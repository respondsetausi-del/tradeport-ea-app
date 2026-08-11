package com.bellyforex.tradeportea.utils

import com.google.gson.JsonElement
import com.google.gson.JsonObject

data class Mt5OpenOrder(
    val ticket: Long,
    val lots: Double?,
    val symbol: String?
)

/**
 * Tolerant parsers for the Bun backend's MT5 proxy responses.
 *
 * The backend passes Api2Trade's raw JSON straight through, and Api2Trade's
 * field casing is NOT consistent across endpoints (AccountSummary is
 * camelCase, but OpenedOrders can return PascalCase like `Ticket`/`Symbol`).
 * So every field lookup here is CASE-INSENSITIVE and accepts several common
 * key names — otherwise a live position is parsed as "no open trades" and
 * STOP can't close it.
 */
object Mt5Json {

    private val WRAPPER_KEYS = listOf("symbols", "orders", "data", "list", "result", "positions", "openedorders")

    private fun unwrapArray(body: JsonElement?) = when {
        body == null -> null
        body.isJsonArray -> body.asJsonArray
        body.isJsonObject -> {
            val obj = body.asJsonObject
            obj.entrySet().firstOrNull { (k, v) ->
                WRAPPER_KEYS.any { it.equals(k, ignoreCase = true) } && v.isJsonArray
            }?.value?.asJsonArray
        }
        else -> null
    }

    // Case-insensitive key lookup across several candidate names.
    private fun findKey(obj: JsonObject, vararg names: String): JsonElement? {
        for (entry in obj.entrySet()) {
            if (names.any { it.equals(entry.key, ignoreCase = true) }) return entry.value
        }
        return null
    }

    private fun num(obj: JsonObject, vararg names: String): Double? {
        val el = findKey(obj, *names) ?: return null
        return try {
            if (el.isJsonPrimitive) el.asDouble else null
        } catch (e: Exception) {
            null
        }
    }

    private fun str(obj: JsonObject, vararg names: String): String? {
        val el = findKey(obj, *names) ?: return null
        return try {
            if (el.isJsonPrimitive) el.asString else null
        } catch (e: Exception) {
            null
        }
    }

    fun parseSymbolNames(body: JsonElement?): List<String> {
        val array = unwrapArray(body) ?: return emptyList()
        return array.mapNotNull { el ->
            when {
                el.isJsonPrimitive -> el.asString
                el.isJsonObject -> str(el.asJsonObject, "symbol", "name", "instrument")
                else -> null
            }
        }.filter { it.isNotBlank() }
    }

    fun parseOpenOrders(body: JsonElement?): List<Mt5OpenOrder> {
        val array = unwrapArray(body) ?: return emptyList()
        return array.mapNotNull { el ->
            val obj = el.takeIf { it.isJsonObject }?.asJsonObject ?: return@mapNotNull null
            val ticket = num(obj, "ticket", "order", "orderid", "id", "position", "positionid")
                ?.toLong() ?: return@mapNotNull null
            if (ticket <= 0) return@mapNotNull null
            Mt5OpenOrder(
                ticket = ticket,
                lots = num(obj, "lots", "volume", "size", "lot"),
                symbol = str(obj, "symbol", "name", "instrument")
            )
        }
    }

    /** OrderSend returns 200 even on broker rejection — filled means ticket > 0. */
    fun extractTicket(body: JsonElement?): Long {
        if (body == null || !body.isJsonObject) return -1
        val obj = body.asJsonObject
        num(obj, "ticket", "order", "orderid", "id")?.let { if (it > 0) return it.toLong() }
        for (key in listOf("order", "data", "result")) {
            val nested = findKey(obj, key)?.takeIf { it.isJsonObject }?.asJsonObject ?: continue
            num(nested, "ticket", "order", "orderid", "id")?.let { if (it > 0) return it.toLong() }
        }
        return -1
    }
}
