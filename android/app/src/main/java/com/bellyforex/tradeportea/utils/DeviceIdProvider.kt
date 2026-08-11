package com.bellyforex.tradeportea.utils

import android.content.Context
import java.util.UUID

/**
 * Persistent device fingerprint for anti-sharing device binding.
 *
 * Format matches the React Native tradeport-ea-app client in
 * services/api.ts exactly: `android-<uuid-with-dashes>-<ms-timestamp>`.
 * The value is generated once on first call, persisted in
 * SharedPreferences under the `device_prefs` namespace, and never
 * changes for the lifetime of the install. An app-data wipe reassigns
 * a new id, which is intentional — that path is the customer-visible
 * "new device" scenario and is handled by the admin reset flow.
 *
 * The resulting id is sent to the Bun /api/check-email endpoint on
 * every auth call so one subscription is locked to one device.
 */
object DeviceIdProvider {
    private const val PREFS = "device_prefs"
    private const val KEY = "device_id"

    fun get(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(KEY, null)?.let { return it }

        // Match the RN format: `${Platform.OS}-${uuidWithDashes}-${Date.now()}`
        // UUID.randomUUID() already produces dashed 8-4-4-4-12 hex like the
        // JS generator in services/api.ts, so both platforms emit
        // byte-compatible ids into the shared `members.device_id` column.
        val uuid = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()
        val deviceId = "android-$uuid-$timestamp"

        prefs.edit().putString(KEY, deviceId).apply()
        return deviceId
    }

    /**
     * Clears the cached device id. Only used when the user is explicitly
     * signing out of their account — not on every revoke, because a revoked
     * user should stay bound to their current phone so the admin panel can
     * still see which device they're locked to.
     */
    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY)
            .apply()
    }
}
