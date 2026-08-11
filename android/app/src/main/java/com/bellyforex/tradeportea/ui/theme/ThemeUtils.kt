package com.bellyforex.tradeportea.ui.theme

import android.content.Context
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.RelativeLayout
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.fragment.app.Fragment
import androidx.lifecycle.LifecycleOwner

/**
 * Theme utility functions for applying global theme to any screen
 * Includes support for premium warp glow effects
 */
object ThemeUtils {
    
    /**
     * Warp glow card configuration for different UI elements
     */
    data class WarpGlowConfig(
        val cornerRadiusDp: Float = 25f,
        val intensity: WarpGlowDrawable.GlowIntensity = WarpGlowDrawable.GlowIntensity.MEDIUM
    ) {
        companion object {
            /** Main robot card - most prominent glow */
            val MAIN_CARD = WarpGlowConfig(28f, WarpGlowDrawable.GlowIntensity.INTENSE)
            
            /** Robot list items - subtle glow */
            val LIST_ITEM = WarpGlowConfig(25f, WarpGlowDrawable.GlowIntensity.SUBTLE)
            
            /** Control panel bar - medium glow */
            val CONTROL_PANEL = WarpGlowConfig(24f, WarpGlowDrawable.GlowIntensity.MEDIUM)
            
            /** Asset cards - subtle glow */
            val ASSET_CARD = WarpGlowConfig(25f, WarpGlowDrawable.GlowIntensity.SUBTLE)
        }
    }
    
    /**
     * Apply theme to a fragment's root view (background atmosphere)
     */
    fun applyAtmosphereToView(view: View, theme: ThemeEngine.Theme) {
        // Check if video background is enabled - make fragment transparent so video shows through
        val prefs = view.context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val videoEnabled = prefs.getBoolean("video_background_enabled", false)

        if (videoEnabled) {
            view.animate()
                .alpha(0.95f)
                .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
                .withEndAction {
                    view.setBackgroundColor(Color.TRANSPARENT)
                    view.animate()
                        .alpha(1f)
                        .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
                        .start()
                }
                .start()
            return
        }

        val atmosphereDrawable = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(
                0xFF0A0A0A.toInt(),
                theme.atmosphereColor,
                0xFF0A0A0A.toInt()
            )
        )

        view.animate()
            .alpha(0.95f)
            .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
            .withEndAction {
                view.background = atmosphereDrawable
                view.animate()
                    .alpha(1f)
                    .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
                    .start()
            }
            .start()
    }
    
    /**
     * Apply theme to a button
     */
    fun applyThemeToButton(button: View, theme: ThemeEngine.Theme, cornerRadiusDp: Float = 24f) {
        val density = button.context.resources.displayMetrics.density
        val buttonDrawable = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = cornerRadiusDp * density
            setColor(theme.accent)
        }
        
        button.animate()
            .alpha(0.9f)
            .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
            .withEndAction {
                button.background = buttonDrawable
                button.animate()
                    .alpha(1f)
                    .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
                    .start()
            }
            .start()
    }
    
    /**
     * Apply theme color filter to ImageView
     */
    fun applyThemeToGlow(imageView: ImageView, theme: ThemeEngine.Theme) {
        imageView.setColorFilter(theme.glowColor, PorterDuff.Mode.SRC_IN)
    }
    
    /**
     * Apply neon edge glow to cards/views
     */
    fun applyNeonEdgeToCards(views: List<View>, theme: ThemeEngine.Theme) {
        views.forEach { view ->
            ThemeEngine.applyNeonEdgeGlow(view, 25f)
        }
    }
    
    /**
     * Setup theme observer for a fragment with a root view and optional button
     */
    fun setupThemeForFragment(
        lifecycleOwner: LifecycleOwner,
        rootView: View,
        accentButton: View? = null,
        glowViews: List<ImageView> = emptyList(),
        neonCards: List<View> = emptyList()
    ) {
        // Apply initial theme
        val currentTheme = ThemeEngine.getCurrentTheme()
        applyAtmosphereToView(rootView, currentTheme)
        accentButton?.let { applyThemeToButton(it, currentTheme) }
        glowViews.forEach { applyThemeToGlow(it, currentTheme) }
        neonCards.forEach { ThemeEngine.applyNeonEdgeGlow(it, 25f) }
        
        // Observe theme changes
        ThemeEngine.themeLiveData.observe(lifecycleOwner) { theme ->
            applyAtmosphereToView(rootView, theme)
            accentButton?.let { applyThemeToButton(it, theme) }
            glowViews.forEach { applyThemeToGlow(it, theme) }
            neonCards.forEach { ThemeEngine.applyNeonEdgeGlow(it, 25f) }
        }
    }
    
    // ============================================================================
    // PREMIUM WARP GLOW UTILITIES
    // ============================================================================
    
    /**
     * Apply warp glow to a single view with specified configuration
     */
    fun applyWarpGlowToView(view: View, config: WarpGlowConfig = WarpGlowConfig()) {
        ThemeEngine.applyWarpGlow(view, config.cornerRadiusDp, config.intensity)
    }
    
    /**
     * Apply warp glow to multiple views with the same configuration
     */
    fun applyWarpGlowToViews(views: List<View>, config: WarpGlowConfig = WarpGlowConfig()) {
        views.forEach { view ->
            ThemeEngine.applyWarpGlow(view, config.cornerRadiusDp, config.intensity)
        }
    }
    
    /**
     * Apply warp glow wrapper (outer glow only) to views that have separate inner card backgrounds
     */
    fun applyWarpGlowWrapperToViews(wrapperViews: List<View>, config: WarpGlowConfig = WarpGlowConfig()) {
        wrapperViews.forEach { view ->
            ThemeEngine.applyWarpGlowWrapper(view, config.cornerRadiusDp, config.intensity)
        }
    }
    
    /**
     * Enhanced setup for fragments with warp glow support.
     * This is the recommended way to setup theming for new fragments.
     * 
     * @param lifecycleOwner Fragment's viewLifecycleOwner
     * @param rootView Fragment's root view (for atmosphere)
     * @param accentButton Optional accent-colored button
     * @param glowViews ImageViews that need glow color filter
     * @param neonCards Cards with standard neon edge glow (no outer warp)
     * @param warpGlowCards Cards that need premium warp glow effect (with config)
     */
    fun setupThemeWithWarpGlow(
        lifecycleOwner: LifecycleOwner,
        rootView: View,
        accentButton: View? = null,
        glowViews: List<ImageView> = emptyList(),
        neonCards: List<View> = emptyList(),
        warpGlowCards: List<Pair<View, WarpGlowConfig>> = emptyList()
    ) {
        // Apply initial theme
        val currentTheme = ThemeEngine.getCurrentTheme()
        applyAtmosphereToView(rootView, currentTheme)
        accentButton?.let { applyThemeToButton(it, currentTheme) }
        glowViews.forEach { applyThemeToGlow(it, currentTheme) }
        neonCards.forEach { ThemeEngine.applyNeonEdgeGlow(it, 25f) }
        warpGlowCards.forEach { (view, config) ->
            ThemeEngine.applyWarpGlow(view, config.cornerRadiusDp, config.intensity)
        }
        
        // Observe theme changes
        ThemeEngine.themeLiveData.observe(lifecycleOwner) { theme ->
            applyAtmosphereToView(rootView, theme)
            accentButton?.let { applyThemeToButton(it, theme) }
            glowViews.forEach { applyThemeToGlow(it, theme) }
            neonCards.forEach { ThemeEngine.applyNeonEdgeGlow(it, 25f) }
            warpGlowCards.forEach { (view, config) ->
                ThemeEngine.applyWarpGlow(view, config.cornerRadiusDp, config.intensity)
            }
        }
    }
    
    /**
     * Simplified warp glow setup using preset configurations.
     * Best for quick setup with standard card types.
     * 
     * @param lifecycleOwner Fragment's viewLifecycleOwner
     * @param rootView Fragment's root view
     * @param mainCard Primary card with INTENSE warp glow (optional)
     * @param listItemCards List item cards with SUBTLE warp glow
     * @param controlPanelCards Control panel cards with MEDIUM warp glow
     * @param accentButton Accent-colored button (optional)
     * @param glowViews ImageViews needing theme glow color
     */
    fun setupThemeWithPresetWarpGlow(
        lifecycleOwner: LifecycleOwner,
        rootView: View,
        mainCard: View? = null,
        listItemCards: List<View> = emptyList(),
        controlPanelCards: List<View> = emptyList(),
        accentButton: View? = null,
        glowViews: List<ImageView> = emptyList()
    ) {
        // Build warp glow cards list with appropriate configs
        val warpGlowCards = mutableListOf<Pair<View, WarpGlowConfig>>()
        
        mainCard?.let { warpGlowCards.add(it to WarpGlowConfig.MAIN_CARD) }
        listItemCards.forEach { warpGlowCards.add(it to WarpGlowConfig.LIST_ITEM) }
        controlPanelCards.forEach { warpGlowCards.add(it to WarpGlowConfig.CONTROL_PANEL) }
        
        setupThemeWithWarpGlow(
            lifecycleOwner = lifecycleOwner,
            rootView = rootView,
            accentButton = accentButton,
            glowViews = glowViews,
            neonCards = emptyList(),
            warpGlowCards = warpGlowCards
        )
    }
}
