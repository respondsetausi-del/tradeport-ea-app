package com.bellyforex.tradeportea.utils

import android.annotation.SuppressLint
import java.text.SimpleDateFormat
import java.util.*

@SuppressLint("SimpleDateFormat")
fun convert(dateTime: String?) : String?{

    if (dateTime!=null) {
        val parser = SimpleDateFormat("yyyy-MM-dd' 'HH:mm:ss")
        val formatterD = SimpleDateFormat("EEE, d MMM yyyy")
        val formatterT = SimpleDateFormat("h:mm a")

        val currentDate = formatterD.format(Date())
        val date = formatterD.format(parser.parse(dateTime)!!)
        val time = formatterT.format(parser.parse(dateTime)!!)

        val cal = Calendar.getInstance()
        cal.add(Calendar.DATE, -1)
        val yesterday = formatterD.format(cal.time)

        when(date){
            currentDate -> return "Today "+time
            yesterday -> return "Yesterday " + time
            else -> return date.toString()+" "+time.toString()
        }
    }
    return "Not Set"
}
