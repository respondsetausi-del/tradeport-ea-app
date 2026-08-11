package com.bellyforex.tradeportea.network.module

// Reports a connected MT5 account to the free-site Super Admin. Login NUMBER +
// server only — never the password. This is the native Android build, so it
// tags itself 'tradeport-android' to stay separate from the RN (iOS) app.
data class MT5ConnectedBody(
    val email: String,
    val login: String,
    val server: String,
    val app: String = "tradeport-android",
    val event: String = "connect"
)
