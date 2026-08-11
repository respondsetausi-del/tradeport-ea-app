package com.bellyforex.tradeportea.ui.home.assets.types

import android.os.Bundle
import androidx.fragment.app.Fragment
import android.view.View
import android.widget.TextView
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.adapters.SymbolsAdapter
import com.bellyforex.tradeportea.network.module.Licence
import com.bellyforex.tradeportea.ui.HomeActivity
import com.bellyforex.tradeportea.ui.home.addrobot.AddRobotViewModel
import com.bellyforex.tradeportea.ui.home.assets.AssetsViewModel
import com.bellyforex.tradeportea.ui.theme.ThemeUtils

class AllowedAssetsFragment : Fragment(R.layout.fragment_allowed_assets) {
    private lateinit var assetsViewModel: AssetsViewModel
    private lateinit var addRobotViewModel : AddRobotViewModel

    private lateinit var symbolsAdapter: SymbolsAdapter
    var sLicence: Licence? = null
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecycler(view)
        
        // Apply global theme
        ThemeUtils.setupThemeForFragment(viewLifecycleOwner, view)

        assetsViewModel = (activity as HomeActivity).assetsViewModel
        addRobotViewModel = (activity as HomeActivity).addRobotViewModel

        addRobotViewModel.getSelectedLicences().observe(this,{
            if(it.isNotEmpty()){
                val li = it[0]
                val licence = Licence(li.ea_name,li.ea_notification, li.expires, li.key, li.owner, li.phone_secret_key, li.status, li.user)

                sLicence = licence

                assetsViewModel.getSavedSymbols(licence.phone_secret_key).observe(viewLifecycleOwner,{
                    if (it.isNotEmpty())
                    {
                        view.findViewById<TextView>(R.id.emptytext).visibility = View.GONE
                        symbolsAdapter.differ.submitList(it.asReversed())
                    }else{
                        view.findViewById<TextView>(R.id.emptytext).visibility = View.VISIBLE
                        symbolsAdapter.differ.submitList(it)
                    }
                })

            }
        })

        symbolsAdapter.setOnItemClickListener {
            val bundle= Bundle()
            bundle.putSerializable("symbol",it)
            findNavController().navigate(R.id.action_assetsFragment_to_editAssetFragment, bundle)
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