package com.bellyforex.tradeportea.network.db

import android.content.Context
import androidx.room.*

import org.json.JSONObject
import androidx.sqlite.db.SupportSQLiteDatabase

import androidx.room.migration.Migration
import com.bellyforex.tradeportea.network.module.*


@Database(
    entities = [Licence::class, Sicence::class, Symbol::class, Signal::class, log::class],
    version = 4,
    exportSchema = false
)
@TypeConverters(OwnerTypeConverter::class)
abstract class LicenceDB : RoomDatabase() {

    abstract fun getLicenceDao(): LicenceDao

    companion object{
        @Volatile
        private var instance: LicenceDB? =null
        private val LOCK = Any()

        operator fun invoke(context: Context) = instance?: synchronized(LOCK){
            instance?: createDatabase(context).also { instance = it }
        }

        private val MIGRATION_2_3: Migration = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS " +
                            "signals (id INTEGER NOT NULL, " +
                            "action TEXT NOT NULL," +
                            "asset TEXT NOT NULL," +
                            "latestupdate TEXT NOT NULL," +
                            "price TEXT NOT NULL," +
                            "sl TEXT NOT NULL," +
                            "time TEXT NOT NULL," +
                            "tp TEXT NOT NULL," +
                            "lotSize DOUBLE NULL," +
                            "platform TEXT NULL," +
                            "used INTEGER NOT NULL," +
                            "PRIMARY KEY(id))"
                )
            }
        }

        private val MIGRATION_3_4: Migration = object : Migration(3, 4) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS " +
                            "log (id INTEGER NOT NULL, " +
                            "message TEXT NOT NULL," +
                            "PRIMARY KEY(id))"
                )
            }
        }

        private fun createDatabase(context: Context) =
            Room.databaseBuilder(
                context.applicationContext,
                LicenceDB::class.java,
                "licences_db"
            ).addMigrations(MIGRATION_2_3).addMigrations(MIGRATION_3_4).build()
    }

}
class OwnerTypeConverter {
    @TypeConverter
    fun fromOwner(owner: Owner): String {
        return JSONObject().apply {
            put("name", owner.name)
            put("email", owner.email)
            put("phone", owner.phone)
            put("logo", owner.logo)
        }.toString()
    }

    @TypeConverter
    fun toOwner(owner: String): Owner {
        val json = JSONObject(owner)
        return Owner(
            json.get("email") as String,
            json.get("name") as String,
            json.get("phone") as String,
            json.get("logo") as String
        )
    }
}