package com.bellyforex.tradeportea.utils

import android.content.Context
import android.graphics.Color

/**
 * FloatingTheme — Provides theme colors for ControlService (runs as Service, not Activity).
 *
 * Reads directly from ThemeEngine's SharedPreferences ("theme_prefs" / "selected_theme")
 * so it always stays in sync when the user changes themes.
 */
object FloatingTheme {

    private const val PREFS_NAME = "theme_prefs"
    private const val KEY_THEME = "selected_theme"

    /** Get the current theme name from SharedPreferences */
    private fun getThemeName(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_THEME, "CRIMSON") ?: "CRIMSON"
    }

    fun getGlassTint(context: Context): Int {
        return when (getThemeName(context)) {
            "CRIMSON"   -> Color.parseColor("#15FF4444")
            "OCEAN"     -> Color.parseColor("#154488FF")
            "EMERALD"   -> Color.parseColor("#1544CC77")
            "VIOLET"    -> Color.parseColor("#15BB86FC")
            "AMBER"     -> Color.parseColor("#15DAA520")
            "SILVER"    -> Color.parseColor("#15AAAAAA")
            "BLACK"     -> Color.parseColor("#15444444")
            "WHITE"     -> Color.parseColor("#15DDDDDD")
            "DARK_BLUE" -> Color.parseColor("#153366AA")
            else        -> Color.parseColor("#15FF4444")
        }
    }

    fun getGlowColor(context: Context): Int {
        return when (getThemeName(context)) {
            "CRIMSON"   -> Color.parseColor("#40FF4444")
            "OCEAN"     -> Color.parseColor("#404488FF")
            "EMERALD"   -> Color.parseColor("#4044CC77")
            "VIOLET"    -> Color.parseColor("#40BB86FC")
            "AMBER"     -> Color.parseColor("#40DAA520")
            "SILVER"    -> Color.parseColor("#40AAAAAA")
            "BLACK"     -> Color.parseColor("#40444444")
            "WHITE"     -> Color.parseColor("#40DDDDDD")
            "DARK_BLUE" -> Color.parseColor("#403366AA")
            else        -> Color.parseColor("#40FF4444")
        }
    }

    /**
     * Full-alpha glow color for WarpGlowDrawable use.
     */
    fun getFullGlowColor(context: Context): Int {
        return when (getThemeName(context)) {
            "CRIMSON"   -> Color.parseColor("#FFFF4444")
            "OCEAN"     -> Color.parseColor("#FF4488FF")
            "EMERALD"   -> Color.parseColor("#FF44CC77")
            "VIOLET"    -> Color.parseColor("#FFBB86FC")
            "AMBER"     -> Color.parseColor("#FFDAA520")
            "SILVER"    -> Color.parseColor("#FFAAAAAA")
            "BLACK"     -> Color.parseColor("#FF444444")
            "WHITE"     -> Color.parseColor("#FFDDDDDD")
            "DARK_BLUE" -> Color.parseColor("#FF3366AA")
            else        -> Color.parseColor("#FFFF4444")
        }
    }

    fun getBorderColor(context: Context): Int {
        return when (getThemeName(context)) {
            "CRIMSON"   -> Color.parseColor("#25FF4444")
            "OCEAN"     -> Color.parseColor("#254488FF")
            "EMERALD"   -> Color.parseColor("#2544CC77")
            "VIOLET"    -> Color.parseColor("#25BB86FC")
            "AMBER"     -> Color.parseColor("#25DAA520")
            "SILVER"    -> Color.parseColor("#25AAAAAA")
            "BLACK"     -> Color.parseColor("#25444444")
            "WHITE"     -> Color.parseColor("#25DDDDDD")
            "DARK_BLUE" -> Color.parseColor("#253366AA")
            else        -> Color.parseColor("#25FF4444")
        }
    }
}
