package com.bellyforex.tradeportea.ui.home

import com.google.android.material.dialog.MaterialAlertDialogBuilder
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.os.Bundle
import android.os.IBinder
import android.view.animation.Animation
import android.view.animation.AnimationUtils
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.EditText
import android.widget.FrameLayout
import android.text.TextUtils.concat
import android.view.View
import android.view.View.GONE
import android.view.View.VISIBLE
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.RelativeLayout
import android.widget.TextView
import android.widget.Toast
import androidx.cardview.widget.CardView
import androidx.core.content.res.ResourcesCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bellyforex.tradeportea.ControlService
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.adapters.RobotsAdapter
import com.bellyforex.tradeportea.network.api.RetrofitInstance
import com.bellyforex.tradeportea.network.module.AuthBody
import com.bellyforex.tradeportea.network.module.Licence
import com.bellyforex.tradeportea.utils.Mt5Json
import com.bellyforex.tradeportea.utils.StrategyClient
import kotlinx.coroutines.launch
import com.bellyforex.tradeportea.ui.HomeActivity
import com.bellyforex.tradeportea.ui.home.addrobot.AddRobotViewModel
import com.bellyforex.tradeportea.ui.home.assets.AssetsViewModel
import com.bellyforex.tradeportea.utils.Constants.Companion.LOGO_BASE_URL
import com.bellyforex.tradeportea.utils.convert
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.bitmap.CenterCrop
import com.bumptech.glide.load.resource.bitmap.RoundedCorners
import com.bellyforex.tradeportea.ui.theme.ThemeEngine
import com.bellyforex.tradeportea.ui.theme.ThemeUtils
import com.bellyforex.tradeportea.ui.theme.WarpGlowDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.Color
import android.graphics.Outline
import android.graphics.PorterDuff
import android.os.Build
import android.view.ViewOutlineProvider
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.animation.OvershootInterpolator
import android.util.TypedValue
import com.google.android.material.card.MaterialCardView
import com.bellyforex.tradeportea.utils.SoundManager


class HomeFragment : Fragment(R.layout.fragment_home) {
    private lateinit var robotsAdapter: RobotsAdapter
    private lateinit var addRobotViewModel : AddRobotViewModel
    private lateinit var assetsViewModel: AssetsViewModel
    private lateinit var homeViewModel: HomeViewModel
    private lateinit var ea_nameSharedPref : SharedPreferences

    private var authenticated = false
    var sLicence: Licence? = null

    //for service
    private var trading = false
    private var mBound : MutableLiveData<Boolean> = MutableLiveData()
    private lateinit var mService: ControlService
    private val mConnection = object  : ServiceConnection{
        override fun onServiceConnected(className: ComponentName?, binder: IBinder?) {
            val service = binder as ControlService.MyBinder
            mService = service.getService()
            mBound.postValue(true)
        }

        override fun onServiceDisconnected(p0: ComponentName?) {
            mBound.postValue(false)
        }

    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecycler(view)

        // Apply hero card shape from settings
        applyHeroCardShape(view)

        addRobotViewModel = (activity as HomeActivity).addRobotViewModel
        assetsViewModel = (activity as HomeActivity).assetsViewModel
        homeViewModel = (activity as HomeActivity).homeViewModel
        // Initialize SharedPreferences
        ea_nameSharedPref = requireActivity().getSharedPreferences("MyPrefs", Context.MODE_PRIVATE)

        // Initialize reactor sound
        SoundManager.init(requireContext())

        val navController = findNavController()

        mBound.observe(viewLifecycleOwner) {
            if (it)
                homeViewModel.getTradingStatus(mService)
        }

        // Setup rotating glow animation for trade button
        val tradeButtonGlow = view.findViewById<FrameLayout>(R.id.tradeButtonGlow)
        val stopButtonGlow = view.findViewById<FrameLayout>(R.id.stopButtonGlow)
        val rotateSlowAnim = AnimationUtils.loadAnimation(context, R.anim.rotate_glow_slow)
        
        // Start slow rotation on trade button glow
        tradeButtonGlow?.startAnimation(rotateSlowAnim)
        stopButtonGlow?.startAnimation(rotateSlowAnim)
        
        // Setup global theme observer
        setupThemeObserver(view, tradeButtonGlow, stopButtonGlow)
        
        homeViewModel.tradingInProgress.observe(viewLifecycleOwner) {
            trading = it
            when (it) {
                true -> {
                    view.findViewById<LinearLayout>(R.id.stopButton).visibility = VISIBLE
                    view.findViewById<LinearLayout>(R.id.startButton).visibility = GONE
                    // Speed up rotation when trading
                    val rotateFastAnim = AnimationUtils.loadAnimation(context, R.anim.rotate_glow_fast)
                    stopButtonGlow?.startAnimation(rotateFastAnim)
                }
                false -> {
                    view.findViewById<LinearLayout>(R.id.stopButton).visibility = GONE
                    if (sLicence?.status != "Expired")
                        view.findViewById<LinearLayout>(R.id.startButton).visibility = VISIBLE
                    // Return to slow rotation
                    tradeButtonGlow?.startAnimation(rotateSlowAnim)
                }
            }
        }


        view.findViewById<FrameLayout>(R.id.scanner_btn).setOnClickListener {
            startActivity(Intent(requireContext(), com.bellyforex.tradeportea.ui.ScannerActivity::class.java))
        }
        view.findViewById<FrameLayout>(R.id.add_bot_btn).setOnClickListener {
            navController.navigate(R.id.action_navigation_home_to_addRobotFragment)
        }
        view.findViewById<LinearLayout>(R.id.startButton).setOnClickListener {
            // Reactor activation: vibrate + sound + scale pulse animation
            vibrateOnTrade()
            SoundManager.playReactorActivate()

            // Scale pulse animation on the trade button glow ring
            tradeButtonGlow?.animate()
                ?.scaleX(1.35f)?.scaleY(1.35f)
                ?.setDuration(200)
                ?.setInterpolator(OvershootInterpolator(2f))
                ?.withEndAction {
                    tradeButtonGlow.animate()
                        .scaleX(1f).scaleY(1f)
                        .setDuration(300)
                        .setInterpolator(OvershootInterpolator(1.5f))
                        .start()
                }?.start()

            // Flash: briefly brighten the glow then return
            tradeButtonGlow?.animate()?.alpha(1f)?.setDuration(100)?.withEndAction {
                tradeButtonGlow.animate().alpha(0.85f).setDuration(150).withEndAction {
                    tradeButtonGlow.animate().alpha(1f).setDuration(200).start()
                }.start()
            }?.start()

            // Quick-config popup -> instant MT5 execution via Api2Trade
            showQuickTradeDialog()
        }
        view.findViewById<LinearLayout>(R.id.stopButton).setOnClickListener {
            stopAndCloseAllTrades()
        }
        view.findViewById<LinearLayout>(R.id.gotoasset).setOnClickListener {
            navController.navigate(R.id.action_navigation_home_to_assetsFragment)
        }
        view.findViewById<LinearLayout>(R.id.delete_ea).setOnClickListener {
            val builder = MaterialAlertDialogBuilder(requireContext(), R.style.iOS26AlertDialog)
            builder.setTitle("Warning")
            builder.setMessage(concat("Are you sure you want to delete ",sLicence?.ea_name," ?. Note that you will no longer be able to use the licence key ~ ",sLicence?.key))
            builder.setPositiveButton("DELETE"){
                    dialog,which->
                if(trading)
                {
                    stopAndCloseAllTrades()
                }
                assetsViewModel.deleteAllSymbol(sLicence!!.phone_secret_key)
                addRobotViewModel.deleteSicence(sLicence!!)
                addRobotViewModel.deleteLicence(sLicence!!)
                dialog.dismiss()
            }
            builder.setNegativeButton("CANCEL"){
                    dialog,which->
                dialog.dismiss()
            }
            builder.setBackground(resources.getDrawable(R.drawable.ios26_glass_dialog_refined, null))
            val alertDialog = builder.create()
            alertDialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
            alertDialog.show()
        }

        view.findViewById<LinearLayout>(R.id.bot_info).setOnClickListener {
            val builder = MaterialAlertDialogBuilder(requireContext(), R.style.iOS26AlertDialog)
            builder.setTitle("Robot Information")
            builder.setMessage(concat(
                "Status : ",sLicence?.status,
                "\nRobot Name : ",sLicence?.ea_name,
                "\nLicence Key : ",sLicence?.key,
                "\nActive Until : ",convert(sLicence?.expires),
                "\nOwner's Name : ",sLicence?.owner?.name,
                "\nOwner's Contacts : ",sLicence?.owner?.phone
            ))
            builder.setPositiveButton("CLOSE"){
                    dialog,which->
                dialog.dismiss()
            }
            builder.setBackground(resources.getDrawable(R.drawable.ios26_glass_dialog_refined, null))
            val alertDialog = builder.create()
            alertDialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
            alertDialog.show()
        }

        addRobotViewModel.getSelectedLicences().observe(viewLifecycleOwner) {
            if (it.isNotEmpty()) {
                val li = it[0]
                val licence = Licence(
                    li.ea_name,
                    li.ea_notification,
                    li.expires,
                    li.key,
                    li.owner,
                    li.phone_secret_key,
                    li.status,
                    li.user
                )
                if (!authenticated) {
                    authenticated = true
                    addRobotViewModel.authenticate(
                        AuthBody(
                            licence!!.key,
                            licence!!.phone_secret_key
                        )
                    )
                }
                sLicence = licence
                showTopView(view, licence)
            } else {
                showTopView(view, null)
            }
        }
        addRobotViewModel.getLicences().observe(viewLifecycleOwner) {
            if (it.isNotEmpty()) {
                view.findViewById<TextView>(R.id.label).visibility = VISIBLE
                robotsAdapter.differ.submitList(it.asReversed())
            } else {
                view.findViewById<TextView>(R.id.label).visibility = GONE
                robotsAdapter.differ.submitList(it)
            }
        }

        robotsAdapter.setOnItemClickListener {

            if(it != sLicence)
            {
                if(trading)
                {
                    stopAndCloseAllTrades()
                }

                addRobotViewModel.authenticate(AuthBody(it.key,it.phone_secret_key))

            }

        }

    }

    // Broker symbols from the connected account, cached for the session so
    // reopening the popup doesn't refetch.
    private var mt5Symbols: List<String>? = null

    private fun mt5Prefs(): SharedPreferences =
        requireContext().applicationContext.getSharedPreferences("mt5", Context.MODE_PRIVATE)

    /**
     * Quick-config popup shown on every TRADE press: symbol (from the
     * connected MT5 account), lot size (default 0.01) and number of trades.
     * CONFIRM executes instantly in a random direction (Buy or Sell).
     */
    private fun showQuickTradeDialog() {
        val uuid = mt5Prefs().getString("uuid", null)
        if (!mt5Prefs().getBoolean("logged", false) || uuid.isNullOrEmpty()) {
            Toast.makeText(context, "Connect your MT5 account on the Metatrader page first.", Toast.LENGTH_LONG).show()
            return
        }

        val dialogView = layoutInflater.inflate(R.layout.dialog_quick_trade, null)
        val symbolField = dialogView.findViewById<AutoCompleteTextView>(R.id.quick_symbol)
        val lotField = dialogView.findViewById<EditText>(R.id.quick_lot)
        val countField = dialogView.findViewById<EditText>(R.id.quick_count)
        val confirmBtn = dialogView.findViewById<android.widget.Button>(R.id.quick_confirm)
        val cancelBtn = dialogView.findViewById<android.widget.Button>(R.id.quick_cancel)

        fun bindSymbols(list: List<String>) {
            symbolField.setAdapter(
                ArrayAdapter(requireContext(), android.R.layout.simple_dropdown_item_1line, list)
            )
            symbolField.threshold = 1
        }
        symbolField.setOnClickListener { symbolField.showDropDown() }

        val cached = mt5Symbols
        if (cached != null) {
            bindSymbols(cached)
        } else {
            viewLifecycleOwner.lifecycleScope.launch {
                try {
                    val response = RetrofitInstance.mt5Api.symbols(uuid)
                    val names = Mt5Json.parseSymbolNames(response.body())
                    if (response.isSuccessful && names.isNotEmpty()) {
                        mt5Symbols = names
                        bindSymbols(names)
                    } else {
                        Toast.makeText(context, "Could not load symbols. Reconnect your MT5 account.", Toast.LENGTH_LONG).show()
                    }
                } catch (e: Exception) {
                    Toast.makeText(context, "Could not load symbols. Check your internet.", Toast.LENGTH_LONG).show()
                }
            }
        }

        val builder = MaterialAlertDialogBuilder(requireContext(), R.style.iOS26AlertDialog)
        builder.setView(dialogView)
        val dialog = builder.create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.show()

        cancelBtn.setOnClickListener { dialog.dismiss() }

        // Validate on CONFIRM without auto-dismissing on bad input
        confirmBtn.setOnClickListener {
            val symbol = symbolField.text.toString().trim()
            val lots = lotField.text.toString().trim().replace(',', '.').toDoubleOrNull()
            val count = countField.text.toString().trim().toIntOrNull()
            val symbols = mt5Symbols
            when {
                symbol.isEmpty() ->
                    Toast.makeText(context, "Pick a symbol.", Toast.LENGTH_SHORT).show()
                symbols != null && !symbols.contains(symbol) ->
                    Toast.makeText(context, "Pick a symbol from your account's list.", Toast.LENGTH_SHORT).show()
                lots == null || lots <= 0 ->
                    Toast.makeText(context, "Enter a valid lot size. Eg: 0.01", Toast.LENGTH_SHORT).show()
                count == null || count < 1 || count > 100 ->
                    Toast.makeText(context, "Number of trades must be between 1 and 100.", Toast.LENGTH_SHORT).show()
                else -> {
                    dialog.dismiss()
                    val comment = (sLicence?.ea_name
                        ?: ea_nameSharedPref.getString("ea_name", null)?.takeIf { it.isNotBlank() }
                        ?: "Robot").take(31)
                    // Server-side strategy engine, NOT the on-device batch loop.
                    // The batch is paused, not deleted — see QuickTradeEngine.
                    homeViewModel.tradingInProgress.postValue(true)
                    viewLifecycleOwner.lifecycleScope.launch {
                        StrategyClient.start(requireContext(), symbol, lots, count, comment)
                            .onSuccess {
                                StrategyClient.toast(requireContext(), "Robot started on $symbol.")
                            }
                            .onFailure {
                                homeViewModel.tradingInProgress.postValue(false)
                                StrategyClient.toast(
                                    requireContext(),
                                    it.message ?: "Could not start. Check your connection."
                                )
                            }
                    }
                }
            }
        }
    }

    /**
     * STOP: halt the recurring loop and close every open position.
     */
    private fun stopAndCloseAllTrades() {
        val uuid = mt5Prefs().getString("uuid", null)
        if (uuid.isNullOrEmpty()) {
            homeViewModel.tradingInProgress.postValue(false)
            Toast.makeText(context, "MT5 account not connected.", Toast.LENGTH_SHORT).show()
            return
        }
        Toast.makeText(context, "Closing all trades...", Toast.LENGTH_SHORT).show()
        homeViewModel.tradingInProgress.postValue(false)
        viewLifecycleOwner.lifecycleScope.launch {
            StrategyClient.stop(requireContext())
                .onSuccess { flat ->
                    // `flat == false` means the server could NOT confirm the
                    // account is empty. Saying "all closed" there would be a
                    // lie the user acts on, so say what actually happened.
                    StrategyClient.toast(
                        requireContext(),
                        if (flat) "Robot stopped. All trades closed."
                        else "Robot stopped, but some trades may still be open — check MetaTrader."
                    )
                }
                .onFailure {
                    StrategyClient.toast(
                        requireContext(),
                        it.message ?: "Could not stop. Check your connection."
                    )
                }
        }
    }

    private fun showTopView(view: View, licence: Licence?)
    {
        if (licence != null) {
            view.findViewById<RelativeLayout>(R.id.selected_bot_header).visibility = View.VISIBLE

            // Set text for the TextViews
            val botNameTextView = view.findViewById<TextView>(R.id.bot_name)
            botNameTextView.text = licence.ea_name
            storeBotName(licence.ea_name)

            val ownerNameTextView = view.findViewById<TextView>(R.id.owner_name)
            ownerNameTextView.text = " ${licence.owner.name}"

            // Apply theme glow to bot name and owner name
            val theme = ThemeEngine.getCurrentTheme()
            applyTextGlow(botNameTextView, theme)
            applyTextGlow(ownerNameTextView, theme)

            // Also apply glow to powered_by text
            val poweredByTextView = view.findViewById<TextView>(R.id.powered_by)
            poweredByTextView?.let { applyTextGlow(it, theme) }

            // Set the custom font for TextViews
            val typeface = ResourcesCompat.getFont(view.context, R.font.starkiller) // Use appropriate context

            // Check if typeface is not null before setting
            if (typeface != null) {
                //botNameTextView.typeface = typeface
                //ownerNameTextView.typeface = typeface
            }



            when (licence.status) {
                "Active" -> {
                    val startButton = view.findViewById(R.id.startButton) as LinearLayout
                    if(!trading)
                        startButton.visibility = View.VISIBLE
                    view.findViewById<TextView>(R.id.note).visibility=GONE
                    view.findViewById<TextView>(R.id.owner_name).visibility = VISIBLE
                }

                "Expired" -> {
                    val startButton = view.findViewById(R.id.startButton) as LinearLayout
                    startButton.visibility = View.GONE
                    view.findViewById<TextView>(R.id.owner_name).visibility = GONE
                    view.findViewById<TextView>(R.id.note).apply{
                        visibility = View.VISIBLE
                        text = concat("! Your Licence key ~ ",
                            licence.key," Have Expired. Please Contact ",licence.owner.name," at ",
                            licence.owner.phone, " for  new Key or re-activation.")
                    }

                }
            }
            val cornerRadiusPx = (24 * resources.displayMetrics.density).toInt()
            when(licence.owner.logo){
                "none" ->{
                    val imageview = view.findViewById(R.id.logo_img) as ImageView
                    Glide.with(view)
                        .load(R.drawable.ic_baseline_arrow_circle_right_24)
                        .transform(CenterCrop(), RoundedCorners(cornerRadiusPx))
                        .into(imageview)
                }
                else ->{
                    Glide.with(view)
                        .load(LOGO_BASE_URL +licence.owner.logo)
                        .transform(CenterCrop(), RoundedCorners(cornerRadiusPx))
                        .into(view.findViewById(R.id.logo_img))
                }
            }

        }else{
            view.findViewById<RelativeLayout>(R.id.selected_bot_header).visibility = GONE
        }
    }
    private fun setupRecycler(view: View){

        val searchResultsRecyclerview= view.findViewById<RecyclerView>(R.id.bots_list_recycler_view)
        robotsAdapter = RobotsAdapter()
        searchResultsRecyclerview.layoutManager =  LinearLayoutManager(context,
            LinearLayoutManager.VERTICAL,false)
        searchResultsRecyclerview.hasFixedSize()
        searchResultsRecyclerview.adapter = robotsAdapter

    }

    /**
     * Switches the hero card between rounded-rectangle (default) and circle shape
     * based on the "robot_image_shape" SharedPreference.
     * Uses TypedValue.applyDimension() to match XML parser dp→px conversion exactly.
     */
    private fun applyHeroCardShape(view: View) {
        val heroCard = view.findViewById<CardView>(R.id.hero_card) ?: return
        val mainCard = view.findViewById<FrameLayout>(R.id.main_card)
        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val isCircle = prefs.getString("robot_image_shape", "square") == "circle"

        if (isCircle) {
            heroCard.post {
                val size = heroCard.width
                if (size > 0) {
                    // Make card square
                    heroCard.layoutParams.height = size
                    heroCard.requestLayout()

                    // Update glow to circle
                    (mainCard?.background as? WarpGlowDrawable)?.updateCornerRadius(size / 2f)

                    // Disable software rendering on parent so CardView clipToOutline works
                    // Glow still works because BlurMaskFilter renders to internal bitmap cache
                    mainCard?.setLayerType(View.LAYER_TYPE_NONE, null)

                    // Wait for layout to finish, then set card radius
                    heroCard.post {
                        heroCard.radius = size / 2f
                    }
                }
            }
        } else {
            val dp340 = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 340f, resources.displayMetrics).toInt()
            val dp24 = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 24f, resources.displayMetrics)

            heroCard.layoutParams.height = dp340
            heroCard.requestLayout()
            heroCard.radius = dp24

            // Restore software rendering + glow
            mainCard?.let { WarpGlowDrawable.prepareView(it) }
            (mainCard?.background as? WarpGlowDrawable)?.updateCornerRadius(dp24)
        }
    }

    override fun onStart() {
        super.onStart()
        Intent((activity as HomeActivity),ControlService::class.java).also {
            (activity as HomeActivity).bindService(it,mConnection,Context.BIND_AUTO_CREATE)
        }
    }

    override fun onResume() {
        super.onResume()
        // Re-apply hero card shape + rebind list when coming back from Settings
        view?.let { applyHeroCardShape(it) }
        if (::robotsAdapter.isInitialized) {
            robotsAdapter.notifyDataSetChanged()
        }
        // Resync TRADE/STOP with the SERVER, not with anything held in this
        // process. The robot keeps running while the app is closed, so the
        // backend is the only thing that knows whether it is trading —
        // in-memory state would show STOP after every app restart.
        if (::homeViewModel.isInitialized) {
            lifecycleScope.launch {
                val status = StrategyClient.status(requireContext())
                if (status != null) homeViewModel.tradingInProgress.postValue(status.running)
            }
        }
    }

    private fun storeBotName(botName: String) {
        // To save a value
        val editor = ea_nameSharedPref.edit()
        editor.putString("ea_name", botName) // Use your actual key and value
        editor.apply()
    }
    
    private fun setupThemeObserver(view: View, tradeButtonGlow: FrameLayout?, stopButtonGlow: FrameLayout?) {
        // Get references to themed elements
        val rootLayout = view as? RelativeLayout
        
        // Get card views - glow applied directly to backgrounds
        val mainCard = view.findViewById<FrameLayout>(R.id.main_card)
        val controlPanel = view.findViewById<FrameLayout>(R.id.controls)
        val addEaButton = view.findViewById<FrameLayout>(R.id.add_bot_btn)
        val scannerButton = view.findViewById<FrameLayout>(R.id.scanner_btn)

        // REQUIRED: Prepare views for software rendering (BlurMaskFilter needs this)
        mainCard?.let { WarpGlowDrawable.prepareView(it) }
        controlPanel?.let { WarpGlowDrawable.prepareView(it) }
        addEaButton?.let { WarpGlowDrawable.prepareView(it) }
        scannerButton?.let { WarpGlowDrawable.prepareView(it) }

        // Apply initial theme (first time - create drawables)
        val initialTheme = ThemeEngine.getCurrentTheme()
        applyThemeInitial(initialTheme, rootLayout, tradeButtonGlow, stopButtonGlow, mainCard, controlPanel, addEaButton, scannerButton)

        // Apply initial text glow to powered_by
        view.findViewById<TextView>(R.id.powered_by)?.let { applyTextGlow(it, initialTheme) }
        
        // Get text views that need glow
        val botNameText = view.findViewById<TextView>(R.id.bot_name)
        val ownerNameText = view.findViewById<TextView>(R.id.owner_name)
        val poweredByText = view.findViewById<TextView>(R.id.powered_by)

        // Observe theme changes via LiveData - use animated transitions
        ThemeEngine.themeLiveData.observe(viewLifecycleOwner) { theme ->
            applyThemeAnimated(theme, rootLayout, tradeButtonGlow, stopButtonGlow, mainCard, controlPanel, addEaButton, scannerButton)

            // Update text glow colors
            botNameText?.let { applyTextGlow(it, theme) }
            ownerNameText?.let { applyTextGlow(it, theme) }
            poweredByText?.let { applyTextGlow(it, theme) }

            // Refresh robot list cards so they update glow color
            robotsAdapter.notifyDataSetChanged()
        }

        // Observe video background state to toggle transparency
        (activity as? HomeActivity)?.videoBackgroundLiveData?.observe(viewLifecycleOwner) { videoEnabled ->
            if (videoEnabled) {
                rootLayout?.setBackgroundColor(Color.TRANSPARENT)
            } else {
                val theme = ThemeEngine.getCurrentTheme()
                rootLayout?.background = GradientDrawable(
                    GradientDrawable.Orientation.TOP_BOTTOM,
                    intArrayOf(0xFF0A0A0A.toInt(), theme.atmosphereColor, 0xFF0A0A0A.toInt())
                )
            }
        }
    }
    
    /**
     * Apply theme for the first time - creates all drawables without animation
     */
    private fun applyThemeInitial(
        theme: ThemeEngine.Theme,
        rootLayout: RelativeLayout?,
        tradeButtonGlow: FrameLayout?,
        stopButtonGlow: FrameLayout?,
        mainCard: FrameLayout?,
        controlPanel: FrameLayout?,
        addEaButton: FrameLayout?,
        scannerButton: FrameLayout? = null
    ) {
        val density = resources.displayMetrics.density

        // Set background atmosphere (transparent if video background is on)
        val videoEnabled = (activity as? HomeActivity)?.videoBackgroundLiveData?.value == true
        if (videoEnabled) {
            rootLayout?.setBackgroundColor(Color.TRANSPARENT)
        } else {
            rootLayout?.background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xFF0A0A0A.toInt(), theme.atmosphereColor, 0xFF0A0A0A.toInt())
            )
        }

        // Set trade button glows
        applyTradeButtonGlow(tradeButtonGlow, theme, false)
        applyTradeButtonGlow(stopButtonGlow, theme, true)
        
        val pad12 = 12f * density  // matches android:padding="12dp" on wrapper FrameLayouts

        // Apply neon glow to main card (wraps entire card)
        mainCard?.let { card ->
            card.background = WarpGlowDrawable(
                glowColor = theme.glowColor,
                cornerRadiusPx = 24f * density,
                intensity = WarpGlowDrawable.GlowIntensity.INTENSE,
                paddingPx = pad12
            )
        }

        // Apply neon glow to trading control panel
        controlPanel?.let { card ->
            card.background = WarpGlowDrawable(
                glowColor = theme.glowColor,
                cornerRadiusPx = 20f * density,
                intensity = WarpGlowDrawable.GlowIntensity.MEDIUM,
                paddingPx = pad12
            )
        }

        // Apply neon glow to ADD NEW EA button
        addEaButton?.let { card ->
            card.background = WarpGlowDrawable(
                glowColor = theme.glowColor,
                cornerRadiusPx = 20f * density,
                intensity = WarpGlowDrawable.GlowIntensity.SUBTLE,
                paddingPx = pad12
            )
        }

        // Apply neon glow to scanner button
        scannerButton?.let { card ->
            card.background = WarpGlowDrawable(
                glowColor = theme.glowColor,
                cornerRadiusPx = 20f * density,
                intensity = WarpGlowDrawable.GlowIntensity.SUBTLE,
                paddingPx = pad12
            )
        }
    }
    
    /**
     * Apply theme with smooth animated color transitions (no flash)
     */
    private fun applyThemeAnimated(
        theme: ThemeEngine.Theme,
        rootLayout: RelativeLayout?,
        tradeButtonGlow: FrameLayout?,
        stopButtonGlow: FrameLayout?,
        mainCard: FrameLayout?,
        controlPanel: FrameLayout?,
        addEaButton: FrameLayout?,
        scannerButton: FrameLayout? = null
    ) {
        val density = resources.displayMetrics.density
        
        // Animate background atmosphere with crossfade (skip if video background is on)
        val videoEnabled = (activity as? HomeActivity)?.videoBackgroundLiveData?.value == true
        rootLayout?.let { root ->
            if (videoEnabled) {
                root.setBackgroundColor(Color.TRANSPARENT)
            } else {
                val newDrawable = GradientDrawable(
                    GradientDrawable.Orientation.TOP_BOTTOM,
                    intArrayOf(0xFF0A0A0A.toInt(), theme.atmosphereColor, 0xFF0A0A0A.toInt())
                )
                root.animate()
                    .alpha(0.95f)
                    .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
                    .withEndAction {
                        root.background = newDrawable
                        root.animate().alpha(1f).setDuration(ThemeEngine.TRANSITION_DURATION / 2).start()
                    }
                    .start()
            }
        }
        
        // Animate trade button glows
        applyTradeButtonGlow(tradeButtonGlow, theme, false)
        applyTradeButtonGlow(stopButtonGlow, theme, true)
        
        // Animate glow color transitions on cards
        animateCardGlowColors(mainCard, theme, 24f, WarpGlowDrawable.GlowIntensity.INTENSE)
        animateCardGlowColors(controlPanel, theme, 20f, WarpGlowDrawable.GlowIntensity.MEDIUM)
        animateCardGlowColors(addEaButton, theme, 20f, WarpGlowDrawable.GlowIntensity.SUBTLE)
        animateCardGlowColors(scannerButton, theme, 20f, WarpGlowDrawable.GlowIntensity.SUBTLE)
    }
    
    /**
     * Animate card glow colors with smooth crossfade transition.
     * Updates the existing WarpGlowDrawable colors instead of recreating.
     */
    private fun animateCardGlowColors(
        cardView: FrameLayout?,
        theme: ThemeEngine.Theme,
        cornerRadiusDp: Float,
        intensity: WarpGlowDrawable.GlowIntensity,
        paddingDp: Float = 12f
    ) {
        cardView ?: return
        val existingDrawable = cardView.background as? WarpGlowDrawable

        if (existingDrawable != null) {
            // Smooth crossfade: animate alpha while updating colors
            cardView.animate()
                .alpha(0.85f)
                .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
                .withEndAction {
                    existingDrawable.updateColors(theme.glowColor, theme.glowColor)
                    cardView.animate()
                        .alpha(1f)
                        .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
                        .start()
                }
                .start()
        } else {
            // Drawable doesn't exist yet - create it
            val density = resources.displayMetrics.density
            cardView.background = WarpGlowDrawable(
                glowColor = theme.glowColor,
                cornerRadiusPx = cornerRadiusDp * density,
                intensity = intensity,
                paddingPx = paddingDp * density
            )
        }
    }
    
    private fun applyTradeButtonGlow(glowFrame: FrameLayout?, theme: ThemeEngine.Theme, isActive: Boolean) {
        glowFrame ?: return
        
        val density = resources.displayMetrics.density
        val glowAlpha = if (isActive) 0x60 else 0x40
        val glowRadius = if (isActive) 34f else 30f
        
        // Create themed glow drawable
        val glowDrawable = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            gradientType = GradientDrawable.RADIAL_GRADIENT
            gradientRadius = glowRadius * density
            colors = intArrayOf(
                android.graphics.Color.argb(glowAlpha, 
                    android.graphics.Color.red(theme.glowColor),
                    android.graphics.Color.green(theme.glowColor),
                    android.graphics.Color.blue(theme.glowColor)),
                0x00000000
            )
        }
        
        // Create button base drawable
        val buttonBase = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0xE6181818.toInt())
        }
        
        // Create internal lighting
        val innerLight = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(0x20FFFFFF, 0x00000000)
        ).apply {
            shape = GradientDrawable.OVAL
        }
        
        // Combine into layer drawable
        val layerDrawable = android.graphics.drawable.LayerDrawable(arrayOf(
            glowDrawable,
            buttonBase,
            innerLight
        ))
        
        // Set insets for button base and inner light
        val inset4dp = (4 * density).toInt()
        val inset5dp = (5 * density).toInt()
        layerDrawable.setLayerInset(1, inset4dp, inset4dp, inset4dp, inset4dp)
        layerDrawable.setLayerInset(2, inset5dp, inset5dp, inset5dp, inset5dp)
        
        // Smooth transition
        glowFrame.animate()
            .alpha(0.9f)
            .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
            .withEndAction {
                glowFrame.background = layerDrawable
                glowFrame.animate()
                    .alpha(1f)
                    .setDuration(ThemeEngine.TRANSITION_DURATION / 2)
                    .start()
            }
            .start()
    }

    /**
     * Apply neon text glow shadow matching the current theme color.
     */
    private fun applyTextGlow(textView: TextView, theme: ThemeEngine.Theme) {
        val glowColor = Color.argb(
            200,
            Color.red(theme.glowColor),
            Color.green(theme.glowColor),
            Color.blue(theme.glowColor)
        )
        textView.setShadowLayer(12f, 0f, 0f, glowColor)
    }

    private fun vibrateOnTrade() {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = requireContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            requireContext().getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // 5-second vibration pattern: strong pulses spread over 5 seconds
            // Pattern: wait, vibrate, wait, vibrate, wait, vibrate...
            val pattern = longArrayOf(0, 400, 600, 400, 600, 400, 600, 400, 600, 400)
            val amplitudes = intArrayOf(0, 180, 0, 220, 0, 180, 0, 255, 0, 200)
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, amplitudes, -1))
        } else {
            @Suppress("DEPRECATION")
            val pattern = longArrayOf(0, 400, 600, 400, 600, 400, 600, 400, 600, 400)
            vibrator.vibrate(pattern, -1)
        }
    }
}