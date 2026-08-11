package com.bellyforex.tradeportea.network.module

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity( tableName = "log")
data class log(
    @PrimaryKey(autoGenerate = false)
    var id: Int,
    var message: String
)
