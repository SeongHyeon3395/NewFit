package com.front

import android.os.Build
import android.os.Bundle
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  private fun clearRefreshRatePreference() {
    try {
      val attrs = window.attributes

      // Let Android fully follow user/device display settings (30/60/90/120Hz, battery saver, adaptive mode).
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        attrs.preferredDisplayModeId = 0
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        attrs.preferredRefreshRate = 0f
      }
      window.attributes = attrs

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        try {
          val windowClass = window.javaClass
          val setFrameRate = windowClass.getMethod(
            "setFrameRate",
            Float::class.javaPrimitiveType,
            Int::class.javaPrimitiveType
          )

          val compatDefault = try {
            val field = Class.forName("android.view.Window").getField("FRAME_RATE_COMPATIBILITY_DEFAULT")
            field.getInt(null)
          } catch (_: Throwable) {
            0
          }

          setFrameRate.invoke(window, 0f, compatDefault)
        } catch (_: Throwable) {
          // ignore
        }
      }
    } catch (_: Throwable) {
      // ignore
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    super.onCreate(savedInstanceState)
    clearRefreshRatePreference()
  }

  override fun onResume() {
    super.onResume()
    clearRefreshRatePreference()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      clearRefreshRatePreference()
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Front"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
