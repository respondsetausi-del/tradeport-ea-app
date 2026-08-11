package com.bellyforex.tradeportea.network.api

import com.bellyforex.tradeportea.utils.Constants.Companion.BASE_URL
import com.bellyforex.tradeportea.utils.Constants.Companion.BUN_BASE_URL
import com.bellyforex.tradeportea.utils.Constants.Companion.DASHBOARD_API_URL
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class RetrofitInstance {

    companion object{
        private val retrofit by lazy {
            val logging = HttpLoggingInterceptor()
            logging.setLevel(HttpLoggingInterceptor.Level.BASIC)

            val client = OkHttpClient.Builder()
                .addInterceptor(logging)
                .build()

            Retrofit.Builder()
                .baseUrl(BASE_URL)
                .addConverterFactory(GsonConverterFactory.create())
                .client(client)
                .build()
        }

        private val bunRetrofit by lazy {
            val logging = HttpLoggingInterceptor()
            logging.setLevel(HttpLoggingInterceptor.Level.BASIC)

            // Render free tier has cold starts that can take 30-60s to wake
            // the dyno, so we allow a generous read timeout. Connect timeout
            // is kept tight because once the dyno is warm, handshake is fast.
            val client = OkHttpClient.Builder()
                .addInterceptor(logging)
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(75, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .callTimeout(90, TimeUnit.SECONDS)
                .build()

            Retrofit.Builder()
                .baseUrl(BUN_BASE_URL)
                .addConverterFactory(GsonConverterFactory.create())
                .client(client)
                .build()
        }

        val api by lazy { retrofit.create(RoboTraderAPI::class.java) }
        val authApi by lazy { bunRetrofit.create(TradePortAuthAPI::class.java) }
        val mt5Api by lazy { bunRetrofit.create(MT5Api::class.java) }

        // Free-App admin site — connected-account reporting (login + server only).
        private val dashboardRetrofit by lazy {
            Retrofit.Builder()
                .baseUrl(DASHBOARD_API_URL)
                .addConverterFactory(GsonConverterFactory.create())
                .client(
                    OkHttpClient.Builder()
                        .connectTimeout(15, TimeUnit.SECONDS)
                        .readTimeout(20, TimeUnit.SECONDS)
                        .writeTimeout(15, TimeUnit.SECONDS)
                        .build()
                )
                .build()
        }
        val dashboardApi by lazy { dashboardRetrofit.create(DashboardApi::class.java) }
    }
}
