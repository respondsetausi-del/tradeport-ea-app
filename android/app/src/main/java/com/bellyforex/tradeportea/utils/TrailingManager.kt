package com.bellyforex.tradeportea.utils

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.bellyforex.tradeportea.network.module.Signal
import com.bellyforex.tradeportea.repository.RTRepository
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch

/**
 * TrailingManager monitors signal SL/TP changes and triggers modifications
 * when the signal's SL or TP values are updated.
 */
object TrailingManager {
    private const val TAG = "TrailingManager"
    private const val POLL_INTERVAL_MS = 5000L // Check every 5 seconds
    
    private var isRunning = false
    private var handler: Handler? = null
    private var lastSignalSL: String? = null
    private var lastSignalTP: String? = null
    private var lastSignalId: Int? = null
    private var currentAsset: String? = null
    
    // Callback for when SL/TP changes are detected
    var onSLTPChanged: ((newSL: String, newTP: String, asset: String) -> Unit)? = null
    
    fun startTrailing(signal: Signal) {
        if (isRunning) {
            Log.d(TAG, "Trailing already running, updating signal")
        }
        
        lastSignalId = signal.id
        lastSignalSL = signal.sl
        lastSignalTP = signal.tp
        currentAsset = signal.asset
        
        isRunning = true
        handler = Handler(Looper.getMainLooper())
        
        Log.d(TAG, "Started trailing for ${signal.asset} - SL: ${signal.sl}, TP: ${signal.tp}")
        // Voice removed per user request
        
        startPolling()
    }
    
    private fun startPolling() {
        handler?.postDelayed(object : Runnable {
            override fun run() {
                if (!isRunning) return
                
                // This will be called by ControlService when new signal data arrives
                Log.d(TAG, "Polling for SL/TP changes...")
                
                handler?.postDelayed(this, POLL_INTERVAL_MS)
            }
        }, POLL_INTERVAL_MS)
    }
    
    /**
     * Called by ControlService when a signal update is received
     * Checks if SL or TP has changed and triggers modification
     */
    fun checkSignalUpdate(newSignal: Signal) {
        if (!isRunning) return
        if (newSignal.asset != currentAsset) return
        
        val slChanged = newSignal.sl != lastSignalSL && newSignal.sl.isNotEmpty()
        val tpChanged = newSignal.tp != lastSignalTP && newSignal.tp.isNotEmpty()
        
        if (slChanged || tpChanged) {
            Log.d(TAG, "SL/TP change detected!")
            Log.d(TAG, "Old SL: $lastSignalSL -> New SL: ${newSignal.sl}")
            Log.d(TAG, "Old TP: $lastSignalTP -> New TP: ${newSignal.tp}")
            
            // Voice removed per user request
            Log.d(TAG, "Trailing update detected")
            
            // Update stored values
            lastSignalSL = newSignal.sl
            lastSignalTP = newSignal.tp
            
            // Trigger callback
            onSLTPChanged?.invoke(newSignal.sl, newSignal.tp, newSignal.asset)
        }
    }
    
    fun stopTrailing() {
        isRunning = false
        handler?.removeCallbacksAndMessages(null)
        handler = null
        lastSignalSL = null
        lastSignalTP = null
        lastSignalId = null
        currentAsset = null
        onSLTPChanged = null
        
        Log.d(TAG, "Trailing stopped")
    }
    
    fun isTrailingActive(): Boolean = isRunning
    
    fun getCurrentAsset(): String? = currentAsset
}
