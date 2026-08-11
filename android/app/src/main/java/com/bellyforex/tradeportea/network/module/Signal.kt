package com.bellyforex.tradeportea.network.module

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.io.Serializable

@Entity( tableName = "signals")
data class Signal(
    @PrimaryKey(autoGenerate = false)
    var id: Int,
    var action: String,
    var asset: String,
    var latestupdate: String,
    var price: String,
    var sl: String,
    var time: String,
    var tp: String,
    val lotSize : Double?,
    val platform : String?,
    var used: Boolean = false
): Serializable