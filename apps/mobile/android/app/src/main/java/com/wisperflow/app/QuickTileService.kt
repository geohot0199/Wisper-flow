package com.wisperflow.app

import android.content.Intent
import android.service.quicksettings.TileService

/**
 * Android Quick Settings Tile.
 *
 * Adds a tile in the notification shade so a user can pull down the
 * shade and tap once to launch the dictation overlay — this is the
 * Android equivalent of a "home button launches my app" gesture.
 */
class QuickTileService : TileService() {
    override fun onClick() {
        super.onClick()
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("fromTile", true)
        }
        startActivityAndCollapse(intent)
    }
}
