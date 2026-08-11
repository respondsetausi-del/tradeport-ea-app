package com.bellyforex.tradeportea.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.View.GONE
import android.view.View.VISIBLE
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.AsyncListDiffer
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.network.module.Faqs

class FaqAdapter: RecyclerView.Adapter<FaqAdapter.PostViewHolder>() {

    inner class PostViewHolder(itemView: View): RecyclerView.ViewHolder(itemView)

    private val differCallback = object : DiffUtil.ItemCallback<Faqs>(){

        override fun areItemsTheSame(oldItem: Faqs, newItem: Faqs): Boolean {
            return oldItem == newItem
        }

        override fun areContentsTheSame(oldItem: Faqs, newItem: Faqs): Boolean {
            return oldItem == newItem
        }

    }

    val differ = AsyncListDiffer(this, differCallback)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PostViewHolder {
        return PostViewHolder(
            LayoutInflater.from(parent.context).inflate(
                R.layout.faq_layout,
                parent,
                false
            )
        )
    }

    override fun onBindViewHolder(holder: PostViewHolder, position: Int) {
        val faqs = differ.currentList[position]
        holder.itemView.apply {

            findViewById<TextView>(R.id.title).text = faqs.title
            findViewById<TextView>(R.id.body).text = faqs.body

            when(faqs.selected){
                true ->{
                    findViewById<TextView>(R.id.body).visibility = VISIBLE
                    findViewById<ImageView>(R.id.down_arrow).visibility = GONE
                    findViewById<ImageView>(R.id.up_arrow).visibility = VISIBLE
                }
                false ->{
                    findViewById<TextView>(R.id.body).visibility = GONE
                    findViewById<ImageView>(R.id.down_arrow).visibility = VISIBLE
                    findViewById<ImageView>(R.id.up_arrow).visibility = GONE
                }
            }

            setOnClickListener {
                selectedPos = position
                onItemClickListener?.let { it(faqs) }
            }
        }
    }

    override fun getItemCount(): Int {
        return differ.currentList.size
    }

    private var onItemClickListener: ((Faqs) -> Unit)? = null

    fun setOnItemClickListener(listener: (Faqs) -> Unit) {
        onItemClickListener = listener
    }
    var selectedPos: Int? = null


}