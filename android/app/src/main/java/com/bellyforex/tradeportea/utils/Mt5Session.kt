package com.bellyforex.tradeportea.utils

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.bellyforex.tradeportea.network.api.RetrofitInstance
import com.bellyforex.tradeportea.network.module.Mt5ReconnectRequest

/**
 * Keeps the MT5 session usable.
 *
 * A stored UUID is NOT proof the broker still holds the session — Api2Trade
 * expires idle sessions, after which every call fails with INVALID_TOKEN. The
 * backend can revive the session under the SAME UUID from the stored
 * credentials, so the handle on this device never has to change.
 *
 * Call [ensure] before anything that matters. It is throttled, so calling it
 * liberally is fine.
 */
object Mt5Session {

    private const val TAG = "Mt5Session"
    private const val PROBE_INTERVAL_MS = 60_000L

    @Volatile private var lastProbe = 0L

    fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences("mt5", Context.MODE_PRIVATE)

    fun uuid(context: Context): String? =
        prefs(context).getString("uuid", null)?.takeIf { it.isNotBlank() }

    /** Credentials saved at connect time, used to revive a dead session. */
    fun credentials(context: Context): Triple<String, String, String>? {
        val p = prefs(context)
        val server = p.getString("server", null)?.takeIf { it.isNotBlank() } ?: return null
        val login = p.getString("login", null)?.takeIf { it.isNotBlank() } ?: return null
        val password = p.getString("password", null)?.takeIf { it.isNotBlank() } ?: return null
        return Triple(server, login, password)
    }

    /**
     * Make sure the session behind the stored UUID is alive, reconnecting if
     * not. Returns the UUID to use, or null when there is nothing to work with.
     *
     * [force] skips the throttle — use it after a call has already failed.
     */
    suspend fun ensure(context: Context, force: Boolean = false): String? {
        val uuid = uuid(context) ?: return null
        val creds = credentials(context) ?: return uuid // nothing to reconnect with

        val now = System.currentTimeMillis()
        if (!force && now - lastProbe < PROBE_INTERVAL_MS) return uuid
        lastProbe = now

        return try {
            val (server, login, password) = creds
            val response = RetrofitInstance.mt5Api.reconnect(
                Mt5ReconnectRequest(uuid = uuid, server = server, login = login, password = password)
            )
            val body = response.body()
            if (response.isSuccessful && body?.error == null) {
                if (body?.reconnected == true) Log.i(TAG, "session was dead — reconnected")
                body?.uuid?.takeIf { it.isNotBlank() } ?: uuid
            } else {
                Log.w(TAG, "reconnect failed: ${body?.error ?: response.code()}")
                uuid // let the caller try anyway; the server may still be fine
            }
        } catch (e: Exception) {
            Log.w(TAG, "reconnect error", e)
            uuid
        }
    }
}
