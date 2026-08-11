package com.bellyforex.tradeportea.ui.home.assets.edit


import android.os.Bundle
import android.view.View
import android.view.View.GONE
import android.view.View.VISIBLE
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.network.module.Symbol
import com.bellyforex.tradeportea.ui.HomeActivity
import com.bellyforex.tradeportea.ui.home.assets.AssetsViewModel
import com.bellyforex.tradeportea.ui.theme.ThemeUtils


class EditAssetFragment : Fragment(R.layout.fragment_edit_asset) {
    private lateinit var assetsViewModel: AssetsViewModel


    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        back(view)
        
        // Apply global theme
        ThemeUtils.setupThemeForFragment(viewLifecycleOwner, view)
        
        val symbol= arguments?.getSerializable("symbol") as Symbol
        assetsViewModel = (activity as HomeActivity).assetsViewModel

        // Action and platform are fixed (BOTH on MT5) and their fields are
        // hidden in the layout; only lot size and number of trades are edited.
        val lot = view.findViewById(R.id.outlined_edit_text) as EditText
        val ntr = view.findViewById(R.id.outlined_edit_text_4) as EditText


        if(symbol.lotSize != null){
            lot.setText(symbol.lotSize.toString())
        }
        if (symbol.platform != null) {
            val platformDetails = symbol.platform.toString().trim().split(":")
            if (platformDetails.size == 2) {
                ntr.setText(platformDetails[1].uppercase())
            }
        }


        view.findViewById<TextView>(R.id.top_text).text = symbol.name


        view.findViewById<Button>(R.id.submit).setOnClickListener {



            if(lot.text.isNotEmpty())
            {
                // Comma-safe lot: locale keyboards enter "0,10" which would
                // crash toDouble(); normalise to a dot first.
                val lotValue = lot.text.toString().trim().replace(',', '.').toDoubleOrNull()
                if (lotValue != null && lotValue > 0)
                {
                    val numTradesValue = ntr.text.toString().trim().ifEmpty { "1" }
                    val saveThis = Symbol(symbol.id,symbol.name,symbol.phone_secret,lotValue,"BOTH","MT5:${numTradesValue}")

                    assetsViewModel.saveSymbol(saveThis)

                    Toast.makeText(context, "Symbol Saved!", Toast.LENGTH_SHORT).show()

                    findNavController().popBackStack()
                }else
                {
                    Toast.makeText(context,"Enter a valid Lot Size. Eg: 0.01",Toast.LENGTH_SHORT).show()
                }
            }else
            {
                Toast.makeText(context,"Lot Size cannot be empty",Toast.LENGTH_SHORT).show()
            }
        }

        view.findViewById<Button>(R.id.submit).apply {
            // Always show submit button so users can add new symbols AND update existing ones
            visibility = VISIBLE
        }


        view.findViewById<ImageButton>(R.id.delete_symbol).apply {
            if (symbol.lotSize != null){
                visibility=VISIBLE
            }else
            {
                visibility= GONE
            }

            setOnClickListener {
                assetsViewModel.deleteSymbol(symbol)

                Toast.makeText(context,"Symbol will no long be traded.",Toast.LENGTH_SHORT).show()
                findNavController().popBackStack()
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