package com.bellyforex.tradeportea.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.TextUtils
import android.util.Patterns
import android.view.View
import android.view.View.GONE
import android.view.View.VISIBLE
import android.webkit.WebView
import android.widget.Button
import android.widget.ProgressBar
import android.widget.RelativeLayout
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import androidx.core.view.GravityCompat
import androidx.drawerlayout.widget.DrawerLayout
import androidx.lifecycle.ViewModelProvider
import androidx.navigation.findNavController
import androidx.navigation.ui.AppBarConfiguration
import androidx.navigation.ui.navigateUp
import androidx.navigation.ui.setupWithNavController
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.databinding.ActivityHomeBinding
import com.bellyforex.tradeportea.network.db.LicenceDB
import com.bellyforex.tradeportea.repository.RTRepository
import com.bellyforex.tradeportea.ui.home.HomeViewModel
import com.bellyforex.tradeportea.ui.home.addrobot.AddRobotViewModel
import com.bellyforex.tradeportea.ui.home.addrobot.ViewModelProviderFactory
import com.bellyforex.tradeportea.ui.home.assets.AssetsViewModel
import com.bellyforex.tradeportea.utils.Constants
import com.bellyforex.tradeportea.utils.DeviceIdProvider
import com.bellyforex.tradeportea.utils.Resource
import com.google.android.material.navigation.NavigationView
import com.google.android.material.textfield.TextInputEditText
import com.bellyforex.tradeportea.ui.theme.ThemeEngine
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.net.Uri
import android.view.Surface
import android.view.TextureView
import android.widget.ImageView
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.MutableLiveData
import com.bellyforex.tradeportea.utils.TTSManager


class HomeActivity : AppCompatActivity() {

    private lateinit var binding: ActivityHomeBinding
    lateinit var addRobotViewModel : AddRobotViewModel
    lateinit var assetsViewModel : AssetsViewModel
    lateinit var homeViewModel : HomeViewModel
    private lateinit var appBarConfiguration: AppBarConfiguration
    private lateinit var drawerLayout: DrawerLayout

    private var email:CharSequence? = null

    // Video background
    private var mediaPlayer: MediaPlayer? = null
    private var videoSurface: Surface? = null
    private var isVideoBackgroundEnabled = false
    private var selectedVideoRes: Int = R.raw.video
    private var customVideoUri: String? = null
    val videoBackgroundLiveData = MutableLiveData<Boolean>(false)
    private val videoLoopHandler = Handler(Looper.getMainLooper())
    private var videoLoopRunnable: Runnable? = null

    // Drawer peek animation
    private val peekHandler = Handler(Looper.getMainLooper())

    // Revoke detection guard: the first onResume after onCreate is
    // skipped because onCreate already fires its own auth check.
    // Every subsequent foreground (app resumed from background) runs
    // verifySubscription() to catch server-side revocations instantly.
    private var isFirstResume = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val rtRepository = RTRepository(LicenceDB(this))
        val addRobotViewModelProviderFactory = ViewModelProviderFactory(rtRepository)
        addRobotViewModel = ViewModelProvider(this, addRobotViewModelProviderFactory)[AddRobotViewModel::class.java]

        val assetsViewModelProviderFactory = com.bellyforex.tradeportea.ui.home.assets.ViewModelProviderFactory(rtRepository)
        assetsViewModel = ViewModelProvider(this, assetsViewModelProviderFactory)[AssetsViewModel::class.java]

        val homeViewModelProviderFactory = com.bellyforex.tradeportea.ui.home.ViewModelProviderFactory(rtRepository)
        homeViewModel = ViewModelProvider(this, homeViewModelProviderFactory)[HomeViewModel::class.java]

        binding = ActivityHomeBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        // Initialize TTS and speak welcome message
        TTSManager.init(this)
        TTSManager.speak(TTSManager.Messages.WELCOME)
        
        drawerLayout = binding.drawerLayout
        val navView: NavigationView = binding.navView

        val navController = findNavController(R.id.nav_host_fragment_activity_home)
        // Passing each menu ID as a set of Ids because each
        // menu should be considered as top level destinations.
        appBarConfiguration = AppBarConfiguration(
            setOf(
                R.id.navigation_home, R.id.navigation_metatrader, R.id.navigation_settings
            ),
            drawerLayout
        )
        
        // Setup NavigationView with NavController
        navView.setupWithNavController(navController)

        // Floating hamburger (top-left of every page) toggles the nav drawer.
        findViewById<android.widget.ImageButton>(R.id.hamburgerButton).setOnClickListener {
            if (drawerLayout.isDrawerOpen(GravityCompat.START)) {
                drawerLayout.closeDrawer(GravityCompat.START)
            } else {
                drawerLayout.openDrawer(GravityCompat.START)
            }
        }
        
        // Initialize Theme Engine
        ThemeEngine.init(this)
        setupThemeSwatches(navView)

        // Setup video background
        setupVideoBackground()

        val sharedPreference = getSharedPreferences("MEMBERS", Context.MODE_PRIVATE)

        // Observer for the PHP getApp() call — used ONLY for the forced-update
        // version check. All auth-state decisions now come from checkEmail().
        homeViewModel.app.observe(this) { resource ->
            if (resource is Resource.Success) {
                resource.data?.let { data ->
                    if (Constants.CURRENT_VERSION != data.version) {
                        val intent = Intent(this, FinishActivity::class.java)
                        intent.putExtra("update", true)
                        startActivity(intent)
                    }
                }
            }
        }

        // Observer for the Bun /api/check-email call — handles all auth-state
        // branching: device binding, expiry, payment, mentor validation.
        homeViewModel.checkEmail.observe(this) { resource ->
            when (resource) {
                is Resource.Loading -> {
                    // Show payLayout (login form) so the spinner (which lives
                    // inside payLayout) is actually visible. Otherwise the user
                    // stares at a blank dark screen during Render cold starts.
                    findViewById<RelativeLayout>(R.id.payLayout).visibility = VISIBLE
                    findViewById<ProgressBar>(R.id.progress).visibility = VISIBLE
                    findViewById<RelativeLayout>(R.id.main_view).visibility = GONE
                    findViewById<ProgressBar>(R.id.mainProgress).visibility = GONE
                    findViewById<RelativeLayout>(R.id.error_code).visibility = GONE
                }
                is Resource.Error -> {
                    findViewById<ProgressBar>(R.id.mainProgress).visibility = GONE
                    findViewById<ProgressBar>(R.id.progress).visibility = GONE
                    findViewById<RelativeLayout>(R.id.payLayout).visibility = VISIBLE
                    findViewById<RelativeLayout>(R.id.error_code).visibility = VISIBLE
                }
                is Resource.Success -> {
                    findViewById<ProgressBar>(R.id.mainProgress).visibility = GONE
                    findViewById<ProgressBar>(R.id.progress).visibility = GONE
                    findViewById<RelativeLayout>(R.id.error_code).visibility = GONE

                    val r = resource.data ?: return@observe
                    val emailStr = email?.toString()?.trim().orEmpty()
                    val mentorT = getCurrentMentorOrDefault()

                    // 1. Not found → user doesn't exist at all, send to payment
                    if (r.found == 0) {
                        findViewById<RelativeLayout>(R.id.payLayout).visibility = View.VISIBLE
                        drawerLayout.setDrawerLockMode(DrawerLayout.LOCK_MODE_LOCKED_CLOSED)
                        if (isValidEmail(emailStr)) {
                            showPaymentWebView(emailStr, mentorT)
                        }
                        return@observe
                    }

                    // 2. Subscription expired — must be checked BEFORE paid,
                    // because the server returns paid=0 AND expired=1 together
                    // for expired accounts. We want these users to see "renew"
                    // instead of being dumped into the payment page as new signups.
                    if (r.expired == 1) {
                        findViewById<RelativeLayout>(R.id.payLayout).visibility = View.VISIBLE
                        drawerLayout.setDrawerLockMode(DrawerLayout.LOCK_MODE_LOCKED_CLOSED)
                        val expiryStr = r.expiryDate ?: "recently"
                        showAlert(
                            "Subscription Expired",
                            "Your subscription expired on $expiryStr. Please renew to continue using Trade Port EA."
                        )
                        return@observe
                    }

                    // 3. Not paid (and not expired) → brand new user, send to payment
                    if (r.paid == 0) {
                        findViewById<RelativeLayout>(R.id.payLayout).visibility = View.VISIBLE
                        drawerLayout.setDrawerLockMode(DrawerLayout.LOCK_MODE_LOCKED_CLOSED)
                        if (isValidEmail(emailStr)) {
                            showPaymentWebView(emailStr, mentorT)
                        }
                        return@observe
                    }

                    // 4. Device mismatch — credential sharing attempt
                    if (r.deviceMismatch == 1) {
                        findViewById<RelativeLayout>(R.id.payLayout).visibility = View.VISIBLE
                        drawerLayout.setDrawerLockMode(DrawerLayout.LOCK_MODE_LOCKED_CLOSED)
                        showAlert(
                            "Device Not Authorized",
                            "This subscription is already active on another device. Each subscription can only be used on one device. Contact your mentor to transfer your license."
                        )
                        return@observe
                    }

                    // 5. Invalid mentor ID
                    if (r.invalidMentor == 1) {
                        Toast.makeText(
                            this,
                            "Mentor ID does not match our records for this email.",
                            Toast.LENGTH_LONG
                        ).show()
                        return@observe
                    }

                    // 6. All good → unlock main view
                    findViewById<RelativeLayout>(R.id.payLayout).visibility = View.GONE
                    findViewById<RelativeLayout>(R.id.main_view).visibility = VISIBLE
                    drawerLayout.setDrawerLockMode(DrawerLayout.LOCK_MODE_UNLOCKED)
                    peekDrawer()
                }
            }
        }

        // Show the login form by default on startup. Without this, a fresh
        // install with no cached email leaves payLayout hidden forever and
        // the user sees a blank dark screen.
        findViewById<RelativeLayout>(R.id.payLayout).visibility = VISIBLE
        findViewById<ProgressBar>(R.id.mainProgress).visibility = GONE
        drawerLayout.setDrawerLockMode(DrawerLayout.LOCK_MODE_LOCKED_CLOSED)

        // Cold-start: pre-fill the login form with the cached email for
        // convenience, but do NOT auto-run the auth/device check. The check
        // only runs when the user fills in the form and taps Proceed — so we
        // never show a device-lock popup before the user has done anything.
        val cachedEmail = sharedPreference.getString("email", null)?.trim()
        if (!cachedEmail.isNullOrEmpty()) {
            email = cachedEmail
            findViewById<TextInputEditText>(R.id.outlined_edit_text_3).setText(cachedEmail)
        }

        findViewById<Button>(R.id.reload_reload).setOnClickListener {
            val em = sharedPreference.getString("email", null)?.trim()
            if (!em.isNullOrEmpty()) {
                email = em
                performAuthCheck(em, getCurrentMentorOrDefault())
            }
        }

        findViewById<Button>(R.id.subscribe).setOnClickListener {
            val emailInput = findViewById<TextInputEditText>(R.id.outlined_edit_text_3).text
            email = emailInput

            if (isValidEmail(emailInput)) {
                val mentorInput = findViewById<TextInputEditText>(R.id.outlined_edit_text_2).text
                val mentorT = if (!mentorInput.isNullOrEmpty()) mentorInput.toString() else "0"

                // Cache email for auto-login on next launch
                sharedPreference.edit().putString("email", emailInput.toString()).apply()

                performAuthCheck(emailInput.toString(), mentorT)
            } else {
                Toast.makeText(
                    this,
                    "Don't leave any empty spaces, insert valid address",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    /**
     * Fires both auth-related network calls:
     *  - getApp() against the PHP backend, used only to read the forced-update `version` field
     *  - checkEmail() against the Bun backend, which performs device binding and returns auth state
     */
    private fun performAuthCheck(emailStr: String, mentorStr: String) {
        val deviceId = DeviceIdProvider.get(this)
        homeViewModel.getApp(emailStr, null)
        homeViewModel.checkEmail(emailStr, mentorStr, deviceId)
    }

    /**
     * Re-verifies the current subscription against the Bun backend.
     * Called on cold start and again on every onResume so that a user who
     * was revoked, expired, or had their device binding stolen while the
     * app was in the background gets kicked out of the main view the
     * moment they foreground the app. Mirrors the `verifySubscription`
     * useEffect in providers/app-provider.tsx of the RN client.
     *
     * Silently no-ops when there is no cached email (fresh install or
     * user never logged in), so the login form stays untouched.
     */
    private fun verifySubscription() {
        val sharedPreference = getSharedPreferences("MEMBERS", Context.MODE_PRIVATE)
        val cachedEmail = sharedPreference.getString("email", null)?.trim()
        if (cachedEmail.isNullOrEmpty()) return

        val mentorInput = findViewById<TextInputEditText>(R.id.outlined_edit_text_2)?.text
        val mentorStr = if (!mentorInput.isNullOrEmpty()) mentorInput.toString() else "0"

        email = cachedEmail
        performAuthCheck(cachedEmail, mentorStr)
    }

    private fun getCurrentMentorOrDefault(): String {
        val mentor = findViewById<TextInputEditText>(R.id.outlined_edit_text_2)?.text
        return if (!mentor.isNullOrEmpty()) mentor.toString() else "0"
    }

    private fun showPaymentWebView(emailStr: String, mentorStr: String) {
        val url = "https://tradeportea.com/shop/?email=$emailStr&mentor=$mentorStr"

        val webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.loadWithOverviewMode = true
        webView.settings.useWideViewPort = true
        webView.loadUrl(url)

        val cardView = CardView(this)
        cardView.radius = 16f
        cardView.setContentPadding(16, 16, 16, 16)
        cardView.addView(webView)

        AlertDialog.Builder(this)
            .setView(cardView)
            .setNegativeButton("Close") { dialog, _ -> dialog.dismiss() }
            .create()
            .show()
    }

    private fun showAlert(title: String, message: String) {
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("OK") { dialog, _ -> dialog.dismiss() }
            .create()
            .show()
    }
    
    override fun onSupportNavigateUp(): Boolean {
        val navController = findNavController(R.id.nav_host_fragment_activity_home)
        return navController.navigateUp(appBarConfiguration) || super.onSupportNavigateUp()
    }
    
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (drawerLayout.isDrawerOpen(GravityCompat.START)) {
            drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            super.onBackPressed()
        }
    }
    
    /**
     * Briefly peeks the navigation drawer open then closes it,
     * so the user knows it exists. Only runs once per install.
     */
    private fun peekDrawer() {
        // Small delay so the main content settles first
        peekHandler.postDelayed({
            if (!isFinishing && !isDestroyed) {
                drawerLayout.openDrawer(GravityCompat.START)
                // Close it after a brief moment
                peekHandler.postDelayed({
                    if (!isFinishing && !isDestroyed && drawerLayout.isDrawerOpen(GravityCompat.START)) {
                        drawerLayout.closeDrawer(GravityCompat.START)
                    }
                }, 1000)
            }
        }, 600)
    }

    private fun isValidEmail(target: CharSequence?): Boolean {
        return !TextUtils.isEmpty(target) && Patterns.EMAIL_ADDRESS.matcher(target).matches()
    }
    
    private fun setupThemeSwatches(navView: NavigationView) {
        val headerView = navView.getHeaderView(0)

        val swatchCrimson = headerView.findViewById<ImageView>(R.id.swatch_crimson)
        val swatchOcean = headerView.findViewById<ImageView>(R.id.swatch_ocean)
        val swatchEmerald = headerView.findViewById<ImageView>(R.id.swatch_emerald)
        val swatchViolet = headerView.findViewById<ImageView>(R.id.swatch_violet)
        val swatchAmber = headerView.findViewById<ImageView>(R.id.swatch_amber)
        val swatchSilver = headerView.findViewById<ImageView>(R.id.swatch_silver)
        val swatchBlack = headerView.findViewById<ImageView>(R.id.swatch_black)
        val swatchWhite = headerView.findViewById<ImageView>(R.id.swatch_white)
        val swatchDarkBlue = headerView.findViewById<ImageView>(R.id.swatch_dark_blue)

        val ringCrimson = headerView.findViewById<ImageView>(R.id.swatch_crimson_ring)
        val ringOcean = headerView.findViewById<ImageView>(R.id.swatch_ocean_ring)
        val ringEmerald = headerView.findViewById<ImageView>(R.id.swatch_emerald_ring)
        val ringViolet = headerView.findViewById<ImageView>(R.id.swatch_violet_ring)
        val ringAmber = headerView.findViewById<ImageView>(R.id.swatch_amber_ring)
        val ringSilver = headerView.findViewById<ImageView>(R.id.swatch_silver_ring)
        val ringBlack = headerView.findViewById<ImageView>(R.id.swatch_black_ring)
        val ringWhite = headerView.findViewById<ImageView>(R.id.swatch_white_ring)
        val ringDarkBlue = headerView.findViewById<ImageView>(R.id.swatch_dark_blue_ring)

        val rings = listOf(ringCrimson, ringOcean, ringEmerald, ringViolet, ringAmber, ringSilver, ringBlack, ringWhite, ringDarkBlue)

        // Update ring visibility based on current theme
        fun updateRings(theme: ThemeEngine.Theme) {
            rings.forEach { it.visibility = GONE }
            when (theme) {
                ThemeEngine.Theme.CRIMSON -> ringCrimson.visibility = VISIBLE
                ThemeEngine.Theme.OCEAN -> ringOcean.visibility = VISIBLE
                ThemeEngine.Theme.EMERALD -> ringEmerald.visibility = VISIBLE
                ThemeEngine.Theme.VIOLET -> ringViolet.visibility = VISIBLE
                ThemeEngine.Theme.AMBER -> ringAmber.visibility = VISIBLE
                ThemeEngine.Theme.SILVER -> ringSilver.visibility = VISIBLE
                ThemeEngine.Theme.BLACK -> ringBlack.visibility = VISIBLE
                ThemeEngine.Theme.WHITE -> ringWhite.visibility = VISIBLE
                ThemeEngine.Theme.DARK_BLUE -> ringDarkBlue.visibility = VISIBLE
            }
        }

        // Set initial state
        updateRings(ThemeEngine.getCurrentTheme())

        // Setup click listeners
        swatchCrimson?.setOnClickListener {
            ThemeEngine.setTheme(this, ThemeEngine.Theme.CRIMSON)
            updateRings(ThemeEngine.Theme.CRIMSON)
        }

        swatchOcean?.setOnClickListener {
            ThemeEngine.setTheme(this, ThemeEngine.Theme.OCEAN)
            updateRings(ThemeEngine.Theme.OCEAN)
        }

        swatchEmerald?.setOnClickListener {
            ThemeEngine.setTheme(this, ThemeEngine.Theme.EMERALD)
            updateRings(ThemeEngine.Theme.EMERALD)
        }

        swatchViolet?.setOnClickListener {
            ThemeEngine.setTheme(this, ThemeEngine.Theme.VIOLET)
            updateRings(ThemeEngine.Theme.VIOLET)
        }

        swatchAmber?.setOnClickListener {
            ThemeEngine.setTheme(this, ThemeEngine.Theme.AMBER)
            updateRings(ThemeEngine.Theme.AMBER)
        }

        swatchSilver?.setOnClickListener {
            ThemeEngine.setTheme(this, ThemeEngine.Theme.SILVER)
            updateRings(ThemeEngine.Theme.SILVER)
        }

        swatchBlack?.setOnClickListener {
            ThemeEngine.setTheme(this, ThemeEngine.Theme.BLACK)
            updateRings(ThemeEngine.Theme.BLACK)
        }

        swatchWhite?.setOnClickListener {
            ThemeEngine.setTheme(this, ThemeEngine.Theme.WHITE)
            updateRings(ThemeEngine.Theme.WHITE)
        }

        swatchDarkBlue?.setOnClickListener {
            ThemeEngine.setTheme(this, ThemeEngine.Theme.DARK_BLUE)
            updateRings(ThemeEngine.Theme.DARK_BLUE)
        }
    }

    // ============================================================================
    // VIDEO BACKGROUND
    // ============================================================================

    private fun setupVideoBackground() {
        val appSettingsPrefs = getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val selectedVideo = appSettingsPrefs.getString("selected_video", "none") ?: "none"
        isVideoBackgroundEnabled = selectedVideo != "none"
        if (selectedVideo == "custom") {
            customVideoUri = appSettingsPrefs.getString("custom_video_uri", null)
        } else {
            customVideoUri = null
            selectedVideoRes = when (selectedVideo) {
                "video1" -> R.raw.video
                "video2" -> R.raw.video1
                "video3" -> R.raw.video3
                "video4" -> R.raw.video4
                "video5" -> R.raw.video5
                "video6" -> R.raw.video6
                "video7" -> R.raw.video7
                else -> R.raw.video
            }
        }
        videoBackgroundLiveData.value = isVideoBackgroundEnabled

        val textureView: TextureView = binding.videoBackground

        textureView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
                videoSurface = Surface(surfaceTexture)
                if (isVideoBackgroundEnabled) {
                    startVideoPlayback()
                }
            }

            override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}

            override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
                releaseMediaPlayer()
                videoSurface?.release()
                videoSurface = null
                return true
            }

            override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
        }

        applyVideoBackgroundState(selectedVideo)
    }

    private fun startVideoPlayback() {
        releaseMediaPlayer()
        stopVideoLoopHandler()

        val isCustom = customVideoUri != null
        val isVideo2 = !isCustom && selectedVideoRes == R.raw.video1

        try {
            mediaPlayer = MediaPlayer().apply {
                if (isCustom) {
                    setDataSource(this@HomeActivity, Uri.parse(customVideoUri))
                } else {
                    val afd = resources.openRawResourceFd(selectedVideoRes)
                    setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                    afd.close()
                }

                setSurface(videoSurface)
                isLooping = true
                setVolume(0f, 0f)

                setOnPreparedListener { mp ->
                    // Center-crop scaling
                    val videoWidth = mp.videoWidth.toFloat()
                    val videoHeight = mp.videoHeight.toFloat()
                    val viewWidth = binding.videoBackground.width.toFloat()
                    val viewHeight = binding.videoBackground.height.toFloat()

                    if (videoWidth > 0 && videoHeight > 0 && viewWidth > 0 && viewHeight > 0) {
                        val videoAspect = videoWidth / videoHeight
                        val viewAspect = viewWidth / viewHeight

                        if (videoAspect > viewAspect) {
                            binding.videoBackground.scaleX = videoAspect / viewAspect
                            binding.videoBackground.scaleY = 1f
                        } else {
                            binding.videoBackground.scaleX = 1f
                            binding.videoBackground.scaleY = viewAspect / videoAspect
                        }
                    }

                    mp.start()

                    // Video Background 2: loop first 7 seconds
                    if (isVideo2) {
                        startVideo2Loop()
                    }
                }

                prepareAsync()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun startVideo2Loop() {
        stopVideoLoopHandler()
        videoLoopRunnable = object : Runnable {
            override fun run() {
                try {
                    mediaPlayer?.let {
                        if (it.isPlaying && it.currentPosition >= 7000) {
                            it.seekTo(0)
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                videoLoopHandler.postDelayed(this, 500)
            }
        }
        videoLoopHandler.postDelayed(videoLoopRunnable!!, 500)
    }

    private fun stopVideoLoopHandler() {
        videoLoopRunnable?.let { videoLoopHandler.removeCallbacks(it) }
        videoLoopRunnable = null
    }

    private fun releaseMediaPlayer() {
        stopVideoLoopHandler()
        mediaPlayer?.let {
            try {
                if (it.isPlaying) it.stop()
                it.release()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        mediaPlayer = null
    }

    fun applyVideoBackgroundState(videoKey: String) {
        val enabled = videoKey != "none"
        isVideoBackgroundEnabled = enabled
        videoBackgroundLiveData.value = enabled

        if (videoKey == "custom") {
            val appSettingsPrefs = getSharedPreferences("app_settings", Context.MODE_PRIVATE)
            customVideoUri = appSettingsPrefs.getString("custom_video_uri", null)
        } else {
            customVideoUri = null
            selectedVideoRes = when (videoKey) {
                "video1" -> R.raw.video
                "video2" -> R.raw.video1
                "video3" -> R.raw.video3
                "video4" -> R.raw.video4
                "video5" -> R.raw.video5
                "video6" -> R.raw.video6
                "video7" -> R.raw.video7
                else -> R.raw.video
            }
        }

        val textureView: TextureView = binding.videoBackground
        val scrimView: View = binding.videoScrim

        if (enabled) {
            textureView.visibility = VISIBLE
            scrimView.visibility = VISIBLE
            binding.container.setBackgroundColor(Color.TRANSPARENT)

            // Always restart playback to switch to the correct video
            if (videoSurface != null) {
                startVideoPlayback()
            }
        } else {
            textureView.visibility = GONE
            scrimView.visibility = GONE
            releaseMediaPlayer()
            binding.container.background = ThemeEngine.createAtmosphereDrawable()
        }
    }

    override fun onPause() {
        super.onPause()
        stopVideoLoopHandler()
        mediaPlayer?.let {
            try {
                if (it.isPlaying) it.pause()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (isVideoBackgroundEnabled) {
            mediaPlayer?.let {
                try {
                    if (!it.isPlaying) it.start()
                    // Restart 12-second loop handler for video2
                    if (selectedVideoRes == R.raw.video1) {
                        startVideo2Loop()
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }

        // Revoke detection: re-verify subscription whenever the app
        // foregrounds IF the user is already past the login screen.
        // This lets us kick a user out mid-session the moment their
        // binding changes on the server (device stolen, admin revoked,
        // subscription expired). We skip when payLayout is visible so
        // we don't spam the server while the user is actively logging
        // in, and we skip on the very first onResume (right after
        // onCreate already fired the same check) to avoid a duplicate
        // call on app launch.
        if (!isFirstResume && findViewById<RelativeLayout>(R.id.main_view).visibility == VISIBLE) {
            verifySubscription()
        }
        isFirstResume = false
    }

    override fun onDestroy() {
        super.onDestroy()
        peekHandler.removeCallbacksAndMessages(null)
        releaseMediaPlayer()
        videoSurface?.release()
        videoSurface = null
    }
}
