package com.bellyforex.tradeportea.ui.theme

import android.animation.ArgbEvaluator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.view.View
import android.widget.ImageView
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData

/**
 * iOS 26 Theme Engine - Global & Reactive
 * Controls: glows, edges, trade button animation, background atmosphere, button accents
 * Does NOT control: text hierarchy, glass opacity, core layout
 */
object ThemeEngine {
    
    private const val PREFS_NAME = "theme_prefs"
    private const val KEY_THEME = "selected_theme"
    const val TRANSITION_DURATION = 350L
    
    enum class Theme(
        val glowColor: Int,
        val glowSoft: Int,
        val accent: Int,
        val highlight: Int,
        val atmosphereColor: Int
    ) {
        CRIMSON(0xFF990000.toInt(), 0xFF660000.toInt(), 0xFFAA0000.toInt(), 0xFFCC0000.toInt(), 0xFF330000.toInt()),
        OCEAN(0xFF006699.toInt(), 0xFF004466.toInt(), 0xFF0088AA.toInt(), 0xFF00AACC.toInt(), 0xFF001833.toInt()),
        EMERALD(0xFF006644.toInt(), 0xFF004433.toInt(), 0xFF008855.toInt(), 0xFF00AA66.toInt(), 0xFF001A11.toInt()),
        VIOLET(0xFF660099.toInt(), 0xFF440066.toInt(), 0xFF8800AA.toInt(), 0xFFAA00CC.toInt(), 0xFF1A0033.toInt()),
        AMBER(0xFF996600.toInt(), 0xFF664400.toInt(), 0xFFAA7700.toInt(), 0xFFCC8800.toInt(), 0xFF331A00.toInt()),
        SILVER(0xFF555555.toInt(), 0xFF333333.toInt(), 0xFF777777.toInt(), 0xFF999999.toInt(), 0xFF1A1A1A.toInt()),
        BLACK(0xFF222222.toInt(), 0xFF111111.toInt(), 0xFF333333.toInt(), 0xFF444444.toInt(), 0xFF080808.toInt()),
        WHITE(0xFFCCCCCC.toInt(), 0xFF999999.toInt(), 0xFFDDDDDD.toInt(), 0xFFEEEEEE.toInt(), 0xFF2A2A2A.toInt()),
        DARK_BLUE(0xFF003366.toInt(), 0xFF002244.toInt(), 0xFF004488.toInt(), 0xFF0055AA.toInt(), 0xFF000D1A.toInt())
    }
    
    private var currentTheme: Theme = Theme.CRIMSON
    private val _themeLiveData = MutableLiveData<Theme>()
    val themeLiveData: LiveData<Theme> = _themeLiveData
    
    private var listeners: MutableList<ThemeChangeListener> = mutableListOf()
    
    interface ThemeChangeListener {
        fun onThemeChanged(theme: Theme)
    }
    
    fun init(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val themeName = prefs.getString(KEY_THEME, Theme.CRIMSON.name) ?: Theme.CRIMSON.name
        currentTheme = try {
            Theme.valueOf(themeName)
        } catch (e: Exception) {
            Theme.CRIMSON
        }
        _themeLiveData.value = currentTheme
    }
    
    fun getCurrentTheme(): Theme = currentTheme
    
    fun setTheme(context: Context, theme: Theme) {
        if (currentTheme == theme) return
        
        currentTheme = theme
        
        // Save preference
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, theme.name)
            .apply()
        
        // Update LiveData (for reactive UI)
        _themeLiveData.postValue(theme)
        
        // Notify legacy listeners
        listeners.forEach { it.onThemeChanged(theme) }
    }
    
    fun addListener(listener: ThemeChangeListener) {
        if (!listeners.contains(listener)) {
            listeners.add(listener)
        }
    }
    
    fun removeListener(listener: ThemeChangeListener) {
        listeners.remove(listener)
    }
    
    // Helper to get glow color with alpha
    fun getGlowColor(alpha: Int = 0x40): Int {
        val color = currentTheme.glowColor
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
    }
    
    fun getGlowSoftColor(alpha: Int = 0x25): Int {
        val color = currentTheme.glowSoft
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
    }
    
    fun getAccentColor(): Int = currentTheme.accent
    
    fun getHighlightColor(): Int = currentTheme.highlight
    
    fun getAtmosphereColor(): Int = currentTheme.atmosphereColor
    
    // Smooth color transition for any view background
    fun animateBackgroundTint(view: View, fromColor: Int, toColor: Int) {
        val animator = ValueAnimator.ofObject(ArgbEvaluator(), fromColor, toColor)
        animator.duration = TRANSITION_DURATION
        animator.addUpdateListener { anim ->
            val color = anim.animatedValue as Int
            view.background?.setColorFilter(color, PorterDuff.Mode.MULTIPLY)
        }
        animator.start()
    }
    
    // Create themed atmosphere gradient drawable
    fun createAtmosphereDrawable(): GradientDrawable {
        val theme = currentTheme
        return GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(
                0xFF0A0A0A.toInt(),
                theme.atmosphereColor,
                0xFF0A0A0A.toInt()
            )
        )
    }
    
    // Apply theme glow to a card view with smooth transition
    fun applyCardGlow(view: View, cornerRadiusDp: Float = 24f) {
        val density = view.context.resources.displayMetrics.density
        val cornerRadius = cornerRadiusDp * density
        
        val glowDrawable = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setCornerRadius(cornerRadius)
            setStroke((1 * density).toInt(), getGlowColor(0x25))
        }
        
        view.animate()
            .alpha(0.97f)
            .setDuration(TRANSITION_DURATION / 2)
            .withEndAction {
                view.background = glowDrawable
                view.animate()
                    .alpha(1f)
                    .setDuration(TRANSITION_DURATION / 2)
                    .start()
            }
            .start()
    }
    
    // Apply theme to button background
    fun applyButtonTheme(view: View, cornerRadiusDp: Float = 16f) {
        val density = view.context.resources.displayMetrics.density
        val cornerRadius = cornerRadiusDp * density
        
        val buttonDrawable = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setCornerRadius(cornerRadius)
            setColor(currentTheme.accent)
        }
        
        view.animate()
            .alpha(0.9f)
            .setDuration(TRANSITION_DURATION / 2)
            .withEndAction {
                view.background = buttonDrawable
                view.animate()
                    .alpha(1f)
                    .setDuration(TRANSITION_DURATION / 2)
                    .start()
            }
            .start()
    }
    
    // Apply tint to ImageView with smooth transition
    fun applyAccentTint(imageView: ImageView) {
        imageView.animate()
            .alpha(0.8f)
            .setDuration(TRANSITION_DURATION / 2)
            .withEndAction {
                imageView.setColorFilter(currentTheme.accent, PorterDuff.Mode.SRC_IN)
                imageView.animate()
                    .alpha(1f)
                    .setDuration(TRANSITION_DURATION / 2)
                    .start()
            }
            .start()
    }
    
    // Apply glow ring to trade button
    fun applyTradeButtonGlow(glowView: ImageView) {
        glowView.setColorFilter(currentTheme.glowColor, PorterDuff.Mode.SRC_IN)
    }
    
    // Smooth transition for glow ring color
    fun animateGlowColor(imageView: ImageView, fromColor: Int, toColor: Int) {
        val animator = ValueAnimator.ofObject(ArgbEvaluator(), fromColor, toColor)
        animator.duration = TRANSITION_DURATION
        animator.addUpdateListener { anim ->
            val color = anim.animatedValue as Int
            imageView.setColorFilter(color, PorterDuff.Mode.SRC_IN)
        }
        animator.start()
    }
    
    /**
     * Creates a vibrant neon edge glow card drawable with theme colors
     * Mimics the striking outer glow effect seen in premium UI designs
     */
    fun createNeonEdgeGlowCard(context: Context, cornerRadiusDp: Float = 25f): LayerDrawable {
        val density = context.resources.displayMetrics.density
        val cornerRadius = cornerRadiusDp * density
        
        val theme = currentTheme
        
        // Outer neon glow layer (brightest)
        val outerGlow = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setCornerRadius(cornerRadius + 3 * density)
            setColor(getGlowColor(0x55))
        }
        
        // Middle glow layer
        val middleGlow = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setCornerRadius(cornerRadius + 2 * density)
            setColor(getGlowColor(0x44))
        }
        
        // Inner glow layer
        val innerGlow = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setCornerRadius(cornerRadius + 1 * density)
            setColor(getGlowColor(0x33))
        }
        
        // Dark card background with gradient
        val cardBackground = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(0xFF1a1a1a.toInt(), 0xFF0f0f0f.toInt(), 0xFF0a0a0a.toInt())
        ).apply {
            setCornerRadius(cornerRadius)
        }
        
        // Bright inner border
        val innerBorder = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setCornerRadius(cornerRadius)
            setStroke((2 * density).toInt(), getGlowColor(0x66))
            setColor(android.graphics.Color.TRANSPARENT)
        }
        
        // Create layer list
        val layers = arrayOf(
            outerGlow,
            middleGlow,
            innerGlow,
            cardBackground,
            innerBorder
        )
        
        val layerDrawable = LayerDrawable(layers)
        
        // Set insets for each layer
        layerDrawable.setLayerInset(1, (1 * density).toInt(), (1 * density).toInt(), 
            (1 * density).toInt(), (1 * density).toInt())
        layerDrawable.setLayerInset(2, (2 * density).toInt(), (2 * density).toInt(), 
            (2 * density).toInt(), (2 * density).toInt())
        layerDrawable.setLayerInset(3, (3 * density).toInt(), (3 * density).toInt(), 
            (3 * density).toInt(), (3 * density).toInt())
        layerDrawable.setLayerInset(4, (3 * density).toInt(), (3 * density).toInt(), 
            (3 * density).toInt(), (3 * density).toInt())
        
        return layerDrawable
    }
    
    /**
     * Apply neon edge glow to any view with smooth animation
     */
    fun applyNeonEdgeGlow(view: View, cornerRadiusDp: Float = 25f) {
        view.animate()
            .alpha(0.9f)
            .setDuration(TRANSITION_DURATION / 2)
            .withEndAction {
                view.background = createNeonEdgeGlowCard(view.context, cornerRadiusDp)
                view.animate()
                    .alpha(1f)
                    .setDuration(TRANSITION_DURATION / 2)
                    .start()
            }
            .start()
    }
    
    // ============================================================================
    // PREMIUM OUTER WARP GLOW SYSTEM
    // Creates a soft, diffused neon light that radiates outward from card edges
    // ============================================================================
    
    /**
     * Creates a premium neon border glow drawable.
     * Renders a bright neon stroke with outer glow bleeding into the dark background.
     * 
     * @param context Android context for density calculation
     * @param cornerRadiusDp Corner radius of the card in dp
     * @param intensity Glow intensity level (SUBTLE, MEDIUM, INTENSE)
     * @return WarpGlowDrawable configured with current theme colors
     */
    fun createWarpGlowDrawable(
        context: Context,
        cornerRadiusDp: Float = 25f,
        intensity: WarpGlowDrawable.GlowIntensity = WarpGlowDrawable.GlowIntensity.MEDIUM
    ): WarpGlowDrawable {
        val density = context.resources.displayMetrics.density
        val cornerRadiusPx = cornerRadiusDp * density
        
        return WarpGlowDrawable(
            glowColor = currentTheme.glowColor,
            cornerRadiusPx = cornerRadiusPx,
            intensity = intensity
        )
    }
    
    /**
     * Creates a complete warp glow card combining outer warp glow with inner neon edge glow.
     * This is the premium card effect with both inner detail and outer light bleed.
     * 
     * @param context Android context
     * @param cornerRadiusDp Corner radius in dp
     * @param intensity Glow intensity
     * @return WarpGlowCardDrawable combining warp glow + inner card
     */
    fun createWarpGlowCard(
        context: Context,
        cornerRadiusDp: Float = 25f,
        intensity: WarpGlowDrawable.GlowIntensity = WarpGlowDrawable.GlowIntensity.MEDIUM
    ): WarpGlowCardDrawable {
        val warpGlow = createWarpGlowDrawable(context, cornerRadiusDp, intensity)
        val innerCard = createNeonEdgeGlowCard(context, cornerRadiusDp)
        
        return WarpGlowCardDrawable(warpGlow, innerCard)
    }
    
    /**
     * Apply neon border glow effect to a view with smooth crossfade animation.
     * IMPORTANT: Call WarpGlowDrawable.prepareView(view) before this for blur to render.
     * 
     * @param view Target view to apply warp glow
     * @param cornerRadiusDp Corner radius in dp
     * @param intensity Glow intensity level
     */
    fun applyWarpGlow(
        view: View,
        cornerRadiusDp: Float = 25f,
        intensity: WarpGlowDrawable.GlowIntensity = WarpGlowDrawable.GlowIntensity.MEDIUM
    ) {
        WarpGlowDrawable.prepareView(view)
        view.animate()
            .alpha(0.9f)
            .setDuration(TRANSITION_DURATION / 2)
            .withEndAction {
                view.background = createWarpGlowDrawable(view.context, cornerRadiusDp, intensity)
                view.animate()
                    .alpha(1f)
                    .setDuration(TRANSITION_DURATION / 2)
                    .start()
            }
            .start()
    }
    
    /**
     * Apply only the outer warp glow (no inner card) to a wrapper view.
     * Use this when you have an outer FrameLayout wrapper for the glow effect
     * and the inner card is a separate view with its own background.
     * 
     * @param wrapperView The outer wrapper that will display the warp glow
     * @param cornerRadiusDp Corner radius matching the inner card
     * @param intensity Glow intensity
     */
    fun applyWarpGlowWrapper(
        wrapperView: View,
        cornerRadiusDp: Float = 25f,
        intensity: WarpGlowDrawable.GlowIntensity = WarpGlowDrawable.GlowIntensity.MEDIUM
    ) {
        WarpGlowDrawable.prepareView(wrapperView)
        wrapperView.animate()
            .alpha(0.9f)
            .setDuration(TRANSITION_DURATION / 2)
            .withEndAction {
                wrapperView.background = createWarpGlowDrawable(
                    wrapperView.context, cornerRadiusDp, intensity
                )
                wrapperView.animate()
                    .alpha(1f)
                    .setDuration(TRANSITION_DURATION / 2)
                    .start()
            }
            .start()
    }
    
    /**
     * Update an existing WarpGlowDrawable or WarpGlowCardDrawable with new theme colors.
     * Use this for smooth theme transitions on views that already have warp glow applied.
     * 
     * @param view View with warp glow background
     */
    fun updateWarpGlowTheme(view: View) {
        val background = view.background
        when (background) {
            is WarpGlowDrawable -> {
                view.animate()
                    .alpha(0.9f)
                    .setDuration(TRANSITION_DURATION / 2)
                    .withEndAction {
                        background.updateColors(currentTheme.glowColor, currentTheme.glowColor)
                        view.animate()
                            .alpha(1f)
                            .setDuration(TRANSITION_DURATION / 2)
                            .start()
                    }
                    .start()
            }
            is WarpGlowCardDrawable -> {
                view.animate()
                    .alpha(0.9f)
                    .setDuration(TRANSITION_DURATION / 2)
                    .withEndAction {
                        background.updateWarpColors(currentTheme.glowColor, currentTheme.glowColor)
                        // Also recreate inner card with new theme
                        view.background = createWarpGlowCard(
                            view.context,
                            25f,
                            WarpGlowDrawable.GlowIntensity.MEDIUM
                        )
                        view.animate()
                            .alpha(1f)
                            .setDuration(TRANSITION_DURATION / 2)
                            .start()
                    }
                    .start()
            }
        }
    }
}
