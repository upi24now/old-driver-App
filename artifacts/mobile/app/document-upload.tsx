import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type DocId = "aadhaar" | "license" | "rc";

type DocSpec = {
  id: DocId;
  title: string;
  description: string;
  icon: string;
  hint: string;
};

const DOCS: DocSpec[] = [
  {
    id: "aadhaar",
    title: "Aadhaar Card",
    description: "Government ID for identity verification",
    icon: "user-check",
    hint: "Upload clear photo of front side",
  },
  {
    id: "license",
    title: "Driving License",
    description: "Valid driving license issued in India",
    icon: "credit-card",
    hint: "Both sides preferred, valid expiry",
  },
  {
    id: "rc",
    title: "Vehicle RC",
    description: "Registration Certificate of your vehicle",
    icon: "file-text",
    hint: "Clear photo of RC book or card",
  },
];

type DocState = {
  uri: string | null;
  uploadedAt: number | null;
};

function StatusBadge({ status }: { status: "required" | "uploaded" | "verified" }) {
  const colors = useColors();
  const config = {
    required: { bg: "#fff5e6", color: "#b75d00", label: "Required" },
    uploaded: { bg: "#e3f2fd", color: "#1565c0", label: "Uploaded" },
    verified: { bg: "#e8f5e9", color: colors.primary, label: "Verified" },
  }[status];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      {status === "verified" && (
        <Feather name="check-circle" size={10} color={config.color} />
      )}
      <Text style={[styles.badgeText, { color: config.color }]}>
        {config.label}
      </Text>
    </View>
  );
}

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
          borderColor: uploaded ? colors.primary : colors.border,
          backgroundColor: "#fff",
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.docIcon,
            {
              backgroundColor: uploaded ? "#f0fdf4" : "#f5f5f5",
            },
          ]}
        >
          <Feather
            name={doc.icon as any}
            size={20}
            color={uploaded ? colors.primary : "#666"}
          />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            {doc.title}
          </Text>
          <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
            {doc.description}
          </Text>
        </View>
        <StatusBadge status={uploaded ? "uploaded" : "required"} />
      </View>

      {uploaded ? (
        <View style={styles.previewWrap}>
          <Image
            source={{ uri: state.uri! }}
            style={styles.previewImage}
            contentFit="cover"
          />
          <View style={styles.previewOverlay}>
            <View style={styles.previewMeta}>
              <Feather name="check-circle" size={14} color={colors.primary} />
              <Text style={styles.previewMetaText}>
                Uploaded just now
              </Text>
            </View>
            <View style={styles.previewActions}>
              <TouchableOpacity
                style={[styles.smallBtn, { backgroundColor: "#fff" }]}
                onPress={onUpload}
                activeOpacity={0.8}
              >
                <Feather name="refresh-cw" size={12} color="#0a0a0a" />
                <Text style={styles.smallBtnText}>Replace</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallBtn, { backgroundColor: "#fff" }]}
                onPress={onRemove}
                activeOpacity={0.8}
              >
                <Feather name="trash-2" size={12} color={colors.destructive} />
                <Text style={[styles.smallBtnText, { color: colors.destructive }]}>
                  Remove
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={[
            styles.uploadZone,
            { borderColor: colors.border },
          ]}
          onPress={onUpload}
          activeOpacity={0.7}
        >
          <View style={[styles.uploadIconCircle, { backgroundColor: "#f0fdf4" }]}>
            <Feather name="upload-cloud" size={22} color={colors.primary} />
          </View>
          <Text style={[styles.uploadTitle, { color: colors.foreground }]}>
            Tap to upload
          </Text>
          <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>
            {doc.hint}
          </Text>
          <View style={styles.uploadMethodRow}>
            <View style={styles.uploadMethod}>
              <Feather name="camera" size={11} color={colors.mutedForeground} />
              <Text style={[styles.uploadMethodText, { color: colors.mutedForeground }]}>
                Camera
              </Text>
            </View>
            <View style={[styles.uploadDot, { backgroundColor: colors.border }]} />
            <View style={styles.uploadMethod}>
              <Feather name="image" size={11} color={colors.mutedForeground} />
              <Text style={[styles.uploadMethodText, { color: colors.mutedForeground }]}>
                Gallery
              </Text>
            </View>
            <View style={[styles.uploadDot, { backgroundColor: colors.border }]} />
            <Text style={[styles.uploadMethodText, { color: colors.mutedForeground }]}>
              JPG, PNG • 5MB
            </Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function DocumentUploadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [docs, setDocs] = useState<Record<DocId, DocState>>({
    aadhaar: { uri: null, uploadedAt: null },
    license: { uri: null, uploadedAt: null },
    rc: { uri: null, uploadedAt: null },
  });

  async function pickFor(id: DocId) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo access to upload.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setDocs((d) => ({
        ...d,
        [id]: { uri: result.assets[0].uri, uploadedAt: Date.now() },
      }));
    }
  }

  function removeDoc(id: DocId) {
    setDocs((d) => ({ ...d, [id]: { uri: null, uploadedAt: null } }));
  }

  const uploadedCount = Object.values(docs).filter((d) => d.uri).length;
  const progress = uploadedCount / DOCS.length;
  const allUploaded = uploadedCount === DOCS.length;

  function handleSubmit() {
    if (!allUploaded) return;
    router.replace("/verification-pending");
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
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
              Verification required to go online
            </Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.progressRow}>
          <View
            style={[styles.progressTrack, { backgroundColor: colors.border }]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: colors.primary,
                  width: `${Math.max(progress * 100, 4)}%`,
                },
              ]}
            />
          </View>
          <Text style={[styles.progressLabel, { color: colors.foreground }]}>
            {uploadedCount}/{DOCS.length}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.infoBanner,
            { backgroundColor: "#f0fdf4", borderColor: colors.primary },
          ]}
        >
          <View
            style={[
              styles.infoIconWrap,
              { backgroundColor: "rgba(0, 200, 83, 0.15)" },
            ]}
          >
            <Feather name="shield" size={16} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.infoTitle, { color: colors.foreground }]}>
              Your documents are safe
            </Text>
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              Encrypted end-to-end. Only used for driver verification.
            </Text>
          </View>
        </View>

        <View style={styles.docsList}>
          {DOCS.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              state={docs[doc.id]}
              onUpload={() => pickFor(doc.id)}
              onRemove={() => removeDoc(doc.id)}
            />
          ))}
        </View>

        <View
          style={[
            styles.tipBox,
            { backgroundColor: "#fff", borderColor: colors.border },
          ]}
        >
          <Text style={[styles.tipTitle, { color: colors.foreground }]}>
            Tips for a clear photo
          </Text>
          {[
            "Place document on a flat, dark surface",
            "Make sure all corners are visible",
            "Avoid glare and shadows",
            "Text should be readable",
          ].map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <View
                style={[styles.tipDot, { backgroundColor: colors.primary }]}
              />
              <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
                {tip}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

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
            color={allUploaded ? colors.primary : colors.mutedForeground}
          />
          <Text style={[styles.footerHintText, { color: colors.mutedForeground }]}>
            {allUploaded
              ? "All documents uploaded. Ready to submit."
              : `Upload ${DOCS.length - uploadedCount} more document${DOCS.length - uploadedCount > 1 ? "s" : ""} to continue.`}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: allUploaded ? colors.primary : colors.muted },
          ]}
          onPress={handleSubmit}
          activeOpacity={0.85}
          disabled={!allUploaded}
        >
          <Text
            style={[
              styles.submitBtnText,
              { color: allUploaded ? "#fff" : colors.mutedForeground },
            ]}
          >
            Submit for Verification
          </Text>
          <Feather
            name="arrow-right"
            size={18}
            color={allUploaded ? "#fff" : colors.mutedForeground}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

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
  headerSub: { fontSize: 12 },

  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: "700",
  },

  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },

  infoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  infoTitle: { fontSize: 13, fontWeight: "700" },
  infoText: { fontSize: 12, marginTop: 2 },

  docsList: { gap: 12 },

  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    gap: 14,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
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
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },

  uploadZone: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 22,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fafafa",
  },
  uploadIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  uploadTitle: { fontSize: 14, fontWeight: "700" },
  uploadHint: { fontSize: 12, textAlign: "center" },
  uploadMethodRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  uploadMethod: { flexDirection: "row", alignItems: "center", gap: 4 },
  uploadMethodText: { fontSize: 11, fontWeight: "500" },
  uploadDot: { width: 3, height: 3, borderRadius: 1.5 },

  previewWrap: {
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
    aspectRatio: 16 / 10,
    backgroundColor: "#f5f5f5",
  },
  previewImage: { width: "100%", height: "100%" },
  previewOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  previewMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
  },
  previewMetaText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  previewActions: { flexDirection: "row", gap: 6 },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 7,
  },
  smallBtnText: { fontSize: 11, fontWeight: "700", color: "#0a0a0a" },

  tipBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  tipTitle: { fontSize: 13, fontWeight: "700", marginBottom: 2 },
  tipRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tipDot: { width: 4, height: 4, borderRadius: 2 },
  tipText: { fontSize: 12 },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    gap: 10,
  },
  footerHint: { flexDirection: "row", alignItems: "center", gap: 6 },
  footerHintText: { fontSize: 12 },
  submitBtn: {
    height: 56,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitBtnText: { fontSize: 17, fontWeight: "700" },
});
