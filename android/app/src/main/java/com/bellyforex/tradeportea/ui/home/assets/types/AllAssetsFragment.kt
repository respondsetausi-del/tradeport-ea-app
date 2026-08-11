package com.bellyforex.tradeportea.ui.home.assets.types

import android.app.AlertDialog
import android.app.ProgressDialog
import android.content.Context
import android.os.Bundle
import androidx.fragment.app.Fragment
import android.view.View
import android.view.View.GONE
import android.view.View.VISIBLE
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.adapters.SymbolsAdapter
import com.bellyforex.tradeportea.network.module.AuthBody
import com.bellyforex.tradeportea.network.module.Licence
import com.bellyforex.tradeportea.network.module.Symbol
import com.bellyforex.tradeportea.ui.HomeActivity
import com.bellyforex.tradeportea.ui.home.addrobot.AddRobotViewModel
import com.bellyforex.tradeportea.ui.home.assets.AssetsViewModel
import com.bellyforex.tradeportea.utils.Resource
import com.bellyforex.tradeportea.ui.theme.ThemeUtils


class AllAssetsFragment : Fragment(R.layout.fragment_all_assets) {

    private lateinit var assetsViewModel: AssetsViewModel
    private lateinit var addRobotViewModel : AddRobotViewModel

    var sLicence: Licence? = null

    private lateinit var symbolsAdapter: SymbolsAdapter
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecycler(view)
        assetsViewModel = (activity as  HomeActivity).assetsViewModel
        
        // Apply global theme
        ThemeUtils.setupThemeForFragment(viewLifecycleOwner, view)
        addRobotViewModel = (activity as HomeActivity).addRobotViewModel

        // The licence is still needed for the phone_secret_key when a symbol
        // is picked, but the symbol universe itself comes from the connected
        // MT5 account (Api2Trade SymbolList), not the PHP backend.
        addRobotViewModel.getSelectedLicences().observe(this,{
            if(it.isNotEmpty()){
                val li = it[0]
                val licence = Licence(li.ea_name,li.ea_notification, li.expires, li.key, li.owner, li.phone_secret_key, li.status, li.user)

                sLicence = licence
            }
        })
        loadMt5Symbols(view)
        val builder = AlertDialog.Builder(context)
        var dialog: ProgressDialog? = null
        assetsViewModel.symbolsData.observe(viewLifecycleOwner,{

            when(it) {
                is Resource.Loading -> {
                    dialog?.dismiss()
                    dialog = ProgressDialog.show(context, "Loading", "Please wait...", true)
                    view.findViewById<LinearLayout>(R.id.error_note).visibility = GONE
                }
                is Resource.Error -> {

                    dialog?.dismiss()
                    view.findViewById<TextView>(R.id.error_text).text =
                        it.message ?: "Error Occurred, please reload"
                    view.findViewById<LinearLayout>(R.id.error_note).visibility = VISIBLE
                    view.findViewById<Button>(R.id.reload_button).setOnClickListener {
                        loadMt5Symbols(view)
                    }
                }
                is Resource.Success -> {
                    dialog?.dismiss()
                    view.findViewById<LinearLayout>(R.id.error_note).visibility = GONE
                    if (it.data?.symbols!!.isNotEmpty()) {
                        symbolsAdapter.differ.submitList(it.data?.symbols)
                    }
                }
            }
        })


        symbolsAdapter.setOnItemClickListener {

            val symbol = Symbol(it.id,it.name,sLicence!!.phone_secret_key,null,null,null)
            val bundle= Bundle()
            bundle.putSerializable("symbol",symbol)

            findNavController().navigate(R.id.action_assetsFragment_to_editAssetFragment,bundle)
        }
    }
    /**
     * Symbols come from the connected MT5 account so users pick the broker's
     * exact symbol names (e.g. XAUUSD.mic). Without a connected account there
     * is nothing to list — prompt the user to link one first.
     */
    private fun loadMt5Symbols(view: View) {
        val mt5Pref = requireContext().applicationContext.getSharedPreferences("mt5", Context.MODE_PRIVATE)
        val uuid = mt5Pref.getString("uuid", null)
        val connected = mt5Pref.getBoolean("logged", false) && !uuid.isNullOrEmpty()

        if (connected) {
            assetsViewModel.getMt5Symbols(uuid!!)
        } else {
            view.findViewById<TextView>(R.id.error_text).text =
                "Connect your MT5 account on the Metatrader page to load its symbols."
            view.findViewById<LinearLayout>(R.id.error_note).visibility = VISIBLE
            view.findViewById<Button>(R.id.reload_button).setOnClickListener {
                loadMt5Symbols(view)
            }
        }
    }

    private fun setupRecycler(view: View){

        val searchResultsRecyclerview= view.findViewById<RecyclerView>(R.id.symbols_recyclerView)
        symbolsAdapter = SymbolsAdapter()
        searchResultsRecyclerview.layoutManager =  LinearLayoutManager(context,
            LinearLayoutManager.VERTICAL,false)
        searchResultsRecyclerview.hasFixedSize()
        searchResultsRecyclerview.adapter = symbolsAdapter

    }
}