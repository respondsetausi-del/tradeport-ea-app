package com.bellyforex.tradeportea.ui

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.utils.TTSManager
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class CloseTradesActivity : AppCompatActivity() {
    
    private lateinit var webView: WebView
    private lateinit var statusText: TextView
    private lateinit var mt5SharedPref: SharedPreferences
    private var closingInProgress = false
    private var login = ""
    private var password = ""
    private var server = ""
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Make activity invisible - no UI shown
        window.setBackgroundDrawableResource(android.R.color.transparent)
        setContentView(R.layout.activity_close_trades)
        
        // Hide the activity from user view
        window.setDimAmount(0f)
        
        webView = findViewById(R.id.closeTradesWebView)
        statusText = findViewById(R.id.closeStatusText)
        
        // Hide webview - runs in background
        webView.visibility = android.view.View.INVISIBLE
        statusText.visibility = android.view.View.GONE
        
        mt5SharedPref = getSharedPreferences("mt5", Context.MODE_PRIVATE)
        
        // Get credentials
        login = mt5SharedPref.getString("login", "") ?: ""
        password = mt5SharedPref.getString("password", "") ?: ""
        server = mt5SharedPref.getString("server", "") ?: ""
        
        Log.d("CloseTradesActivity", "Login: $login, Server: $server")
        
        if (login.isEmpty() || password.isEmpty()) {
            statusText.text = "No MT5 login details found"
            TTSManager.speak("No login details found")
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, 3000)
            return
        }
        
        setupWebView()
        loadPlatform()
    }
    
    private fun setupWebView() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.setSupportZoom(true)
        webView.settings.builtInZoomControls = true
        webView.settings.displayZoomControls = false
        webView.settings.userAgentString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!closingInProgress) {
                    closingInProgress = true
                    Handler(Looper.getMainLooper()).postDelayed({
                        performLogin()
                    }, 1500)
                }
            }
        }
    }
    
    private fun loadPlatform() {
        statusText.text = "Loading platform for $server..."
        
        // Use same URL logic as TradeActivity based on server
        val url = when (server.lowercase()) {
            "razormarkets-live" -> "https://webtrader.razormarkets.co.za/terminal"
            "icmarkets-live04", "icmarketssc-live21" -> "https://webterminal.icmarkets.com/terminal"
            "ftmo-live", "ftmo-server" -> "https://trade.ftmo.com/"
            else -> "https://webtrader.razormarkets.co.za/terminal"
        }
        
        Log.d("CloseTradesActivity", "Loading URL: $url")
        webView.loadUrl(url)
    }
    
    private fun performLogin() {
        statusText.text = "Logging in as $login..."
        
        MainScope().launch {
            try {
                // Fill login form
                val fillLoginJs = """
                    javascript:(function() {
                        console.log('Filling login form...');
                        var loginInput = document.querySelector('input[name="login"]');
                        var passwordInput = document.querySelector('input[name="password"]');
                        
                        if (loginInput) {
                            loginInput.value = '$login';
                            loginInput.dispatchEvent(new Event('input', { bubbles: true }));
                            console.log('Login filled');
                        }
                        if (passwordInput) {
                            passwordInput.value = '$password';
                            passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
                            console.log('Password filled');
                        }
                    })();
                """.trimIndent()
                
                webView.evaluateJavascript(fillLoginJs, null)
                delay(500)
                
                // Click login button
                val clickLoginJs = """
                    javascript:(function() {
                        var btn = document.querySelector('.button.svelte-1wrky82.active, button[type="submit"], .login-btn, .btn-login');
                        if (btn) { btn.click(); console.log('Login clicked'); }
                    })();
                """.trimIndent()
                
                webView.evaluateJavascript(clickLoginJs, null)
                
                delay(4000)
                statusText.text = "Finding open positions..."
                
                // Now close all trades
                closeAllPositions()
                
            } catch (e: Exception) {
                Log.e("CloseTradesActivity", "Error: ${e.message}")
                statusText.text = "Error: ${e.message}"
                delay(3000)
                finish()
            }
        }
    }
    
    private fun closeAllPositions() {
        MainScope().launch {
            statusText.text = "Closing all positions..."
            
            // Script to close all open positions
            val closeAllJs = """
                javascript:(function() {
                    console.log('Looking for positions to close...');
                    
                    // Method 1: Find close buttons directly
                    var closeBtns = document.querySelectorAll('[class*="close"], .position-close, .close-btn, .btn-close');
                    console.log('Found ' + closeBtns.length + ' close buttons');
                    
                    closeBtns.forEach(function(btn, i) {
                        setTimeout(function() { btn.click(); }, i * 300);
                    });
                    
                    // Method 2: Right-click on positions and select close
                    var positions = document.querySelectorAll('.position, .trade-row, [class*="position"]');
                    console.log('Found ' + positions.length + ' positions');
                    
                    // Method 3: Try the close all button if exists
                    var closeAllBtn = document.querySelector('[title="Close All"], .close-all, .btn-close-all');
                    if (closeAllBtn) { closeAllBtn.click(); console.log('Close all button clicked'); }
                    
                    return closeBtns.length;
                })();
            """.trimIndent()
            
            webView.evaluateJavascript(closeAllJs) { result ->
                Log.d("CloseTradesActivity", "Close result: $result")
            }
            
            delay(2000)
            
            // Confirm any dialogs
            val confirmJs = """
                javascript:(function() {
                    var confirms = document.querySelectorAll('.confirm, .ok, .yes, button.primary, [class*="confirm"]');
                    confirms.forEach(function(btn) { btn.click(); });
                })();
            """.trimIndent()
            
            webView.evaluateJavascript(confirmJs, null)
            
            delay(2000)
            statusText.text = "Done! Closing..."
            TTSManager.speak("Trades closed")
            
            delay(1500)
            finish()
        }
    }
    
    override fun onDestroy() {
        super.onDestroy()
        webView.destroy()
    }
}
