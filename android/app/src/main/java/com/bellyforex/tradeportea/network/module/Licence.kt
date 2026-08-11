package com.bellyforex.tradeportea.network.module

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.io.Serializable

@Entity( tableName = "licences")
data class Licence(
    var ea_name: String,
    var ea_notification: String,
    var expires: String,
    var key: String,
    var owner: Owner,
    @PrimaryKey(autoGenerate = false)
    var phone_secret_key: String,
    var status: String,
    var user: String,
    var selected: Boolean = false
):Serializable

@Entity( tableName = "sicences")
data class Sicence(
    var ea_name: String,
    var ea_notification: String,
    var expires: String,
    var key: String,
    var owner: Owner,
    var phone_secret_key: String,
    var status: String,
    var user: String,
    @PrimaryKey(autoGenerate = false)
    var selected: Boolean = false
):Serializable