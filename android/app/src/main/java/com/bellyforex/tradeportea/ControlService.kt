package com.bellyforex.tradeportea
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.NotificationManager.IMPORTANCE_LOW
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.text.TextUtils.concat
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.View.GONE
import android.view.View.VISIBLE
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.RelativeLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.Observer
import com.bellyforex.tradeportea.network.api.RetrofitInstance
import com.bellyforex.tradeportea.network.module.Mt5TradeRequest
import com.bellyforex.tradeportea.utils.Mt5Session
import com.bellyforex.tradeportea.utils.Mt5Json
import com.bellyforex.tradeportea.network.db.LicenceDB
import com.bellyforex.tradeportea.network.module.AuthBody
import com.bellyforex.tradeportea.network.module.Sicence
import com.bellyforex.tradeportea.network.module.Signal
import com.bellyforex.tradeportea.network.module.Signals
import com.bellyforex.tradeportea.network.module.Symbol
import com.bellyforex.tradeportea.network.module.log
import com.bellyforex.tradeportea.repository.RTRepository
import com.bellyforex.tradeportea.ui.CloseTradesActivity
import com.bellyforex.tradeportea.ui.FinishActivity
import com.bellyforex.tradeportea.ui.HomeActivity
import com.bellyforex.tradeportea.ui.ModifyTradeActivity
import com.bellyforex.tradeportea.ui.TradeActivity
import com.bellyforex.tradeportea.utils.Constants.Companion.LOGO_BASE_URL
import com.bellyforex.tradeportea.utils.FloatingTheme
import com.bellyforex.tradeportea.utils.Resource
import com.bumptech.glide.Glide
import android.animation.ObjectAnimator
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import retrofit2.Response
import com.bellyforex.tradeportea.ui.theme.WarpGlowDrawable
import com.bellyforex.tradeportea.utils.TTSManager
import com.bellyforex.tradeportea.utils.TrailingManager


class ControlService: Service(), View.OnTouchListener, View.OnClickListener{
    lateinit var job: Job
    private val binder = MyBinder()
    private val rtRepository = RTRepository(LicenceDB(this))
    private val licence = getSelectedLicences()
    private var busy = false
    private val signalData: MutableLiveData<Resource<Signals>> = MutableLiveData()
    private lateinit var savedSignalData: LiveData<List<Signal>>
    private lateinit var savedLogData: LiveData<List<log>>
    private lateinit var symbols: LiveData<List<Symbol>>
    private var useSymbols :List<Symbol> = listOf()
    private lateinit var pendingIntent: PendingIntent
    private lateinit var pendingIntentMT4: PendingIntent
    private lateinit var myPendingIntent: PendingIntent
    private lateinit var myPendingIntent2: PendingIntent
    private lateinit var lic: Sicence
    private lateinit var mt4SharedPref : SharedPreferences
    private lateinit var mt5SharedPref : SharedPreferences
    private lateinit var ea_nameSharedPref : SharedPreferences
    private lateinit var ea_nameModePref : SharedPreferences


    private var trading = false
    override fun onBind(intent: Intent?): IBinder? {
        Log.d("runnable","service is bound")
        return binder
    }


    inner class MyBinder: Binder(){
        fun getService() = this@ControlService
    }

    fun getStatus() : Flow<Boolean> {
        return flow {
            delay(500)
            emit(trading)
        }
    }


    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel(applicationContext)
        resetVariable()
        createOverlay()

        val intent = Intent(this, TradeActivity::class.java)
        ea_nameSharedPref = getSharedPreferences("MyPrefs", Context.MODE_PRIVATE)
        ea_nameModePref = getSharedPreferences("EANameModePrefs", MODE_PRIVATE)

        intent.flags = Intent.FLAG_ACTIVITY_BROUGHT_TO_FRONT
        pendingIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }else{
            PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT)
        }


        trading = true
        Log.d("runnable","service is started")
        
        // Initialize TTS and speak "Trading Activated"
        TTSManager.init(this)
        TTSManager.speak(TTSManager.Messages.TRADING_ACTIVATED)
        
        // Set up trailing SL/TP callback to launch ModifyTradeActivity
        TrailingManager.onSLTPChanged = { newSL, newTP, asset ->
            Log.d("ControlService", "Trailing callback triggered - SL: $newSL, TP: $newTP for $asset")
            val modifyIntent = Intent(this, ModifyTradeActivity::class.java)
            modifyIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            modifyIntent.putExtra("new_sl", newSL)
            modifyIntent.putExtra("new_tp", newTP)
            modifyIntent.putExtra("asset", asset)
            startActivity(modifyIntent)
        }
        
        licence.observeForever(licenceObserver)
        signalData.observeForever(signalsObserver)
        savedLogData = rtRepository.getDBLogs()


        return START_STICKY
    }

    private fun resetVariable()
    {
        busy =false
        checkCount = 0
        wait = false
    }
    private fun getSavedSymbols(phone_secret_key:String) = rtRepository.getSavedSymbols(phone_secret_key)
    private fun getSelectedLicences() = rtRepository.getSicences()
    private var symbolObserver = Observer<List<Symbol>> { useSymbols = it }
    private var checkCount = 0
    private var wait = false

    private val savedSignalObserver = Observer<List<Signal>>{
        // Skip if trading is disabled (e.g., during close all trades)
        if (!trading) {
            Log.d("ControlService", "Signal ignored - trading disabled")
            return@Observer
        }
        
        if (it.isNotEmpty() && it != null)
        {
            busy = true

            if(!it[0].used)
            {
                // Get platform and normalize it (trim whitespace, uppercase)
                val rawPlatform = it[0].platform
                val platform = rawPlatform?.split(":")?.getOrNull(0)?.trim()?.uppercase()
                
                Log.d("ControlService", "Signal platform raw: '$rawPlatform', parsed: '$platform'")

                if(platform == "MT5") {
                    // No WebView, so nothing takes over the screen and the user
                    // does not have to leave the phone alone while it trades.
                    TTSManager.speak(TTSManager.Messages.OPENING_TRADE)

                    executeMt5Signal(it[0])
                    addLogMessage(0,">>Executing MT5 signal")
                    myView.findViewById<RelativeLayout>(R.id.autotrade).apply{
                        visibility = GONE
                    }
                }
                else if(platform == "MT4") {
                    addLogMessage(0,">>Automated Trading is in Progress, Please Do not Use your phone.")
                    
                    // Speak "Opening trade"
                    TTSManager.speak(TTSManager.Messages.OPENING_TRADE)

                    openMT(it[0])

                    addLogMessage(0,">>Opening MT4")
                    myView.findViewById<RelativeLayout>(R.id.autotrade).apply{
                        visibility = GONE
                    }
                }else
                {
                    // Speak "Trading failed"
                    TTSManager.speak(TTSManager.Messages.TRADING_FAILED)
                    
                    myView.findViewById<TextView>(R.id.note_text).apply{
                        text = concat("Automated Trading Failed, please add a platform to this symbol.")
                        visibility = VISIBLE
                    }
                }
            }else
            {
                wait = true
                checkCount = 0
            }
        }
    }
    private val licenceObserver = Observer<List<Sicence>> { data ->
        if (data.isNotEmpty())
        {
            lic = data[0]
            symbols = getSavedSymbols(lic.phone_secret_key)
            symbols.observeForever(symbolObserver)
            job = MainScope().launch {
                rtRepository.deleteSignals()
                rtRepository.deleteLogs()
                savedSignalData = rtRepository.getDBSignals()
                savedSignalData.observeForever(savedSignalObserver)
                while (true)
                {
                    delay(2000)
                    if(!busy )
                    {
                        wait = false
                        checkCount =0
                        rtRepository.deleteSignals()
                        rtRepository.deleteLogs()
                        getSignals(AuthBody(lic.key,lic.phone_secret_key))
                        myView.findViewById<TextView>(R.id.note_text).apply{
                            visibility = GONE
                        }
                        myView.findViewById<RelativeLayout>(R.id.autotrade).apply{
                            visibility = GONE
                        }

                    }else{

                        if(wait){
                            myView.findViewById<TextView>(R.id.note_text).apply{
                                visibility = GONE
                            }
                            myView.findViewById<RelativeLayout>(R.id.autotrade).apply{
                                visibility = GONE
                            }
                            rtRepository.deleteSignals()
                            //addLogMessage(1,myView.findViewById<TextView>(R.id.log_message).text.toString())
                            delay(100000)
                            busy = false

                        }else {
                            if (checkCount <= 60) {
                                checkCount += 1
                            } else {
                                wait = true

                            }
                        }
                        Log.d("runnable",checkCount.toString())
                    }

                }
            }
        }
    }

    private val signalsObserver = Observer<Resource<Signals>> { data ->
        busy = when(data) {
            is Resource.Loading ->{
                true
            }
            is Resource.Error ->{
                false
            }
            is Resource.Success ->{
                if(data.data != null && data.data.signal !=null){
                    val mySig = data.data.signal
                    val mySymbol = testIfSymbolIsAllowed(mySig.asset,useSymbols)
                    
                    // Check for trailing SL/TP updates on existing positions
                    if (TrailingManager.isTrailingActive() && mySig.asset == TrailingManager.getCurrentAsset()) {
                        val trailingSignal = Signal(
                            mySig.id, mySig.action, mySig.asset, mySig.latestupdate,
                            mySig.price, mySig.sl, mySig.time, mySig.tp,
                            mySymbol?.lotSize, mySymbol?.platform, mySig.used
                        )
                        TrailingManager.checkSignalUpdate(trailingSignal)
                    }
                    
                    if (mySymbol !=null) {
                        if ((mySig.action == mySymbol.action) || (mySymbol.action == "BOTH")) {
                            MainScope().launch {
                                Log.d("runnable", "got the signal" + mySig.id)
                                
                                // Show signal received notification on floating icon
                                Handler(Looper.getMainLooper()).post {
                                    try {
                                        // Speak "Signal Received"
                                        TTSManager.speak("${TTSManager.Messages.SIGNAL_RECEIVED}, ${mySig.action} ${mySig.asset}")
                                        
                                        // Only update UI if myView is initialized
                                        if (::myView.isInitialized) {
                                            myView.findViewById<RelativeLayout>(R.id.autotrade)?.apply {
                                                visibility = VISIBLE
                                            }
                                            myView.findViewById<TextView>(R.id.note_text)?.apply {
                                                text = "Signal Received: ${mySig.action} ${mySig.asset}"
                                                visibility = VISIBLE
                                            }
                                        }
                                    } catch (e: Exception) {
                                        Log.e("ControlService", "Error showing signal notification: ${e.message}")
                                    }
                                }
                                
                                rtRepository.saveSignals(
                                    Signal(
                                        mySig.id,
                                        mySig.action,
                                        mySig.asset,
                                        mySig.latestupdate,
                                        mySig.price,
                                        mySig.sl,
                                        mySig.time,
                                        mySig.tp,
                                        mySymbol.lotSize,
                                        mySymbol.platform,
                                        mySig.used
                                    )
                                )
                            }

                        }
                    }
                }
                false
            }
        }
    }
    /**
     * Execute an MT5 signal through Api2Trade.
     *
     * This replaces launching TradeActivity, which drove the broker's web
     * terminal by simulated clicks. That approach placed its orders one at a
     * time over tens of seconds, so a signal fired while the robot held the
     * opposite side landed a Buy on top of a Sell — the hedge that was
     * reported. A REST order fills in one call, and the same session the rest
     * of the app uses.
     *
     * Stop loss and take profit ride along with the order rather than being
     * applied afterwards, so the position is never briefly unprotected.
     */
    private fun executeMt5Signal(signal: Signal) = MainScope().launch {
        val operation = when (signal.action.trim().lowercase()) {
            "buy", "long" -> "Buy"
            "sell", "short" -> "Sell"
            else -> null
        }
        if (operation == null) {
            addLogMessage(0, ">>Signal ignored — unknown direction '${signal.action}'")
            return@launch
        }

        // A stored UUID is not proof the broker still holds the session.
        val uuid = Mt5Session.ensure(this@ControlService, force = true)
        if (uuid.isNullOrEmpty()) {
            addLogMessage(0, ">>MT5 account not connected — signal not taken.")
            return@launch
        }

        val lots = signal.lotSize?.takeIf { it > 0 } ?: 0.01
        val comment = (getSharedPreferences("MyPrefs", MODE_PRIVATE)
            .getString("ea_name", null)?.takeIf { it.isNotBlank() } ?: "Robot").take(31)
        // Locale keyboards produce "0,10", which parses to 0 and would be
        // rejected by the broker as an invalid volume.
        val sl = signal.sl.trim().replace(',', '.').toDoubleOrNull()?.takeIf { it > 0 }
        val tp = signal.tp.trim().replace(',', '.').toDoubleOrNull()?.takeIf { it > 0 }

        try {
            val response = RetrofitInstance.mt5Api.trade(
                Mt5TradeRequest(
                    id = uuid, action = "open", symbol = signal.asset,
                    operation = operation, volume = lots, comment = comment,
                    stoploss = sl, takeprofit = tp
                )
            )
            // OrderSend answers 200 even when the broker rejects it, so a
            // ticket is the only proof the order actually exists.
            val ticket = Mt5Json.extractTicket(response.body())
            if (response.isSuccessful && ticket > 0) {
                addLogMessage(0, ">>$operation ${signal.asset} opened — ticket $ticket")
            } else {
                addLogMessage(0, ">>Trade rejected by broker. Check the lot size for ${signal.asset}.")
            }
        } catch (e: Exception) {
            Log.w("ControlService", "signal execute failed", e)
            addLogMessage(0, ">>Trade failed — check your internet connection.")
        }
    }

    private fun openMT(signal: Signal)
    {
        val b = Bundle()
        b.putSerializable("signal",signal)
        val intent = Intent(this, TradeActivity::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        intent.putExtra("signal",b)
        startActivity(intent)
        //pendingIntent.writeToParcel()
        //pendingIntent.send()
    }


    private fun testIfSymbolIsAllowed(name: String?, symbols : List<Symbol>): Symbol?{

        for(symbol in symbols)
        {
            if(name == symbol.name) return symbol
        }

        return null
    }

    private fun getSignals(authBody: AuthBody) = MainScope().launch {

        signalData.postValue(Resource.Loading())
        try {
            val response = rtRepository.getSignals(authBody)
            signalData.postValue(handleSignalResponse(response))
        } catch (t: Throwable) {
            signalData.postValue(Resource.Error("Oops! Something went wrong"))
        }

    }
    private fun addLogMessage(id :Int,msg :String)
    {
        MainScope().launch {
            rtRepository.upsetLog(
                log(id,msg)
            )
        }
    }

    private fun handleSignalResponse(response: Response<Signals>): Resource<Signals> {
        if (response.isSuccessful) {
            response.body()?.let {
                if (it.message == "accept") {
                    return Resource.Success(it)
                }

                return Resource.Error("Unknown Error Occurred!!")
            }
        }
        return Resource.Error(response.message())
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            trading = false
            busy = false
            useSymbols = listOf()
            try { licence.removeObserver(licenceObserver) } catch (_: Exception) {}
            try { signalData.removeObserver(signalsObserver) } catch (_: Exception) {}
            if (::symbols.isInitialized) {
                try { symbols.removeObserver(symbolObserver) } catch (_: Exception) {}
            }
            if (::job.isInitialized) {
                try { job.cancel() } catch (_: Exception) {}
            }
            try { unregisterThemeListener() } catch (_: Exception) {}
            try { iconGlowDrawable?.stopRotation() } catch (_: Exception) {}
            if (overlayAdded && ::windowManager.isInitialized && ::myView.isInitialized) {
                try { windowManager.removeView(myView) } catch (_: Exception) {}
                overlayAdded = false
            }
            try { resetVariable() } catch (_: Exception) {}
            Log.d("runnable", "service stopped")
        } catch (e: Exception) {
            Log.e("ControlService", "onDestroy error: ${e.message}")
        }
        stopSelf()
    }

    private fun createNotificationChannel(context: Context){
        val channelId = "RoboTrader"
        val channelName = "Robo Trader"

        val channel = NotificationChannel(
            channelId,
            channelName,
            IMPORTANCE_LOW

        ).apply {
            lightColor = Color.BLUE
            importance = IMPORTANCE_LOW
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }


        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.createNotificationChannel(channel)

        val intent = Intent(applicationContext, HomeActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        myPendingIntent =if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }else{
            PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT)
        }

        val intent2 = Intent(this, FinishActivity::class.java)
        intent2.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        //myPendingIntent2 =PendingIntent.getActivity(this,0,intent2,0)
        myPendingIntent2 = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.getActivity(this, 0, intent2,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }else{
            PendingIntent.getActivity(this, 0, intent2,
                PendingIntent.FLAG_UPDATE_CURRENT)
        }


        val channelBuilder = NotificationCompat.Builder(this,channelId)
        val notification = channelBuilder
            .setOngoing(true)
            .setSmallIcon(com.bellyforex.tradeportea.R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setContentTitle("TradePortEA is Active")
            .setContentText("Connected Robot will trade for you.")
            .build()

        startForeground(1, notification)
    }
    private lateinit var windowManager: WindowManager
    private lateinit var btnParams: WindowManager.LayoutParams
    private lateinit var expandedParams: WindowManager.LayoutParams
    private lateinit var myView: View
    private lateinit var floatingWindowView: View

    private var initialX = 0
    private var initialY = 0
    private var initialTouchX = 0.0f
    private var initialTouchY = 0.0f
    private var moving = true
    private var isExpanded = false
    private var isMovingDisabled = false  // New flag to disable movement
    private var logged4 = false
    private var logged5 = false
    private var pulseAnim: ObjectAnimator? = null

    // Safe WindowManager wrappers for crash prevention
    private fun safeAddView(view: View, params: WindowManager.LayoutParams) {
        try {
            if (!view.isAttachedToWindow) {
                windowManager.addView(view, params)
            }
        } catch (e: Exception) {
            Log.e("ControlService", "safeAddView error: ${e.message}")
        }
    }

    private fun safeRemoveView(view: View?) {
        try {
            view?.let {
                if (it.isAttachedToWindow) {
                    windowManager.removeView(it)
                }
            }
        } catch (e: Exception) {
            Log.e("ControlService", "safeRemoveView error: ${e.message}")
        }
    }

    private fun safeUpdateView(view: View, params: WindowManager.LayoutParams) {
        try {
            if (view.isAttachedToWindow) {
                windowManager.updateViewLayout(view, params)
            }
        } catch (e: Exception) {
            Log.e("ControlService", "safeUpdateView error: ${e.message}")
        }
    }

    private fun applyFloatingTheme(view: View) {
        try {
            val root = view.findViewById<View>(R.id.floating_root) ?: return
            val glassTint = FloatingTheme.getGlassTint(this)
            val glowColor = FloatingTheme.getGlowColor(this)
            val borderColor = FloatingTheme.getBorderColor(this)

            // Apply tint overlay to root background
            val bg = root.background
            if (bg is LayerDrawable) {
                // Tint the glass layer (index 1 in our layer-list)
                val glassLayer = bg.getDrawable(1) as? GradientDrawable
                glassLayer?.setColor(glassTint)

                // Tint the border (last layer)
                val borderLayer = bg.getDrawable(bg.numberOfLayers - 1) as? GradientDrawable
                borderLayer?.setStroke(
                    (1 * resources.displayMetrics.density).toInt(),
                    borderColor
                )
            }

            // Tint the orb glow
            val orbGlow = view.findViewById<FrameLayout>(R.id.orb_glow_container)
            orbGlow?.background?.let { drawable ->
                if (drawable is LayerDrawable && drawable.numberOfLayers > 0) {
                    val newHalo = GradientDrawable()
                    newHalo.shape = GradientDrawable.OVAL
                    newHalo.gradientType = GradientDrawable.RADIAL_GRADIENT
                    newHalo.gradientRadius = 44f * resources.displayMetrics.density
                    newHalo.colors = intArrayOf(glowColor, Color.TRANSPARENT)
                    drawable.setDrawableByLayerId(drawable.getId(0), newHalo)
                }
            }
        } catch (e: Exception) {
            Log.e("ControlService", "applyFloatingTheme error: ${e.message}")
        }
    }

    private fun startOrbPulseAnimation(view: View) {
        try {
            val orbGlow = view.findViewById<FrameLayout>(R.id.orb_glow_container) ?: return
            pulseAnim?.cancel()
            // Gentle alpha pulse on the orb glow ring — NO rotation (image must stay still)
            pulseAnim = ObjectAnimator.ofFloat(orbGlow, "alpha", 0.6f, 1f).apply {
                duration = 2500
                repeatCount = ObjectAnimator.INFINITE
                repeatMode = ObjectAnimator.REVERSE
                interpolator = AccelerateDecelerateInterpolator()
            }
            pulseAnim?.start()
        } catch (e: Exception) {
            Log.e("ControlService", "startOrbPulseAnimation error: ${e.message}")
        }
    }

    private var overlayAdded = false

    private fun createOverlay() {
        // Prevent duplicate floating icons — single boolean flag, reliable on all devices
        if (overlayAdded) return

        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val inflater: LayoutInflater = getSystemService(LAYOUT_INFLATER_SERVICE) as LayoutInflater
        myView = inflater.inflate(R.layout.info_layout, null)
        myView.setOnTouchListener(this)
        myView.setOnClickListener(this)

        myView.findViewById<Button>(R.id.force_stop).setOnClickListener {
            val id = Process.myPid()
            Process.killProcess(id)
        }

        val layoutFlag = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        btnParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.TRANSLUCENT
        )

        btnParams.gravity = Gravity.TOP or Gravity.CENTER
        btnParams.x = 0
        btnParams.y = 0

        windowManager.addView(myView, btnParams)
        overlayAdded = true

        // Apply theme glow to floating icon border
        applyFloatingIconTheme(myView)

        // Listen for theme changes to update floating icon & expanded window glows
        registerThemeListener()
    }

    private var iconGlowDrawable: WarpGlowDrawable? = null
    private var themePrefsListener: SharedPreferences.OnSharedPreferenceChangeListener? = null

    /** Listen for theme changes and update all floating UI glow colors */
    private fun registerThemeListener() {
        val prefs = getSharedPreferences("theme_prefs", MODE_PRIVATE)
        themePrefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == "selected_theme") {
                // Update floating icon glow color
                val newColor = FloatingTheme.getFullGlowColor(this)
                iconGlowDrawable?.updateColors(newColor, newColor)

                // Update expanded window glow if it's currently open
                if (isExpanded && ::floatingWindowView.isInitialized) {
                    try {
                        val wrapperBg = floatingWindowView.background as? WarpGlowDrawable
                        wrapperBg?.updateColors(newColor, newColor)

                        // Update text glows
                        val textAlpha = Color.argb(200, Color.red(newColor), Color.green(newColor), Color.blue(newColor))
                        floatingWindowView.findViewById<TextView>(R.id.bot_name)?.setShadowLayer(12f, 0f, 0f, textAlpha)
                        floatingWindowView.findViewById<TextView>(R.id.owner_name)?.setShadowLayer(8f, 0f, 0f, textAlpha)

                        // Re-apply floating theme tints
                        applyFloatingTheme(floatingWindowView)
                    } catch (e: Exception) {
                        Log.e("ControlService", "Theme update on expanded view error: ${e.message}")
                    }
                }
            }
        }
        prefs.registerOnSharedPreferenceChangeListener(themePrefsListener)
    }

    private fun unregisterThemeListener() {
        themePrefsListener?.let {
            getSharedPreferences("theme_prefs", MODE_PRIVATE)
                .unregisterOnSharedPreferenceChangeListener(it)
        }
        themePrefsListener = null
    }

    private fun applyFloatingIconTheme(view: View) {
        try {
            val glowRing = view.findViewById<FrameLayout>(R.id.icon_glow_ring) ?: return
            val iconContainer = view.findViewById<FrameLayout>(R.id.icon_container) ?: return
            val fullGlowColor = FloatingTheme.getFullGlowColor(this)
            val density = resources.displayMetrics.density

            // Apply WarpGlowDrawable to the outer glow ring (rotating neon border)
            WarpGlowDrawable.prepareView(glowRing)
            val glowDrawable = WarpGlowDrawable(
                glowColor = fullGlowColor,
                cornerRadiusPx = 34f * density, // large radius = near-circular for the round icon
                intensity = WarpGlowDrawable.GlowIntensity.MEDIUM,
                paddingPx = 6f * density
            )
            glowRing.background = glowDrawable
            iconGlowDrawable = glowDrawable

            // Keep icon container with dark transparent circle background
            val iconBg = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xE6111111.toInt())
            }
            iconContainer.background = iconBg
        } catch (e: Exception) {
            Log.e("ControlService", "applyFloatingIconTheme error: ${e.message}")
        }
    }

    override fun onTouch(v: View?, event: MotionEvent?): Boolean {
        if (v == null || event == null) return false
        
        storeBotName(lic.ea_name)
        if (isMovingDisabled) {
            return true // Ignore touch events if movement is disabled
        }

        // Get the correct LayoutParams DIRECTLY from the view being touched
        // This eliminates the need for separate btnParams/expandedParams references
        val params: WindowManager.LayoutParams = try {
            v.layoutParams as? WindowManager.LayoutParams ?: return false
        } catch (e: ClassCastException) {
            Log.e("ControlService", "Invalid LayoutParams type: ${e.message}")
            return false
        }

        // Click detection threshold (in pixels)
        val clickThreshold = 15
        
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                initialX = params.x
                initialY = params.y
                initialTouchX = event.rawX
                initialTouchY = event.rawY
                moving = false // Don't start moving until we detect drag
                return true
            }
            MotionEvent.ACTION_UP -> {
                // Check if this was a click (minimal movement)
                val deltaX = Math.abs(event.rawX - initialTouchX)
                val deltaY = Math.abs(event.rawY - initialTouchY)
                if (deltaX < clickThreshold && deltaY < clickThreshold) {
                    // This is a click - perform click action
                    v.performClick()
                }
                moving = false
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                // Only start moving if we've moved beyond the click threshold
                val dx = (event.rawX - initialTouchX).toInt()
                val dy = (event.rawY - initialTouchY).toInt()
                
                if (Math.abs(dx) > clickThreshold || Math.abs(dy) > clickThreshold) {
                    moving = true
                    params.x = initialX + dx
                    params.y = initialY + dy
                    
                    try {
                        if (v.isAttachedToWindow) {
                            windowManager.updateViewLayout(v, params)
                        }
                    } catch (e: IllegalArgumentException) {
                        // View not attached to WindowManager
                        Log.w("ControlService", "View not attached: ${e.message}")
                    } catch (e: Exception) {
                        Log.e("ControlService", "Error updating view layout: ${e.message}")
                    }
                }
                return true
            }
        }
        return false
    }

    fun isNetworkAvailable(context: Context): Boolean {
        // Safely get the ConnectivityManager instance
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // For Android 6.0 (Marshmallow) and above
            val network = connectivityManager.activeNetwork
            val networkCapabilities = connectivityManager.getNetworkCapabilities(network)
            networkCapabilities != null &&
                    (networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                            networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR))
        } else {
            // For Android versions below 6.0 (Marshmallow)
            @Suppress("DEPRECATION")
            val networkInfo = connectivityManager.activeNetworkInfo
            networkInfo != null && networkInfo.isConnected
        }
    }


    @SuppressLint("InvalidWakeLockTag")
    override fun onClick(view: View?) {
        mt4SharedPref  = getSharedPreferences("mt4", MODE_PRIVATE)
        mt5SharedPref  = getSharedPreferences("mt5", MODE_PRIVATE)

        val a4 = mt4SharedPref.getBoolean("logged", null == true)
        val a5 = mt5SharedPref.getBoolean("logged", null == true)

        // Get the current symbols list (quotes)
        val symbolsList = symbols.value ?: emptyList()



        if (!moving) {
            if (!isExpanded) {

                // Get an instance of the PowerManager
                val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager

                // Create a WakeLock with the PARTIAL_WAKE_LOCK flag
                val wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MyWakeLock")
                // Preserve the current position of the first overlay



                val currentX = btnParams.x
                val currentY = btnParams.y

                // Create and display the second overlay - wrapped in glow container
                val inflater = LayoutInflater.from(this)
                val innerView = inflater.inflate(R.layout.floating_window, null)

                // Create glow wrapper FrameLayout
                val density = resources.displayMetrics.density
                val glowPadding = (12 * density).toInt()
                val glowWrapper = FrameLayout(this)
                glowWrapper.setPadding(glowPadding, glowPadding, glowPadding, glowPadding)
                glowWrapper.clipToPadding = false
                glowWrapper.clipChildren = false

                // Apply WarpGlowDrawable to the wrapper
                val glowColor = FloatingTheme.getGlowColor(this)
                // Use full-alpha version of glow color for WarpGlowDrawable
                val fullGlow = Color.argb(255,
                    Color.red(glowColor), Color.green(glowColor), Color.blue(glowColor))
                WarpGlowDrawable.prepareView(glowWrapper)
                glowWrapper.background = WarpGlowDrawable(
                    glowColor = fullGlow,
                    cornerRadiusPx = 28f * density,
                    intensity = WarpGlowDrawable.GlowIntensity.MEDIUM,
                    paddingPx = 12f * density
                )

                glowWrapper.addView(innerView, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT
                ))
                floatingWindowView = glowWrapper

                // Find and set up the close button
                val closeButton: Button = floatingWindowView.findViewById(R.id.closeButton)
                closeButton.setOnClickListener {
                    // Remove the overlay when the close button is clicked
                    windowManager.removeView(floatingWindowView)
                    isExpanded = false
                }



                // Find and set up the buttons
                val statusButton: Button = floatingWindowView.findViewById(R.id.statusButton)
                val accountButton: Button = floatingWindowView.findViewById(R.id.accountButton)
                val internetStatus: Button = floatingWindowView.findViewById(R.id.internetStatus)
                val allowedSymbols: Button = floatingWindowView.findViewById(R.id.allowedSymbols)
                val executeButton: Button = floatingWindowView.findViewById(R.id.executeButton)
                val modeB: Button = floatingWindowView.findViewById(R.id.modeb)




                // Define your colors and drawable resources
                // Define your color and drawable resources
                val redColor = ContextCompat.getColor(this, R.color.black)
                val cancelIconDrawable = ContextCompat.getDrawable(this, R.drawable.ic_baseline_cancel_23)

                logged4 = a4
                logged5 = a5


                if (!logged4 && !logged5) {
                    // Set text color to red
                    accountButton.setTextColor(redColor)
                    accountButton.setTypeface(null, Typeface.BOLD)
                }



                // Assuming `internetStatus` is a TextView and `cancelIconDrawable` is a drawable resource
                if (!isNetworkAvailable(this)) {
                    internetStatus.setTextColor(redColor) // Use red color to indicate error
                    internetStatus.setTypeface(null, Typeface.BOLD)
                }

                if (symbolsList.isNotEmpty()) {
                    // Display the symbols' names as a comma-separated string
                    allowedSymbols.text = symbolsList.joinToString(", ") { it.name }
                } else {
                    // Set text color to red
                    allowedSymbols.setTextColor(redColor)
                    allowedSymbols.setTypeface(null, Typeface.BOLD)
                    allowedSymbols.text = " NO QUOTES SELECTED"
                }


                // Initialize the handler
                val handler = Handler(Looper.getMainLooper())


// Delay constants (in milliseconds)
                val delayBetweenButtons = 500L  // Delay between each button
                val delayForFirstButton = 0L    // Initial delay before showing the first button

// Boolean to track the visibility state
                var areButtonsVisible = false

                statusButton.setOnClickListener {
                    // Function to show a button after a delay
                    fun showButtonWithDelay(button: Button, delay: Long) {
                        handler.postDelayed({
                            button.visibility = View.VISIBLE
                        }, delay)
                    }

                    // Function to hide a button after a delay
                    fun hideButtonWithDelay(button: Button, delay: Long) {
                        handler.postDelayed({
                            button.visibility = View.GONE
                        }, delay)
                    }

                    if (!areButtonsVisible) {
                        // Show buttons with staggered delays
                        showButtonWithDelay(accountButton, delayForFirstButton)
                        showButtonWithDelay(internetStatus, delayForFirstButton + delayBetweenButtons)
                        showButtonWithDelay(allowedSymbols, delayForFirstButton + 2 * delayBetweenButtons)
                        showButtonWithDelay(executeButton, delayForFirstButton + 3 * delayBetweenButtons)
                        areButtonsVisible = true
                    } else {
                        // Hide buttons immediately
                        accountButton.visibility = View.GONE
                        internetStatus.visibility = View.GONE
                        allowedSymbols.visibility = View.GONE
                        executeButton.visibility = View.GONE
                        areButtonsVisible = false
                    }
                }


                // Retrieve the mode value, with a default value of 1 (Normal) if not found
                var mode = ea_nameModePref.getInt("mode", 1)



                modeB.setOnClickListener {


                    // Check the value of 'mode' and set the text for accountButton accordingly
                    when (mode) {
                        1 -> {
                            // Mode 1: Normal
                            modeB.text = "Dynamic"
                            mode = 2
                            storeMode(mode)
                            modeB.setCompoundDrawablesWithIntrinsicBounds(0, 0, 0, 0)
                        }
                        2 -> {
                            // Mode 2: Attack
                            modeB.text = "Intense"
                            mode = 3
                            storeMode(mode)
                            modeB.setCompoundDrawablesWithIntrinsicBounds(0, 0, 0, 0)

                        }
                        3 -> {
                            // Mode 3: Aggressive
                            modeB.text = "Normal"
                            mode = 1
                            storeMode(mode)
                            modeB.setCompoundDrawablesWithIntrinsicBounds(0, 0, 0, 0)

                        }
                    }

                    // Make accountButton visible if it's not already
                    modeB.visibility = View.VISIBLE
                }

                // Check conditions for bot activity (e.g., if all other statuses are positive
                if (!symbolsList.isNotEmpty() || !isNetworkAvailable(this) || !logged4 && !logged5)
                {
                    // Set text to "BOT NOT ACTIVE" in red color if the bot is not active
                    executeButton.text = "BOT NOT ACTIVE"
                    executeButton.setTextColor(ContextCompat.getColor(this, R.color.black))
                    executeButton.setTypeface(null, Typeface.BOLD)
                }




                // Find and update the TextViews and ImageView
                val ownerNameTextView: TextView = floatingWindowView.findViewById(R.id.owner_name)
                val botNameTextView: TextView = floatingWindowView.findViewById(R.id.bot_name)
                val logoImageView: ImageView = floatingWindowView.findViewById(R.id.logo_img)

                // Populate the TextViews
                ownerNameTextView.text = lic.owner.name // Update with actual field for owner name
                botNameTextView.text = lic.ea_name // Update with actual field for bot name

                // Apply text glow matching the theme to bot name and owner name
                val textGlowColor = FloatingTheme.getFullGlowColor(this)
                val textGlowAlpha = Color.argb(200,
                    Color.red(textGlowColor), Color.green(textGlowColor), Color.blue(textGlowColor))
                botNameTextView.setShadowLayer(12f, 0f, 0f, textGlowAlpha)
                ownerNameTextView.setShadowLayer(8f, 0f, 0f, textGlowAlpha)

                // Theme the STATUS and CLOSE buttons with glow tint
                val btnGlowLight = Color.argb(30,
                    Color.red(textGlowColor), Color.green(textGlowColor), Color.blue(textGlowColor))
                statusButton.setShadowLayer(6f, 0f, 0f, textGlowAlpha)
                closeButton.setShadowLayer(6f, 0f, 0f, textGlowAlpha)

                // Theme mode button text glow
                modeB.setShadowLayer(6f, 0f, 0f, textGlowAlpha)

                // Handle the logo image
                when (lic.owner.logo) {
                    "none" -> {
                        logoImageView.setImageDrawable(resources.getDrawable(R.drawable.ic_baseline_arrow_circle_right_24, null))
                    }
                    else -> {
                        Glide.with(this)
                            .load(LOGO_BASE_URL + lic.owner.logo)
                            .placeholder(R.drawable.ic_baseline_arrow_circle_right_24) // Optional placeholder while loading
                            .optionalCircleCrop()
                            .into(logoImageView);
                        logoImageView.setBackgroundResource(android.R.color.transparent);
                    }
                }

                // Set up window manager parameters and add the view
                // Use screen width minus margins for proper card width
                // Account for glow wrapper padding (12dp each side)
                val screenWidth = resources.displayMetrics.widthPixels
                val outerMargin = (12 * density).toInt() // small outer margin
                val cardWidth = screenWidth - (outerMargin * 2)

                expandedParams = WindowManager.LayoutParams(
                    cardWidth,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                    PixelFormat.TRANSLUCENT
                )
                expandedParams.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                expandedParams.x = 0 // Centered horizontally
                expandedParams.y = currentY + myView.height // Below the floating icon

                // Attach touch listener for dragging the expanded view
                floatingWindowView.setOnTouchListener(this)

                // Apply theme colors and start orb pulse animation (no rotation on image)
                applyFloatingTheme(floatingWindowView)
                startOrbPulseAnimation(floatingWindowView)

                safeAddView(floatingWindowView, expandedParams)

                isExpanded = true
            } else {
                // Collapse the first overlay and remove the second overlay
                pulseAnim?.cancel()
                safeRemoveView(floatingWindowView)
                isExpanded = false
            }
        }
    }

    private fun storeBotName(botName: String) {
        // To save a value
        val editor = ea_nameSharedPref.edit()
        editor.putString("ea_name", botName) // Use your actual key and value
        editor.apply()
    }

    private fun storeMode(mode: Int) {
        // Get the SharedPreferences editor
        val editor = ea_nameModePref.edit()

        // Save the mode value using the key "mode"
        editor.putInt("mode", mode)

        // Apply the changes asynchronously
        editor.apply()
    }

}


