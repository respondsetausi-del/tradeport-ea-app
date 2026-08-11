package com.bellyforex.tradeportea.ui

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.utils.TTSManager
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class ModifyTradeActivity : AppCompatActivity() {
    
    private lateinit var webView: WebView
    private lateinit var statusText: TextView
    private lateinit var mt5SharedPref: SharedPreferences
    private var modifyInProgress = false
    
    private var newSL: String = ""
    private var newTP: String = ""
    private var asset: String = ""
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_modify_trade)
        
        webView = findViewById(R.id.modifyTradeWebView)
        statusText = findViewById(R.id.modifyStatusText)
        
        mt5SharedPref = getSharedPreferences("mt5", Context.MODE_PRIVATE)
        
        // Get modification parameters from intent
        newSL = intent.getStringExtra("new_sl") ?: ""
        newTP = intent.getStringExtra("new_tp") ?: ""
        asset = intent.getStringExtra("asset") ?: ""
        
        if (newSL.isEmpty() && newTP.isEmpty()) {
            statusText.text = "No SL/TP values to modify"
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, 2000)
            return
        }
        
        setupWebView()
        startModification()
    }
    
    private fun setupWebView() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.setSupportZoom(true)
        webView.settings.builtInZoomControls = true
        webView.settings.displayZoomControls = false
        
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!modifyInProgress) {
                    modifyInProgress = true
                    Handler(Looper.getMainLooper()).postDelayed({
                        loginAndModify()
                    }, 2000)
                }
            }
        }
    }
    
    private fun startModification() {
        val login = mt5SharedPref.getString("login", "") ?: ""
        val password = mt5SharedPref.getString("password", "") ?: ""
        
        if (login.isEmpty() || password.isEmpty()) {
            statusText.text = "No MT5 login details found"
            TTSManager.speak("No login details found")
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, 3000)
            return
        }
        
        statusText.text = "Loading platform to modify $asset..."
        webView.loadUrl("https://trade.mql5.com/trade")
    }
    
    private fun loginAndModify() {
        val login = mt5SharedPref.getString("login", "") ?: ""
        val password = mt5SharedPref.getString("password", "") ?: ""
        val server = mt5SharedPref.getString("server", "") ?: ""
        
        statusText.text = "Logging in to modify SL/TP..."
        
        MainScope().launch {
            try {
                // Login script
                val loginJs = """
                    javascript:(function() {
                        var loginInput = document.querySelector('input[name="login"]');
                        var passwordInput = document.querySelector('input[name="password"]');
                        var serverInput = document.querySelector('input[name="server"]');
                        
                        if (loginInput) {
                            loginInput.value = '$login';
                            loginInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        if (passwordInput) {
                            passwordInput.value = '$password';
                            passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        if (serverInput) {
                            serverInput.value = '$server';
                            serverInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        
                        setTimeout(function() {
                            var loginBtn = document.querySelector('button[type="submit"]');
                            if (loginBtn) loginBtn.click();
                        }, 500);
                    })();
                """.trimIndent()
                
                webView.evaluateJavascript(loginJs, null)
                
                delay(5000)
                statusText.text = "Modifying SL/TP for $asset..."
                
                // Find the position and modify SL/TP
                val modifyJs = """
                    javascript:(function() {
                        // Find position row for the asset
                        var positions = document.querySelectorAll('.position-row, .trade-row, tr[data-symbol]');
                        var found = false;
                        
                        positions.forEach(function(row) {
                            var symbolCell = row.querySelector('.symbol, [data-symbol], td:first-child');
                            if (symbolCell && symbolCell.innerText.includes('$asset')) {
                                found = true;
                                // Double-click or right-click to open modify dialog
                                var modifyBtn = row.querySelector('.modify-btn, .btn-modify, [title="Modify"]');
                                if (modifyBtn) {
                                    modifyBtn.click();
                                } else {
                                    // Try double-click on row
                                    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                                }
                            }
                        });
                        
                        return found;
                    })();
                """.trimIndent()
                
                webView.evaluateJavascript(modifyJs) { result ->
                    Log.d("ModifyTradeActivity", "Find position result: $result")
                }
                
                delay(2000)
                
                // Set new SL/TP values
                val setSLTPJs = """
                    javascript:(function() {
                        var slInput = document.querySelector('input[name="sl"], .sl-input, #stopLoss');
                        var tpInput = document.querySelector('input[name="tp"], .tp-input, #takeProfit');
                        
                        if (slInput && '$newSL' !== '') {
                            slInput.value = '$newSL';
                            slInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        if (tpInput && '$newTP' !== '') {
                            tpInput.value = '$newTP';
                            tpInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        
                        // Click modify/confirm button
                        setTimeout(function() {
                            var confirmBtn = document.querySelector('.modify-confirm, .btn-confirm, button[type="submit"]');
                            if (confirmBtn) confirmBtn.click();
                        }, 500);
                    })();
                """.trimIndent()
                
                webView.evaluateJavascript(setSLTPJs, null)
                
                delay(3000)
                statusText.text = "SL/TP modified successfully!"
                TTSManager.speak("Stop loss and take profit updated")
                
                delay(2000)
                finish()
                
            } catch (e: Exception) {
                Log.e("ModifyTradeActivity", "Error modifying trade: ${e.message}")
                statusText.text = "Error: ${e.message}"
                delay(3000)
                finish()
            }
        }
    }
    
    override fun onDestroy() {
        super.onDestroy()
        webView.destroy()
    }
}
