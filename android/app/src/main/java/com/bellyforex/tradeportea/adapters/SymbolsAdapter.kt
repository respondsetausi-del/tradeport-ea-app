package com.bellyforex.tradeportea.adapters

import android.text.TextUtils.concat
import android.view.LayoutInflater
import android.view.View
import android.view.View.GONE
import android.view.View.VISIBLE
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView

import androidx.recyclerview.widget.AsyncListDiffer
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.network.module.Symbol
import com.bellyforex.tradeportea.ui.theme.ThemeEngine
import com.bellyforex.tradeportea.ui.theme.ThemeUtils
import com.bellyforex.tradeportea.ui.theme.WarpGlowDrawable


class SymbolsAdapter: RecyclerView.Adapter<SymbolsAdapter.PostViewHolder>() {

    inner class PostViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val assetCard: FrameLayout? = itemView.findViewById(R.id.asset_card)
    }

    private val differCallback = object : DiffUtil.ItemCallback<Symbol>() {

        override fun areItemsTheSame(oldItem: Symbol, newItem: Symbol): Boolean {
            return oldItem == newItem
        }

        override fun areContentsTheSame(oldItem: Symbol, newItem: Symbol): Boolean {
            return oldItem.id == newItem.id
        }

    }

    val differ = AsyncListDiffer(this, differCallback)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PostViewHolder {
        return PostViewHolder(
            LayoutInflater.from(parent.context).inflate(
                R.layout.asset_layout,
                parent,
                false
            )
        )
    }

    override fun onBindViewHolder(holder: PostViewHolder, position: Int) {
        val post = differ.currentList[position]
        holder.itemView.apply {

            findViewById<TextView>(R.id.symbolname).text = post.name
            if(post.lotSize != null)
            {
                findViewById<TextView>(R.id.lot_txt).apply {
                    text = concat("Lot Size : ",post.lotSize.toString())
                    visibility = VISIBLE
                }
            }else
            {
                findViewById<TextView>(R.id.lot_txt).apply {
                    visibility = GONE
                }
            }

            if(post.action != null)
            {
                findViewById<TextView>(R.id.actxt).apply {
                    text = concat("Action : ",post.action.toString())
                    visibility = VISIBLE
                }
            }else
            {
                findViewById<TextView>(R.id.actxt).apply {
                    visibility = GONE
                }
            }


            setOnClickListener {
                onItemClickListener?.let { it(post) }
            }
        }
        
        // Apply theme-reactive glow directly to card
        applyCardGlow(holder)
    }
    
    /**
     * Apply theme-reactive neon glow directly to asset card.
     * Glow is same size as card - no wrapper offset.
     */
    private fun applyCardGlow(holder: PostViewHolder) {
        val theme = ThemeEngine.getCurrentTheme()
        val density = holder.itemView.context.resources.displayMetrics.density
        
        holder.assetCard?.let { card ->
            WarpGlowDrawable.prepareView(card)
            card.background = WarpGlowDrawable(
                glowColor = theme.glowColor,
                cornerRadiusPx = 24f * density,
                intensity = WarpGlowDrawable.GlowIntensity.SUBTLE
            )
        }
    }

    override fun getItemCount(): Int {
        return differ.currentList.size
    }

    private var onItemClickListener: ((Symbol) -> Unit)? = null

    fun setOnItemClickListener(listener: (Symbol) -> Unit) {
        onItemClickListener = listener
    }
}
