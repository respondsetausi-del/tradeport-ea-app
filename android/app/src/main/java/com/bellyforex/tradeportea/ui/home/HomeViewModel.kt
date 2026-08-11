package com.bellyforex.tradeportea.ui.home

import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bellyforex.tradeportea.ControlService
import com.bellyforex.tradeportea.network.module.App
import com.bellyforex.tradeportea.network.module.CheckEmailRequest
import com.bellyforex.tradeportea.network.module.CheckEmailResponse
import com.bellyforex.tradeportea.repository.RTRepository
import com.bellyforex.tradeportea.utils.Resource
import kotlinx.coroutines.launch
import retrofit2.Response

class HomeViewModel(private val rtRepository: RTRepository) : ViewModel() {

    val tradingInProgress : MutableLiveData<Boolean> = MutableLiveData()
    val app : MutableLiveData<Resource<App>> = MutableLiveData()
    val checkEmail : MutableLiveData<Resource<CheckEmailResponse>> = MutableLiveData()

    fun getTradingStatus(mService : ControlService) = viewModelScope.launch {
        mService.getStatus().collect {
            tradingInProgress.postValue(it)
        }
    }

    fun getApp(email: String?, use:Boolean?) = viewModelScope.launch {
        app.postValue(Resource.Loading())
        try {
            app.postValue(handleappresponse(rtRepository.getApp(email,use)))
        }catch (t: Throwable)
        {
            app.postValue(Resource.Error("something went wrong "+t.toString()))
        }
    }
    private fun handleappresponse(res : Response<App>): Resource<App>{
        if (res.isSuccessful){
            res.body()?.let {
                return Resource.Success(it)
            }
        }
        return Resource.Error("something went wrong ")
    }

    // Device-binding subscription check against Bun /api/check-email.
    // All auth-state decisions (accept/expired/device_mismatch) come from
    // this call; getApp() is kept only for the forced-update version check.
    fun checkEmail(email: String, mentor: String, deviceId: String) = viewModelScope.launch {
        checkEmail.postValue(Resource.Loading())
        try {
            val req = CheckEmailRequest(email = email, mentor = mentor, deviceId = deviceId)
            val res = rtRepository.checkEmail(req)
            if (res.isSuccessful && res.body() != null) {
                checkEmail.postValue(Resource.Success(res.body()!!))
            } else {
                checkEmail.postValue(Resource.Error("Authentication failed (${res.code()})"))
            }
        } catch (t: Throwable) {
            checkEmail.postValue(Resource.Error("Network error: ${t.message}"))
        }
    }
}
