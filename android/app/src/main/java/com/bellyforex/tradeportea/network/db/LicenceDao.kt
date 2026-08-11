package com.bellyforex.tradeportea.network.db

import androidx.lifecycle.LiveData
import androidx.room.*
import com.bellyforex.tradeportea.network.module.*

@Dao
interface LicenceDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(licence: Licence): Long

    @Query("SELECT * FROM licences")
    fun getDBLicences(): LiveData<List<Licence>>

    @Delete
    suspend fun deleteLicence(licence: Licence)

    //for saved licences
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun selectedupsert(licence: Sicence): Long

    @Query("SELECT * FROM sicences")
    fun getSELicences(): LiveData<List<Sicence>>

    @Delete
    suspend fun deleteSicence(licence: Sicence)

    //for Symbols

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsetSymbol(symbol: Symbol) : Long

    @Query("SELECT * FROM symbols WHERE phone_secret= :phone_secret")
    fun getSavedSymbols(phone_secret:String): LiveData<List<Symbol>>

    /*
    @Query("SELECT * FROM symbols WHERE phone_secret=phone_secret AND name=name")
    fun getDBSymbol(phone_secret:String, name: String): LiveData<Symbol>
    */
    @Delete
    suspend fun deleteSymbol(symbol: Symbol)

    @Query("DELETE FROM symbols WHERE phone_secret= :phone_secret")
    suspend fun deleteAllSymbol(phone_secret: String)

    //for signals

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun saveSignals(signal: Signal): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun updateSignals(signal: Signal): Long

    @Query("SELECT * FROM signals")
    fun getDBSignals(): LiveData<List<Signal>>

    @Query("DELETE FROM signals")
    suspend fun deleteSignals()

    //log
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upSetLog(log: log): Long

    @Query("SELECT * FROM log")
    fun getDBLogs(): LiveData<List<log>>

    @Query("DELETE FROM log")
    suspend fun deleteLogs()


}