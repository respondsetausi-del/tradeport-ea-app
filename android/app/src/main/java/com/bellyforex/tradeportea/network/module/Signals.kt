package com.bellyforex.tradeportea.network.module

import com.google.gson.annotations.SerializedName

data class Signals(
    @SerializedName("data")
    var signal: Signal,
    var message: String
)