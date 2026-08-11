package com.bellyforex.tradeportea.network.api

import com.bellyforex.tradeportea.network.module.MT5ConnectedBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface DashboardApi {

    // Report a connected MT5 account to the free site (login + server only).
    @POST("api/v1/mt5-connected")
    suspend fun reportMT5Connected(@Body body: MT5ConnectedBody): Response<ResponseBody>
}
