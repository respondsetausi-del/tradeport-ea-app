package com.bellyforex.tradeportea.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import com.bellyforex.tradeportea.R

/**
 * GlassEdgeGlowView - A custom View that draws an animated glowing border.
 * 
 * Creates a slow-rotating light sweep around the card edge for a liquid glass effect.
 * Use as an overlay on top of glass cards.
 */
class GlassEdgeGlowView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()
    private val matrix = Matrix()
    
    // Configurable attributes
    private var glowColor: Int = Color.parseColor("#30BB86FC")
    private var cornerRadius: Float = 20f * resources.displayMetrics.density
    private var strokeWidth: Float = 2f * resources.displayMetrics.density
    private var animationDuration: Int = 4000
    
    // Animation
    private var animator: ValueAnimator? = null
    private var animatedAngle: Float = 0f
    
    // Gradient colors for the sweep
    private var gradientColors = intArrayOf(
        Color.TRANSPARENT,
        glowColor,
        Color.argb(38, 255, 255, 255), // 15% white
        Color.TRANSPARENT
    )
    private var gradientPositions = floatArrayOf(0f, 0.25f, 0.5f, 1f)

    init {
        // Parse custom attributes
        attrs?.let {
            val typedArray = context.obtainStyledAttributes(it, R.styleable.GlassEdgeGlowView)
            
            glowColor = typedArray.getColor(
                R.styleable.GlassEdgeGlowView_glowColor,
                Color.parseColor("#30BB86FC")
            )
            cornerRadius = typedArray.getDimension(
                R.styleable.GlassEdgeGlowView_glowCornerRadius,
                20f * resources.displayMetrics.density
            )
            strokeWidth = typedArray.getDimension(
                R.styleable.GlassEdgeGlowView_glowStrokeWidth,
                2f * resources.displayMetrics.density
            )
            animationDuration = typedArray.getInt(
                R.styleable.GlassEdgeGlowView_glowSpeed,
                4000
            )
            
            typedArray.recycle()
        }
        
        // Update gradient colors with the configured glow color
        updateGradientColors()
        
        // Setup paint
        glowPaint.apply {
            style = Paint.Style.STROKE
            this.strokeWidth = this@GlassEdgeGlowView.strokeWidth
        }
    }

    private fun updateGradientColors() {
        gradientColors = intArrayOf(
            Color.TRANSPARENT,
            glowColor,
            Color.argb(38, 255, 255, 255), // 15% white highlight
            Color.TRANSPARENT
        )
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        
        // Create rounded rect path
        val halfStroke = strokeWidth / 2
        val rectF = RectF(halfStroke, halfStroke, w - halfStroke, h - halfStroke)
        path.reset()
        path.addRoundRect(rectF, cornerRadius, cornerRadius, Path.Direction.CW)
        
        // Create sweep gradient shader centered on the view
        updateShader()
    }

    private fun updateShader() {
        val centerX = width / 2f
        val centerY = height / 2f
        
        val sweepGradient = SweepGradient(
            centerX, centerY,
            gradientColors,
            gradientPositions
        )
        
        // Apply rotation to the gradient
        matrix.reset()
        matrix.postRotate(animatedAngle, centerX, centerY)
        sweepGradient.setLocalMatrix(matrix)
        
        glowPaint.shader = sweepGradient
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        
        if (width > 0 && height > 0) {
            updateShader()
            canvas.drawPath(path, glowPaint)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        startAnimation()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        stopAnimation()
    }

    private fun startAnimation() {
        animator?.cancel()
        
        animator = ValueAnimator.ofFloat(0f, 360f).apply {
            duration = animationDuration.toLong()
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
            interpolator = LinearInterpolator()
            
            addUpdateListener { animation ->
                animatedAngle = animation.animatedValue as Float
                invalidate()
            }
        }
        
        animator?.start()
    }

    private fun stopAnimation() {
        animator?.cancel()
        animator = null
    }

    /**
     * Programmatically set the glow color.
     * Useful for accent-aware theming.
     */
    fun setGlowColor(color: Int) {
        glowColor = color
        updateGradientColors()
        invalidate()
    }

    /**
     * Set corner radius programmatically.
     */
    fun setCornerRadius(radius: Float) {
        cornerRadius = radius
        if (width > 0 && height > 0) {
            val halfStroke = strokeWidth / 2
            val rectF = RectF(halfStroke, halfStroke, width - halfStroke, height - halfStroke)
            path.reset()
            path.addRoundRect(rectF, cornerRadius, cornerRadius, Path.Direction.CW)
        }
        invalidate()
    }

    /**
     * Set animation speed (duration in milliseconds).
     */
    fun setAnimationSpeed(durationMs: Int) {
        animationDuration = durationMs
        if (animator?.isRunning == true) {
            stopAnimation()
            startAnimation()
        }
    }
}
