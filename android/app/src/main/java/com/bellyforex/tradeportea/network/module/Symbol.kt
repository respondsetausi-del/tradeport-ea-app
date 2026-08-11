package com.bellyforex.tradeportea.network.module

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.io.Serializable

@Entity( tableName = "symbols")
data class Symbol(
    @PrimaryKey(autoGenerate = false)
    val id:Int,
    val name: String,
    val phone_secret: String?,
    val lotSize : Double?,
    val action : String?,
    val platform : String?
):Serializable