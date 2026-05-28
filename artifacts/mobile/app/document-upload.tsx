/**
 * document-upload.tsx
 *
 * Expo Go-compatible document + selfie upload screen.
 *
 * Key Expo Go fixes applied:
 *  - allowsEditing: false  → avoids Android UCrop activity that silently drops
 *    the result back to Expo Go (the #1 cause of "image not returned").
 *  - No ActionSheetIOS dynamic require — Alert.alert only for cross-platform
 *    reliability.
 *  - All five doc types (including selfie) always show both Camera & Gallery.
 *  - Selfie "Take Photo" uses front camera; all others use back camera.
 *  - Permissions requested individually per source (camera vs media library).
 *  - Per-doc loading state shown while picker is active.
 */

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

// ─── Types ───────────────────────────────────────────────────────────────────

type DocId = "selfie" | "aadhaar" | "pan" | "license" | "rc";

type DocSpec = {
  id: DocId;
  title: string;
  description: string;
  emoji: string;
  hint: string;
  /** selfie = use front-facing camera for "Take Photo" */
  isSelfie?: boolean;
};

const DOCS: DocSpec[] = [
  {
    id: "selfie",
    title: "Driver Selfie",
    description: "Clear photo of your face — no glasses or hat",
    emoji: "🤳",
    hint: "Look straight at camera, neutral background",
    isSelfie: true,
  },
  {
    id: "aadhaar",
    title: "Aadhaar Card",
    description: "Government-issued identity card (front side)",
    emoji: "🪪",
    hint: "All 12 digits and full name must be visible",
  },
  {
    id: "pan",
    title: "PAN Card",
    description: "10-digit PAN required for earnings & tax",
    emoji: "💳",
    hint: "PAN number and name must be clearly readable",
  },
  {
    id: "license",
    title: "Driving License",
    description: "Valid Indian driving license",
    emoji: "🪪",
    hint: "Both sides preferred — expiry must be valid",
  },
  {
    id: "rc",
    title: "Vehicle RC",
    description: "Registration Certificate of your vehicle",
    emoji: "📄",
    hint: "RC book / smart card — all details clearly visible",
  },
];

// ─── Per-doc state ────────────────────────────────────────────────────────────

type DocState = {
  uri: string | null;
  uploadedAt: number | null;
  /** true while permission request or picker is open */
  loading: boolean;
};

const blankDoc = (): DocState => ({ uri: null, uploadedAt: null, loading: false });

// ─── Permission helpers ───────────────────────────────────────────────────────

async function requestCamera(): Promise<boolean> {
  const { status, canAskAgain } =
    await ImagePicker.requestCameraPermissionsAsync();
  if (status === "granted") return true;
  const msg = canAskAgain
    ? "Camera permission is needed to take a photo. Please allow it."
    : "Camera access is blocked. Open Settings → App → Permissions → Camera.";
  Alert.alert("Camera permission required", msg, [{ text: "OK" }]);
  return false;
}

async function requestGallery(): Promise<boolean> {
  const { status, canAskAgain } =
    await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status === "granted") return true;
  const msg = canAskAgain
    ? "Photo library permission is needed to choose an image."
    : "Photo access is blocked. Open Settings → App → Permissions → Photos.";
  Alert.alert("Photos permission required", msg, [{ text: "OK" }]);
  return false;
}

// ─── Picker helpers ───────────────────────────────────────────────────────────
//
// IMPORTANT — allowsEditing: false
//   On Android, allowsEditing:true opens the UCrop activity. In Expo Go that
//   activity often returns without data, making the whole pick silently fail.
//   Keeping it false is the only reliable cross-device fix.

async function openCamera(front: boolean): Promise<string | null> {
  const ok = await requestCamera();
  if (!ok) return null;
  try {
    const result = await ImagePicker.launchCameraAsync({
      cameraType: front
        ? ImagePicker.CameraType.front
        : ImagePicker.CameraType.back,
      mediaTypes: ["images"],
      allowsEditing: false, // ← critical for Expo Go / Android
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return null;
    return result.assets[0].uri;
  } catch (e) {
    console.warn("openCamera error", e);
    Alert.alert("Camera error", "Could not open camera. Please try again.");
    return null;
  }
}

async function openGallery(): Promise<string | null> {
  const ok = await requestGallery();
  if (!ok) return null;
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false, // ← critical for Expo Go / Android
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return null;
    return result.assets[0].uri;
  } catch (e) {
    console.warn("openGallery error", e);
    Alert.alert("Gallery error", "Could not open gallery. Please try again.");
    return null;
  }
}

// ─── Action sheet (cross-platform, no dynamic require) ────────────────────────

function showSourceSheet(
  isSelfie: boolean,
  onCamera: () => void,
  onGallery: () => void,
) {
  const cameraLabel = isSelfie ? "Take Selfie (Front Camera)" : "Take Photo (Camera)";
  // Alert.alert works on iOS and Android — no ActionSheetIOS dynamic require
  // that can break Expo Go bundling.
  Alert.alert(
    isSelfie ? "Upload Selfie" : "Upload Document",
    "Choose how to add your photo",
    [
      { text: cameraLabel, onPress: onCamera },
      { text: "Choose from Gallery", onPress: onGallery },
      { text: "Cancel", style: "cancel" },
    ],
    { cancelable: true },
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ uploaded }: { uploaded: boolean }) {
  return (
    <View
      style={[styles.badge, { backgroundColor: uploaded ? "#e8f5e9" : "#fff5e6" }]}
    >
      {uploaded && <Feather name="check-circle" size={10} color="#00C853" />}
      <Text
        style={[styles.badgeText, { color: uploaded ? "#00C853" : "#b75d00" }]}
      >
        {uploaded ? "Uploaded" : "Required"}
      </Text>
    </View>
  );
}

// ─── DocumentCard ─────────────────────────────────────────────────────────────

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
        { borderColor: uploaded ? "#00C853" : colors.border },
      ]}
    >
      {/* ── Header row ── */}
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

      {/* ── Body ── */}
      {state.loading ? (
        /* Processing… spinner */
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#00C853" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Opening picker…
          </Text>
        </View>
      ) : uploaded ? (
        /* Preview */
        <View
          style={[
            styles.previewWrap,
            doc.isSelfie && styles.previewWrapSquare,
          ]}
        >
          <Image
            source={{ uri: state.uri! }}
            style={styles.previewImg}
            contentFit="cover"
            transition={250}
          />
          <View style={styles.previewBar}>
            <Feather name="check-circle" size={13} color="#fff" />
            <Text style={styles.previewBarText}>
              {doc.isSelfie ? "Selfie saved" : "Document saved"}
            </Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.barBtn}
              onPress={onUpload}
              activeOpacity={0.8}
            >
              <Feather name="refresh-cw" size={11} color="#fff" />
              <Text style={styles.barBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.barBtn, styles.barBtnDanger]}
              onPress={onRemove}
              activeOpacity={0.8}
            >
              <Feather name="trash-2" size={11} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* Upload zone */
        <View style={styles.uploadZone}>
          {/* Primary action button */}
          <TouchableOpacity
            style={styles.uploadBtn}
            onPress={onUpload}
            activeOpacity={0.82}
          >
            <LinearGradient
              colors={["#00C853", "#00E676"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.uploadBtnGrad}
            >
              <Feather name="camera" size={17} color="#fff" />
              <Text style={styles.uploadBtnText}>
                {doc.isSelfie ? "Take Selfie" : "Take Photo / Upload"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Hint */}
          <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>
            {doc.hint}
          </Text>

          {/* Tags row */}
          <View style={styles.tagsRow}>
            <View style={styles.tag}>
              <Feather name="camera" size={9} color="#9CA3AF" />
              <Text style={styles.tagText}>Camera</Text>
            </View>
            <View style={styles.tagDot} />
            <View style={styles.tag}>
              <Feather name="image" size={9} color="#9CA3AF" />
              <Text style={styles.tagText}>Gallery</Text>
            </View>
            <View style={styles.tagDot} />
            <View style={styles.tag}>
              <Feather name="lock" size={9} color="#9CA3AF" />
              <Text style={styles.tagText}>Encrypted</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DocumentUploadScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();

  const [docs, setDocs] = useState<Record<DocId, DocState>>(() => ({
    selfie:  blankDoc(),
    aadhaar: blankDoc(),
    pan:     blankDoc(),
    license: blankDoc(),
    rc:      blankDoc(),
  }));

  // ── Helpers ──

  function patch(id: DocId, partial: Partial<DocState>) {
    setDocs((prev) => ({ ...prev, [id]: { ...prev[id], ...partial } }));
  }

  function removeDoc(id: DocId) {
    setDocs((prev) => ({ ...prev, [id]: blankDoc() }));
  }

  /**
   * Run the picker (camera or gallery) and apply the result.
   * Must be called from inside an Alert.alert callback — not from
   * a sync context — so that the Alert dismisses before the picker opens.
   */
  async function runPicker(id: DocId, pickFn: () => Promise<string | null>) {
    patch(id, { loading: true });
    try {
      const uri = await pickFn();
      if (uri) {
        patch(id, { uri, uploadedAt: Date.now(), loading: false });
      } else {
        patch(id, { loading: false });
      }
    } catch {
      patch(id, { loading: false });
    }
  }

  function handleUpload(doc: DocSpec) {
    showSourceSheet(
      !!doc.isSelfie,
      // Camera option
      () => runPicker(doc.id, () => openCamera(!!doc.isSelfie)),
      // Gallery option
      () => runPicker(doc.id, openGallery),
    );
  }

  // ── Derived ──

  const uploadedCount = (Object.values(docs) as DocState[]).filter((d) => d.uri).length;
  const total         = DOCS.length;
  const progress      = uploadedCount / total;
  const allDone       = uploadedCount === total;

  function handleSubmit() {
    if (!allDone) return;
    router.replace("/verification-pending");
  }

  // ── Render ──

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ────── Header ────── */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 12, backgroundColor: "#fff" },
        ]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={19} color="#0a0a0a" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Upload Documents</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              Step 4 · Verification
            </Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {/* Progress bar */}
        <View style={styles.progressRow}>
          <View
            style={[styles.progressTrack, { backgroundColor: colors.border }]}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(progress * 100, 3)}%` },
              ]}
            />
          </View>
          <Text style={[styles.progressLabel, { color: colors.foreground }]}>
            {uploadedCount}/{total}
          </Text>
        </View>
      </View>

      {/* ────── Scroll content ────── */}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Security banner */}
        <View style={styles.banner}>
          <View style={styles.bannerIcon}>
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

        {/* Doc cards */}
        <View style={styles.docList}>
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
        <View
          style={[
            styles.tipBox,
            { backgroundColor: "#fff", borderColor: colors.border },
          ]}
        >
          <View style={styles.tipHeader}>
            <Feather name="info" size={13} color={colors.mutedForeground} />
            <Text style={[styles.tipTitle, { color: colors.foreground }]}>
              Tips for a clear photo
            </Text>
          </View>
          {[
            "Lay document flat on a dark surface",
            "All 4 corners must fit in the frame",
            "Avoid glare, shadows, and blur",
            "Every digit and letter must be readable",
          ].map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <View style={styles.tipDot} />
              <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
                {tip}
              </Text>
            </View>
          ))}
        </View>

        {/* Platform notice (development helper) */}
        {Platform.OS === "android" && (
          <View style={styles.platformNote}>
            <Feather name="smartphone" size={12} color="#6B7280" />
            <Text style={styles.platformNoteText}>
              After selecting a photo, tap the checkmark / Done button to confirm.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ────── Sticky footer ────── */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16,
            backgroundColor: "#fff",
            borderTopColor: colors.border,
          },
        ]}
      >
        <View style={styles.footerHint}>
          <Feather
            name={allDone ? "check-circle" : "info"}
            size={13}
            color={allDone ? "#00C853" : colors.mutedForeground}
          />
          <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
            {allDone
              ? "All documents uploaded. Ready to submit."
              : `${total - uploadedCount} more document${total - uploadedCount > 1 ? "s" : ""} needed.`}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, { opacity: allDone ? 1 : 0.45 }]}
          onPress={handleSubmit}
          activeOpacity={0.85}
          disabled={!allDone}
        >
          <LinearGradient
            colors={["#00C853", "#00E676"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.submitGrad}
          >
            <Text style={styles.submitText}>Submit for Verification</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { alignItems: "center" },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#0a0a0a" },
  headerSub: { fontSize: 12, marginTop: 1 },

  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3, backgroundColor: "#00C853" },
  progressLabel: { fontSize: 12, fontWeight: "700" },

  // Scroll
  scroll: { paddingHorizontal: 16, paddingTop: 14, gap: 14 },

  // Banner
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
  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,200,83,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerTitle: { fontSize: 13, fontWeight: "700" },
  bannerSub:   { fontSize: 11, marginTop: 2 },

  // Doc list
  docList: { gap: 12 },

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
  docEmoji:       { fontSize: 22 },
  cardHeaderText: { flex: 1, gap: 2 },
  cardTitle:      { fontSize: 15, fontWeight: "700" },
  cardDesc:       { fontSize: 12 },

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },

  // Loading
  loadingBox: {
    height: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 12,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#f0f0f0",
  },
  loadingText: { fontSize: 13, fontWeight: "500" },

  // Upload zone
  uploadZone: {
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
  uploadBtn:     { width: "100%", borderRadius: 12, overflow: "hidden" },
  uploadBtnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  uploadBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  uploadHint:    { fontSize: 12, textAlign: "center" },
  tagsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  tag:     { flexDirection: "row", alignItems: "center", gap: 3 },
  tagText: { fontSize: 10, fontWeight: "500", color: "#9CA3AF" },
  tagDot:  { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#D1D5DB" },

  // Preview
  previewWrap: {
    borderRadius: 12,
    overflow: "hidden",
    aspectRatio: 16 / 9,
    backgroundColor: "#f0f0f0",
  },
  previewWrapSquare: { aspectRatio: 1 },
  previewImg:        { width: "100%", height: "100%" },
  previewBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  previewBarText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  barBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
  },
  barBtnDanger: { backgroundColor: "rgba(255,59,48,0.18)" },
  barBtnText:   { fontSize: 11, fontWeight: "700", color: "#fff" },

  // Tips
  tipBox: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  tipHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  tipTitle: { fontSize: 13, fontWeight: "700" },
  tipRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  tipDot:   { width: 4, height: 4, borderRadius: 2, backgroundColor: "#00C853" },
  tipText:  { fontSize: 12 },

  // Platform note (Android)
  platformNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
    marginTop: -4,
  },
  platformNoteText: { fontSize: 11, color: "#9CA3AF" },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    gap: 10,
  },
  footerHint: { flexDirection: "row", alignItems: "center", gap: 6 },
  hintText:   { fontSize: 12 },
  submitBtn:  { borderRadius: 15, overflow: "hidden" },
  submitGrad: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 15,
  },
  submitText: { fontSize: 17, fontWeight: "700", color: "#fff" },
});
