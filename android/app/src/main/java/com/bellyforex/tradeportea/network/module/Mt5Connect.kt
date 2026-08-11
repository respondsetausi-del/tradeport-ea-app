package com.bellyforex.tradeportea.network.module

import com.google.gson.annotations.SerializedName

data class Mt5ConnectRequest(
    val server: String,
    val login: String,
    val password: String
)

/**
 * Payload of POST /api/mt5/connect on the Bun backend. The backend generates
 * the session UUID (ConnectEx) and validates it via AccountSummary.leverage > 0
 * before returning, so a 2xx with a UUID means the MT5 account is genuinely
 * connected. Field names are kept permissive (uuid/id/sessionId) so the client
 * works regardless of which key the backend uses.
 */
data class Mt5ConnectResponse(
    val uuid: String? = null,
    val id: String? = null,
    @SerializedName("sessionId") val sessionIdField: String? = null,
    val error: String? = null,
    val message: String? = null,
    val summary: Mt5AccountSummary? = null,
    val account: Mt5AccountSummary? = null
) {
    val sessionId: String?
        get() = uuid ?: id ?: sessionIdField
}

data class Mt5AccountSummary(
    val balance: Double? = null,
    val equity: Double? = null,
    val profit: Double? = null,
    val margin: Double? = null,
    val freeMargin: Double? = null,
    val marginLevel: Double? = null,
    val leverage: Double? = null,
    val currency: String? = null
)

data class Mt5DisconnectResponse(
    val message: String? = null,
    val error: String? = null
)

/**
 * Body of POST /api/mt5/trade. `symbol` must be the broker's exact string
 * (case-sensitive, suffix included) and `volume` uses a dot decimal.
 * The backend maps action "open" to Api2Trade OrderSend.
 */
data class Mt5TradeRequest(
    val id: String,
    val action: String,
    val symbol: String,
    val operation: String,
    val volume: Double,
    val comment: String? = null,
    /**
     * Optional protective levels, sent with the order rather than applied
     * afterwards — a position that exists for even a moment without its stop is
     * a position that can gap through where the stop should have been.
     */
    val stoploss: Double? = null,
    val takeprofit: Double? = null
)

/**
 * Close body for POST /api/mt5/trade. OrderClose must include the volume or
 * the position doesn't close — both `lots` and `volume` are sent since the
 * backend's field name isn't pinned.
 */
data class Mt5CloseRequest(
    val id: String,
    val action: String = "close",
    val ticket: Long,
    val lots: Double? = null,
    val volume: Double? = null
)

/**
 * Body of POST /api/mt5/reconnect. The backend probes the session behind
 * `uuid` and, if the broker dropped it, re-authenticates under the SAME uuid —
 * so the handle stored on this device stays valid and nothing downstream has
 * to be rewired.
 */
data class Mt5ReconnectRequest(
    val uuid: String,
    val server: String,
    val login: String,
    val password: String
)

data class Mt5ReconnectResponse(
    val uuid: String? = null,
    val reconnected: Boolean? = null,
    val error: String? = null
)

/**
 * Body of POST /api/mt5/strategy/start.
 *
 * Trading runs on the SERVER, not here — it keeps going with the app
 * backgrounded or force-quit, which an on-device loop cannot do under Doze.
 *
 * `server`/`login`/`password` are sent so the run can revive its own broker
 * session while the phone is asleep; without them an expired token halts it
 * until the app is reopened.
 */
data class StrategyStartRequest(
    val id: String,
    val symbol: String,
    val volume: Double,
    val count: Int,
    val comment: String,
    val server: String? = null,
    val login: String? = null,
    val password: String? = null
)

data class StrategyStopRequest(val id: String)

data class StrategyActionResponse(
    val ok: Boolean? = null,
    val running: Boolean? = null,
    val wasRunning: Boolean? = null,
    val flat: Boolean? = null,
    val error: String? = null
)

/**
 * PUBLIC status only. The backend deliberately withholds how direction is
 * decided — no indicator names, thresholds or reasons are exposed to the app,
 * so nothing here can reveal the method.
 */
data class StrategyStatus(
    val running: Boolean = false,
    val symbol: String? = null,
    val volume: Double? = null,
    val count: Int? = null,
    val direction: String? = null,
    val openTrades: Int? = null,
    val status: String? = null,
    val tradesPlaced: Int? = null,
    val uptimeSec: Long? = null
)
