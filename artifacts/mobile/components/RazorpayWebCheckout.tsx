import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";

export type RazorpayCheckoutParams = {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
  planName: string;
  driverPhone?: string;
};

type Props = {
  visible: boolean;
  params: RazorpayCheckoutParams;
  onSuccess: (paymentId: string, orderId: string, signature: string) => void;
  onCancel: () => void;
  onFailure: (error: string) => void;
  onClose: () => void;
};

type PostMessage =
  | { type: "success"; razorpayPaymentId: string; razorpayOrderId: string; razorpaySignature: string }
  | { type: "cancel" }
  | { type: "failure"; error: string };

function buildCheckoutHtml(p: RazorpayCheckoutParams): string {
  const contact = p.driverPhone ? `+91${p.driverPhone}` : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: transparent; }
  </style>
</head>
<body>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  (function () {
    var handled = false;

    function post(data) {
      if (handled) return;
      handled = true;
      window.ReactNativeWebView.postMessage(JSON.stringify(data));
    }

    var options = {
      key:         ${JSON.stringify(p.keyId)},
      amount:      ${p.amount},
      currency:    ${JSON.stringify(p.currency)},
      name:        "Bike Courier",
      description: ${JSON.stringify(p.planName + " Driver Plan")},
      order_id:    ${JSON.stringify(p.razorpayOrderId)},
      prefill: {
        contact: ${JSON.stringify(contact)}
      },
      theme: { color: "#0a6efd" },
      handler: function (response) {
        post({
          type:               "success",
          razorpayPaymentId:  response.razorpay_payment_id,
          razorpayOrderId:    response.razorpay_order_id,
          razorpaySignature:  response.razorpay_signature
        });
      },
      modal: {
        ondismiss: function () {
          post({ type: "cancel" });
        }
      }
    };

    var rzp = new Razorpay(options);

    rzp.on("payment.failed", function (response) {
      var desc = (response.error && response.error.description) || "Payment failed";
      post({ type: "failure", error: desc });
    });

    rzp.open();
  })();
</script>
</body>
</html>`;
}

export function RazorpayWebCheckout({
  visible,
  params,
  onSuccess,
  onCancel,
  onFailure,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(true);
  const html = useRef(buildCheckoutHtml(params));

  if (visible && html.current !== buildCheckoutHtml(params)) {
    html.current = buildCheckoutHtml(params);
  }

  const handleMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: PostMessage;
      try {
        msg = JSON.parse(e.nativeEvent.data) as PostMessage;
      } catch {
        return;
      }

      if (msg.type === "success") {
        onSuccess(msg.razorpayPaymentId, msg.razorpayOrderId, msg.razorpaySignature);
        onClose();
      } else if (msg.type === "cancel") {
        onCancel();
        onClose();
      } else if (msg.type === "failure") {
        onFailure(msg.error);
        onClose();
      }
    },
    [onSuccess, onCancel, onFailure, onClose],
  );

  const handleNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    const url = nav.url ?? "";
    if (!url.startsWith("http://") && !url.startsWith("https://") && url !== "about:blank") {
      Linking.openURL(url).catch(() => undefined);
    }
  }, []);

  const handleShouldStartLoadWithRequest = useCallback((request: { url: string }) => {
    const url = request.url ?? "";
    if (!url.startsWith("http://") && !url.startsWith("https://") && url !== "about:blank") {
      Linking.openURL(url).catch(() => undefined);
      return false;
    }
    return true;
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        onCancel();
        onClose();
      }}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{params.planName} Plan — ₹{Math.round(params.amount / 100)}</Text>
          <TouchableOpacity
            onPress={() => {
              onCancel();
              onClose();
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        <WebView
          source={{ html: html.current, baseUrl: "https://checkout.razorpay.com" }}
          style={styles.webView}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          originWhitelist={["*"]}
          mixedContentMode="always"
          startInLoadingState={false}
          onLoadEnd={() => setLoading(false)}
          onMessage={handleMessage}
          onNavigationStateChange={handleNavigationStateChange}
          onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
          onError={() => {
            onFailure("Failed to load payment page. Check your connection.");
            onClose();
          }}
        />

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#0a6efd" />
            <Text style={styles.loadingText}>Loading secure checkout…</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  headerTitle: { fontSize: 15, fontWeight: "700", color: "#0a0a0a" },
  closeBtn: { fontSize: 18, color: "#666", fontWeight: "600" },
  webView: { flex: 1, backgroundColor: "transparent" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { fontSize: 13, fontWeight: "500", color: "#666" },
});
