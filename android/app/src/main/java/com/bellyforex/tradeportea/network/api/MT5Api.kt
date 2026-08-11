package com.bellyforex.tradeportea.network.api

import com.bellyforex.tradeportea.network.module.Mt5CloseRequest
import com.bellyforex.tradeportea.network.module.Mt5ConnectRequest
import com.bellyforex.tradeportea.network.module.Mt5ConnectResponse
import com.bellyforex.tradeportea.network.module.Mt5DisconnectResponse
import com.bellyforex.tradeportea.network.module.Mt5ReconnectRequest
import com.bellyforex.tradeportea.network.module.Mt5ReconnectResponse
import com.bellyforex.tradeportea.network.module.Mt5TradeRequest
import com.bellyforex.tradeportea.network.module.StrategyActionResponse
import com.bellyforex.tradeportea.network.module.StrategyStartRequest
import com.bellyforex.tradeportea.network.module.StrategyStatus
import com.bellyforex.tradeportea.network.module.StrategyStopRequest
import com.google.gson.JsonElement
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * Retrofit interface for the Api2Trade MT5 proxy on the Bun backend (Render).
 * The app never talks to Api2Trade directly and never holds its credentials —
 * the backend attaches auth server-side and hands back a session UUID that
 * the app uses for every subsequent MT5 call.
 */
interface MT5Api {

    @POST("api/mt5/connect")
    suspend fun connect(@Body body: Mt5ConnectRequest): Response<Mt5ConnectResponse>

    @DELETE("api/mt5/connect")
    suspend fun disconnect(@Query("id") id: String): Response<Mt5DisconnectResponse>

    /**
     * Live account summary (Api2Trade AccountSummary): balance, equity,
     * profit, leverage, currency. Raw JSON — the summary may be top-level
     * or wrapped; parsing happens at the call site.
     */
    @GET("api/mt5/account")
    suspend fun account(@Query("id") id: String): Response<JsonElement>

    /**
     * Broker symbol universe (Api2Trade SymbolList). Returned as raw JSON
     * because the backend may wrap the string array ({"symbols": [...]}) or
     * return it bare; parsing happens in AssetsViewModel.
     */
    @GET("api/mt5/symbols")
    suspend fun symbols(
        @Query("id") id: String,
        @Query("action") action: String = "list"
    ): Response<JsonElement>

    /**
     * Open/modify/close a trade (Api2Trade OrderSend/OrderModify/OrderClose).
     * OrderSend returns HTTP 200 even on broker rejection — callers must
     * treat the order as placed only when the returned ticket > 0.
     */
    @POST("api/mt5/trade")
    suspend fun trade(@Body body: Mt5TradeRequest): Response<JsonElement>

    /** Close a position by ticket — the volume must be included. */
    @POST("api/mt5/trade")
    suspend fun closeTrade(@Body body: Mt5CloseRequest): Response<JsonElement>

    /** Open (or closed) positions on the account. */
    @GET("api/mt5/orders")
    suspend fun orders(
        @Query("id") id: String,
        @Query("type") type: String = "open"
    ): Response<JsonElement>

    /**
     * Probe the session and silently re-establish it under the same UUID if the
     * broker dropped it. Cheap enough to call before anything that matters.
     */
    @POST("api/mt5/reconnect")
    suspend fun reconnect(@Body body: Mt5ReconnectRequest): Response<Mt5ReconnectResponse>

    /**
     * Server-side strategy engine. Direction comes from the market and the
     * loop lives on the backend, so trading continues with the app closed.
     */
    @POST("api/mt5/strategy/start")
    suspend fun strategyStart(@Body body: StrategyStartRequest): Response<StrategyActionResponse>

    @POST("api/mt5/strategy/stop")
    suspend fun strategyStop(@Body body: StrategyStopRequest): Response<StrategyActionResponse>

    @GET("api/mt5/strategy/status")
    suspend fun strategyStatus(@Query("id") id: String): Response<StrategyStatus>
}
