package com.bellyforex.tradeportea.ui.home.assets

import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bellyforex.tradeportea.network.module.*
import com.bellyforex.tradeportea.repository.RTRepository
import com.bellyforex.tradeportea.utils.Resource
import com.google.gson.JsonElement
import kotlinx.coroutines.launch
import retrofit2.Response

class AssetsViewModel( private val rtRepository: RTRepository
) : ViewModel() {

    val symbolsData: MutableLiveData<Resource<Symbols>> = MutableLiveData()


    fun getSymbols(authBody: AuthBody) = viewModelScope.launch {

        symbolsData.postValue(Resource.Loading())
        try {
            val response = rtRepository.getSymbols(authBody)
            symbolsData.postValue(handleSymbolsResponse(response))
        }catch (t: Throwable){
            symbolsData.postValue(Resource.Error("Oops! Something went wrong"))
        }

    }

    /**
     * Pull the broker symbol universe from the connected MT5 account
     * (Api2Trade SymbolList via the backend). Symbol names are the broker's
     * exact strings (e.g. "XAUUSD.mic") — casing must never be altered or
     * OrderSend rejects them.
     */
    fun getMt5Symbols(uuid: String) = viewModelScope.launch {
        symbolsData.postValue(Resource.Loading())
        try {
            val response = rtRepository.getMt5Symbols(uuid)
            if (!response.isSuccessful) {
                symbolsData.postValue(Resource.Error("Could not load symbols from MT5 (HTTP ${response.code()}). Try reconnecting your account."))
                return@launch
            }
            val names = parseSymbolNames(response.body())
            if (names.isEmpty()) {
                symbolsData.postValue(Resource.Error("No symbols returned from the MT5 account. Try reconnecting."))
                return@launch
            }
            val symbols = names.map { name ->
                Symbol(name.hashCode(), name, null, null, null, "mt5")
            }.toMutableList()
            symbolsData.postValue(Resource.Success(Symbols(symbols, "accept")))
        } catch (t: Throwable) {
            symbolsData.postValue(Resource.Error("Oops! Something went wrong"))
        }
    }

    // Accepts either a bare ["EURUSD", ...] array or a wrapped
    // {"symbols"/"data"/"list": [...]} object, with string or
    // {symbol/name: ...} entries.
    private fun parseSymbolNames(body: JsonElement?): List<String> {
        val array = when {
            body == null -> return emptyList()
            body.isJsonArray -> body.asJsonArray
            body.isJsonObject -> {
                val obj = body.asJsonObject
                listOf("symbols", "data", "list", "result")
                    .firstNotNullOfOrNull { key ->
                        obj.get(key)?.takeIf { it.isJsonArray }?.asJsonArray
                    } ?: return emptyList()
            }
            else -> return emptyList()
        }
        return array.mapNotNull { el ->
            when {
                el.isJsonPrimitive -> el.asString
                el.isJsonObject -> el.asJsonObject.get("symbol")?.takeIf { it.isJsonPrimitive }?.asString
                    ?: el.asJsonObject.get("name")?.takeIf { it.isJsonPrimitive }?.asString
                else -> null
            }
        }.filter { it.isNotBlank() }
    }

    private fun handleSymbolsResponse(response: Response<Symbols>): Resource<Symbols>{
        if (response.isSuccessful){
            response.body()?.let {
                if (it.message == "accept"){
                    return Resource.Success(it)
                }

                return Resource.Error("Unknown Error Occurred!!")
            }
        }
        return Resource.Error(response.message())
    }

    fun saveSymbol(symbol: Symbol) = viewModelScope.launch {
        rtRepository.upsetSymbol(symbol)
    }

    fun getSavedSymbols(phone_secret_key:String) = rtRepository.getSavedSymbols(phone_secret_key)

    fun deleteSymbol(symbol: Symbol)  = viewModelScope.launch {
        rtRepository.deleteSymbol(symbol)
    }
    fun deleteAllSymbol(phone_secret:String) = viewModelScope.launch {
        rtRepository.deleteAllSymbol(phone_secret)
    }
}