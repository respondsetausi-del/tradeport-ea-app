package com.bellyforex.tradeportea.ui.home.addrobot

import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bellyforex.tradeportea.network.module.Account
import com.bellyforex.tradeportea.network.module.AuthBody
import com.bellyforex.tradeportea.network.module.Licence
import com.bellyforex.tradeportea.network.module.Sicence
import com.bellyforex.tradeportea.repository.RTRepository
import com.bellyforex.tradeportea.utils.Resource
import kotlinx.coroutines.launch
import retrofit2.Response

class AddRobotViewModel( private val rtRepository: RTRepository
) : ViewModel() {

    val accountData: MutableLiveData<Resource<Account>> = MutableLiveData()


    fun authenticate(authBody: AuthBody) = viewModelScope.launch {
        accountData.postValue(Resource.Loading())
        try {
            val response = rtRepository.authenticate(authBody)
            accountData.postValue(handleAccountResponse(response))
        }catch (t: Throwable){
            accountData.postValue(Resource.Error("Oops! Something went wrong"))
        }
    }

    private fun handleAccountResponse(response: Response<Account>): Resource<Account>{
        if (response.isSuccessful){
            response.body()?.let {
                if (it.message == "used")
                    return Resource.Error("The License key is already used in another device.")
                else if (it.message == "accept"){
                    saveLicence(it.Licence)
                    saveSicence(it.Licence)
                    return Resource.Success(it)
                }

                return Resource.Error("Unknown Error Occurred!!")
            }
        }
        return Resource.Error(response.message())
    }

    //database functions
    private fun saveLicence(licence: Licence) = viewModelScope.launch {
        rtRepository.upsetLicence(licence)
    }

    fun getLicences() = rtRepository.getLicences()

    fun deleteLicence(licence: Licence)  = viewModelScope.launch {
        rtRepository.deleteLicence(licence)
    }
    fun deleteSicence(licence: Licence)  = viewModelScope.launch {
        var sicence = Sicence(licence.ea_name,licence.ea_notification, licence.expires, licence.key, licence.owner, licence.phone_secret_key, licence.status, licence.user)
        rtRepository.deleteSicence(sicence)
    }

    //selected functions
    private fun saveSicence(licence: Licence) = viewModelScope.launch {
        var sicence = Sicence(licence.ea_name, licence.ea_notification,licence.expires, licence.key, licence.owner, licence.phone_secret_key, licence.status, licence.user)
        rtRepository.upsetSel(sicence)
    }

    fun getSelectedLicences() = rtRepository.getSicences()


}