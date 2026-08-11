package com.bellyforex.tradeportea.ui

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.os.CountDownTimer
import android.os.Handler
import android.os.Process
import android.text.TextUtils
import android.util.Log
import android.webkit.CookieManager
import android.webkit.CookieSyncManager
import android.webkit.ValueCallback
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.NestedScrollView
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.Observer
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.network.db.LicenceDB
import com.bellyforex.tradeportea.network.module.Signal
import com.bellyforex.tradeportea.network.module.log
import com.bellyforex.tradeportea.repository.RTRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import com.bellyforex.tradeportea.utils.TTSManager
import com.bellyforex.tradeportea.utils.TrailingManager


class TradeActivity : AppCompatActivity() {
    private var loading = false
    private var showAllSymbols = false
    private var chooseSymbol = false
    private var pressExecuteTrade = false
    private var checkEmsg = false
    private var chechDisc = true
    private var loggedIn = false
    private var trade = true
    private var chatLoading = true
    private var symbolCount = 0
    var job: Job? = null
    var job2: Job? = null
    lateinit var timer1: CountDownTimer
    private val rtRepository = RTRepository(LicenceDB(this))
    private lateinit var savedSignalData: LiveData<List<Signal>>
    private lateinit var savedLogData: LiveData<List<log>>
    private var mySig : MutableLiveData<Signal?> = MutableLiveData()
    private var obData = true
    private lateinit var mt4SharedPref : SharedPreferences
    private lateinit var mt5SharedPref : SharedPreferences
    private lateinit var ea_nameSharedPref: SharedPreferences
    private lateinit var ea_nameModePref : SharedPreferences
    private var lastTradeTime: Long = 0
    private val tradeCooldownMs: Long = 120000 // 2 minutes in milliseconds


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_trade)
        savedSignalData = rtRepository.getDBSignals()
        savedSignalData.observeForever(savedSignalObserver)
        savedLogData = rtRepository.getDBLogs()
        savedLogData.observeForever(savedLogObserver)
        ea_nameSharedPref = getSharedPreferences("MyPrefs", Context.MODE_PRIVATE)
        // Initialize SharedPreferences





        var maxto = 0


        mt4SharedPref  = getSharedPreferences("mt4", MODE_PRIVATE)
        mt5SharedPref  = getSharedPreferences("mt5", MODE_PRIVATE)

        CookieSyncManager.createInstance(applicationContext)
        val cookieManager: CookieManager = CookieManager.getInstance()
        cookieManager.removeAllCookies(null)

        obData = false
        var timeleft = 100
        timer1 = object : CountDownTimer(100000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                timeleft -= 1
                if (maxto <= 100) {
                    //Toast.makeText(this@TradeActivity,timeleft.toString(),Toast.LENGTH_SHORT).show()
                }
                maxto += 1

            }

            override fun onFinish() {

                addLogMessage(0,"Time's Up. There was an unknown error preventing trade to take place. Please Check your network connection.")
                addLogMessage(1,findViewById<TextView>(R.id.log_message).text.toString())
                job?.cancel()
                job2?.cancel()
                val intent = Intent(this@TradeActivity, FinishActivity::class.java)
                startActivity(intent)
                finish()
            }
        }.start()


        val webView = findViewById<WebView>(R.id.webView)
        
        // WebView Configuration - EXACTLY MATCHING MT5 AUTH SETUP
        webView.requestFocus()
        webView.settings.javaScriptEnabled = true
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = true
        webView.settings.setRenderPriority(WebSettings.RenderPriority.HIGH)

        webView.settings.cacheMode = WebSettings.LOAD_CACHE_ELSE_NETWORK
        webView.settings.domStorageEnabled = true
        webView.settings.layoutAlgorithm = WebSettings.LayoutAlgorithm.NARROW_COLUMNS
        webView.settings.useWideViewPort = true
        webView.settings.saveFormData = true
        webView.isFocusableInTouchMode = false
        webView.isFocusable = false
        webView.settings.builtInZoomControls = true
        webView.settings.displayZoomControls = false
        webView.settings.userAgentString =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        val signal = intent.getBundleExtra("signal")?.getSerializable("signal") as Signal
        
        // DEBUG: Log signal SL/TP values
        Log.d("TradeActivity", "═══ SIGNAL SL/TP DEBUG ═══")
        Log.d("TradeActivity", "Signal SL: '${signal.sl}'")
        Log.d("TradeActivity", "Signal TP: '${signal.tp}'")
        Log.d("TradeActivity", "Signal Asset: '${signal.asset}'")
        Log.d("TradeActivity", "Signal Action: '${signal.action}'")

        // Read number-of-trades from app prefs first (set via Allowed Symbols UI). Fallback to platform suffix, else 1
        val tradingPrefs = getSharedPreferences("TradingPrefs", Context.MODE_PRIVATE)
        val prefNumTrades = tradingPrefs.getInt("numTrades", -1)

        val (platform, parsedNumTrades) = signal.platform.toString().trim().split(":").let {
            it[0] to (it.getOrNull(1)?.toIntOrNull() ?: -1)
        }
        val numberOfTrades = when {
            prefNumTrades > 0 -> prefNumTrades
            parsedNumTrades > 0 -> parsedNumTrades
            else -> 1
        }
        
        Log.d("TradeActivity", "Signal platform: ${signal.platform}, parsed platform=$platform, numTrades(pref=$prefNumTrades, parsed=$parsedNumTrades) -> using $numberOfTrades")
        
        if (numberOfTrades <= 0) {
            Toast.makeText(this, "⚠ Invalid number of trades: $numberOfTrades. Signal platform should be 'MT5:1' format.", Toast.LENGTH_LONG).show()
            Log.e("TradeActivity", "Invalid numberOfTrades: $numberOfTrades from platform: ${signal.platform}")
        }


        when (platform) {
            "MT5" -> {
                val login = mt5SharedPref.getString("login", null)
                val password = mt5SharedPref.getString("password", null)
                val server = mt5SharedPref.getString("server", null)
                val bname =  ea_nameSharedPref.getString("ea_name", "Default Value")

                if (login !=null && password != null && server !=null)
                {
                    webView.isFocusableInTouchMode = true
                    webView.isFocusable = true
                    tradeMT5(webView, login, password, server, signal.asset, signal.tp, signal.sl, signal.lotSize.toString(), signal.action,bname,numberOfTrades)

                }else{
                    addLogMessage(0,"Opps it seems like you did not add your MT5 Login details. Please press metatrader and add them.")
                    addLogMessage(1,"Opps it seems like you did not add your MT4 Login details. Please press metatrader and add them.")

                    val intent = Intent(this@TradeActivity, FinishActivity::class.java)
                    startActivity(intent)
                    finish()
                }
            }
            "MT4" -> {
                val login = mt4SharedPref.getString("login", null)
                val password = mt4SharedPref.getString("password", null)
                val server = mt4SharedPref.getString("server", null)
                val bname =  ea_nameSharedPref.getString("ea_name", "Default Value");

                if (login !=null && password != null && server !=null)
                {
                    webView.isFocusableInTouchMode = false;
                    webView.isFocusable = false;
                    val servertrim = server.trim()
                    val logintrim = login.trim()
                    val passwordtrim = password.trim()
                    tradeMT4(webView, logintrim, passwordtrim, servertrim, signal.asset, signal.tp, signal.sl, signal.lotSize.toString(), signal.action,bname,numberOfTrades)
                }else{
                    addLogMessage(0,"Opps it seems like you did not add your MT4 Login details. Please press metatrader and add them.")
                    addLogMessage(1,"Opps it seems like you did not add your MT4 Login details. Please press metatrader and add them.")

                    val intent = Intent(this@TradeActivity, FinishActivity::class.java)
                    startActivity(intent)
                    finish()
                }
            }
            else -> {
                job?.cancel()
                job2?.cancel()
                finish()
            }
        }

        job = MainScope().launch {
            while (true) {
                loading = false
                delay(3000)
            }
        }

        findViewById<Button>(R.id.force_stop).setOnClickListener {
            val id = Process.myPid()
            Process.killProcess(id)
        }



    }

    private fun addLogMessage(id: Int, msg: String) {
        try {
            if (!isFinishing && !isDestroyed) {
                MainScope().launch {
                    try {
                        // Assuming 'log_message' is the TextView where logs are displayed
                        val logTextView = findViewById<TextView>(R.id.log_message)
                        logTextView?.text = ""  // Clear previous content
                        logTextView?.text = msg // Set new content

                        // Assuming rtRepository is responsible for handling logs
                        rtRepository.upsetLog(log(id, msg))
                    } catch (e: Exception) {
                        Log.e("TradeActivity", "Error adding log message: ${e.message}")
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("TradeActivity", "Error in addLogMessage: ${e.message}")
        }
    }
    
    override fun onDestroy() {
        try {
            Log.d("TradeActivity", "onDestroy called - cleaning up resources")
            
            // Cancel all jobs safely
            try {
                job?.cancel()
            } catch (e: Exception) {
                Log.e("TradeActivity", "Error cancelling job in onDestroy: ${e.message}")
            }
            
            try {
                job2?.cancel()
            } catch (e: Exception) {
                Log.e("TradeActivity", "Error cancelling job2 in onDestroy: ${e.message}")
            }
            
            try {
                timer1.cancel()
            } catch (e: Exception) {
                Log.e("TradeActivity", "Error cancelling timer in onDestroy: ${e.message}")
            }
            
            super.onDestroy()
        } catch (e: Exception) {
            Log.e("TradeActivity", "Error in onDestroy: ${e.message}")
            try {
                super.onDestroy()
            } catch (e2: Exception) {
                Log.e("TradeActivity", "Error calling super.onDestroy: ${e2.message}")
            }
        }
    }
    
    override fun onPause() {
        try {
            Log.d("TradeActivity", "onPause called")
            super.onPause()
        } catch (e: Exception) {
            Log.e("TradeActivity", "Error in onPause: ${e.message}")
        }
    }

    private val savedLogObserver = Observer<List<log>>{
        if (it.isNotEmpty() && it != null)
        {
            val prevtxt = findViewById<TextView>(R.id.log_message).text.toString()
            val newtxt = TextUtils.concat(prevtxt, "\n", it[0].message).toString()
            findViewById<TextView>(R.id.log_message).text = newtxt

            val sv = findViewById<NestedScrollView>(R.id.sv)
            sv.scrollTo(0, sv.bottom)

        }else
        {
            findViewById<TextView>(R.id.log_message).text = ""
        }
    }

    private val savedSignalObserver = Observer<List<Signal>>{
        if (it.isNotEmpty() && it != null)
        {
            if(!it[0].used)
            {
                mySig.postValue(it[0])
            }else
            {
                mySig.postValue(null)
            }
        }
    }

    // Define a data class to hold trade details
    data class TradeDetails(
        val lot: String,
        val tp: String?,
        val sl: String?,
        val symbol: String,
        val action: String
    )

    private fun tradeMT5(
        webView: WebView,
        id: String,
        password: String,
        server: String,
        asset: String,
        tp: String?,
        sl: String?,
        volume: String,
        action: String,
        botname: String?,
        numberOfTrades: Int?
    ){
        ea_nameModePref = getSharedPreferences("EANameModePrefs", MODE_PRIVATE)

        // Retrieve the mode value (with a default value of 1 if it doesn't exist)
        val mode = ea_nameModePref.getInt("mode", 1)  // Default to 1 (Normal mode)

        addLogMessage(0, "Setting up MT5...")
        
        // DEBUG: Log SL/TP in tradeMT5
        Log.d("TradeActivity", "tradeMT5 called with - TP: '$tp', SL: '$sl', Volume: '$volume'")
        addLogMessage(0, "SL: ${sl ?: "none"} | TP: ${tp ?: "none"}")

        // Normalize the trade action once for the entire flow
        val actionNormalized = action.trim().lowercase()
        val isBuySignal = actionNormalized.startsWith("buy")

        val numberOfOrders = numberOfTrades ?: 1


        var js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
        var jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
        var jsPressRemove = """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
""";
        var jsSelect =  """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""

        var jsOpenSearchBar = """
    javascript: 
    (function() {
        // First, try to open the search bar/symbol selector
        var searchIcon = document.querySelector('.search-icon, .icon-search, [class*="search"], .symbol-search-button, .search-button');
        if (searchIcon !== null) {
            searchIcon.click();
            return true;
        }
        return false;
    })();
"""
        var jsSearch = """
    javascript: 
    (function() {
        var input = document.querySelector('input[placeholder="Search symbol"]');
        if (input != null) {
            input.focus();
            input.value = '';
            input.value = '$asset';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    })();
"""
// Create an instance of TradeDetails and store the values
        val tradeDetails = TradeDetails(
            lot = volume,
            tp = tp,
            sl = sl,
            symbol = asset,
            action = action
        )

        // Safe SL/TP values - handle null and empty
        val safeSL = if (sl.isNullOrEmpty() || sl == "null") "" else sl
        val safeTP = if (tp.isNullOrEmpty() || tp == "null") "" else tp
        
        Log.d("TradeActivity", "safeSL='$safeSL', safeTP='$safeTP'")
        
        var jsOrderInfo = """
javascript: 
(function() {
    console.log('=== Setting order params ===');
    console.log('SL value to set: $safeSL');
    console.log('TP value to set: $safeTP');
    console.log('Volume to set: ${tradeDetails.lot}');
    
    // Set volume
    var volumeInput = document.querySelector('.trade-input input[type="text"]');
    if (volumeInput) {
        volumeInput.focus();
        volumeInput.value = '${tradeDetails.lot}';
        volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
        volumeInput.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('Volume set');
    }

    // Set SL
    var slVal = '$safeSL';
    if (slVal && slVal !== '' && slVal !== 'null' && slVal !== '0') {
        console.log('Attempting to set SL: ' + slVal);
        // Try multiple checkbox selectors
        var slChecks = document.querySelectorAll('.sl input[type="checkbox"], input.sl-checkbox, .stop-loss input[type="checkbox"]');
        slChecks.forEach(function(cb) { if (!cb.checked) cb.click(); });
        
        // Try multiple input selectors
        var slInputs = document.querySelectorAll('.sl input[type="text"], .sl input:not([type="checkbox"]), input[name="sl"], .stop-loss input[type="text"]');
        slInputs.forEach(function(inp) {
            inp.focus();
            inp.value = slVal;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('SL input found and set');
        });
    }

    // Set TP
    var tpVal = '$safeTP';
    if (tpVal && tpVal !== '' && tpVal !== 'null' && tpVal !== '0') {
        console.log('Attempting to set TP: ' + tpVal);
        // Try multiple checkbox selectors
        var tpChecks = document.querySelectorAll('.tp input[type="checkbox"], input.tp-checkbox, .take-profit input[type="checkbox"]');
        tpChecks.forEach(function(cb) { if (!cb.checked) cb.click(); });
        
        // Try multiple input selectors
        var tpInputs = document.querySelectorAll('.tp input[type="text"], .tp input:not([type="checkbox"]), input[name="tp"], .take-profit input[type="text"]');
        tpInputs.forEach(function(inp) {
            inp.focus();
            inp.value = tpVal;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('TP input found and set');
        });
    }

    // Comment
    var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
    if (commentInput) {
        commentInput.value = '$botname';
        commentInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    return true;
})();
"""

        // Prevent the order dialog from being closed by user actions (Esc/close buttons)
        val jsLockDialog = """
javascript:
(function(){
  var dlg = document.querySelector('.order-dialog, .trade-window, [class*="order"], [class*="trade-dialog"]');
  if(!dlg){ return false; }
  var closeBtns = dlg.querySelectorAll('button.close, .close, [class*="close"], .icon-close');
  closeBtns.forEach(function(btn){
    btn.addEventListener('click', function(e){ e.stopImmediatePropagation(); e.preventDefault(); }, true);
    try { btn.disabled = true; } catch(e){}
  });
  window.addEventListener('keydown', function(e){ if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); }}, true);
  return true;
})();
"""

// Access individual properties of tradeDetails using dot notation
        // Add connection timeout handling
        webView.settings.apply {
            // Set reasonable timeouts
            setSupportMultipleWindows(false)
        }
        
        // Log the connection attempt
        Log.d("TradeActivity", "═══ Initiating WebView Connection ═══")
        Log.d("TradeActivity", "Server: $server")
        Log.d("TradeActivity", "Account: $id")
        addLogMessage(0, "Connecting to $server...")
        
        when (server.lowercase())
        {
            "razormarkets-live" ->
            {
                try {
                    Log.d("TradeActivity", "Loading URL: https://webtrader.razormarkets.co.za/terminal")
                    webView.loadUrl("https://webtrader.razormarkets.co.za/terminal")
                    addLogMessage(0, "Loading RazorMarkets terminal...")
                } catch (e: Exception) {
                    Log.e("TradeActivity", "Failed to load URL: ${e.message}")
                    addLogMessage(0, "Failed to connect. Retrying...")
                    // Retry after delay
                    MainScope().launch {
                        delay(3000)
                        try {
                            webView.loadUrl("https://webtrader.razormarkets.co.za/terminal")
                        } catch (e2: Exception) {
                            Log.e("TradeActivity", "Retry failed: ${e2.message}")
                            addLogMessage(0, "Connection failed. Check internet.")
                        }
                    }
                }
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""

                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}

if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""

                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }

            "rocketx-live" ->
            {
                webView.loadUrl("https://webtrader.rocketx.io:1950/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "spacemarkets-live" ->
            {
                webView.loadUrl("https://webtrader.spacemarkets.io:1960/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }

            "rcgmarkets-demo" ->
            {
                webView.loadUrl("https://webtrader-demo.rcgmarkets.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "rcgmarkets-live" ->
            {
                webView.loadUrl("https://webtrader.rcgmarkets.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }

            "deriv-demo" ->
            {
                webView.loadUrl("https://mt5-demo-web.deriv.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "derivsvg-server" ->
            {
                webView.loadUrl("https://mt5-real01-web-svg.deriv.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "derivsvg-server-02" ->
            {
                webView.loadUrl("https://mt5-real02-web-svg.deriv.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "derivsvg-server-03" ->
            {
                webView.loadUrl("https://mt5-real03-web-svg.deriv.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "derivbvi-server" ->
            {
                webView.loadUrl("https://mt5-real01-web-bvi.deriv.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "derivbvi-server-02" ->
            {
                webView.loadUrl("https://mt5-real02-web-bvi.deriv.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "derivbvi-server-03" ->
            {
                webView.loadUrl("https://mt5-real03-web-bvi.deriv.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus();
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "derivbvi-server-vu" ->
            {
                webView.loadUrl("https://mt5-real01-web-vu.deriv.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus;
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "derivbvi-server-vu-02" ->
            {
                webView.loadUrl("https://mt5-real02-web-vu.deriv.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus;
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp

 input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            "derivbvi-server-vu-03" ->
            {
                webView.loadUrl("https://mt5-real03-web-vu.deriv.com/terminal")
                js ="""
    javascript: 
    var x = document.querySelector('input[name="login"]');
    if (x != null) {
        x.value = '$id';
        x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var y = document.querySelector('input[name="password"]');
    if (y != null) {
        y.value = '$password';
        y.dispatchEvent(new Event('input', { bubbles: true }));
    }
"""
                jsPress = "javascript: var button = document.querySelector('.button.svelte-1wrky82.active'); if(button !== null) { button.click(); true; } else { false; }";
                jsPressRemove =  """
    javascript: 
    var button = document.querySelector('.button.svelte-1wrky82.red'); 
    if (button !== null) { 
        button.click(); 
        true; 
    } else {
        var buttons = document.getElementsByTagName("button");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() == "Remove") {
                buttons[i].click();
                break; // Click the first "Remove" button and break
            }
        }
        false; // Indicate that the first method failed
    }
"""
                jsSearch = """
    javascript: 
    var x = document.querySelector('input[placeholder="Search symbol"]');
    if (x != null) {
        x.value = '$asset';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.focus;
    }
"""
                jsOrderInfo = """
javascript: 
// Find the volume input element
var volumeInput = document.querySelector('.trade-input input[type="text"]');
if (volumeInput !== null) {
    volumeInput.value = 0.00;
    volumeInput.value = ${tradeDetails.lot}||$volume;
    volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the stop loss input element
var stopLossInput = document.querySelector('.sl input[type="text"]');
if (stopLossInput !== null) {
    stopLossInput.value = ${tradeDetails.sl}||$sl;
    stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the take profit input element
var takeProfitInput = document.querySelector('.tp input[type="text"]');
if (takeProfitInput !== null) {
    takeProfitInput.value = ${tradeDetails.tp}||$tp;
    takeProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Find the comment input element
var commentInput = document.querySelector('.input.svelte-mtorg2 input[type="text"]');
if (commentInput !== null) {
    commentInput.value = '$botname';
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
}
if(takeProfitInput.value == null || stopLossInput == null || volumeInput.value == null || commentInput.value == null)
{
     false;
}
else
{
     true;
}
"""
                jsSelect = """
    javascript: 
    var symbolSpan = document.querySelector('.name.svelte-19bwscl .symbol.svelte-19bwscl');
    if (symbolSpan !== null) {
        var text = symbolSpan.innerText.trim();
        if (text === '$asset' || text === '$asset.mic') {
            symbolSpan.click();
            true;
        } else {
            false;
        }
    } else {
        false;
    }
"""
            }
            else -> webView.loadUrl("https://webtrader.razormarkets.co.za/terminal")
        }






        val jsOrder = """
    javascript: 
    // Find the element with the specific class and text
    var element = document.querySelector('.icon-button.withText span.button-text');

    // If the element exists
    if (element !== null) {
        // Scroll the element into view
        element.scrollIntoView();

        // Click on the element
        element.click();
        true; // Return true if the element was found and clicked
    } else {
        false; // Return false if the element was not found
    }
"""


        val jsBuy = """
    javascript: 
    (function(){
      function visible(el){
        if(!el) return false;
        var r = el.getBoundingClientRect();
        return r.width>0 && r.height>0 && window.getComputedStyle(el).display!=='none';
      }
      var candidates = [];
      candidates = candidates.concat(Array.from(document.querySelectorAll('.footer-row button')));
      candidates = candidates.concat(Array.from(document.querySelectorAll('button')));
      var btn = candidates.find(function(b){
        var t = (b.innerText||'').toLowerCase();
        return visible(b) && !b.disabled && (t.includes('buy') && !t.includes('sell'));
      });
      if(btn){ try{ btn.scrollIntoView({block:'center'});}catch(e){} btn.click(); return true; }
      return false;
    })();
"""

        val jsSell = """
    javascript: 
    (function(){
      function visible(el){
        if(!el) return false;
        var r = el.getBoundingClientRect();
        return r.width>0 && r.height>0 && window.getComputedStyle(el).display!=='none';
      }
      var candidates = [];
      candidates = candidates.concat(Array.from(document.querySelectorAll('.footer-row button')));
      candidates = candidates.concat(Array.from(document.querySelectorAll('button')));
      var btn = candidates.find(function(b){
        var t = (b.innerText||'').toLowerCase();
        return visible(b) && !b.disabled && (t.includes('sell'));
      });
      if(btn){ try{ btn.scrollIntoView({block:'center'});}catch(e){} btn.click(); return true; }
      return false;
    })();
"""
        val jsDone = """
    javascript: 
    (function(){
      function visible(el){
        if(!el) return false;
        var r = el.getBoundingClientRect();
        return r.width>0 && r.height>0 && window.getComputedStyle(el).display!=='none';
      }
      var candidates = Array.from(document.querySelectorAll('button, .trade-button, .button'));
      var ok = candidates.find(function(b){
        var t = (b.innerText||'').trim().toLowerCase();
        return visible(b) && !b.disabled && (t==='ok' || t.includes('ok'));
      });
      if(ok){ ok.click(); return true; }
      return false;
    })();
"""

        // Add this new JavaScript constant at the top of tradeMT5 function, after other JS vars
        var jsCheckTradePanel = """
            javascript:
            (function() {
                var tradePanel = document.querySelector('.trade-panel, .order-window, [class*="trade"], [class*="order"]');
                return tradePanel !== null && tradePanel.offsetHeight > 0;
            })()
        """

        webView.webViewClient = object : WebViewClient() {
            private var job: Job? = null

            override fun onPageFinished(view: WebView, url: String?) {
                stopJob()
                job = MainScope().launch {
                    addLogMessage(0, "Authenticating...")
                    delay(500)
                    try {
                        // Step 1: Handle disclaimer
                        view.evaluateJavascript("document.querySelector('#disclaimer')") { value ->
                            if (value.isNotEmpty()) {
                                        view.loadUrl("javascript:document.querySelector('.accept-button').click()")
                                addLogMessage(0, "Checking Login..")
                            }
                        }

                        delay(500)

                        // Step 2: Remove previous login
                        view.evaluateJavascript("javascript:document.querySelector('.form').classList.contains('hidden');") { p0 ->
                            if (!p0.toBoolean() && p0 != null) {
                                view.evaluateJavascript(jsPressRemove, null)
                                addLogMessage(0, "Checking password...")
                            }
                        }

                        delay(500)

                        // Step 3: Fill login credentials
                        view.evaluateJavascript("javascript:document.querySelector('.form').classList.contains('hidden');") { p0 ->
                            if (!p0.toBoolean() && p0 != null) {
                                        view.evaluateJavascript(js, null)
                                addLogMessage(0, "Connecting to Server....")
                            }
                        }

                        delay(500)

                        // Step 4: Submit login form
                        view.evaluateJavascript("javascript:document.querySelector('.form').classList.contains('hidden');") { p0 ->
                            if (!p0.toBoolean() && p0 != null) {
                                view.evaluateJavascript(jsPress, null)
                                addLogMessage(0, "Connecting to Server....")
                                }
                            }

                            delay(1000)

                        // Step 5: Search and select symbol
                        addLogMessage(0, "Opening search bar...")
                        view.loadUrl(jsOpenSearchBar)
                        delay(150)
                        
                                view.loadUrl(jsSearch)
                        delay(400)
                        addLogMessage(0, "Connecting to Server....")

                        view.loadUrl(jsSearch)
                        delay(400)
                        addLogMessage(0, "Connecting to Server....")

                                view.evaluateJavascript(jsSelect) { result ->
                                    val success = result?.toBoolean() ?: false
                                    if (success) {
                                        showAllSymbols = true
                                loggedIn = true
                                loading = false
                                chatLoading = true
                                        chooseSymbol = true
                                        pressExecuteTrade = false
                                addLogMessage(0, "✓ Login Successful")
                                Log.i("TradeActivity", "✓ Login successful - starting order execution")
                                stopJob()
                                // Start monitoring for order execution
                                checkAndExecuteOrders(view)
                                    } else {
                                addLogMessage(0, "✗ Symbol $asset not found")
                                checkEmsg = true
                                stopJob()
                            }
                        }
                    } catch (e: CancellationException) {
                        Log.d("TradeActivity", "Login job cancelled")
                    } catch (e: Exception) {
                        Log.e("TradeActivity", "Login error: ${e.message}")
                        addLogMessage(0, "Login error occurred")
                        stopJob()
                    }
                }
            }

            // Execute orders after login - STRICTLY SEQUENTIAL with crash protection
            private fun checkAndExecuteOrders(view: WebView) {
                addLogMessage(0, "Starting order execution...")
                MainScope().launch {
                    try {
                        delay(300) // Wait for page to stabilize
                        
                        // Check if we're still in cooldown period
                        val currentTime = System.currentTimeMillis()
                        val timeSinceLastTrade = currentTime - lastTradeTime
                        
                        if (lastTradeTime > 0 && timeSinceLastTrade < tradeCooldownMs) {
                            val remainingSeconds = (tradeCooldownMs - timeSinceLastTrade) / 1000
                            addLogMessage(0, "⏸️ Trade cooldown active. Please wait $remainingSeconds seconds")
                            Log.w("TradeActivity", "Trade blocked - cooldown active. $remainingSeconds seconds remaining")
                            
                            // Navigate to FinishActivity without trading
                            delay(2000)
                            safelyNavigateToFinish()
                            return@launch
                        }
                        
                        // Validate numberOfOrders
                        if (numberOfOrders == null || numberOfOrders <= 0) {
                            addLogMessage(0, "⚠ Invalid number of orders: $numberOfOrders")
                            delay(2000)
                            safelyNavigateToFinish()
                            return@launch
                        }
                        
                        addLogMessage(0, "Executing $numberOfOrders order(s)...")
                        
                        // Execute all orders STRICTLY SEQUENTIALLY
                        for (i in 1..numberOfOrders!!) {
                            try {
                                Log.d("TradeActivity", "═══ Order #$i of $numberOfOrders ═══")
                                Log.d("TradeActivity", "Symbol: $asset, Action: $action, Vol: $volume, TP: $tp, SL: $sl")
                                
                                // Step 1: Open order dialog (with crash protection)
                                addLogMessage(0, "📋 Opening dialog #$i...")
                                try {
                                    view.evaluateJavascript(jsOrder) { }
                                } catch (e: Exception) {
                                    Log.e("TradeActivity", "Error opening dialog: ${e.message}")
                                }
                                delay(400)
                                
                                // Step 2: Set parameters (with crash protection)
                                addLogMessage(0, "⚙️ Setting parameters - SL: $sl, TP: $tp, Vol: $volume")
                                try {
                                    view.evaluateJavascript(jsLockDialog) { }
                                    delay(100)
                                    view.evaluateJavascript(jsOrderInfo) { result ->
                                        Log.d("TradeActivity", "jsOrderInfo result: $result")
                                    }
                                } catch (e: Exception) {
                                    Log.e("TradeActivity", "Error setting params: ${e.message}")
                                }
                                // Delay for SL/TP to be set
                                delay(800)
                                
                                // Step 3: Click Buy/Sell STRICTLY (with crash protection)
                                addLogMessage(0, if (isBuySignal) "📈 Clicking BUY..." else "📉 Clicking SELL...")
                                try {
                                    repeat(4) { _ ->
                                        view.evaluateJavascript(if (isBuySignal) jsBuy else jsSell) { }
                                        delay(100)
                                    }
                                } catch (e: Exception) {
                                    Log.e("TradeActivity", "Error clicking button: ${e.message}")
                                }
                                delay(200)
                                
                                // Step 4: Click OK (with crash protection)
                                try {
                                    view.evaluateJavascript(jsDone) { }
                                } catch (e: Exception) {
                                    Log.e("TradeActivity", "Error clicking OK: ${e.message}")
                                }
                                delay(200)
                                
                                addLogMessage(0, "✅ Order #$i completed")
                                Log.d("TradeActivity", "Order #$i completed successfully")
                                
                                // STRICTLY wait between orders
                                if (i < numberOfOrders) {
                                    delay(300)
                                }
                                
                            } catch (e: Exception) {
                                Log.e("TradeActivity", "Error in order #$i: ${e.message}", e)
                                addLogMessage(0, "⚠️ Order #$i had an issue but continuing...")
                                delay(1000)
                                // Continue to next order instead of crashing
                            }
                        }
                        
                        // All orders completed
                        addLogMessage(0, "🎉 All $numberOfOrders orders completed!")
                        
                        // Speak "Trade completed"
                        TTSManager.speak(TTSManager.Messages.TRADE_COMPLETED)
                        
                        // Trailing disabled for stability
                        // TrailingManager.startTrailing() removed
                        
                        // Record time for cooldown
                        lastTradeTime = System.currentTimeMillis()
                        Log.i("TradeActivity", "Trade cooldown activated - next trade in 2 minutes")
                        addLogMessage(0, "⏸️ Trading paused for 2 minutes")
                        
                        // Navigate to FinishActivity
                        delay(1500)
                        safelyNavigateToFinish()
                        
                    } catch (e: CancellationException) {
                        Log.d("TradeActivity", "Order execution cancelled")
                    } catch (e: Exception) {
                        Log.e("TradeActivity", "Critical error in order execution: ${e.message}", e)
                        addLogMessage(0, "⚠️ Trading error occurred")
                        delay(2000)
                        safelyNavigateToFinish()
                    }
                }
            }
            
            // Safe navigation helper to prevent crashes
            private fun safelyNavigateToFinish() {
                try {
                    Log.d("TradeActivity", "Safely navigating to finish...")
                    
                    // Cancel jobs individually with error protection
                    try {
                        job?.cancel()
                    } catch (e: Exception) {
                        Log.e("TradeActivity", "Error cancelling job: ${e.message}")
                    }
                    
                    try {
                        this@TradeActivity.job2?.cancel()
                    } catch (e: Exception) {
                        Log.e("TradeActivity", "Error cancelling job2: ${e.message}")
                    }
                    
                    try {
                        this@TradeActivity.timer1.cancel()
                    } catch (e: Exception) {
                        Log.e("TradeActivity", "Error cancelling timer: ${e.message}")
                    }
                    
                    // Small delay to ensure cleanup completes
                    Thread.sleep(200)
                    
                    // Navigate to finish activity
                    try {
                        if (!this@TradeActivity.isFinishing && !this@TradeActivity.isDestroyed) {
                            val finishIntent = Intent(this@TradeActivity, FinishActivity::class.java)
                            finishIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
                            this@TradeActivity.startActivity(finishIntent)
                            this@TradeActivity.finish()
                            Log.d("TradeActivity", "Successfully navigated to FinishActivity")
                        } else {
                            Log.w("TradeActivity", "Activity already finishing or destroyed")
                        }
                    } catch (e: Exception) {
                        Log.e("TradeActivity", "Error starting FinishActivity: ${e.message}")
                        try {
                            if (!this@TradeActivity.isFinishing) {
                                this@TradeActivity.finish()
                            }
                        } catch (e2: Exception) {
                            Log.e("TradeActivity", "Error calling finish(): ${e2.message}")
                        }
                    }
                    
                } catch (e: Exception) {
                    Log.e("TradeActivity", "Critical error in safelyNavigateToFinish: ${e.message}", e)
                    // Last resort - try to finish
                    try {
                        if (!this@TradeActivity.isFinishing) {
                            this@TradeActivity.finish()
                        }
                    } catch (e2: Exception) {
                        Log.e("TradeActivity", "Final finish() failed: ${e2.message}")
                    }
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError
            ) {
                addLogMessage(0, "You have lost internet connection")
            }

            fun stopJob() {
                job?.cancel()
            }
        }

    }


    private fun tradeMT4(
        webView: WebView,
        id: String,
        password: String,
        server: String,
        asset: String,
        tp: String?,
        sl: String?,
        volume: String,
        action: String,
        botname: String?,
        numberOfTrades: Int?
    ){

        ea_nameModePref = getSharedPreferences("EANameModePrefs", MODE_PRIVATE)

        // Retrieve the mode value (with a default value of 1 if it doesn't exist)
        val mode = ea_nameModePref.getInt("mode", 1)  // Default to 1 (Normal mode)

        addLogMessage(0, "Setting up MT5...")


        val numberOfOrders = numberOfTrades






        webView.loadUrl("https://metatraderweb.app/trade?version=4")

        val js =
            "javascript:var x=document.getElementById('login').value = '$id'; var x=document.getElementById('server').value = '$server';var y=document.getElementById('password').value='$password';"
        val jsPress ="javascript:document.querySelectorAll('button.input-button').item(3).removeAttribute('disabled');document.querySelectorAll('button.input-button').item(3).click();"
        val item1InSymbolsRightClick ="javascript:var element=document.querySelector('body > div.page-window.market-watch.compact > div > div.b > div.page-block > div > table > tbody > tr:nth-child(1)');" +
                "var ev1 = new MouseEvent(\"mousedown\", {\n" +
                "            bubbles: true,\n" +
                "            cancelable: false,\n" +
                "            view: window,\n" +
                "            button: 2,\n" +
                "            buttons: 2,\n" +
                "            clientX: element.getBoundingClientRect().x,\n" +
                "            clientY: element.getBoundingClientRect().y\n" +
                "        });\n" +
                "        element.dispatchEvent(ev1);\n" +
                "        var ev2 = new MouseEvent(\"mouseup\", {\n" +
                "            bubbles: true,\n" +
                "            cancelable: false,\n" +
                "            view: window,\n" +
                "            button: 2,\n" +
                "            buttons: 0,\n" +
                "            clientX: element.getBoundingClientRect().x,\n" +
                "            clientY: element.getBoundingClientRect().y\n" +
                "        });\n" +
                "        element.dispatchEvent(ev2);\n" +
                "        var ev3 = new MouseEvent(\"contextmenu\", {\n" +
                "            bubbles: true,\n" +
                "            cancelable: false,\n" +
                "            view: window,\n" +
                "            button: 2,\n" +
                "            buttons: 0,\n" +
                "            clientX: element.getBoundingClientRect().x,\n" +
                "            clientY: element.getBoundingClientRect().y\n" +
                "        });\n" +
                "        element.dispatchEvent(ev3);"

        val press_show_all = "javascript:var sall=document.querySelector('body > div.page-menu.context.expanded > div > div > span.box > span > div:nth-child(7)');" +
                "sall.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));" +
                "sall.click();"

        val choose_symbol = "javascript:var tableB = document.querySelector('body > div.page-window.market-watch.compact > div > div.b > div.page-block > div > table > tbody');" +
                "var allTRs = tableB.querySelectorAll('tr');" +
                "var input, filter, ul, li, a, i, txtValue;" +
                "var clickEvent  = document.createEvent ('MouseEvents');\n" +
                "            clickEvent.initEvent ('dblclick', true, true);\n" +
                "for (i = 0; i < allTRs.length; i++) {\n" +
                "            a = allTRs[i].getElementsByTagName('td')[0];\n" +
                "            if (a.textContent.trimLeft(0) === '"+asset+"') {\n" +
                "              a.style.background = 'red';\n" +
                "                a.dispatchEvent(clickEvent);\n" +
                "            } " +
                "          }"


        val combinedScript = """
    javascript:
(function() {
    // Function to set input value and dispatch events
    function setInputValue(inputId, value) {
        var input = document.querySelector('#' + inputId);
        if (input) {
            input.value = value;  // Set the value
            input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            input.dispatchEvent(new Event('focus', { bubbles: true }));
        }
    }

    // Function to invalidate input value based on its ID
    function invalidateInput(inputId) {
        var input = document.querySelector('#' + inputId);
        if (input) {
            if (inputId === 'sl') {
                input.value = '$sl';  // Set to valid SL value
            } else if (inputId === 'tp') {
                input.value = '$tp';  // Set to valid TP value
            } else {
                input.value = '';  // For other inputs, reset to empty
            }
            input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        }
    }

    // Set values for SL and TP
    var slValue = '$sl';  // Replace with actual SL value
    var tpValue = '$tp';  // Replace with actual TP value

    setInputValue('sl', slValue);
    setInputValue('tp', tpValue);

    // Optionally invalidate the TP input (for demonstration)
    invalidateInput('tp'); // This will set the TP input to a valid value
    invalidateInput('sl'); // This will set the TP input to a valid value
    // Set and commit volume input value
    var volumeInput = document.querySelector('#volume');
    if (volumeInput) {
        volumeInput.value = '$volume'; 
        volumeInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        volumeInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        volumeInput.dispatchEvent(new Event('focus', { bubbles: true }));
    }

    // Set and commit comment input value
    var commentInput = document.querySelector('#comment');
    if (commentInput) {
        commentInput.value = '$botname'; 
        commentInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        commentInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        commentInput.dispatchEvent(new Event('focus', { bubbles: true }));
    }

})();
"""





        val sellItem = "javascript:document.querySelector('button.input-button.red').click();"
        val buyItem = "javascript:document.querySelector('button.input-button.blue').click();"


        val sellItem1 = "javascript:document.querySelector('body > div:nth-child(17) > div > div.b > button:nth-child(18)').click();"
        val buyItem1 = "javascript:document.querySelector('body > div:nth-child(17) > div > div.b > button:nth-child(19)').click();"


        webView.webViewClient = object : WebViewClient() {

            override fun onPageFinished(view: WebView, url: String?) {
                job2 = MainScope().launch {
                    while (true) {
                        delay(3000)
                        if (loading)
                            addLogMessage(0,"Setting Up Trade on MT4")
                        else{

                            if(!showAllSymbols) {
                                view.evaluateJavascript("document.querySelector('body > div:nth-child(14)').classList.contains('hidden')"
                                ) { p0 ->
                                    if (!p0.toBoolean() && p0 != null) {
                                        view.loadUrl(js)
                                        view.loadUrl(jsPress)
                                        showAllSymbols = true
                                        addLogMessage(0,"linking Bot to Account")
                                    }
                                }
                            }

                            if(showAllSymbols)
                            {
                                view.evaluateJavascript("javascript: document.querySelector('body > div.page-window.market-watch.compact > div > div.b > div.page-block > div > table > tbody > tr:nth-child(1)');"
                                ) { p0 ->
                                    if (p0 != null) {
                                        view.loadUrl(item1InSymbolsRightClick)
                                        addLogMessage(0,"checking all available assets.")
                                    }
                                }
                                delay(3000)
                                view.evaluateJavascript("javascript: document.querySelector('body > div.page-menu.context.expanded > div > div > span.box > span > div:nth-child(7)');"
                                ) { p0 ->
                                    if (p0 != null) {
                                        view.loadUrl(press_show_all)
                                        chooseSymbol = true
                                        addLogMessage(0,"Viewing all available assets.")
                                    }
                                }
                            }

                            if(chooseSymbol){
                                view.evaluateJavascript("javascript: document.querySelector('body > div.page-window.market-watch.compact > div > div.b > div.page-block > div > table > tbody').innerText.includes('$asset')",object : ValueCallback<String>{
                                    override fun onReceiveValue(p0: String?) {

                                        if (p0 != null && p0.toBoolean())
                                        {
                                            view.loadUrl(choose_symbol)
                                            showAllSymbols = false
                                            pressExecuteTrade = true
                                            addLogMessage(0,"Selecting $asset")
                                        }

                                    }

                                })
                            }



                            if (pressExecuteTrade) {
                                var loopCounter = 0 // Track number of orders processed

                                // A recursive function to handle the next order in sequence
                                fun executeOrder() {
                                    // Check if all orders have been processed
                                    if (loopCounter >= numberOfOrders!!) {
                                        checkEmsg = true
                                        pressExecuteTrade = false
                                        return
                                    }

                                    // Process the current order
                                    view.evaluateJavascript(
                                        "javascript: document.querySelector('body > div:nth-child(18)').classList.contains('hidden')"
                                    ) { p0 ->
                                        if (p0 != null && !p0.toBoolean()) {
                                            chooseSymbol = false
                                            view.evaluateJavascript(combinedScript) { result ->
                                                val success = result?.toBoolean() ?: false
                                                if (success) {
                                                    addLogMessage(0, "Setting LotSize , TP and SL.")
                                                }
                                            }

                                            // Handle the delay and load URLs sequentially
                                            Handler().postDelayed({
                                                Handler().postDelayed({
                                                    if (action == "BUY") {
                                                        view.loadUrl(buyItem)
                                                    } else {
                                                        view.loadUrl(sellItem)
                                                    }
                                                    addLogMessage(0, ">> $action $asset ")

                                                    // Increment the loop counter after finishing the current order
                                                    loopCounter++

                                                    // Recursively call the function to process the next order
                                                    executeOrder()
                                                }, 1000)
                                            }, 1000)
                                        }
                                    }
                                }

                                // Start executing the orders
                                executeOrder()
                            }





                            if(checkEmsg) {

                                view.evaluateJavascript("javascript: document.querySelector('body > div:nth-child(16) > div > div.b > button:nth-child(38)').style.display=='none';") { p0 ->
                                    if (p0 != null && !p0.toBoolean()) {
                                        view.evaluateJavascript("javascript: document.querySelector('body > div:nth-child(16) > div > div.b > div:nth-child(37)').innerText;") { eMsg ->
                                            if (eMsg != null) {
                                                addLogMessage(0,">>$eMsg ")
                                                addLogMessage(1,findViewById<TextView>(R.id.log_message).text.toString()+"\n>>$eMsg")


                                            }
                                            Handler().postDelayed({
                                                // Speak "Trade completed" for MT4
                                                TTSManager.speak(TTSManager.Messages.TRADE_COMPLETED)
                                                
                                                job?.cancel()
                                                job2?.cancel()
                                                timer1.cancel()
                                                trade = false;
                                                val intent = Intent(this@TradeActivity, FinishActivity::class.java)
                                                startActivity(intent)
                                                finish()

                                            },3000)
                                        }
                                    }
                                }
                            }

                        }

                    }
                }
            }

            override fun onLoadResource(view: WebView?, url: String?) {
                webView.clearCache(true)
                loading = true
                addLogMessage(0,">>Loading... ")
                super.onLoadResource(view, url)
            }




            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError
            ) {
                addLogMessage(0, "You have lost internet connection")
            }

            fun stopJob() {
                job?.cancel()
            }
        }



    }


}

