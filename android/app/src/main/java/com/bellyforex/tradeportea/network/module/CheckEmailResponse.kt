package com.bellyforex.tradeportea.network.module

import com.google.gson.annotations.SerializedName

/**
 * Response body from POST /api/check-email on the Bun auth backend.
 * Fields are numeric int flags (0/1) matching app/api/check-email/route.ts.
 */
data class CheckEmailResponse(
    val found: Int = 0,
    val used: Int = 0,
    val paid: Int = 0,
    @SerializedName("invalidMentor") val invalidMentor: Int = 0,
    val expired: Int = 0,
    @SerializedName("expiry_date") val expiryDate: String? = null,
    @SerializedName("device_mismatch") val deviceMismatch: Int = 0
)
