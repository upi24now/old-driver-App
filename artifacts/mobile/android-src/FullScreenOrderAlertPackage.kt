package in.bikecourierservice.driver

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * React Native package that registers FullScreenOrderAlertModule with the bridge.
 *
 * Registered in MainApplication.kt via the withFullScreenOrderAlert config plugin,
 * which adds `add(FullScreenOrderAlertPackage())` to the getPackages() apply block
 * at EAS prebuild time.
 */
class FullScreenOrderAlertPackage : ReactPackage {

    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(FullScreenOrderAlertModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
