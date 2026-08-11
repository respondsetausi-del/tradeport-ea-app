package com.bellyforex.tradeportea.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.*
import android.os.Build
import android.util.AttributeSet
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import com.bellyforex.tradeportea.R

/**
 * GlassCardView - A custom FrameLayout that renders a glassmorphism/liquid glass effect.
 * 
 * Features:
 * - Semi-transparent base fill
 * - RenderEffect blur on API 31+ (gradient fallback on older APIs)
 * - Diagonal gradient sheen for light refraction simulation
 * - Rounded border with customizable corner radius
 * - Optional animated shimmer effect
 */
class GlassCardView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    // Paint objects for each layer
    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val gradientPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val shimmerPaint = Paint(Paint.ANTI_ALIAS_FLAG)

    // Configurable attributes
    private var cornerRadius: Float = 20f * resources.displayMetrics.density
    private var glassTint: Int = Color.argb(15, 255, 255, 255)
    private var blurRadius: Float = 20f
    private var borderWidth: Float = 1f * resources.displayMetrics.density
    private var borderColor: Int = Color.argb(30, 255, 255, 255)
    private var animateShimmer: Boolean = true

    // Shimmer animation
    private var shimmerAnimator: ValueAnimator? = null
    private var shimmerProgress: Float = 0f

    // Drawing bounds
    private val drawRect = RectF()
    private val borderRect = RectF()

    init {
        // Enable drawing
        setWillNotDraw(false)
        
        // Parse custom attributes
        attrs?.let {
            val typedArray = context.obtainStyledAttributes(it, R.styleable.GlassCardView)
            
            cornerRadius = typedArray.getDimension(
                R.styleable.GlassCardView_glassCornerRadius,
                20f * resources.displayMetrics.density
            )
            glassTint = typedArray.getColor(
                R.styleable.GlassCardView_glassTint,
                Color.argb(15, 255, 255, 255)
            )
            blurRadius = typedArray.getFloat(
                R.styleable.GlassCardView_glassBlurRadius,
                20f
            )
            borderWidth = typedArray.getDimension(
                R.styleable.GlassCardView_glassBorderWidth,
                1f * resources.displayMetrics.density
            )
            borderColor = typedArray.getColor(
                R.styleable.GlassCardView_glassBorderColor,
                Color.argb(30, 255, 255, 255)
            )
            animateShimmer = typedArray.getBoolean(
                R.styleable.GlassCardView_glassAnimateShimmer,
                true
            )
            
            typedArray.recycle()
        }

        // Setup paints
        setupPaints()
        
        // Set elevation for shadow
        elevation = 8f * resources.displayMetrics.density
        
        // Clip to outline for rounded corners
        clipToOutline = true
        outlineProvider = object : android.view.ViewOutlineProvider() {
            override fun getOutline(view: android.view.View, outline: android.graphics.Outline) {
                outline.setRoundRect(0, 0, view.width, view.height, cornerRadius)
            }
        }

        // Apply blur effect on API 31+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            setRenderEffect(
                android.graphics.RenderEffect.createBlurEffect(
                    blurRadius, blurRadius,
                    Shader.TileMode.CLAMP
                )
            )
        }
    }

    private fun setupPaints() {
        // Layer 1: Base semi-transparent fill
        basePaint.apply {
            color = glassTint
            style = Paint.Style.FILL
        }

        // Layer 4: Border stroke
        borderPaint.apply {
            color = borderColor
            style = Paint.Style.STROKE
            strokeWidth = borderWidth
        }

        // Shimmer paint (will be configured in onSizeChanged)
        shimmerPaint.apply {
            style = Paint.Style.FILL
            xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_OVER)
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        
        // Update drawing bounds
        drawRect.set(0f, 0f, w.toFloat(), h.toFloat())
        
        val halfBorder = borderWidth / 2
        borderRect.set(halfBorder, halfBorder, w - halfBorder, h - halfBorder)

        // Layer 3: Diagonal gradient sheen (light refraction simulation)
        gradientPaint.shader = LinearGradient(
            0f, 0f,
            w.toFloat(), h.toFloat(),
            Color.argb(20, 255, 255, 255),
            Color.argb(5, 255, 255, 255),
            Shader.TileMode.CLAMP
        )
    }

    override fun onDraw(canvas: Canvas) {
        // Layer 1: Base fill
        canvas.drawRoundRect(drawRect, cornerRadius, cornerRadius, basePaint)

        // Layer 2: Blur is handled by RenderEffect on API 31+
        // For older APIs, the gradient provides visual approximation

        // Layer 3: Gradient sheen
        canvas.drawRoundRect(drawRect, cornerRadius, cornerRadius, gradientPaint)

        // Shimmer effect (animated highlight band)
        if (animateShimmer && shimmerProgress > 0f) {
            drawShimmer(canvas)
        }

        // Layer 4: Border
        canvas.drawRoundRect(borderRect, cornerRadius, cornerRadius, borderPaint)

        super.onDraw(canvas)
    }

    private fun drawShimmer(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        
        // Calculate shimmer band position based on animation progress
        val shimmerWidth = w * 0.3f
        val startX = -shimmerWidth + (w + shimmerWidth * 2) * shimmerProgress
        
        // Create shimmer gradient
        shimmerPaint.shader = LinearGradient(
            startX, 0f,
            startX + shimmerWidth, h,
            intArrayOf(
                Color.argb(0, 255, 255, 255),
                Color.argb(25, 255, 255, 255),
                Color.argb(0, 255, 255, 255)
            ),
            floatArrayOf(0f, 0.5f, 1f),
            Shader.TileMode.CLAMP
        )
        
        canvas.drawRoundRect(drawRect, cornerRadius, cornerRadius, shimmerPaint)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (animateShimmer) {
            startShimmerAnimation()
        }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        stopShimmerAnimation()
    }

    private fun startShimmerAnimation() {
        shimmerAnimator?.cancel()
        
        shimmerAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 3000L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
            interpolator = LinearInterpolator()
            
            addUpdateListener { animation ->
                shimmerProgress = animation.animatedValue as Float
                invalidate()
            }
            
            // Add delay between shimmer cycles
            startDelay = 1000L
        }
        
        shimmerAnimator?.start()
    }

    private fun stopShimmerAnimation() {
        shimmerAnimator?.cancel()
        shimmerAnimator = null
    }

    // Public methods for programmatic configuration
    fun setGlassCornerRadius(radius: Float) {
        cornerRadius = radius
        outlineProvider = object : android.view.ViewOutlineProvider() {
            override fun getOutline(view: android.view.View, outline: android.graphics.Outline) {
                outline.setRoundRect(0, 0, view.width, view.height, cornerRadius)
            }
        }
        invalidate()
    }

    fun setGlassTint(color: Int) {
        glassTint = color
        basePaint.color = color
        invalidate()
    }

    fun setGlassBorderColor(color: Int) {
        borderColor = color
        borderPaint.color = color
        invalidate()
    }

    fun setShimmerEnabled(enabled: Boolean) {
        animateShimmer = enabled
        if (enabled && isAttachedToWindow) {
            startShimmerAnimation()
        } else {
            stopShimmerAnimation()
        }
    }
}
