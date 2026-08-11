package com.bellyforex.tradeportea.utils

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Log
import kotlin.math.PI
import kotlin.math.sin

/**
 * SoundManager — Synthesized reactor-style activation sound.
 *
 * Generates a short (~1.2s) ascending power-up tone sequence programmatically.
 * No audio files required — pure math-generated waveform.
 *
 * Sound profile: low rumble → ascending sweep → bright confirmation ping
 */
object SoundManager {

    private const val TAG = "SoundManager"
    private const val SAMPLE_RATE = 44100

    private var reactorSamples: ShortArray? = null
    private var isInitialized = false

    /**
     * Pre-generate the reactor sound waveform so playback is instant.
     */
    fun init(context: Context) {
        if (isInitialized) return
        try {
            reactorSamples = generateReactorSound()
            isInitialized = true
            Log.d(TAG, "SoundManager initialized — reactor sound generated")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize SoundManager: ${e.message}")
        }
    }

    /**
     * Play the reactor activation sound on a background thread.
     */
    fun playReactorActivate() {
        val samples = reactorSamples ?: return
        Thread {
            try {
                val bufferSize = samples.size * 2 // 16-bit = 2 bytes per sample
                val audioTrack = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_GAME)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build()
                    )
                    .setBufferSizeInBytes(bufferSize)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build()

                audioTrack.write(samples, 0, samples.size)
                audioTrack.play()

                // Wait for playback to finish, then release
                val durationMs = (samples.size.toLong() * 1000) / SAMPLE_RATE
                Thread.sleep(durationMs + 100)
                audioTrack.stop()
                audioTrack.release()
            } catch (e: Exception) {
                Log.e(TAG, "Error playing reactor sound: ${e.message}")
            }
        }.start()
    }

    /**
     * Generate the reactor activation waveform.
     *
     * Single smooth arc — system power-on feel:
     *   0.0–1.6s: Continuous slow rise from deep hum (50Hz) to bright whine (600Hz)
     *             Volume builds from silence to peak then tapers off naturally.
     *             Layered harmonics thin out as frequency rises for clean top-end.
     */
    private fun generateReactorSound(): ShortArray {
        val totalDuration = 1.6f // seconds
        val totalSamples = (SAMPLE_RATE * totalDuration).toInt()
        val samples = ShortArray(totalSamples)

        // Use phase accumulator for smooth continuous frequency sweep (no clicks)
        var phase = 0.0

        for (i in 0 until totalSamples) {
            val t = i.toFloat() / SAMPLE_RATE
            val progress = t / totalDuration // 0.0 → 1.0

            // Frequency: slow exponential rise — 50Hz → 600Hz
            // Cubic curve so it sits low longer and rises late, like a turbine spooling
            val freq = 50f + (550f * progress * progress * progress)

            // Volume envelope: fade in → sustain → fade out
            // Peaks around 70% through, then gentle tail-off
            val envelope = when {
                progress < 0.08f -> progress / 0.08f                       // quick fade in
                progress < 0.75f -> 1.0f                                   // sustain
                else -> (1.0f - progress) / 0.25f                          // fade out
            } * 0.7f // master volume

            // Accumulate phase for click-free frequency transitions
            phase += 2.0 * PI * freq / SAMPLE_RATE

            // Harmonic mix: rich at low freq, cleaner as it rises
            val harmonicMix = (1.0f - progress * 0.7f).coerceIn(0f, 1f)
            val sample = envelope * (
                0.55f * sin(phase).toFloat() +
                0.25f * harmonicMix * sin(phase * 2.0).toFloat() +  // octave
                0.12f * harmonicMix * sin(phase * 3.0).toFloat() +  // fifth
                0.08f * harmonicMix * sin(phase * 0.5).toFloat()    // sub-octave rumble
            )

            val clamped = (sample * Short.MAX_VALUE).toInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            samples[i] = clamped.toShort()
        }

        return samples
    }

    fun release() {
        reactorSamples = null
        isInitialized = false
    }
}
