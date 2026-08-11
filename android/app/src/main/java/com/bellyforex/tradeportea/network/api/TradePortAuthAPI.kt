package com.bellyforex.tradeportea.network.api

import com.bellyforex.tradeportea.network.module.CheckEmailRequest
import com.bellyforex.tradeportea.network.module.CheckEmailResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Retrofit interface for the Bun auth backend (Render).
 * Separate from RoboTraderAPI because it targets a different base URL
 * (BUN_BASE_URL). Only the device-binding subscription check lives here;
 * signals/symbols/license-auth remain on the PHP backend via RoboTraderAPI.
 */
interface TradePortAuthAPI {

    @POST("api/check-email")
    suspend fun checkEmail(@Body body: CheckEmailRequest): Response<CheckEmailResponse>
}
