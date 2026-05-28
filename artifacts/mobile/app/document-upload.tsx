import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

// ─── Document spec ──────────────────────────────────────────────
type DocId = "aadhaar" | "pan" | "license" | "rc" | "selfie";

type DocSpec = {
  id: DocId;
  title: string;
  description: string;
  featherIcon: string;
  hint: string;
  emoji: string;
  selfie?: boolean; // opens front camera directly
};

const DOCS: DocSpec[] = [
  {
    id: "selfie",
    title: "Driver Selfie",
    description: "Clear selfie for identity verification",
    featherIcon: "camera",
    hint: "Face clearly visible, neutral background",
    emoji: "🤳",
    selfie: true,
  },
  {
    id: "aadhaar",
    title: "Aadhaar Card",
    description: "Government ID — front side",
    featherIcon: "user-check",
    hint: "All 12 digits and name must be visible",
    emoji: "🪪",
  },
  {
    id: "pan",
    title: "PAN Card",
    description: "10-digit PAN for earnings & tax",
    featherIcon: "credit-card",
    hint: "PAN number and name must be clearly readable",
    emoji: "💳",
  },
  {
    id: "license",
    title: "Driving License",
    description: "Valid Indian driving license",
    featherIcon: "award",
    hint: "Both sides preferred, expiry must be valid",
    emoji: "🪪",
  },
  {
    id: "rc",
    title: "Vehicle RC",
    description: "Registration Certificate of your vehicle",
    featherIcon: "file-text",
    hint: "RC book / smart card — all details visible",
    emoji: "📄",
  },
];

type DocState = {
  uri: string | null;
  uploadedAt: number | null;
  loading: boolean;
};

const initialDoc = (): DocState => ({ uri: null, uploadedAt: null, loading: false });

// ─── Permission helpers ─────────────────────────────────────────
async function ensureCameraPermission(): Promise<boolean> {
  const { status, canAskAgain } =
    await ImagePicker.requestCameraPermissionsAsync();
  if (status === "granted") return true;
  if (!canAskAgain) {
    Alert.alert(
      "Camera access required",
      "Go to Settings → App → Permissions and enable Camera.",
      [{ text: "OK" }]
    );
    return false;
  }
  Alert.alert("Camera permission denied", "Please allow camera access to take a photo.", [
    { text: "OK" },
  ]);
  return false;
}

async function ensureGalleryPermission(): Promise<boolean> {
  const { status, canAskAgain } =
    await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status === "granted") return true;
  if (!canAskAgain) {
    Alert.alert(
      "Photo library access required",
      "Go to Settings → App → Permissions and enable Photos.",
      [{ text: "OK" }]
    );
    return false;
  }
  Alert.alert("Permission denied", "Please allow photo library access.", [{ text: "OK" }]);
  return false;
}

// ─── Image picker helpers ───────────────────────────────────────
async function captureFromCamera(front = false): Promise<string | null> {
  const ok = await ensureCameraPermission();
  if (!ok) return null;
  try {
    const result = await ImagePicker.launchCameraAsync({
      cameraType: front
        ? ImagePicker.CameraType.front
        : ImagePicker.CameraType.back,
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: front ? [1, 1] : [4, 3],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return null;
    return result.assets[0].uri;
  } catch {
    Alert.alert("Camera error", "Could not open camera. Try again.");
    return null;
  }
}

async function pickFromGallery(): Promise<string | null> {
  const ok = await ensureGalleryPermission();
  if (!ok) return null;
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return null;
    return result.assets[0].uri;
  } catch {
    Alert.alert("Gallery error", "Could not open gallery. Try again.");
    return null;
  }
}

// ─── Picker sheet ───────────────────────────────────────────────
function showPickerSheet(
  isSelfie: boolean,
  onCamera: () => void,
  onGallery: () => void
) {
  const cameraLabel = isSelfie ? "Take Selfie" : "Take Photo";
  if (Platform.OS === "ios") {
    // On iOS use ActionSheetIOS for native feel
    const { ActionSheetIOS } = require("react-native");
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [cameraLabel, "Choose from Gallery", "Cancel"],
        cancelButtonIndex: 2,
      },
      (i: number) => {
        if (i === 0) onCamera();
        if (i === 1) onGallery();
      }
    );
  } else {
    Alert.alert(
      isSelfie ? "Take Selfie" : "Upload Document",
      "Choose how to add your photo",
      [
        { text: cameraLabel, onPress: onCamera },
        { text: "Choose from Gallery", onPress: onGallery },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }
}

// ─── Status badge ───────────────────────────────────────────────
function StatusBadge({ uploaded }: { uploaded: boolean }) {
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: uploaded ? "#e8f5e9" : "#fff5e6" },
      ]}
    >
      {uploaded && <Feather name="check-circle" size={10} color="#00C853" />}
      <Text
        style={[
          styles.badgeText,
          { color: uploaded ? "#00C853" : "#b75d00" },
        ]}
      >
        {uploaded ? "Uploaded" : "Required"}
      </Text>
    </View>
  );
}

// ─── Document card ──────────────────────────────────────────────
function DocumentCard({
  doc,
  state,
  onUpload,
  onRemove,
}: {
  doc: DocSpec;
  state: DocState;
  onUpload: () => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const uploaded = !!state.uri;

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: uploaded ? "#00C853" : colors.border,
          backgroundColor: "#fff",
        },
      ]}
    >
      {/* Card header */}
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.docIconWrap,
            { backgroundColor: uploaded ? "#f0fdf4" : "#f5f5f5" },
          ]}
        >
          <Text style={styles.docEmoji}>{doc.emoji}</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            {doc.title}
          </Text>
          <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
            {doc.description}
          </Text>
        </View>
        <StatusBadge uploaded={uploaded} />
      </View>

      {/* Preview or upload zone */}
      {state.loading ? (
        <View style={styles.loadingZone}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Processing image…
          </Text>
        </View>
      ) : uploaded ? (
        <View style={[styles.previewWrap, doc.selfie && styles.previewWrapSelfie]}>
          <Image
            source={{ uri: state.uri! }}
            style={styles.previewImage}
            contentFit={doc.selfie ? "cover" : "cover"}
            transition={200}
          />
          {/* Green success banner */}
          <View style={styles.previewBanner}>
            <Feather name="check-circle" size={13} color="#fff" />
            <Text style={styles.previewBannerText}>
              {doc.selfie ? "Selfie captured" : "Document uploaded"}
            </Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.previewActionBtn}
              onPress={onUpload}
              activeOpacity={0.8}
            >
              <Feather name="refresh-cw" size={11} color="#fff" />
              <Text style={styles.previewActionText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.previewActionBtn, styles.previewActionDanger]}
              onPress={onRemove}
              activeOpacity={0.8}
            >
              <Feather name="trash-2" size={11} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* Upload zone */
        <View style={styles.uploadZoneWrap}>
          {/* Camera button — primary */}
          <TouchableOpacity
            style={[styles.uploadPrimaryBtn, { borderColor: colors.primary }]}
            onPress={onUpload}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#00C853", "#00E676"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.uploadPrimaryGrad}
            >
              <Feather
                name={doc.selfie ? "camera" : "camera"}
                size={18}
                color="#fff"
              />
              <Text style={styles.uploadPrimaryText}>
                {doc.selfie ? "Take Selfie" : "Take Photo / Upload"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>
            {doc.hint}
          </Text>

          <View style={styles.uploadTagRow}>
            <View style={styles.uploadTag}>
              <Feather name="camera" size={9} color="#6B7280" />
              <Text style={styles.uploadTagText}>Camera</Text>
            </View>
            {!doc.selfie && (
              <>
                <View style={styles.uploadTagDot} />
                <View style={styles.uploadTag}>
                  <Feather name="image" size={9} color="#6B7280" />
                  <Text style={styles.uploadTagText}>Gallery</Text>
                </View>
              </>
            )}
            <View style={styles.uploadTagDot} />
            <View style={styles.uploadTag}>
              <Feather name="lock" size={9} color="#6B7280" />
              <Text style={styles.uploadTagText}>Encrypted</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Main screen ────────────────────────────────────────────────
export default function DocumentUploadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [docs, setDocs] = useState<Record<DocId, DocState>>({
    selfie:  initialDoc(),
    aadhaar: initialDoc(),
    pan:     initialDoc(),
    license: initialDoc(),
    rc:      initialDoc(),
  });

  function setLoading(id: DocId, loading: boolean) {
    setDocs((d) => ({ ...d, [id]: { ...d[id], loading } }));
  }

  function setUri(id: DocId, uri: string) {
    setDocs((d) => ({
      ...d,
      [id]: { uri, uploadedAt: Date.now(), loading: false },
    }));
  }

  function removeDoc(id: DocId) {
    setDocs((d) => ({ ...d, [id]: initialDoc() }));
  }

  async function handleUpload(doc: DocSpec) {
    if (doc.selfie) {
      // Selfie → go straight to front camera, no sheet
      setLoading(doc.id, true);
      const uri = await captureFromCamera(true);
      if (uri) setUri(doc.id, uri);
      else setLoading(doc.id, false);
      return;
    }

    // Other docs → offer camera or gallery
    showPickerSheet(
      false,
      async () => {
        setLoading(doc.id, true);
        const uri = await captureFromCamera(false);
        if (uri) setUri(doc.id, uri);
        else setLoading(doc.id, false);
      },
      async () => {
        setLoading(doc.id, true);
        const uri = await pickFromGallery();
        if (uri) setUri(doc.id, uri);
        else setLoading(doc.id, false);
      }
    );
  }

  const uploadedCount = Object.values(docs).filter((d) => d.uri).length;
  const totalDocs     = DOCS.length;
  const progress      = uploadedCount / totalDocs;
  const allUploaded   = uploadedCount === totalDocs;

  function handleSubmit() {
    if (!allUploaded) return;
    router.replace("/verification-pending");
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 12, backgroundColor: "#fff" },
        ]}
      >
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: "#f5f5f5" }]}
          >
            <Feather name="arrow-left" size={19} color="#0a0a0a" />
          </TouchableOpacity>
          <View style={styles.headerTitle}>
            <Text style={styles.headerLabel}>Upload Documents</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              Step 4 · Verification
            </Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {/* Progress */}
        <View style={styles.progressRow}>
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: "#00C853",
                  width: `${Math.max(progress * 100, 3)}%`,
                },
              ]}
            />
          </View>
          <Text style={[styles.progressLabel, { color: colors.foreground }]}>
            {uploadedCount}/{totalDocs}
          </Text>
        </View>
      </View>

      {/* ── Scrollable content ── */}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Security banner */}
        <View style={styles.banner}>
          <View style={styles.bannerIconWrap}>
            <Feather name="shield" size={16} color="#00C853" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.foreground }]}>
              Your documents are safe
            </Text>
            <Text style={[styles.bannerSub, { color: colors.mutedForeground }]}>
              End-to-end encrypted · Used only for driver verification
            </Text>
          </View>
        </View>

        {/* Document cards */}
        <View style={styles.docsList}>
          {DOCS.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              state={docs[doc.id]}
              onUpload={() => handleUpload(doc)}
              onRemove={() => removeDoc(doc.id)}
            />
          ))}
        </View>

        {/* Tips */}
        <View style={[styles.tipBox, { backgroundColor: "#fff", borderColor: colors.border }]}>
          <View style={styles.tipHeader}>
            <Feather name="info" size={14} color={colors.mutedForeground} />
            <Text style={[styles.tipTitle, { color: colors.foreground }]}>
              Tips for a clear photo
            </Text>
          </View>
          {[
            "Place document on flat, dark surface",
            "All 4 corners must be visible",
            "Avoid glare, shadows, and blur",
            "All text must be clearly readable",
          ].map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <View style={[styles.tipDot, { backgroundColor: "#00C853" }]} />
              <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
                {tip}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── Sticky footer ── */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16,
            borderTopColor: colors.border,
            backgroundColor: "#fff",
          },
        ]}
      >
        <View style={styles.footerHint}>
          <Feather
            name={allUploaded ? "check-circle" : "info"}
            size={13}
            color={allUploaded ? "#00C853" : colors.mutedForeground}
          />
          <Text style={[styles.footerHintText, { color: colors.mutedForeground }]}>
            {allUploaded
              ? "All documents uploaded. Ready to submit."
              : `${totalDocs - uploadedCount} more document${totalDocs - uploadedCount > 1 ? "s" : ""} needed.`}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.submitBtn,
            { opacity: allUploaded ? 1 : 0.5 },
          ]}
          onPress={handleSubmit}
          activeOpacity={0.85}
          disabled={!allUploaded}
        >
          <LinearGradient
            colors={["#00C853", "#00E676"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.submitGrad}
          >
            <Text style={styles.submitBtnText}>Submit for Verification</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    zIndex: 10,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { alignItems: "center" },
  headerLabel: { fontSize: 16, fontWeight: "700", color: "#0a0a0a" },
  headerSub: { fontSize: 12, marginTop: 1 },

  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  progressLabel: { fontSize: 12, fontWeight: "700" },

  scroll: { paddingHorizontal: 16, paddingTop: 14, gap: 14 },

  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#b9f6ca",
    backgroundColor: "#f0fdf4",
  },
  bannerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,200,83,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerTitle: { fontSize: 13, fontWeight: "700" },
  bannerSub: { fontSize: 11, marginTop: 2 },

  docsList: { gap: 12 },

  // Card
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    gap: 12,
    backgroundColor: "#fff",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  docIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  docEmoji: { fontSize: 22 },
  cardHeaderText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardDesc: { fontSize: 12 },

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },

  // Upload zone
  uploadZoneWrap: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 14,
    borderColor: "#E5E7EB",
    backgroundColor: "#fafafa",
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 10,
  },
  uploadPrimaryBtn: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 0,
  },
  uploadPrimaryGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  uploadPrimaryText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  uploadHint: { fontSize: 12, textAlign: "center" },
  uploadTagRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  uploadTag: { flexDirection: "row", alignItems: "center", gap: 3 },
  uploadTagText: { fontSize: 10, fontWeight: "500", color: "#6B7280" },
  uploadTagDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#D1D5DB" },

  // Loading
  loadingZone: {
    height: 100,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 12,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#F0F0F0",
  },
  loadingText: { fontSize: 13, fontWeight: "600" },

  // Preview
  previewWrap: {
    borderRadius: 12,
    overflow: "hidden",
    aspectRatio: 16 / 9,
    backgroundColor: "#f5f5f5",
  },
  previewWrapSelfie: { aspectRatio: 1 },
  previewImage: { width: "100%", height: "100%" },
  previewBanner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  previewBannerText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  previewActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
  },
  previewActionDanger: { backgroundColor: "rgba(255,59,48,0.18)" },
  previewActionText: { fontSize: 11, fontWeight: "700", color: "#fff" },

  // Tips
  tipBox: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  tipHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  tipTitle: { fontSize: 13, fontWeight: "700" },
  tipRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tipDot: { width: 4, height: 4, borderRadius: 2 },
  tipText: { fontSize: 12 },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    gap: 10,
  },
  footerHint: { flexDirection: "row", alignItems: "center", gap: 6 },
  footerHintText: { fontSize: 12 },
  submitBtn: { borderRadius: 15, overflow: "hidden" },
  submitGrad: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 15,
  },
  submitBtnText: { fontSize: 17, fontWeight: "700", color: "#fff" },
});
