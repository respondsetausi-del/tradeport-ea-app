package com.bellyforex.tradeportea.utils

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

object TTSManager : TextToSpeech.OnInitListener {
    private var tts: TextToSpeech? = null
    private var isInitialized = false
    private var pendingMessage: String? = null
    
    fun init(context: Context) {
        if (tts == null) {
            tts = TextToSpeech(context.applicationContext, this)
        }
    }
    
    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            val result = tts?.setLanguage(Locale.US)
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.e("TTSManager", "Language not supported")
            } else {
                isInitialized = true
                // Set speech rate slightly faster for more dynamic feel
                tts?.setSpeechRate(1.0f)
                tts?.setPitch(1.0f)
                
                // Speak pending message if any
                pendingMessage?.let {
                    speak(it)
                    pendingMessage = null
                }
                Log.d("TTSManager", "TTS initialized successfully")
            }
        } else {
            Log.e("TTSManager", "TTS initialization failed")
        }
    }
    
    fun speak(message: String) {
        if (isInitialized && tts != null) {
            tts?.speak(message, TextToSpeech.QUEUE_FLUSH, null, message.hashCode().toString())
        } else {
            // Queue message to speak after initialization
            pendingMessage = message
            Log.d("TTSManager", "TTS not ready, queuing message: $message")
        }
    }
    
    fun speakQueue(message: String) {
        if (isInitialized && tts != null) {
            tts?.speak(message, TextToSpeech.QUEUE_ADD, null, message.hashCode().toString())
        }
    }
    
    fun stop() {
        tts?.stop()
    }
    
    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        isInitialized = false
    }
    
    // Predefined voice messages
    object Messages {
        const val WELCOME = "Welcome Master, Its time to make money"
        const val TRADING_ACTIVATED = "Trading Activated, Money Engine ON!"
        const val SIGNAL_RECEIVED = "Signal received"
        const val OPENING_TRADE = "Opening trade"
        const val TRADE_COMPLETED = "Trade completed successfully"
        const val TRADING_FAILED = "Trading failed"
        const val TRADE_IN_PROGRESS = "Automated trading in progress, please do not use your phone"
    }
}
