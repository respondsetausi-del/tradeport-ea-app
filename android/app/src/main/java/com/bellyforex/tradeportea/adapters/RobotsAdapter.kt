package com.bellyforex.tradeportea.adapters


import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat
import androidx.recyclerview.widget.AsyncListDiffer
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import com.bellyforex.tradeportea.R
import com.bellyforex.tradeportea.network.module.Licence
import com.bellyforex.tradeportea.utils.Constants
import com.bumptech.glide.Glide
import com.bellyforex.tradeportea.ui.theme.ThemeEngine
import com.bellyforex.tradeportea.ui.theme.ThemeUtils
import com.bellyforex.tradeportea.ui.theme.WarpGlowDrawable


class RobotsAdapter: RecyclerView.Adapter<RobotsAdapter.PostViewHolder>() {

    inner class PostViewHolder(itemView: View): RecyclerView.ViewHolder(itemView) {
        val robotCard: FrameLayout? = itemView.findViewById(R.id.robot_card)
        val logoGlow: FrameLayout? = itemView.findViewById(R.id.logo_glow)
    }

    private val differCallback = object : DiffUtil.ItemCallback<Licence>(){

        override fun areItemsTheSame(oldItem: Licence, newItem: Licence): Boolean {
            return oldItem.key == newItem.key
        }

        override fun areContentsTheSame(oldItem: Licence, newItem: Licence): Boolean {
            return oldItem == newItem
        }

    }

    val differ = AsyncListDiffer(this, differCallback)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PostViewHolder {
        return PostViewHolder(
            LayoutInflater.from(parent.context).inflate(
                R.layout.robots_layout,
                parent,
                false
            )
        )
    }

    override fun onBindViewHolder(holder: PostViewHolder, position: Int) {
        val licence = differ.currentList[position]
        holder.itemView.apply {

            // Set text for the TextViews
            val botNameTextView = findViewById<TextView>(R.id.bot_name)
            botNameTextView.text = licence.ea_name

            // Set the custom font for TextViews
            val typeface = ResourcesCompat.getFont(context, R.font.starkiller) // Use appropriate context

            // Check if typeface is not null before setting
            if (typeface != null) {
                //botNameTextView.typeface = typeface
            }

            val logoImg = findViewById<ImageView>(R.id.logo_img)

            when (licence.owner.logo) {
                "none" -> {
                    logoImg.setImageResource(R.drawable.ic_baseline_arrow_circle_right_24)
                }
                else -> {
                    Glide.with(context)
                        .load(Constants.LOGO_BASE_URL + licence.owner.logo)
                        .centerCrop()
                        .into(logoImg)
                }
            }

            setOnClickListener {
                onItemClickListener?.let { it(licence) }
            }
        }
        
        // Apply theme-reactive glow to row card and circular logo
        applyCardGlow(holder)
        applyLogoGlow(holder)
    }

    /**
     * Apply theme-reactive neon glow directly to robot card.
     * Glow is same size as card - no wrapper offset.
     */
    private fun applyCardGlow(holder: PostViewHolder) {
        val theme = ThemeEngine.getCurrentTheme()
        val density = holder.itemView.context.resources.displayMetrics.density

        holder.robotCard?.let { card ->
            card.background = WarpGlowDrawable(
                glowColor = theme.glowColor,
                cornerRadiusPx = 20f * density,
                intensity = WarpGlowDrawable.GlowIntensity.SUBTLE,
                paddingPx = 12f * density
            )
        }
    }

    /**
     * Apply circular neon glow around the robot logo thumbnail.
     * Logo is always circular (24dp radius on 48dp card).
     */
    private fun applyLogoGlow(holder: PostViewHolder) {
        val theme = ThemeEngine.getCurrentTheme()
        val density = holder.itemView.context.resources.displayMetrics.density

        holder.logoGlow?.let { wrapper ->
            wrapper.background = WarpGlowDrawable(
                glowColor = theme.glowColor,
                cornerRadiusPx = 24f * density,
                intensity = WarpGlowDrawable.GlowIntensity.SUBTLE,
                paddingPx = 6f * density
            )
        }
    }

    override fun getItemCount(): Int {
        return differ.currentList.size
    }

    private var onItemClickListener: ((Licence) -> Unit)? = null

    fun setOnItemClickListener(listener: (Licence) -> Unit) {
        onItemClickListener = listener
    }


}