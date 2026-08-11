package com.bellyforex.tradeportea.ui.theme

import android.animation.ValueAnimator
import android.graphics.*
import android.graphics.drawable.Drawable
import android.view.View
import android.view.animation.LinearInterpolator

/**
 * Premium Neon Border Glow Drawable with Rotating Sweep Animation
 *
 * Performance-optimized: static glow layers are pre-rendered to a bitmap cache.
 * Only the sweep highlight redraws each frame, dramatically reducing CPU load.
 *
 * Effect layers:
 * 1-4. Static neon glow (cached to bitmap) — outer, middle, core, inner-white
 * 5.   Sweeping highlight — rotating bright arc (redrawn each frame, lightweight)
 *
 * IMPORTANT: Call prepareView() on the wrapper view for blur to render correctly.
 */
class WarpGlowDrawable(
    private var glowColor: Int,
    private var glowSoft: Int = glowColor,
    private var cornerRadiusPx: Float,
    private val glowRadiusPx: Float = 36f,
    private val intensity: GlowIntensity = GlowIntensity.MEDIUM,
    private val paddingPx: Float = 0f
) : Drawable() {

    companion object {
        /** Slow rotation duration — idle / default (10 seconds per revolution) */
        const val ROTATION_SLOW = 10000L
        /** Fast rotation duration — active state (4 seconds per revolution) */
        const val ROTATION_FAST = 4000L
        /** Target ~20fps for smooth-enough rotation without killing performance */
        private const val FRAME_INTERVAL_MS = 50L

        fun prepareView(view: View) {
            view.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
        }

        fun resetView(view: View) {
            view.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        }
    }

    enum class GlowIntensity(
        val strokeWidth: Float,
        val outerBlurRadius: Float,
        val middleBlurRadius: Float,
        val coreAlpha: Int,
        val middleAlpha: Int,
        val outerAlpha: Int
    ) {
        SUBTLE(4f, 12f, 6f, 255, 220, 180),
        MEDIUM(5f, 14f, 8f, 255, 230, 200),
        INTENSE(6f, 16f, 10f, 255, 240, 210)
    }

    // ---- Static glow paints (rendered to cache bitmap once) ----
    private val outerGlowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val middleGlowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val coreStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val innerCorePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }

    // ---- Sweep highlight paint (redrawn each frame — lightweight, no BlurMaskFilter) ----
    private val sweepPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }

    // Paint for drawing the cached bitmap
    private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)

    private val boundsRectF = RectF()

    // Bitmap cache for static glow layers
    private var staticCache: Bitmap? = null
    private var cacheWidth = 0
    private var cacheHeight = 0
    private var cacheDirty = true

    // Rotation animation state
    private var rotationAngle = 0f
    private var animator: ValueAnimator? = null
    private var currentDuration = ROTATION_SLOW
    private var lastFrameTime = 0L

    init {
        setupPaints()
        startRotation(ROTATION_SLOW)
    }

    private fun setupPaints() {
        outerGlowPaint.apply {
            strokeWidth = intensity.strokeWidth + intensity.outerBlurRadius
            color = applyAlpha(glowColor, intensity.outerAlpha)
            maskFilter = BlurMaskFilter(intensity.outerBlurRadius, BlurMaskFilter.Blur.NORMAL)
        }

        middleGlowPaint.apply {
            strokeWidth = intensity.strokeWidth + intensity.middleBlurRadius * 0.5f
            color = applyAlpha(glowColor, intensity.middleAlpha)
            maskFilter = BlurMaskFilter(intensity.middleBlurRadius, BlurMaskFilter.Blur.NORMAL)
        }

        coreStrokePaint.apply {
            strokeWidth = intensity.strokeWidth
            color = applyAlpha(glowColor, intensity.coreAlpha)
            maskFilter = BlurMaskFilter(3f, BlurMaskFilter.Blur.SOLID)
        }

        innerCorePaint.apply {
            strokeWidth = intensity.strokeWidth * 0.4f
            val r = (Color.red(glowColor) + 255) / 2
            val g = (Color.green(glowColor) + 255) / 2
            val b = (Color.blue(glowColor) + 255) / 2
            color = Color.argb(200, r, g, b)
            maskFilter = BlurMaskFilter(2f, BlurMaskFilter.Blur.SOLID)
        }

        // Sweep highlight — NO BlurMaskFilter for performance. Slightly thicker stroke instead.
        sweepPaint.apply {
            strokeWidth = intensity.strokeWidth * 2.5f
            // No maskFilter — keeps it lightweight
        }

        cacheDirty = true
    }

    /** Render the 4 static glow layers to an offscreen bitmap */
    private fun renderStaticCache() {
        val b = bounds
        if (b.isEmpty) return

        val w = b.width()
        val h = b.height()
        if (w == cacheWidth && h == cacheHeight && !cacheDirty && staticCache != null) return

        staticCache?.recycle()
        staticCache = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(staticCache!!)

        // Offset so drawing is relative to (0,0)
        val rect = RectF(
            paddingPx, paddingPx,
            w - paddingPx, h - paddingPx
        )
        if (paddingPx <= 0f) {
            val outerStrokeWidth = intensity.strokeWidth + intensity.outerBlurRadius
            val insetPadding = outerStrokeWidth * 0.6f
            rect.set(insetPadding, insetPadding, w - insetPadding, h - insetPadding)
        }

        val radius = cornerRadiusPx
        c.drawRoundRect(rect, radius, radius, outerGlowPaint)
        c.drawRoundRect(rect, radius, radius, middleGlowPaint)
        c.drawRoundRect(rect, radius, radius, coreStrokePaint)
        c.drawRoundRect(rect, radius, radius, innerCorePaint)

        cacheWidth = w
        cacheHeight = h
        cacheDirty = false
    }

    /** Build dual sweep gradient — two bright arcs 180° apart on opposite sides */
    private fun buildSweepShader(cx: Float, cy: Float) {
        val bright = applyAlpha(glowColor, 255)
        val whiteHot = Color.argb(240,
            (Color.red(glowColor) + 255) / 2,
            (Color.green(glowColor) + 255) / 2,
            (Color.blue(glowColor) + 255) / 2
        )
        val mid = applyAlpha(glowColor, 140)
        val transparent = applyAlpha(glowColor, 0)

        // Two bright arcs at 0° and 180° (~70° each), symmetric
        val colors = intArrayOf(
            // Arc 1 (centered at ~0.125 = 45°)
            mid,            // 0° soft start
            bright,         // ramp up
            whiteHot,       // peak
            bright,         // ramp down
            mid,            // soft end
            transparent,    // gap

            // Arc 2 (centered at ~0.625 = 225°, opposite side)
            mid,            // soft start
            bright,         // ramp up
            whiteHot,       // peak
            bright,         // ramp down
            mid,            // soft end
            transparent     // gap back to start
        )
        val positions = floatArrayOf(
            // Arc 1
            0.0f,
            0.05f,
            0.125f,  // peak center
            0.20f,
            0.25f,
            0.40f,   // dark gap midpoint

            // Arc 2
            0.50f,
            0.55f,
            0.625f,  // peak center (180° from arc 1)
            0.70f,
            0.75f,
            1.0f     // dark gap back to start
        )

        val shader = SweepGradient(cx, cy, colors, positions)
        val matrix = Matrix()
        matrix.postRotate(rotationAngle, cx, cy)
        shader.setLocalMatrix(matrix)
        sweepPaint.shader = shader
    }

    /** Start or restart the continuous rotation animation at reduced frame rate */
    fun startRotation(durationMs: Long = ROTATION_SLOW) {
        currentDuration = durationMs
        animator?.cancel()
        animator = ValueAnimator.ofFloat(0f, 360f).apply {
            duration = durationMs
            repeatCount = ValueAnimator.INFINITE
            interpolator = LinearInterpolator()
            addUpdateListener { anim ->
                // Throttle: only invalidate at ~20fps
                val now = System.currentTimeMillis()
                if (now - lastFrameTime >= FRAME_INTERVAL_MS) {
                    rotationAngle = anim.animatedValue as Float
                    lastFrameTime = now
                    invalidateSelf()
                }
            }
            start()
        }
    }

    fun setRotationSpeed(durationMs: Long) {
        if (currentDuration != durationMs) {
            val currentAngle = rotationAngle
            startRotation(durationMs)
            animator?.let {
                val fraction = currentAngle / 360f
                it.currentPlayTime = (fraction * durationMs).toLong()
            }
        }
    }

    fun stopRotation() {
        animator?.cancel()
        animator = null
    }

    fun updateColors(newGlowColor: Int, newGlowSoft: Int) {
        glowColor = newGlowColor
        glowSoft = newGlowSoft
        setupPaints()
        cacheDirty = true
        invalidateSelf()
    }

    fun updateCornerRadius(newRadiusPx: Float) {
        cornerRadiusPx = newRadiusPx
        cacheDirty = true
        invalidateSelf()
    }

    private fun applyAlpha(color: Int, alpha: Int): Int {
        return Color.argb(alpha.coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))
    }

    override fun draw(canvas: Canvas) {
        val bounds = bounds
        if (bounds.isEmpty) return

        // Compute rect for sweep layer
        if (paddingPx > 0f) {
            boundsRectF.set(
                bounds.left + paddingPx,
                bounds.top + paddingPx,
                bounds.right - paddingPx,
                bounds.bottom - paddingPx
            )
        } else {
            val outerStrokeWidth = intensity.strokeWidth + intensity.outerBlurRadius
            val insetPadding = outerStrokeWidth * 0.6f
            boundsRectF.set(
                bounds.left + insetPadding,
                bounds.top + insetPadding,
                bounds.right - insetPadding,
                bounds.bottom - insetPadding
            )
        }

        canvas.save()
        canvas.clipRect(bounds)

        // Draw cached static glow layers (cheap — just a bitmap blit)
        renderStaticCache()
        staticCache?.let {
            canvas.drawBitmap(it, bounds.left.toFloat(), bounds.top.toFloat(), bitmapPaint)
        }

        // Draw sweep highlight (only layer that changes — no BlurMaskFilter, very cheap)
        val cx = boundsRectF.centerX()
        val cy = boundsRectF.centerY()
        buildSweepShader(cx, cy)
        canvas.drawRoundRect(boundsRectF, cornerRadiusPx, cornerRadiusPx, sweepPaint)

        canvas.restore()
    }

    override fun setAlpha(alpha: Int) {
        bitmapPaint.alpha = alpha
        invalidateSelf()
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        bitmapPaint.colorFilter = colorFilter
        sweepPaint.colorFilter = colorFilter
        invalidateSelf()
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

    override fun getIntrinsicWidth(): Int = -1
    override fun getIntrinsicHeight(): Int = -1
}

/**
 * Combined Warp Glow Card Drawable
 */
class WarpGlowCardDrawable(
    private val warpGlowDrawable: WarpGlowDrawable,
    private val innerCardDrawable: Drawable
) : Drawable() {

    private val innerBounds = Rect()

    override fun onBoundsChange(bounds: Rect) {
        super.onBoundsChange(bounds)
        warpGlowDrawable.bounds = bounds
        innerCardDrawable.bounds = bounds
    }

    override fun draw(canvas: Canvas) {
        warpGlowDrawable.draw(canvas)
        innerCardDrawable.draw(canvas)
    }

    fun updateWarpColors(glowColor: Int, glowSoft: Int) {
        warpGlowDrawable.updateColors(glowColor, glowSoft)
        invalidateSelf()
    }

    override fun setAlpha(alpha: Int) {
        warpGlowDrawable.alpha = alpha
        innerCardDrawable.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        warpGlowDrawable.colorFilter = colorFilter
        innerCardDrawable.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
