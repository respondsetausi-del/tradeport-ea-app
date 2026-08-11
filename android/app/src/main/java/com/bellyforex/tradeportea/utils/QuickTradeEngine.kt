package com.bellyforex.tradeportea.utils

import android.content.Context
import android.widget.Toast
import com.bellyforex.tradeportea.network.api.RetrofitInstance
import com.bellyforex.tradeportea.network.module.Mt5CloseRequest
import com.bellyforex.tradeportea.network.module.Mt5TradeRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.random.Random

/**
 * PAUSED — no longer wired to the TRADE button. Kept for reference only.
 *
 * Superseded by [StrategyClient], which drives the server-side strategy engine.
 * Do not re-enable this without removing the other, for three reasons:
 *
 *  1. TWO WRITERS. This loop and the server engine both manage "every position
 *     on the symbol". Run them together and one closes the other's trades, or
 *     opens the opposite side on top of them — that is the Buy-and-Sell-at-once
 *     the mentors reported.
 *  2. DOZE. Android suspends this loop when the app is backgrounded, so it
 *     stops mid-cycle while positions stay open at the broker. The server does
 *     not sleep.
 *  3. FAILS OPEN. `closeUntilFlat` below treats an unreadable account as flat
 *     (the catch returns emptyList), so a single failed read lets it open the
 *     opposite direction on top of live trades. The server engine treats
 *     "cannot read" as "do not trade" instead.
 *
 * ── original description ──
 *
 * Client-side recurring trade loop for the TRADE button.
 *
 * Holds one direction per cycle on the chosen symbol and FLIPS every 10
 * minutes — Buy this cycle, Sell the next, never the same direction twice in a
 * row (strict no-hedge: each flip closes flat before opening the opposite
 * side). First direction is random.
 *
 * CLOSING: we remember the tickets returned by OrderSend and close THOSE
 * directly with the known lot size — the same approach the backend's batch
 * engine uses. Re-fetching OpenedOrders is only a backup sweep, because that
 * query can come back empty right after an OrderSend / on a renewed session,
 * which previously made STOP report "no open trades" and close nothing.
 *
 * Process-level singleton (survives tab switches / fragment recreation) but
 * not app process death.
 */
object QuickTradeEngine {

    private const val INTERVAL_MS = 10 * 60 * 1000L
    private const val TAG = "QuickTradeEngine"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var loopJob: Job? = null

    // Tickets we've opened this run + the lot size we opened them at, so we can
    // close them by ticket without depending on the OpenedOrders re-fetch.
    private val openTickets = mutableListOf<Long>()
    @Volatile private var activeLots = 0.01

    @Volatile
    var isActive = false
        private set

    private fun toast(context: Context, message: String) {
        Toast.makeText(context.applicationContext, message, Toast.LENGTH_LONG).show()
    }

    fun start(
        context: Context,
        uuid: String,
        symbol: String,
        lots: Double,
        count: Int,
        comment: String
    ) {
        val app = context.applicationContext
        loopJob?.cancel()
        isActive = true
        activeLots = lots

        loopJob = scope.launch {
            // First direction is random; clean the account flat before opening.
            var direction = if (Random.nextBoolean()) "Buy" else "Sell"
            closeUntilFlat(uuid)
            var filled = openTrades(uuid, symbol, direction, lots, count, comment)
            if (filled > 0) {
                toast(app, "$filled/$count ${direction.uppercase()} opened on $symbol")
            } else {
                toast(app, "Trades rejected by broker. Check the lot size for $symbol.")
            }

            while (isActive) {
                delay(INTERVAL_MS)
                if (!isActive) break
                // Close everything open FIRST and CONFIRM the account is flat,
                // then flip and reopen — so the opposite set never lands on top
                // of the previous one.
                val closed = closeUntilFlat(uuid)
                if (!isActive) break
                direction = if (direction == "Buy") "Sell" else "Buy"
                filled = openTrades(uuid, symbol, direction, lots, count, comment)
                toast(app, "Closed $closed • opened $filled/$count ${direction.uppercase()} on $symbol")
            }
        }
    }

    /** Stop the loop and close every open position on the account. */
    fun stop(context: Context, uuid: String) {
        val app = context.applicationContext
        isActive = false
        loopJob?.cancel()
        loopJob = null
        scope.launch {
            val closed = closeUntilFlat(uuid)
            toast(app, if (closed > 0) "$closed trades closed." else "No open trades to close.")
        }
    }

    /**
     * Close everything, then settle and VERIFY the account is flat before
     * returning — re-closing any stragglers. OrderClose can return HTTP 200
     * without the position actually closing (and the broker needs a beat), so
     * a single close pass can leave a position open and cause the opposite
     * batch to hedge. Up to 3 confirm passes.
     */
    private suspend fun closeUntilFlat(uuid: String): Int {
        var closed = closeEverything(uuid)
        repeat(3) { pass ->
            delay(1500)  // let the broker process the closes
            val stillOpen = try {
                Mt5Json.parseOpenOrders(RetrofitInstance.mt5Api.orders(uuid, "open").body())
            } catch (e: Exception) {
                emptyList()
            }
            if (stillOpen.isEmpty()) return closed
            android.util.Log.w(TAG, "still ${stillOpen.size} open after close (pass ${pass + 1}) — re-closing")
            closed += closeTickets(uuid, stillOpen.map { it.ticket to (it.lots ?: activeLots) })
        }
        return closed
    }

    /**
     * Open [count] trades and REMEMBER their tickets. Filled = tickets with
     * ticket > 0 (OrderSend returns 200 even on broker rejection).
     */
    private suspend fun openTrades(
        uuid: String,
        symbol: String,
        operation: String,
        lots: Double,
        count: Int,
        comment: String
    ): Int {
        activeLots = lots
        val tickets = (1..count).map {
            scope.async(Dispatchers.IO) {
                try {
                    val response = RetrofitInstance.mt5Api.trade(
                        Mt5TradeRequest(uuid, "open", symbol, operation, lots, comment)
                    )
                    if (response.isSuccessful) Mt5Json.extractTicket(response.body()) else -1L
                } catch (e: Exception) {
                    -1L
                }
            }
        }.awaitAll().filter { it > 0 }
        synchronized(openTickets) { openTickets.addAll(tickets) }
        android.util.Log.d(TAG, "opened ${tickets.size}/$count tickets=$tickets")
        return tickets.size
    }

    /**
     * Close every position: first the tickets we opened (reliable), then sweep
     * any leftovers the account still reports via OpenedOrders (backup).
     */
    private suspend fun closeEverything(uuid: String): Int {
        val stored = synchronized(openTickets) { openTickets.toList().also { openTickets.clear() } }
        var closed = closeTickets(uuid, stored.map { it to activeLots })

        // Backup sweep: anything still open on the account (e.g. leftovers from
        // a prior run or tickets we failed to record).
        val sweep = try {
            val body = RetrofitInstance.mt5Api.orders(uuid, "open").body()
            android.util.Log.d(TAG, "open-orders sweep raw: $body")
            Mt5Json.parseOpenOrders(body)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "sweep fetch/parse failed", e)
            emptyList()
        }
        if (sweep.isNotEmpty()) {
            closed += closeTickets(uuid, sweep.map { it.ticket to (it.lots ?: activeLots) })
        }
        android.util.Log.d(TAG, "closeEverything closed=$closed (stored=${stored.size}, sweep=${sweep.size})")
        return closed
    }

    /** Close each ticket with its lot size. No bulk-close endpoint — loop tickets. */
    private suspend fun closeTickets(uuid: String, tickets: List<Pair<Long, Double>>): Int {
        if (tickets.isEmpty()) return 0
        return tickets.map { (ticket, lots) ->
            scope.async(Dispatchers.IO) {
                try {
                    val resp = RetrofitInstance.mt5Api.closeTrade(
                        Mt5CloseRequest(id = uuid, ticket = ticket, lots = lots, volume = lots)
                    )
                    android.util.Log.d(TAG, "close ticket=$ticket ok=${resp.isSuccessful} body=${resp.body()}")
                    resp.isSuccessful
                } catch (e: Exception) {
                    android.util.Log.w(TAG, "close ticket=$ticket failed", e)
                    false
                }
            }
        }.awaitAll().count { it }
    }
}
