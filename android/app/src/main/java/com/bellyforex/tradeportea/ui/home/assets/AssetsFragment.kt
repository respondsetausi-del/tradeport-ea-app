package com.bellyforex.tradeportea.ui.home.assets

import android.os.Bundle
import android.view.View
import android.widget.ImageButton
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentPagerAdapter
import androidx.navigation.fragment.findNavController
import androidx.viewpager.widget.ViewPager
import com.google.android.material.tabs.TabLayout
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.adapters.ViewPagerAdapter
import com.bellyforex.tradeportea.ui.HomeActivity
import com.bellyforex.tradeportea.ui.home.addrobot.AddRobotViewModel
import com.bellyforex.tradeportea.ui.home.assets.types.AllAssetsFragment
import com.bellyforex.tradeportea.ui.home.assets.types.AllowedAssetsFragment
import com.bellyforex.tradeportea.ui.theme.ThemeUtils

class AssetsFragment : Fragment(R.layout.assets_fragment) {

    private lateinit var tableLayout: TabLayout
    private lateinit var viewPager: ViewPager
    private lateinit var viewPagerAdapter: ViewPagerAdapter
    private lateinit var addRobotViewModel : AddRobotViewModel


    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        addRobotViewModel = (activity as HomeActivity).addRobotViewModel
        back(view)
        
        // Apply global theme
        ThemeUtils.setupThemeForFragment(viewLifecycleOwner, view)
        tableLayout = view.findViewById(R.id.tab_layout)
        viewPager = view.findViewById(R.id.view_pager)
        tableLayout.setupWithViewPager(viewPager)

        viewPagerAdapter = ViewPagerAdapter(childFragmentManager, FragmentPagerAdapter.BEHAVIOR_RESUME_ONLY_CURRENT_FRAGMENT)
        viewPagerAdapter.addFragment(AllowedAssetsFragment(),"Allowed Symbols")
        viewPagerAdapter.addFragment(AllAssetsFragment(),"All Symbols")
        viewPager.adapter = viewPagerAdapter

        addRobotViewModel.getSelectedLicences().observe(this,{
            if(it.isNotEmpty()){
                val li = it[0]
                view.findViewById<TextView>(R.id.top_text).text = li.ea_name
            }
        })


    }
    private fun back(view: View)
    {
        view.findViewById<ImageButton>(R.id.backbtn).setOnClickListener {
            findNavController().popBackStack()
        }
    }

}