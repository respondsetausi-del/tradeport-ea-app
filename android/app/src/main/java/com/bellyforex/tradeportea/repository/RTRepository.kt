package com.bellyforex.tradeportea.repository

import com.bellyforex.tradeportea.network.api.RetrofitInstance
import com.bellyforex.tradeportea.network.db.LicenceDB
import com.bellyforex.tradeportea.network.module.AuthBody
import com.bellyforex.tradeportea.network.module.CheckEmailRequest
import com.bellyforex.tradeportea.network.module.Licence
import com.bellyforex.tradeportea.network.module.Sicence
import com.bellyforex.tradeportea.network.module.Signal
import com.bellyforex.tradeportea.network.module.Symbol
import com.bellyforex.tradeportea.network.module.log


class RTRepository(
    private val db : LicenceDB
) {
    suspend fun authenticate(authBody: AuthBody)=
        RetrofitInstance.api.authenticate(authBody = authBody)

    suspend fun getSignals(authBody: AuthBody)=
        RetrofitInstance.api.getSignals(authBody.phone_secret)

    suspend fun getSymbols(authBody: AuthBody)=
        RetrofitInstance.api.getSymbols(authBody.phone_secret)

    // Broker symbol universe from the connected MT5 account (Api2Trade
    // SymbolList via the Bun backend), keyed by the session UUID.
    suspend fun getMt5Symbols(uuid: String) =
        RetrofitInstance.mt5Api.symbols(uuid)

    suspend fun getApp(email:String?, use:Boolean?)= RetrofitInstance.api.getApp(email, use)

    // Device-binding auth check against the Bun backend on Render.
    suspend fun checkEmail(req: CheckEmailRequest) =
        RetrofitInstance.authApi.checkEmail(req)

    //database functions
    suspend fun upsetLicence(licence: Licence) =
        db.getLicenceDao().upsert(licence)

     fun getLicences() =
        db.getLicenceDao().getDBLicences()

    suspend fun deleteLicence(licence: Licence) =
        db.getLicenceDao().deleteLicence(licence)

    //selected functions
    suspend fun upsetSel(licence: Sicence) =
        db.getLicenceDao().selectedupsert(licence)

    fun getSicences() =
        db.getLicenceDao().getSELicences()

    suspend fun deleteSicence(licence: Sicence) =
        db.getLicenceDao().deleteSicence(licence)

    //symbols functions db

    suspend fun upsetSymbol(symbol: Symbol) =
        db.getLicenceDao().upsetSymbol(symbol)

    fun getSavedSymbols(phone_secret:String) =
        db.getLicenceDao().getSavedSymbols(phone_secret)

    /*
    fun getDBSymbol(phone_secret:String, name: String) =
        db.getLicenceDao().getDBSymbol(phone_secret, name)*/

    suspend fun deleteSymbol(symbol: Symbol) =
        db.getLicenceDao().deleteSymbol(symbol)

    suspend fun deleteAllSymbol(phone_secret:String) =
        db.getLicenceDao().deleteAllSymbol(phone_secret)

    //for signals

    suspend fun saveSignals(signal: Signal) =
        db.getLicenceDao().saveSignals(signal)

    suspend fun updateSignals(signal: Signal) =
        db.getLicenceDao().updateSignals(signal)

     fun getDBSignals() =
        db.getLicenceDao().getDBSignals()

    suspend fun deleteSignals() =
        db.getLicenceDao().deleteSignals()

    //for log

    suspend fun upsetLog(log: log) =
        db.getLicenceDao().upSetLog(log)

    fun getDBLogs() =
        db.getLicenceDao().getDBLogs()

    suspend fun deleteLogs() =
        db.getLicenceDao().deleteLogs()
}