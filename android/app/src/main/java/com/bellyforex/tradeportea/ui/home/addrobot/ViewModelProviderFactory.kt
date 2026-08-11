package com.bellyforex.tradeportea.ui.home.addrobot

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.bellyforex.tradeportea.repository.RTRepository

class ViewModelProviderFactory(
    private val rtRepository: RTRepository
): ViewModelProvider.Factory {

    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return AddRobotViewModel(rtRepository) as T
    }
}