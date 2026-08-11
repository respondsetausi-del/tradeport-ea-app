package com.bellyforex.tradeportea.network.module

import com.google.gson.annotations.SerializedName

data class Symbols(
    @SerializedName("data")
    val symbols: MutableList<Symbol>,
    val message: String
)