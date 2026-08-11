package com.bellyforex.tradeportea.ui.home.addrobot

import android.app.AlertDialog
import android.app.ProgressDialog
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.network.module.AuthBody
import com.bellyforex.tradeportea.ui.HomeActivity
import com.bellyforex.tradeportea.utils.Resource
import com.google.android.material.textfield.TextInputEditText
import com.bellyforex.tradeportea.ui.theme.ThemeEngine
import com.bellyforex.tradeportea.ui.theme.ThemeUtils
import com.bellyforex.tradeportea.ui.theme.WarpGlowDrawable

class AddRobotFragment : Fragment(R.layout.add_robot_fragment) {

    private lateinit var viewModel: AddRobotViewModel
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        back(view)
        viewModel = (activity as HomeActivity).addRobotViewModel

        // Apply global theme atmosphere + accent button
        val submitButton = view.findViewById<Button>(R.id.submit)
        ThemeUtils.setupThemeForFragment(viewLifecycleOwner, view, submitButton)

        // Apply neon glow to card wrapper
        val cardGlowWrapper = view.findViewById<FrameLayout>(R.id.card_glow_wrapper)
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

        view.findViewById<Button>(R.id.submit).setOnClickListener{
            val key = view.findViewById<TextInputEditText>(R.id.outlined_edit_text)
            if (key.text?.length!! > 0){
                viewModel.authenticate(AuthBody(key.text.toString(),null))

                val builder = AlertDialog.Builder(context)
                var dialog: ProgressDialog? = null
                viewModel.accountData.observe(viewLifecycleOwner) {
                    when (it) {
                        is Resource.Error -> {
                            dialog?.dismiss()
                            builder.setTitle("Error")
                            builder.setMessage(it.message.toString())
                            builder.setPositiveButton("OK") { dialog, which ->
                                dialog.dismiss()
                            }
                            val alertDialog = builder.create()
                            alertDialog.show()
                        }
                        is Resource.Loading -> {
                            dialog?.dismiss()
                            dialog = ProgressDialog.show(context, "Loading", "Please wait...", true)
                        }
                        is Resource.Success -> {
                            dialog?.dismiss()
                            builder.setTitle("Success")
                            builder.setMessage("New account is successfully added!!")
                            builder.setPositiveButton("OK") { dialog, which ->
                                dialog.dismiss()
                            }
                            val alertDialog = builder.create()
                            alertDialog.show()

                        }
                    }
                }
            }else
            {
                Toast.makeText(context,"Text Box is empty", Toast.LENGTH_SHORT).show()
            }
        }
    }
    private fun back(view: View)
    {
        view.findViewById<ImageButton>(R.id.backbtn).setOnClickListener {
            findNavController().popBackStack()
        }
    }

}
