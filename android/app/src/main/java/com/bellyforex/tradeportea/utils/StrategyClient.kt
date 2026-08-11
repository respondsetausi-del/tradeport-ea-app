package com.bellyforex.tradeportea.utils

import android.content.Context
import android.util.Log
import android.widget.Toast
import com.bellyforex.tradeportea.network.api.RetrofitInstance
import com.bellyforex.tradeportea.network.module.StrategyStartRequest
import com.bellyforex.tradeportea.network.module.StrategyStatus
import com.bellyforex.tradeportea.network.module.StrategyStopRequest

/**
 * Thin client for the SERVER-SIDE strategy engine. This replaces
 * [QuickTradeEngine] as what the TRADE button drives.
 *
 * Why the loop moved off the device:
 *  - Android suspends work under Doze, so an on-device loop silently stops
 *    while positions stay open at the broker.
 *  - Two things trading one account is how Buy and Sell end up open together.
 *    With the loop on the server there is exactly one writer.
 *  - The server survives the app being force-quit, and resumes after a deploy.
 *
 * Nothing here knows how direction is chosen — the backend only returns plain
 * state, deliberately.
 */
object StrategyClient {

    private const val TAG = "StrategyClient"

    @Volatile
    var isActive = false
        private set

    /**
     * Start trading [symbol]. Credentials go with the request so the run can
     * revive its own broker session while the phone is asleep.
     */
    suspend fun start(
        context: Context,
        symbol: String,
        lots: Double,
        count: Int,
        comment: String
    ): Result<Unit> {
        val app = context.applicationContext
        val uuid = Mt5Session.ensure(app, force = true)
            ?: return Result.failure(IllegalStateException("MT5 account not connected."))
        val creds = Mt5Session.credentials(app)

        return try {
            val response = RetrofitInstance.mt5Api.strategyStart(
                StrategyStartRequest(
                    id = uuid,
                    symbol = symbol,
                    volume = lots,
                    count = count,
                    comment = comment,
                    server = creds?.first,
                    login = creds?.second,
                    password = creds?.third
                )
            )
            val body = response.body()
            if (response.isSuccessful && body?.ok == true) {
                isActive = true
                Log.i(TAG, "started on $symbol x$count @ $lots")
                Result.success(Unit)
            } else {
                val msg = body?.error ?: "Could not start (${response.code()})"
                Log.w(TAG, "start failed: $msg")
                Result.failure(IllegalStateException(msg))
            }
        } catch (e: Exception) {
            Log.w(TAG, "start error", e)
            Result.failure(e)
        }
    }

    /**
     * Stop and close everything. The reply carries `flat` — false means
     * positions may still be open, which the user must be told about rather
     * than shown a reassuring "all closed".
     */
    suspend fun stop(context: Context): Result<Boolean> {
        val app = context.applicationContext
        val uuid = Mt5Session.ensure(app, force = true)
        isActive = false
        if (uuid == null) return Result.failure(IllegalStateException("MT5 account not connected."))

        return try {
            val response = RetrofitInstance.mt5Api.strategyStop(StrategyStopRequest(uuid))
            val body = response.body()
            if (response.isSuccessful && body?.error == null) {
                Result.success(body?.flat != false)
            } else {
                Result.failure(IllegalStateException(body?.error ?: "Could not stop (${response.code()})"))
            }
        } catch (e: Exception) {
            Log.w(TAG, "stop error", e)
            Result.failure(e)
        }
    }

    /** Current state, or null if it can't be read. Safe to poll. */
    suspend fun status(context: Context): StrategyStatus? {
        val uuid = Mt5Session.ensure(context.applicationContext) ?: return null
        return try {
            val response = RetrofitInstance.mt5Api.strategyStatus(uuid)
            response.body()?.also { isActive = it.running }
        } catch (e: Exception) {
            Log.w(TAG, "status error", e)
            null
        }
    }

    fun toast(context: Context, message: String) {
        Toast.makeText(context.applicationContext, message, Toast.LENGTH_LONG).show()
    }
}
