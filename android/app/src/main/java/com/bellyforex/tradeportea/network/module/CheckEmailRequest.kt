package com.bellyforex.tradeportea.network.module

import com.google.gson.annotations.SerializedName

/**
 * Request body for POST /api/check-email on the Bun auth backend.
 * Mirrors the shape expected by services/api.ts in the tradeport-ea-app repo.
 */
data class CheckEmailRequest(
    val email: String,
    val mentor: String,
    @SerializedName("device_id") val deviceId: String
)
