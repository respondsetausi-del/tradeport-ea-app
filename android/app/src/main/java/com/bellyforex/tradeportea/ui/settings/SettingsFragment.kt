package com.bellyforex.tradeportea.ui.settings

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.ui.HomeActivity
import com.bellyforex.tradeportea.ui.theme.ThemeUtils

class SettingsFragment : Fragment(R.layout.fragment_settings) {

    private val videoOptions = arrayOf("None", "Video 1", "Video 2", "Video 3", "Video 4", "Video 5", "Video 6", "Video 7", "Custom Video")
    private val videoKeys = arrayOf("none", "video1", "video2", "video3", "video4", "video5", "video6", "video7", "custom")

    private val shapeOptions = arrayOf("Rounded Square", "Circle")
    private val shapeKeys = arrayOf("square", "circle")

    private val videoPickerLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.data?.let { uri ->
                // Take persistable read permission so the URI survives reboots
                try {
                    requireContext().contentResolver.takePersistableUriPermission(
                        uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                } catch (_: Exception) {}

                val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
                prefs.edit()
                    .putString("custom_video_uri", uri.toString())
                    .putString("selected_video", "custom")
                    .putBoolean("video_background_enabled", true)
                    .apply()

                (activity as? HomeActivity)?.applyVideoBackgroundState("custom")
            }
        }
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        // Apply global theme
        val rootView = view.findViewById<View>(R.id.settings_root) ?: view
        ThemeUtils.setupThemeForFragment(viewLifecycleOwner, rootView)

        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val spinner = view.findViewById<Spinner>(R.id.spinner_video_background)
        val btnChooseVideo = view.findViewById<Button>(R.id.btn_choose_video)

        // Custom adapter with white text for glass theme
        val adapter = object : ArrayAdapter<String>(requireContext(), android.R.layout.simple_spinner_item, videoOptions) {
            override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup): View {
                val v = super.getView(position, convertView, parent)
                (v as? TextView)?.setTextColor(0xFFFFFFFF.toInt())
                return v
            }

            override fun getDropDownView(position: Int, convertView: View?, parent: android.view.ViewGroup): View {
                val v = super.getDropDownView(position, convertView, parent)
                (v as? TextView)?.apply {
                    setTextColor(0xFFFFFFFF.toInt())
                    setBackgroundColor(0xE6121212.toInt())
                }
                return v
            }
        }
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinner.adapter = adapter

        // Read saved selection with backward compat
        val selectedVideo = prefs.getString("selected_video", null)
            ?: if (prefs.getBoolean("video_background_enabled", false)) "video1" else "none"

        val selectedIndex = videoKeys.indexOf(selectedVideo).coerceAtLeast(0)
        spinner.setSelection(selectedIndex)

        // Show button if custom is already selected
        btnChooseVideo.visibility = if (selectedVideo == "custom") View.VISIBLE else View.GONE

        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                // Tint spinner text white after selection
                (view as? TextView)?.setTextColor(0xFFFFFFFF.toInt())

                val videoKey = videoKeys[position]

                // Show/hide the choose video button
                if (videoKey == "custom") {
                    btnChooseVideo.visibility = View.VISIBLE
                    // Auto-launch picker if no custom URI saved yet
                    val existingUri = prefs.getString("custom_video_uri", null)
                    if (existingUri.isNullOrEmpty()) {
                        launchVideoPicker()
                    }
                } else {
                    btnChooseVideo.visibility = View.GONE
                }

                prefs.edit()
                    .putString("selected_video", videoKey)
                    .putBoolean("video_background_enabled", videoKey != "none")
                    .apply()
                (activity as? HomeActivity)?.applyVideoBackgroundState(videoKey)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        btnChooseVideo.setOnClickListener {
            launchVideoPicker()
        }

        // ── Robot Image Shape ──
        val shapeSpinner = view.findViewById<Spinner>(R.id.spinner_robot_shape)

        val shapeAdapter = object : ArrayAdapter<String>(requireContext(), android.R.layout.simple_spinner_item, shapeOptions) {
            override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup): View {
                val v = super.getView(position, convertView, parent)
                (v as? TextView)?.setTextColor(0xFFFFFFFF.toInt())
                return v
            }

            override fun getDropDownView(position: Int, convertView: View?, parent: android.view.ViewGroup): View {
                val v = super.getDropDownView(position, convertView, parent)
                (v as? TextView)?.apply {
                    setTextColor(0xFFFFFFFF.toInt())
                    setBackgroundColor(0xE6121212.toInt())
                }
                return v
            }
        }
        shapeAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        shapeSpinner.adapter = shapeAdapter

        val savedShape = prefs.getString("robot_image_shape", "square") ?: "square"
        shapeSpinner.setSelection(shapeKeys.indexOf(savedShape).coerceAtLeast(0))

        shapeSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                (view as? TextView)?.setTextColor(0xFFFFFFFF.toInt())
                prefs.edit().putString("robot_image_shape", shapeKeys[position]).apply()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun launchVideoPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "video/*"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        videoPickerLauncher.launch(intent)
    }
}
