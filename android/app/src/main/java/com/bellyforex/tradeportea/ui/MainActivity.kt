package com.bellyforex.tradeportea.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Window
import android.view.WindowManager
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.MutableLiveData
import android.view.View
import android.widget.RelativeLayout
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.network.db.LicenceDB
import com.bellyforex.tradeportea.repository.RTRepository
import com.bellyforex.tradeportea.ui.theme.ThemeEngine
import com.bellyforex.tradeportea.ui.theme.ThemeUtils
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch


class MainActivity : AppCompatActivity() {
    private val drawAllowed =  MutableLiveData<Boolean>()

    private val open =  MutableLiveData<Boolean>()
    private var drawPass : Boolean =false
    lateinit var job: Job

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize theme and apply to welcome page
        ThemeEngine.init(this)
        val rootView = findViewById<RelativeLayout>(R.id.main_root)
        val drawBtn = findViewById<Button>(R.id.draw_btn)
        val theme = ThemeEngine.getCurrentTheme()
        ThemeUtils.applyAtmosphereToView(rootView, theme)
        ThemeUtils.applyThemeToButton(drawBtn, theme)

        val rtRepository = RTRepository(LicenceDB(this))
        val sharedPref = applicationContext.getSharedPreferences("comp", MODE_PRIVATE)
        //job.cancel()
       // val mp: MediaPlayer = MediaPlayer.create(applicationContext, android.R.raw.)
        //mp.start()
        drawAllowed.observe(this) {
            // Get the window of the activity
            val window: Window = window
            when (it) {
                true -> {
                    drawPass = true
                    findViewById<Button>(R.id.draw_btn).apply {
                        this.isEnabled = false
                        this.setCompoundDrawablesWithIntrinsicBounds(
                            0,
                            0,
                            R.drawable.ic_baseline_check_circle_24,
                            0
                        )
                    }
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                else -> {
                    drawPass = false
                    findViewById<Button>(R.id.draw_btn).apply {
                        this.isEnabled = true
                        this.setCompoundDrawablesWithIntrinsicBounds(
                            0,
                            0,
                            R.drawable.ic_baseline_cancel_24,
                            0
                        )
                        this.setOnClickListener {
                            Intent(
                                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:$packageName")
                            ).apply {
                                startActivityForResult(this, 0)
                            }
                        }
                    }
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
        }



        open.observe(this) {
            if (it) {
                job.cancel()
                val intent = Intent(this, HomeActivity::class.java)
                startActivity(intent)
                finish()
            }
        }
        /*val intent = Intent(this, HomeActivity::class.java)
        startActivity(intent)
        finish()*/

        job = MainScope().launch {
            while (true) {
                drawAllowed.postValue(Settings.canDrawOverlays(this@MainActivity))
                delay(200)

                if(drawPass)
                {
                    open.postValue(true)
                }

            }
        }

    }





}