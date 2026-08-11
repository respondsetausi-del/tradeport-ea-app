package com.bellyforex.tradeportea.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.network.api.RetrofitInstance
import com.bellyforex.tradeportea.network.module.Mt5TradeRequest
import com.bellyforex.tradeportea.ui.theme.ThemeEngine
import com.bellyforex.tradeportea.utils.Mt5Session
import com.google.gson.JsonElement
import kotlinx.coroutines.launch
import org.json.JSONArray

class ScannerActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    // Use StartActivityForResult with the exact intent from FileChooserParams
    // This avoids Android's photo picker compression and returns full-resolution URIs
    private val filePickerLauncher: ActivityResultLauncher<Intent> = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            // Use parseResult() to correctly extract URIs — handles single, multiple, and camera
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            fileChooserCallback?.onReceiveValue(uris)
        } else {
            // User cancelled — must still call onReceiveValue(null) or WebView locks up
            fileChooserCallback?.onReceiveValue(null)
        }
        fileChooserCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_scanner)

        webView = findViewById(R.id.scanner_webview)

        // Enable hardware acceleration for better canvas rendering quality
        // This directly affects the JS canvas.toBlob() JPEG quality the scanner page uses
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            builtInZoomControls = true
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = false

            // Use desktop-class user agent so the page serves full-quality assets
            // Some sites serve lower-quality content to mobile WebView UAs
            userAgentString = userAgentString.replace("; wv", "")
        }

        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // Keep the local scanner asset inside the WebView — only external
                // http/https links should punch out to the system browser.
                if (url.startsWith("file://") || url.startsWith("about:") || url.startsWith("data:")) {
                    return false
                }
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: android.os.Message?
            ): Boolean {
                val newWebView = WebView(this@ScannerActivity)
                newWebView.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                        val url = request?.url?.toString() ?: return false
                        webView.loadUrl(url)
                        return true
                    }
                }
                val transport = resultMsg?.obj as? WebView.WebViewTransport
                transport?.webView = newWebView
                resultMsg?.sendToTarget()
                return true
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                // Cancel any pending callback to prevent WebView lock-up
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback

                // Build a chooser intent that gives the user gallery + file manager options
                // Using ACTION_GET_CONTENT (not ACTION_PICK) to get original uncompressed files
                val contentIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/png", "image/jpeg", "image/webp"))
                    // Request original file, not a thumbnail or compressed copy
                    putExtra("android.provider.extra.INIT_NO_COMPRESS", true)
                }

                // Wrap in a chooser so user sees all available apps (Gallery, Files, etc.)
                val chooserIntent = Intent.createChooser(contentIntent, "Select Chart Screenshot")

                // Grant read permission so WebView's JS can read the full file contents
                chooserIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

                filePickerLauncher.launch(chooserIntent)
                return true
            }
        }

        webView.setDownloadListener(DownloadListener { url, _, _, _, _ ->
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        })

        // Bridge for MT5 trading: the page pulls the broker symbol list and
        // fires auto-executions through the Api2Trade backend via this app.
        webView.addJavascriptInterface(TradePortBridge(), "TradePort")

        // On-device chart scanner HTML asset. The candle analysis stays
        // on-device; only symbol list + trade execution use the network.
        // Thread the current ThemeEngine accent through so the page glow/text
        // matches the rest of the app.
        val accentInt = ThemeEngine.getAccentColor()
        val accentHex = String.format("%06X", 0xFFFFFF and accentInt)
        webView.loadUrl("file:///android_asset/scanner.html?accent=$accentHex")

        findViewById<ImageView>(R.id.back_btn).setOnClickListener {
            finish()
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    private fun postJs(script: String) {
        runOnUiThread { webView.evaluateJavascript(script, null) }
    }

    /**
     * JS bridge exposed as window.TradePort inside scanner.html.
     * Symbols and executions go through the Bun backend (Api2Trade proxy)
     * keyed by the session UUID saved when the MT5 account was linked.
     * @JavascriptInterface methods run on a WebView thread — results are
     * pushed back to the page via evaluateJavascript on the UI thread.
     */
    inner class TradePortBridge {

        @JavascriptInterface
        fun requestSymbols() {
            val prefs = getSharedPreferences("mt5", MODE_PRIVATE)
            val connected = prefs.getBoolean("logged", false) && !prefs.getString("uuid", null).isNullOrEmpty()
            if (!connected) {
                postJs("window.onMt5Symbols(null, 'Connect your MT5 account on the Metatrader page first.')")
                return
            }
            lifecycleScope.launch {
                // Revive the session if the broker dropped it, so a stale
                // handle doesn't show up as "no symbols".
                val uuid = Mt5Session.ensure(this@ScannerActivity)
                if (uuid.isNullOrEmpty()) {
                    postJs("window.onMt5Symbols(null, 'Connect your MT5 account on the Metatrader page first.')")
                    return@launch
                }
                try {
                    val response = RetrofitInstance.mt5Api.symbols(uuid)
                    val names = parseSymbolNames(response.body())
                    if (response.isSuccessful && names.isNotEmpty()) {
                        postJs("window.onMt5Symbols(${JSONArray(names)}, null)")
                    } else {
                        postJs("window.onMt5Symbols(null, 'Could not load symbols. Reconnect your MT5 account and try again.')")
                    }
                } catch (e: Exception) {
                    postJs("window.onMt5Symbols(null, 'Could not load symbols. Check your internet and try again.')")
                }
            }
        }

        /**
         * Manual execution from a scan.
         *
         * Deliberately NOT gated on whether the robot is running — a scan
         * execution is an explicit user action and is allowed to stand
         * alongside the robot's positions.
         *
         * Consequence to be aware of: the robot manages every position on its
         * symbol, so when it next reverses it will close manual trades on that
         * symbol too. Scanning a symbol the robot isn't trading avoids this
         * entirely.
         */
        @JavascriptInterface
        fun executeTrade(symbol: String, operation: String, volume: String) {
            val lots = volume.trim().replace(',', '.').toDoubleOrNull()
            if (lots == null || lots <= 0) {
                postJs("window.onTradeResult(false, 'Invalid lot size.')")
                return
            }
            // Order comment = the active robot name, per the platform rule.
            val comment = (getSharedPreferences("MyPrefs", MODE_PRIVATE)
                .getString("ea_name", null)?.takeIf { it.isNotBlank() } ?: "Robot").take(31)

            lifecycleScope.launch {
                // Revive the session first — a stored UUID is not proof the
                // broker still holds it.
                val uuid = Mt5Session.ensure(this@ScannerActivity, force = true)
                if (uuid.isNullOrEmpty()) {
                    postJs("window.onTradeResult(false, 'MT5 account not connected.')")
                    return@launch
                }

                try {
                    val response = RetrofitInstance.mt5Api.trade(
                        Mt5TradeRequest(uuid, "open", symbol, operation, lots, comment)
                    )
                    val ticket = extractTicket(response.body())
                    if (response.isSuccessful && ticket > 0) {
                        postJs("window.onTradeResult(true, 'TRADE EXECUTED — TICKET $ticket')")
                    } else {
                        // HTTP 200 without a ticket is a broker rejection
                        // (e.g. volume below the symbol minimum).
                        postJs("window.onTradeResult(false, 'Trade rejected by broker. Check the lot size for this symbol.')")
                    }
                } catch (e: Exception) {
                    postJs("window.onTradeResult(false, 'Trade failed. Check your internet and try again.')")
                }
            }
        }
    }

    // Accepts a bare array or {symbols/data/list: [...]} wrapping, with
    // string or {symbol/name} entries — same tolerance as AssetsViewModel.
    private fun parseSymbolNames(body: JsonElement?): List<String> {
        val array = when {
            body == null -> return emptyList()
            body.isJsonArray -> body.asJsonArray
            body.isJsonObject -> {
                val obj = body.asJsonObject
                listOf("symbols", "data", "list", "result")
                    .firstNotNullOfOrNull { key ->
                        obj.get(key)?.takeIf { it.isJsonArray }?.asJsonArray
                    } ?: return emptyList()
            }
            else -> return emptyList()
        }
        return array.mapNotNull { el ->
            when {
                el.isJsonPrimitive -> el.asString
                el.isJsonObject -> el.asJsonObject.get("symbol")?.takeIf { it.isJsonPrimitive }?.asString
                    ?: el.asJsonObject.get("name")?.takeIf { it.isJsonPrimitive }?.asString
                else -> null
            }
        }.filter { it.isNotBlank() }
    }

    private fun extractTicket(body: JsonElement?): Long {
        if (body == null || !body.isJsonObject) return -1
        val obj = body.asJsonObject
        return try {
            obj.get("ticket")?.takeIf { it.isJsonPrimitive }?.asLong
                ?: listOf("order", "data", "result")
                    .firstNotNullOfOrNull { key ->
                        obj.get(key)?.takeIf { it.isJsonObject }?.asJsonObject
                            ?.get("ticket")?.takeIf { it.isJsonPrimitive }?.asLong
                    } ?: -1
        } catch (e: Exception) {
            -1
        }
    }
}
