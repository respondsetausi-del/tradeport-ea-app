package com.bellyforex.tradeportea.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.CountDownTimer
import android.view.View.GONE
import android.view.View.VISIBLE
import android.widget.Button
import android.widget.ProgressBar
import android.widget.RelativeLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.NestedScrollView
import androidx.lifecycle.LiveData
import androidx.lifecycle.Observer
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.network.db.LicenceDB
import com.bellyforex.tradeportea.network.module.log
import com.bellyforex.tradeportea.repository.RTRepository
import com.bellyforex.tradeportea.utils.Constants.Companion.UPDATE_LINK


class FinishActivity : AppCompatActivity() {
    private lateinit var savedLogData: LiveData<List<log>>
    private val rtRepository = RTRepository(LicenceDB(this))
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_finish)
        savedLogData = rtRepository.getDBLogs()
        savedLogData.observeForever(savedLogObserver)

        val update = intent.getBooleanExtra("update",false)
        if(!update)
        {
            findViewById<RelativeLayout>(R.id.loading).visibility = VISIBLE
            findViewById<RelativeLayout>(R.id.update).visibility = GONE


            var maxto = 0
            val timeProgressBar = findViewById<ProgressBar>(R.id.time_progressBar)
            val timetext = findViewById<TextView>(R.id.time_line_2)
            var timeleft = 50
            val timer1 = object: CountDownTimer(50000, 1000) {
                override fun onTick(millisUntilFinished: Long) {
                    timeleft -=1
                    timetext.text = timeleft.toString()
                    if(maxto <= 50){
                        timeProgressBar.apply {
                            progress = maxto
                        }
                    }
                    maxto += 1

                }

                override fun onFinish() {
                    timeProgressBar.apply {
                        progress = 50
                        finish()
                    }
                }
            }.start()

        }else{
            findViewById<RelativeLayout>(R.id.loading).visibility = GONE
            findViewById<RelativeLayout>(R.id.update).visibility = VISIBLE
            val updatebtn = findViewById<Button>(R.id.updatebutton).setOnClickListener {
                val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(UPDATE_LINK))
                startActivity(browserIntent)
            }
        }
    }

    private val savedLogObserver = Observer<List<log>>{
        if (it.isNotEmpty() && it != null)
        {
            if(it.size>1) {
                findViewById<TextView>(R.id.log_message).text = it[1].message
                findViewById<Button>(R.id.copy_btn).setOnClickListener {
                    copyTextToClipboard()
                }
                val sv = findViewById<NestedScrollView>(R.id.sv)
                sv.scrollTo(0, sv.bottom)
            }
        }
    }

    private fun copyTextToClipboard() {
        val textToCopy = findViewById<TextView>(R.id.log_message).text
        val clipboardManager = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clipData = ClipData.newPlainText("text", textToCopy)
        clipboardManager.setPrimaryClip(clipData)
        Toast.makeText(this, "Text copied to clipboard", Toast.LENGTH_LONG).show()
    }
    override fun onDestroy() {
        super.onDestroy()
        finish()
    }

    override fun onBackPressed() {
        super.onBackPressed()
        finish()
    }
}