package in.bikecourierservice.driver

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * FullScreenOrderActionReceiver
 *
 * Handles ACCEPT_ORDER and REJECT_ORDER button taps from the full-screen
 * order alert notification posted by FullScreenOrderAlertModule.
 *
 * On receive:
 *   1. Cancels the notification immediately so it disappears from the lock
 *      screen / notification shade.
 *   2. Launches the app via a deep link:
 *        mobile://ride-request?orderId=<id>&nativeAction=accept|reject
 *
 *      App state → behaviour:
 *        Foreground/Background  onNewIntent() delivers the link to Expo Router;
 *                               ride-request.tsx detects nativeAction param and
 *                               auto-calls acceptRide() / rejectRide() once the
 *                               ride is available in DriverContext.
 *        Killed                 App cold-starts with the deep link as the initial
 *                               URL; same ride-request.tsx useEffect handles it
 *                               after Firestore delivers the order (or the
 *                               existing FCM tap recovery fetch resolves it).
 *
 * Registered in AndroidManifest.xml by the withFullScreenOrderAlert config plugin
 * with android:exported="false" (actions are not callable from other apps).
 *
 * No SYSTEM_ALERT_WINDOW permission is used or required.
 */
class FullScreenOrderActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_ACCEPT  = "in.bikecourierservice.driver.ACTION_ACCEPT_ORDER"
        const val ACTION_REJECT  = "in.bikecourierservice.driver.ACTION_REJECT_ORDER"
        const val EXTRA_ORDER_ID = "orderId"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val orderId = intent.getStringExtra(EXTRA_ORDER_ID) ?: return

        // Cancel the notification immediately — before launching the app so it
        // vanishes from the lock screen as soon as the driver taps the button.
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .cancel(FullScreenOrderAlertModule.NOTIFICATION_ID)

        val nativeAction = when (intent.action) {
            ACTION_ACCEPT -> "accept"
            ACTION_REJECT -> "reject"
            else          -> return
        }

        // Build deep link: mobile://ride-request?orderId=<id>&nativeAction=accept|reject
        // Uri.encode(orderId) guards against special characters in the order ID.
        val uri = Uri.parse(
            "mobile://ride-request" +
            "?orderId=${Uri.encode(orderId)}" +
            "&nativeAction=$nativeAction",
        )
        val launchIntent = Intent(Intent.ACTION_VIEW, uri).apply {
            // NEW_TASK   — required when starting an Activity from a BroadcastReceiver.
            // CLEAR_TOP  — if the app is already running, bring the existing task to
            //              the front and deliver the intent via onNewIntent().
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            // Constrain to our own package so no other app intercepts the deep link.
            setPackage(context.packageName)
        }
        context.startActivity(launchIntent)
    }
}
