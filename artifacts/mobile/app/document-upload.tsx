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
 *  - All six doc types (including selfie) always show both Camera & Gallery.
 *  - Selfie "Take Photo" uses front camera; all others use back camera.
 *  - Permissions requested individually per source (camera vs media library).
 *  - Per-doc loading state shown while picker is active.
 *
 * Lock behavior:
 *  - approved / verified  → locked, no upload/replace
 *  - pending / submitted  → waiting, no replace while under review
 *  - rejected             → re-upload enabled
 *  - null / missing       → upload allowed
 */

import { SafeInlineIcon, SafeIconName, SafeIcon } from "@/components/SafeIcon";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Fragment, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image as RNImage,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
// onboardingFeeApplies is true only for brand-new signup drivers.
import { useColors } from "@/hooks/useColors";
import { registerDriverKeys, type DocumentNumbers } from "@/utils/driver-api";
import { getDriverVerificationStatus } from "@/utils/profile-api";
import { uploadDocumentImage, isRemoteUrl } from "@/utils/storage";
import { firebaseAuth } from "@/utils/firebase";

// ─── Types ───────────────────────────────────────────────────────────────────

type DocId = "selfie" | "aadhaarFront" | "aadhaarBack" | "pan" | "licenseFront" | "licenseBack" | "rcFront" | "rcBack";

/**
 * Raw status values that may arrive from Firestore / admin review.
 * Mapped to a NormalizedDocLock before driving UI.
 */
type RawDocStatus =
  | "approved"
  | "verified"
  | "rejected"
  | "pending"
  | "submitted"
  | "missing"
  | null
  | undefined;

/**
 * Canonical four-state lock model used throughout the UI.
 *
 *  locked   — admin approved; driver cannot change
 *  waiting  — submitted, under review; replacement blocked
 *  reupload — admin rejected; driver must re-upload
 *  upload   — no file yet or no status; driver can upload freely
 */
type NormalizedDocLock = "locked" | "waiting" | "reupload" | "upload";

function normalizeLock(status: RawDocStatus, hasUri: boolean): NormalizedDocLock {
  if (status === "approved" || status === "verified") return "locked";
  if (status === "rejected") return "reupload";
  if (status === "pending" || status === "submitted") return hasUri ? "waiting" : "upload";
  return "upload";
}

type DocSpec = {
  id: DocId;
  title: string;
  description: string;
  icon: SafeIconName;
  hint: string;
  /** selfie = use front-facing camera for "Take Photo" */
  isSelfie?: boolean;
};

const DOCS: DocSpec[] = [
  {
    id: "selfie",
    title: "Driver Selfie",
    description: "Clear photo of your face — no glasses or hat",
    icon: "camera",
    hint: "Look straight at camera, neutral background",
    isSelfie: true,
  },
  {
    id: "aadhaarFront",
    title: "Aadhaar Front",
    description: "Government ID — front side",
    icon: "id",
    hint: "All 12 digits and full name must be visible",
  },
  {
    id: "aadhaarBack",
    title: "Aadhaar Back",
    description: "Government ID — back side",
    icon: "id",
    hint: "Back side clearly visible — address readable",
  },
  {
    id: "pan",
    title: "PAN Card",
    description: "10-digit PAN required for earnings & tax",
    icon: "doc",
    hint: "PAN number and name must be clearly readable",
  },
  {
    id: "licenseFront",
    title: "Driving License Front",
    description: "Valid Indian driving license — front side",
    icon: "license",
    hint: "DL number, name, and expiry must be visible",
  },
  {
    id: "licenseBack",
    title: "Driving License Back",
    description: "Valid Indian driving license — back side",
    icon: "license",
    hint: "Vehicle categories and endorsements must be visible",
  },
  {
    id: "rcFront",
    title: "RC Front",
    description: "Registration Certificate — front side",
    icon: "rc",
    hint: "RC number, owner name, and vehicle details must be clear",
  },
  {
    id: "rcBack",
    title: "RC Back",
    description: "Registration Certificate — back side",
    icon: "rc",
    hint: "All details including insurance info must be visible",
  },
];

// ─── Per-doc state ────────────────────────────────────────────────────────────

type DocState = {
  uri: string | null;
  /** Raw asset.uri straight from ImagePicker — stored only for debug strip */
  originalUri?: string | null;
  uploadedAt: number | null;
  /** true while permission request or picker is open */
  loading: boolean;
  /**
   * Admin-set verification status — populated from Firestore once the
   * driver has submitted documents and the admin has reviewed them.
   * Leave undefined / null until real data is available.
   */
  status?: RawDocStatus;
  /**
   * true only when the driver picks a NEW replacement file in the current
   * session. Stays false for old rejected files pre-loaded from Firestore.
   * A rejected document is not ready until freshUpload is true.
   */
  freshUpload?: boolean;
};

const blankDoc = (): DocState => ({ uri: null, originalUri: null, uploadedAt: null, loading: false, freshUpload: false });

// ─── Document number validation ───────────────────────────────────────────────

function validateAadhaar(s: string): string | null {
  const clean = s.replace(/\s/g, "");
  if (!clean) return "Aadhaar number is required";
  if (!/^\d{12}$/.test(clean)) return "Must be exactly 12 digits";
  return null;
}
function validatePAN(s: string): string | null {
  const clean = s.trim().toUpperCase();
  if (!clean) return "PAN number is required";
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(clean)) return "Format: ABCDE1234F";
  return null;
}
function validateDL(s: string): string | null {
  const clean = s.trim();
  if (!clean) return "DL number is required";
  return null;
}
function validateRC(s: string): string | null {
  const clean = s.trim();
  if (!clean) return "RC / registration number is required";
  return null;
}

/**
 * Returns the id of the LAST card in `arr` whose id is in `ids`.
 * Used to decide which card gets the inline number input rendered below it.
 * Returns null when none of the ids appear (group not visible → input skipped).
 */
function lastInGroup(arr: DocSpec[], ids: DocId[]): DocId | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (ids.includes(arr[i]!.id)) return arr[i]!.id;
  }
  return null;
}

// ─── Permission helpers ───────────────────────────────────────────────────────

async function requestCamera(): Promise<boolean> {
  console.log("[UPLOAD] request camera start");
  const { status, canAskAgain } =
    await ImagePicker.requestCameraPermissionsAsync();
  console.log("[UPLOAD] request camera result =", status);
  if (status === "granted") return true;
  const msg = canAskAgain
    ? "Camera permission is needed to take a photo. Please allow it."
    : "Camera access is blocked. Open Settings → App → Permissions → Camera.";
  Alert.alert("Camera permission required", msg, [{ text: "OK" }]);
  return false;
}

async function requestGallery(): Promise<boolean> {
  console.log("[UPLOAD] request gallery start");
  const { status, canAskAgain } =
    await ImagePicker.requestMediaLibraryPermissionsAsync();
  console.log("[UPLOAD] request gallery result =", status);
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

async function openCamera(front: boolean): Promise<ImagePicker.ImagePickerAsset | null> {
  const ok = await requestCamera();
  if (!ok) return null;
  console.log("[UPLOAD] launch camera start, front =", front);
  try {
    const result = await ImagePicker.launchCameraAsync({
      cameraType: front
        ? ImagePicker.CameraType.front
        : ImagePicker.CameraType.back,
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.85,
    });
    console.log("[UPLOAD] launch camera result =", JSON.stringify({ canceled: result.canceled, assets: result.assets?.length ?? 0 }));
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];
    console.log("[UPLOAD] selected uri =", asset.uri);
    return asset;
  } catch (e) {
    console.warn("[UPLOAD] openCamera error", e);
    Alert.alert("Camera error", "Could not open camera. Please try again.");
    return null;
  }
}

async function openGallery(): Promise<ImagePicker.ImagePickerAsset | null> {
  const ok = await requestGallery();
  if (!ok) return null;
  console.log("[UPLOAD] launch gallery start");
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.85,
    });
    console.log("[UPLOAD] launch gallery result =", JSON.stringify({ canceled: result.canceled, assets: result.assets?.length ?? 0 }));
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];
    console.log("[UPLOAD] selected uri =", asset.uri);
    return asset;
  } catch (e) {
    console.warn("[UPLOAD] openGallery error", e);
    Alert.alert("Gallery error", "Could not open gallery. Please try again.");
    return null;
  }
}

// ─── Image copy helper ────────────────────────────────────────────────────────
// ImagePicker returns a short-lived temp URI inside Expo Go's own sandbox.
// RNImage sometimes fails to render those transient paths. Copying to our own
// cache directory gives us a stable file:// URI that RNImage can always read.

async function copyPickedImageToAppCache(
  uri: string,
  id: string,
): Promise<string> {
  if (!uri) return uri;
  const lower = uri.toLowerCase();
  const ext = lower.includes(".png")
    ? "png"
    : lower.includes(".webp")
      ? "webp"
      : "jpg";
  const fileName = `driver-doc-${id}-${Date.now()}.${ext}`;
  const target = new File(Paths.cache, fileName);
  const source = new File(uri);
  try {
    await source.copy(target);
    return target.uri;
  } catch (e) {
    return uri;
  }
}

// ─── Action sheet (cross-platform, no dynamic require) ────────────────────────

function showSourceSheet(
  isSelfie: boolean,
  onCamera: () => void,
  onGallery: () => void,
) {
  console.log("[UPLOAD_FLOW] opening source sheet, isSelfie =", isSelfie);
  const cameraLabel = isSelfie ? "Take Selfie (Front Camera)" : "Take Photo (Camera)";
  Alert.alert(
    isSelfie ? "Upload Selfie" : "Upload Document",
    "Choose how to add your photo",
    [
      {
        text: cameraLabel,
        onPress: () => {
          console.log("[UPLOAD_FLOW] camera selected");
          onCamera();
        },
      },
      {
        text: "Choose from Gallery",
        onPress: () => {
          console.log("[UPLOAD_FLOW] gallery selected");
          onGallery();
        },
      },
      { text: "Cancel", style: "cancel" },
    ],
    { cancelable: true },
  );
}

// ─── Status chip ──────────────────────────────────────────────────────────────

function DocStatusChip({ lock }: { lock: NormalizedDocLock }) {
  const colors = useColors();
  type ChipCfg = { bg: string; color: string; label: string; icon: SafeIconName | null };
  const CFG: Record<NormalizedDocLock, ChipCfg> = {
    locked:   { bg: colors.successSoft,  color: colors.success,         label: "Verified • Locked", icon: "lock"    },
    waiting:  { bg: colors.warningSoft,  color: colors.warning,         label: "Pending",  icon: "clock"   },
    reupload: { bg: colors.errorSoft,    color: colors.error,           label: "Rejected", icon: "warning" },
    upload:   { bg: colors.muted,        color: colors.mutedForeground, label: "Required", icon: null      },
  };
  const cfg = CFG[lock];

  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      {cfg.icon && <SafeInlineIcon name={cfg.icon} size={10} color={cfg.color} />}
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

// ─── DocumentCard ─────────────────────────────────────────────────────────────


function DocumentCard({
  doc,
  state,
  lockState,
  onUpload,
  onRemove,
}: {
  doc: DocSpec;
  state: DocState;
  lockState: NormalizedDocLock;
  onUpload: () => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const uploaded = !!state.uri;
  const previewUri =
    typeof state.uri === "string" && state.uri.length > 0
      ? state.uri
      : null;

  const cardBorderColor = {
    locked:   colors.success,
    waiting:  colors.warning,
    reupload: colors.error,
    upload:   uploaded ? colors.success : colors.border,
  }[lockState];

  const iconBg = {
    locked:   colors.successSoft,
    waiting:  colors.warningSoft,
    reupload: colors.errorSoft,
    upload:   uploaded ? colors.successSoft : colors.muted,
  }[lockState];

  const iconColor = {
    locked:   colors.success,
    waiting:  colors.warning,
    reupload: colors.error,
    upload:   uploaded ? colors.success : colors.primary,
  }[lockState];

  const isActive = lockState === "locked" || (lockState === "upload" && uploaded);

  return (
    <View
      style={[
        styles.card,
        {
          borderColor:   cardBorderColor,
          backgroundColor: colors.surfaceElevated,
          shadowColor:   cardBorderColor,
          shadowOpacity: isActive ? 0.18 : 0.07,
          shadowRadius:  isActive ? 14   : 6,
          shadowOffset:  { width: 0, height: isActive ? 5 : 2 },
          elevation:     isActive ? 6    : 2,
        },
      ]}
    >

      {/* ── Header row ── */}
      <View style={styles.cardHeader}>
        <SafeIcon
          name={doc.icon}
          size={44}
          color={iconColor}
          bg={iconBg}
          rounded={13}
        />
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            {doc.title}
          </Text>
          <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
            {doc.description}
          </Text>
        </View>
        <DocStatusChip lock={lockState} />
      </View>

      {/* ── Body ── */}
      {state.loading ? (

        /* Loading spinner */
        <View style={[styles.loadingBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Opening picker…
          </Text>
        </View>

      ) : lockState === "locked" ? (

        /* ── LOCKED — approved / verified ── */
        uploaded ? (
          <>
            <View style={styles.previewWrap}>
              <RNImage
                source={{ uri: previewUri ?? "" }}
                style={styles.previewImg}
                resizeMode="cover"
              />
            </View>
            <View style={[styles.previewBar, { backgroundColor: "rgba(5,150,105,0.90)" }]}>
              <SafeInlineIcon name="lock" size={13} color="#fff" />
              <Text style={styles.previewBarText}>Verified — changes locked</Text>
            </View>
          </>
        ) : (
          <View
            style={[
              styles.lockedEmptyBox,
              { borderColor: colors.success, backgroundColor: colors.successSoft },
            ]}
          >
            <SafeInlineIcon name="lock" size={22} color={colors.success} />
            <Text style={[styles.lockedLabel, { color: colors.successText }]}>
              Verified — changes locked
            </Text>
          </View>
        )

      ) : lockState === "waiting" ? (

        /* ── WAITING — pending / submitted ── */
        uploaded ? (
          <>
            <View style={styles.previewWrap}>
              <RNImage
                source={{ uri: previewUri ?? "" }}
                style={styles.previewImg}
                resizeMode="cover"
              />
            </View>
            <View style={[styles.previewBar, { backgroundColor: "rgba(217,119,6,0.90)" }]}>
              <SafeInlineIcon name="clock" size={13} color="#fff" />
              <Text style={styles.previewBarText}>Pending verification</Text>
            </View>
          </>
        ) : (
          <View
            style={[
              styles.lockedEmptyBox,
              { borderColor: colors.warning, backgroundColor: colors.warningSoft },
            ]}
          >
            <SafeInlineIcon name="clock" size={22} color={colors.warning} />
            <Text style={[styles.lockedLabel, { color: colors.warningText }]}>
              Pending verification
            </Text>
          </View>
        )

      ) : lockState === "reupload" ? (

        /* ── REUPLOAD — rejected by admin ── */
        <>
          <View
            style={[
              styles.rejectedBanner,
              { backgroundColor: colors.errorSoft, borderColor: colors.error },
            ]}
          >
            <SafeInlineIcon name="warning" size={14} color={colors.error} />
            <Text style={[styles.rejectedBannerText, { color: colors.error }]}>
              Rejected — upload again
            </Text>
          </View>
          {uploaded ? (
            <>
              <View style={styles.previewWrap}>
                <RNImage
                  source={{ uri: previewUri ?? "" }}
                  style={styles.previewImg}
                  resizeMode="cover"
                />
              </View>
              <View style={[styles.previewBar, { backgroundColor: "rgba(220,38,38,0.88)" }]}>
                <Text style={styles.previewBarText}>Previous upload (rejected)</Text>
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={styles.barBtn} onPress={() => { console.log("[UPLOAD_FLOW] button pressed", doc.id, "state=reupload-replace"); onUpload(); }} activeOpacity={0.8}>
                  <SafeInlineIcon name="refresh" size={11} color="#fff" />
                  <Text style={styles.barBtnText}>Replace</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View
              style={[
                styles.uploadZone,
                { borderColor: colors.error, backgroundColor: colors.errorSoft },
              ]}
            >
              <TouchableOpacity style={styles.uploadBtn} onPress={() => { console.log("[UPLOAD_FLOW] button pressed", doc.id, "state=reupload-empty"); onUpload(); }} activeOpacity={0.82}>
                <View style={[styles.uploadBtnSolid, { backgroundColor: colors.error }]}>
                  <SafeInlineIcon name="arrow" size={17} color="#fff" />
                  <Text style={styles.uploadBtnText}>
                    {doc.isSelfie ? "Upload Selfie Again" : "Upload Again"}
                  </Text>
                </View>
              </TouchableOpacity>
              <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>
                {doc.hint}
              </Text>
            </View>
          )}
        </>

      ) : uploaded ? (

        /* ── UPLOADED — normal, no status yet ── */
        <>
          <View style={styles.previewWrap}>
            <RNImage
              source={{ uri: previewUri ?? "" }}
              style={styles.previewImg}
              resizeMode="cover"
            />
          </View>
          <View style={styles.previewBar}>
            <SafeInlineIcon name="check" size={13} color="#fff" />
            <Text style={styles.previewBarText}>
              {doc.isSelfie ? "Selfie saved" : "Document saved"}
            </Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.barBtn} onPress={() => { console.log("[UPLOAD_FLOW] button pressed", doc.id, "state=uploaded-retake"); onUpload(); }} activeOpacity={0.8}>
              <SafeInlineIcon name="refresh" size={11} color="#fff" />
              <Text style={styles.barBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.barBtn, { backgroundColor: "rgba(220,38,38,0.22)" }]}
              onPress={onRemove}
              activeOpacity={0.8}
            >
              <SafeInlineIcon name="close" size={11} color={colors.error} />
            </TouchableOpacity>
          </View>
        </>

      ) : (

        /* ── EMPTY — no file, upload allowed ── */
        <View
          style={[
            styles.uploadZone,
            { borderColor: colors.primary, backgroundColor: colors.primarySoft },
          ]}
        >
          <TouchableOpacity style={styles.uploadBtn} onPress={() => { console.log("[UPLOAD_FLOW] button pressed", doc.id, "state=empty"); onUpload(); }} activeOpacity={0.82}>
            <View style={[styles.uploadBtnSolid, { backgroundColor: colors.primary }]}>
              <SafeInlineIcon name="camera" size={17} color="#fff" />
              <Text style={styles.uploadBtnText}>
                {doc.isSelfie ? "Take Selfie" : "Take Photo / Upload"}
              </Text>
            </View>
          </TouchableOpacity>
          <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>
            {doc.hint}
          </Text>
          <View style={styles.tagsRow}>
            <View style={styles.tag}>
              <SafeInlineIcon name="camera" size={9} color={colors.mutedForeground} />
              <Text style={[styles.tagText, { color: colors.mutedForeground }]}>Camera</Text>
            </View>
            <View style={[styles.tagDot, { backgroundColor: colors.border }]} />
            <View style={styles.tag}>
              <SafeInlineIcon name="gallery" size={9} color={colors.mutedForeground} />
              <Text style={[styles.tagText, { color: colors.mutedForeground }]}>Gallery</Text>
            </View>
            <View style={[styles.tagDot, { backgroundColor: colors.border }]} />
            <View style={styles.tag}>
              <SafeInlineIcon name="lock" size={9} color={colors.mutedForeground} />
              <Text style={[styles.tagText, { color: colors.mutedForeground }]}>Encrypted</Text>
            </View>
          </View>
        </View>

      )}


    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DocumentUploadScreen() {
  const colors     = useColors();
  const insets     = useSafeAreaInsets();
  const router     = useRouter();
  const { driverUid, onboardingFeeApplies, onboardingFeeStatus, phone, profile, refreshKycStatus, verificationStatus } = useDriver();

  // Company policy: once a driver is approved/verified, ALL documents are
  // read-only — no edit, replace, delete, re-upload, or picker. This driver-
  // level lock overrides the per-document status so even docs without an
  // individual "approved" flag are locked once the account is verified.
  const driverLocked = verificationStatus === "approved" || verificationStatus === "verified";
  const [submitting,        setSubmitting]        = useState(false);
  const [uploadStatusText,  setUploadStatusText]  = useState<string>("");

  const [docsLoading, setDocsLoading] = useState(true);

  const [docNumbers, setDocNumbers] = useState<DocumentNumbers>({ aadhaar: "", pan: "", license: "", rc: "" });
  const [numTouched, setNumTouched] = useState({ aadhaar: false, pan: false, license: false, rc: false });
  const [docs, setDocs] = useState<Record<DocId, DocState>>(() =>
    Object.fromEntries(DOCS.map((d) => [d.id, blankDoc()])) as Record<DocId, DocState>,
  );

  // ── Load persisted document state from PostgreSQL on mount ──
  useEffect(() => {
    if (!driverUid) { setDocsLoading(false); return; }
    getDriverVerificationStatus()
      .then((verificationStatus) => {
        // Top-level rejectedDocuments array — written by admin reject endpoint
        // alongside per-doc status. Used as a fallback when per-doc status
        // was never written (e.g. admin rejected before the nested MAP existed).
        const fallbackRejectedIds: string[] =
          verificationStatus?.verificationStatus === "rejected"
            ? (verificationStatus.rejectedDocuments ?? [])
            : [];

        setDocs((prev) => {
          const next = { ...prev };

          // Step 1 — load from the nested documents MAP (source of truth)
          if (verificationStatus?.documents) {
            const stored = verificationStatus.documents as Record<
              string,
              { url?: string | null; status?: string | null; rejectionReason?: string | null } | undefined
            >;
            for (const d of DOCS) {
              const entry = stored[d.id];
              if (entry) {
                next[d.id] = {
                  ...blankDoc(),
                  uri:         entry.url ?? null,
                  status:      (entry.status as RawDocStatus) ?? null,
                  // freshUpload stays false — driver must re-pick in this session
                  // to prove they have the corrected file.
                  freshUpload: false,
                };
              }
            }
          }

          // Step 2 — fallback: if verificationStatus=rejected but no per-doc
          // status is "rejected" in the MAP yet (admin rejected before MAP
          // existed), seed those doc IDs as "rejected" from the top-level array.
          const anyRejectedInMap = DOCS.some(d => next[d.id].status === "rejected");
          if (!anyRejectedInMap && fallbackRejectedIds.length > 0) {
            for (const id of fallbackRejectedIds) {
              const spec = DOCS.find(d => d.id === id);
              if (spec) {
                console.log("[DOC_UPLOAD] fallback: seeding status=rejected for", id, "from rejectedDocuments array");
                next[spec.id] = { ...next[spec.id], status: "rejected" };
              }
            }
          }

          console.log("[DOC_UPLOAD_STATE_LOADED]", JSON.stringify({
            verificationStatus:   verificationStatus?.verificationStatus ?? "(absent)",
            kycRejectionReason:   verificationStatus?.kycRejectionReason ?? "(absent)",
            fallbackRejectedIds,
            anyRejectedInMap,
            pan:    { status: next.pan.status,    uri: next.pan.uri    ? "EXISTS" : null },
            selfie: { status: next.selfie.status, uri: next.selfie.uri ? "EXISTS" : null },
          }, null, 2));

          return next;
        });

        setDocsLoading(false);
      })
      .catch(() => setDocsLoading(false));
  }, [driverUid]);

  // ── Helpers ──

  function patch(id: DocId, partial: Partial<DocState>) {
    setDocs((prev) => ({ ...prev, [id]: { ...prev[id], ...partial } }));
  }

  function removeDoc(id: DocId) {
    // Driver-level lock — verified driver cannot delete/clear any doc.
    if (driverLocked) return;
    setDocs((prev) => ({
      ...prev,
      [id]: { ...blankDoc(), status: prev[id].status, freshUpload: false },
    }));
  }

  /**
   * Run the picker (camera or gallery) and apply the result.
   * Must be called from inside an Alert.alert callback — not from
   * a sync context — so that the Alert dismisses before the picker opens.
   */
  async function runPicker(id: DocId, pickFn: () => Promise<ImagePicker.ImagePickerAsset | null>) {
    patch(id, { loading: true });
    try {
      const asset = await pickFn();
      if (asset) {
        const previewUri = await copyPickedImageToAppCache(asset.uri, id);
        patch(id, {
          uri: previewUri,
          originalUri: asset.uri,
          uploadedAt: Date.now(),
          loading: false,
          freshUpload: true,
        });
      } else {
        patch(id, { loading: false });
      }
    } catch (error) {
      console.error("[UPLOAD_FLOW] upload error, id =", id, String(error));
      Alert.alert(
        "Upload Error",
        String(error instanceof Error ? error.message : error),
      );
      patch(id, { loading: false });
    }
  }

  function handleUpload(doc: DocSpec) {
    console.log("[UPLOAD_FLOW] button pressed, doc id =", doc.id);
    // Driver-level lock — verified driver cannot open the picker for any doc.
    if (driverLocked) {
      console.log("[UPLOAD_FLOW] blocked — driver verified, documents locked");
      return;
    }
    const st = docs[doc.id];
    const lock = normalizeLock(st.status, !!st.uri);
    console.log("[UPLOAD_FLOW] lock =", lock);
    // Defensive guard — buttons are hidden for locked/waiting, but guard anyway
    if (lock === "locked" || lock === "waiting") return;
    showSourceSheet(
      !!doc.isSelfie,
      () => runPicker(doc.id, () => openCamera(!!doc.isSelfie)),
      () => runPicker(doc.id, openGallery),
    );
  }

  // ── Derived ──

  /**
   * Readiness helper — returns true when a single doc requires no further
   * action from the driver:
   *
   *   locked   — admin approved/verified, no action needed
   *   waiting  — file exists and is under review
   *   reupload — driver MUST provide a fresh file this session (old rejected
   *              file does NOT satisfy this — freshUpload must be true)
   *   upload   — driver has uploaded a file in this or a previous session
   */
  function isDocReady(st: DocState): boolean {
    const lock = normalizeLock(st.status, !!st.uri);
    if (lock === "locked") return true;
    if (lock === "waiting") return true;
    if (lock === "reupload") return !!st.freshUpload;
    return !!st.uri;
  }

  /**
   * Re-upload mode: true when at least one doc has been marked "rejected" by
   * the admin.  In this mode only rejected cards are shown as actionable;
   * other docs that are already on file are shown in a compact summary row.
   */
  const reuploadModeActive = !docsLoading && DOCS.some(
    (d) => normalizeLock(docs[d.id].status, !!docs[d.id].uri) === "reupload",
  );

  /**
   * Docs the driver must act on in the current mode:
   *  - re-upload mode → only "reupload" (rejected) docs
   *  - initial upload → all docs
   */
  const actionDocs = reuploadModeActive
    ? DOCS.filter((d) => normalizeLock(docs[d.id].status, !!docs[d.id].uri) === "reupload")
    : DOCS;

  /**
   * Docs that already have files and require no further action from the driver.
   * Only shown (as a compact row) in re-upload mode.
   */
  const alreadySubmittedDocs = reuploadModeActive
    ? DOCS.filter((d) => {
        const lk = normalizeLock(docs[d.id].status, !!docs[d.id].uri);
        return lk === "waiting" || lk === "locked";
      })
    : [];

  // ── Runtime diagnostic — fires once loading completes and whenever docs change ──
  useEffect(() => {
    if (docsLoading) return;
    console.log("[DOC_UPLOAD_STATE]", JSON.stringify({
      pan:   { status: docs.pan.status,   uri: docs.pan.uri   ? "EXISTS" : null, freshUpload: docs.pan.freshUpload },
      selfie: { status: docs.selfie.status, uri: docs.selfie.uri ? "EXISTS" : null },
      reuploadModeActive,
      actionDocs:           actionDocs.map(d => d.id),
      alreadySubmittedDocs: alreadySubmittedDocs.map(d => d.id),
    }, null, 2));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsLoading, docs]);

  /**
   * Progress bar: in re-upload mode count only rejected docs that have a
   * fresh file; otherwise count all ready docs.
   */
  const uploadedCount = reuploadModeActive
    ? actionDocs.filter((d) => isDocReady(docs[d.id])).length
    : DOCS.filter((d) => isDocReady(docs[d.id])).length;

  const total    = reuploadModeActive ? actionDocs.length : DOCS.length;
  const progress = total > 0 ? uploadedCount / total : 0;

  // Which card in each group is the last one visible in actionDocs?
  // The inline number input renders beneath that card.
  // If a group has no cards (e.g. all approved in re-upload mode),
  // its trigger is null and its number is not required for submission.
  const aadhaarTrigger = lastInGroup(actionDocs, ["aadhaarFront", "aadhaarBack"]);
  const panTrigger     = lastInGroup(actionDocs, ["pan"]);
  const licenseTrigger = lastInGroup(actionDocs, ["licenseFront", "licenseBack"]);
  const rcTrigger      = lastInGroup(actionDocs, ["rcFront", "rcBack"]);

  // Number input is only shown after ALL images in its group are uploaded.
  // Driver reads the number from the uploaded scan — images must come first.
  const aadhaarNumVisible = aadhaarTrigger !== null
    && isDocReady(docs["aadhaarFront"])
    && isDocReady(docs["aadhaarBack"]);
  const panNumVisible     = panTrigger !== null
    && isDocReady(docs["pan"]);
  const licenseNumVisible = licenseTrigger !== null
    && isDocReady(docs["licenseFront"])
    && isDocReady(docs["licenseBack"]);
  const rcNumVisible      = rcTrigger !== null
    && isDocReady(docs["rcFront"])
    && isDocReady(docs["rcBack"]);

  // Validation only applies to visible fields.
  // When all 8 images are uploaded every field is visible and all 4 numbers are required.
  const numbersValid = (
    (aadhaarNumVisible ? validateAadhaar(docNumbers.aadhaar ?? "") === null : true) &&
    (panNumVisible     ? validatePAN(docNumbers.pan ?? "") === null         : true) &&
    (licenseNumVisible ? validateDL(docNumbers.license ?? "") === null      : true) &&
    (rcNumVisible      ? validateRC(docNumbers.rc ?? "") === null           : true)
  );

  /**
   * allReady = true only when:
   *   • every required document image is uploaded   (DOCS.every isDocReady)
   *   • every visible number field passes validation (numbersValid)
   * Either condition being false keeps the submit button disabled.
   */
  const allReady = DOCS.every((d) => isDocReady(docs[d.id])) && numbersValid;

  async function handleSubmit() {
    if (!allReady || submitting || docsLoading) return;
    if (!driverUid) {
      console.error("[KYC] handleSubmit: driverUid is null — aborting");
      return;
    }

    // ── Auth UID check ────────────────────────────────────────────────────────
    const authUid = firebaseAuth.currentUser?.uid ?? null;
    console.log("[KYC] auth check — authUid:", authUid, "| driverUid:", driverUid, "| match:", authUid === driverUid);
    if (!authUid) {
      console.error("[KYC] Firebase auth currentUser is null — cannot write");
      Alert.alert("Session Expired", "Please log out and sign in again.", [{ text: "OK" }]);
      return;
    }

    setSubmitting(true);
    setUploadStatusText("Checking account…");

    // ── Phase 1: duplicate-driver check ──────────────────────────────────────
    console.log("[KYC] phase 1 — registerDriverKeys start");
    let keysResult: Awaited<ReturnType<typeof registerDriverKeys>>;
    try {
      keysResult = await registerDriverKeys({
        driverUid,
        phone,
        licenseNumber: profile?.licenseNumber,
        vehicleNumber: profile?.vehicleNumber,
      });
      console.log("[KYC] phase 1 — registerDriverKeys result:", JSON.stringify(keysResult));
    } catch (err) {
      const e = err as Error;
      console.error("[KYC] phase 1 — registerDriverKeys THREW:", e?.message, e?.stack);
      Alert.alert("Submission Error", "Could not verify account. Please try again.");
      setSubmitting(false);
      setUploadStatusText("");
      return;
    }
    if (!keysResult.ok) {
      console.warn("[KYC] phase 1 — duplicate detected:", keysResult.message);
      Alert.alert("Account Already Exists", keysResult.message, [{ text: "OK" }]);
      setSubmitting(false);
      setUploadStatusText("");
      return;
    }

    // ── Phase 2: upload each document to the VPS server ──────────────────────
    console.log("[KYC] phase 2 — VPS uploads start");
    const docsToUpload = DOCS.filter((d) => {
      const st   = docs[d.id];
      const lock = normalizeLock(st.status, !!st.uri);
      return lock !== "locked" && st.uri && !isRemoteUrl(st.uri);
    });
    const docUris: Record<string, string | null> = {};
    let uploadedSoFar = 0;

    for (const d of DOCS) {
      const st   = docs[d.id];
      const lock = normalizeLock(st.status, !!st.uri);
      if (lock === "locked" || lock === "waiting") {
        // locked   = admin-approved, must not change
        // waiting  = non-rejected doc already on file; preserve its Firestore status
        console.log(`[KYC] ${d.id} — ${lock}, skipping — Firestore status preserved`);
        continue;
      }

      if (st.uri && !isRemoteUrl(st.uri)) {
        uploadedSoFar += 1;
        setUploadStatusText(
          `Uploading ${d.title} (${uploadedSoFar}/${docsToUpload.length})…`,
        );
        console.log(`[KYC] ${d.id} — uploading local URI: ${st.uri.slice(0, 80)}`);
        try {
          const downloadURL = await uploadDocumentImage(driverUid, d.id, st.uri);
          console.log(`[KYC] ${d.id} — VPS OK: ${downloadURL.slice(0, 80)}`);
          docUris[d.id] = downloadURL;
        } catch (err) {
          const e = err as Error & { code?: string };
          console.error(`[KYC] ${d.id} — VPS FAILED code=${e?.code} msg=${e?.message}`);
          console.error(`[KYC] ${d.id} — VPS stack:`, e?.stack);
          Alert.alert(
            `Upload Failed — ${d.title}`,
            `Could not upload this document. Check your internet connection and tap Submit again.\n\n${e?.message ?? String(err)}`,
            [{ text: "OK" }],
          );
          setSubmitting(false);
          setUploadStatusText("");
          return;
        }
      } else if (st.uri && isRemoteUrl(st.uri)) {
        console.log(`[KYC] ${d.id} — already remote URL, skipping re-upload`);
        docUris[d.id] = st.uri;
      } else {
        console.log(`[KYC] ${d.id} — uri is null`);
        docUris[d.id] = null;
      }
    }
    console.log("[KYC] phase 2 — all VPS uploads done. docUris keys:", Object.keys(docUris));

    // ── Persistence ──────────────────────────────────────────────────────────
    // No separate PostgreSQL submit step is needed: the /api/kyc/upload-open
    // endpoint upserts each driver_documents row (status='pending') AND flips the
    // drivers row to documents_submitted=true / verification_status='pending' on
    // every successful upload above. Document numbers are not accepted by that
    // endpoint, so they are not persisted here.
    console.log("[KYC] phase 3 — uploads complete, PG rows written by upload-open");
    void docUris;

    // ── Flush context state before routing ────────────────────────────────────
    // refreshKycStatus() reads the PG verification-status endpoint and calls
    // setVerifStatus / setKycRejectionReason so that verification-pending.tsx
    // renders the pending branch — not the rejected branch — from the first frame.
    setUploadStatusText("Finalising…");
    await refreshKycStatus();

    // ── Route ─────────────────────────────────────────────────────────────────
    // New signup drivers who haven't paid yet → onboarding fee screen.
    // Rejected drivers re-uploading (fee already paid) → verification-pending.
    // Guard: both flags must be true — applies=true AND status!="paid".
    const feeOwed = onboardingFeeApplies === true && onboardingFeeStatus !== "paid";
    console.log("[KYC] submit complete — routing, onboardingFeeApplies:", onboardingFeeApplies, "onboardingFeeStatus:", onboardingFeeStatus, "feeOwed:", feeOwed);
    router.replace(feeOwed ? "/onboarding-fee" : "/verification-pending");
  }

  // ── Render ──

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>

      {/* ────── Header ────── */}
      <View
        style={[
          styles.header,
          {
            paddingTop:        insets.top + 10,
            backgroundColor:   "#FFFFFF",
            borderBottomColor: "#E5E7EB",
          },
        ]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <SafeInlineIcon name="back" size={18} color="#111827" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Upload Documents</Text>
            <Text style={styles.headerSub}>Step 4 of 4</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {/* Dot-and-line progress (all 4 filled) */}
        <View style={styles.progressRow}>
          {[1, 2, 3, 4].map((s, i) => (
            <View key={s} style={styles.progressSegment}>
              <View style={[styles.stepDot, { backgroundColor: "#F59E0B" }]}>
                <SafeInlineIcon name="check" size={9} color="#fff" />
              </View>
              {i < 3 && (
                <View style={[styles.progressLine, { backgroundColor: "#F59E0B" }]} />
              )}
            </View>
          ))}
        </View>

        {/* Upload count */}
        <View style={styles.uploadCountRow}>
          <View style={[styles.uploadTrack, { backgroundColor: "#F3F4F6" }]}>
            <View
              style={[
                styles.uploadFill,
                {
                  width:           `${Math.max(progress * 100, 3)}%`,
                  backgroundColor: progress >= 1 ? "#10B981" : "#F59E0B",
                },
              ]}
            />
          </View>
          <Text style={styles.uploadCountLabel}>
            {uploadedCount}/{total} uploaded
          </Text>
        </View>
      </View>

      {/* ────── Scroll content ────── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 180 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Security banner */}
        <View style={styles.banner}>
          <View style={styles.bannerIcon}>
            <SafeIcon name="shield" size={26} color="#10B981" bg="#A7F3D0" rounded={13} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Your documents are safe</Text>
            <Text style={styles.bannerSub}>
              End-to-end encrypted · Used only for driver verification
            </Text>
          </View>
        </View>

        {/* Doc cards — in re-upload mode only rejected docs appear as cards */}
        <View style={styles.docList}>
          {actionDocs.map((doc) => {
            const st = docs[doc.id];
            return (
              <Fragment key={doc.id}>
                <DocumentCard
                  doc={doc}
                  state={st}
                  lockState={driverLocked ? "locked" : normalizeLock(st.status, !!st.uri)}
                  onUpload={() => handleUpload(doc)}
                  onRemove={() => removeDoc(doc.id)}
                />

                {/* ── Aadhaar Number — shown only after BOTH Aadhaar images are uploaded ── */}
                {doc.id === aadhaarTrigger && aadhaarNumVisible && (()=>{
                  const err = numTouched.aadhaar ? validateAadhaar(docNumbers.aadhaar ?? "") : null;
                  return (
                    <View style={[styles.numInline, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.numLabel, { color: colors.foreground }]}>
                        Aadhaar Number <Text style={{ color: colors.error }}>*</Text>
                      </Text>
                      <TextInput
                        style={[styles.numInput, { borderColor: err ? colors.error : colors.border, color: colors.foreground, backgroundColor: colors.background }]}
                        placeholder="12-digit Aadhaar number"
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType="numeric"
                        maxLength={14}
                        value={docNumbers.aadhaar}
                        onChangeText={(t) => setDocNumbers((p) => ({ ...p, aadhaar: t.replace(/[^\d]/g, "") }))}
                        onBlur={() => setNumTouched((p) => ({ ...p, aadhaar: true }))}
                        returnKeyType="next"
                      />
                      {err ? <Text style={[styles.numError, { color: colors.error }]}>{err}</Text> : null}
                    </View>
                  );
                })()}

                {/* ── PAN Number — shown only after the PAN image is uploaded ── */}
                {doc.id === panTrigger && panNumVisible && (()=>{
                  const err = numTouched.pan ? validatePAN(docNumbers.pan ?? "") : null;
                  return (
                    <View style={[styles.numInline, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.numLabel, { color: colors.foreground }]}>
                        PAN Number <Text style={{ color: colors.error }}>*</Text>
                      </Text>
                      <TextInput
                        style={[styles.numInput, { borderColor: err ? colors.error : colors.border, color: colors.foreground, backgroundColor: colors.background }]}
                        placeholder="e.g. ABCDE1234F"
                        placeholderTextColor={colors.mutedForeground}
                        autoCapitalize="characters"
                        maxLength={10}
                        value={docNumbers.pan}
                        onChangeText={(t) => setDocNumbers((p) => ({ ...p, pan: t.toUpperCase().replace(/[^A-Z0-9]/g, "") }))}
                        onBlur={() => setNumTouched((p) => ({ ...p, pan: true }))}
                        returnKeyType="next"
                      />
                      {err ? <Text style={[styles.numError, { color: colors.error }]}>{err}</Text> : null}
                    </View>
                  );
                })()}

                {/* ── Driving Licence Number — shown only after BOTH Licence images are uploaded ── */}
                {doc.id === licenseTrigger && licenseNumVisible && (()=>{
                  const err = numTouched.license ? validateDL(docNumbers.license ?? "") : null;
                  return (
                    <View style={[styles.numInline, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.numLabel, { color: colors.foreground }]}>
                        Driving Licence Number <Text style={{ color: colors.error }}>*</Text>
                      </Text>
                      <TextInput
                        style={[styles.numInput, { borderColor: err ? colors.error : colors.border, color: colors.foreground, backgroundColor: colors.background }]}
                        placeholder="e.g. DL0420110012345"
                        placeholderTextColor={colors.mutedForeground}
                        autoCapitalize="characters"
                        value={docNumbers.license}
                        onChangeText={(t) => setDocNumbers((p) => ({ ...p, license: t.toUpperCase() }))}
                        onBlur={() => setNumTouched((p) => ({ ...p, license: true }))}
                        returnKeyType="next"
                      />
                      {err ? <Text style={[styles.numError, { color: colors.error }]}>{err}</Text> : null}
                    </View>
                  );
                })()}

                {/* ── RC / Registration Number — shown only after BOTH RC images are uploaded ── */}
                {doc.id === rcTrigger && rcNumVisible && (()=>{
                  const err = numTouched.rc ? validateRC(docNumbers.rc ?? "") : null;
                  return (
                    <View style={[styles.numInline, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.numLabel, { color: colors.foreground }]}>
                        RC / Registration Number <Text style={{ color: colors.error }}>*</Text>
                      </Text>
                      <TextInput
                        style={[styles.numInput, { borderColor: err ? colors.error : colors.border, color: colors.foreground, backgroundColor: colors.background }]}
                        placeholder="e.g. MH12AB1234"
                        placeholderTextColor={colors.mutedForeground}
                        autoCapitalize="characters"
                        value={docNumbers.rc}
                        onChangeText={(t) => setDocNumbers((p) => ({ ...p, rc: t.toUpperCase() }))}
                        onBlur={() => setNumTouched((p) => ({ ...p, rc: true }))}
                        returnKeyType="done"
                      />
                      {err ? <Text style={[styles.numError, { color: colors.error }]}>{err}</Text> : null}
                    </View>
                  );
                })()}
              </Fragment>
            );
          })}

          {/* Compact already-submitted list (re-upload mode only) */}
          {alreadySubmittedDocs.length > 0 && (
            <View style={[styles.alreadySubmittedBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.alreadySubmittedHeader}>
                <SafeInlineIcon name="check" size={14} color={colors.success} />
                <Text style={[styles.alreadySubmittedTitle, { color: colors.foreground }]}>
                  Already submitted — no action needed
                </Text>
              </View>
              {alreadySubmittedDocs.map((d) => (
                <View key={d.id} style={styles.alreadySubmittedRow}>
                  <SafeInlineIcon name="check" size={12} color={colors.success} />
                  <Text style={[styles.alreadySubmittedItem, { color: colors.mutedForeground }]}>
                    {d.title}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Tips */}
        <View
          style={[
            styles.tipBox,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.tipHeader}>
            <SafeInlineIcon name="info" size={13} color={colors.mutedForeground} />
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
              <View style={[styles.tipDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
                {tip}
              </Text>
            </View>
          ))}
        </View>

        {/* Platform notice (development helper) */}
        {Platform.OS === "android" && (
          <View style={[styles.platformNote, { backgroundColor: colors.muted }]}>
            <SafeInlineIcon name="info" size={12} color={colors.mutedForeground} />
            <Text style={[styles.platformNoteText, { color: colors.mutedForeground }]}>
              After selecting a photo, tap the checkmark / Done button to confirm.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ────── Sticky footer ────── */}
      {/* pointerEvents="box-none": footer background is touch-transparent so cards
          scrolled behind it still receive taps; child buttons remain interactive. */}
      <View
        pointerEvents="box-none"
        style={[
          styles.footer,
          {
            paddingBottom:   insets.bottom + 16,
            backgroundColor: colors.surface,
            borderTopColor:  colors.border,
          },
        ]}
      >
        <View style={styles.footerHint}>
          <SafeInlineIcon name={allReady ? "check" : "info"} size={13} color={allReady ? colors.success : colors.mutedForeground} />
          <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
            {allReady
              ? "All documents ready. Ready to submit."
              : `${total - uploadedCount} more document${total - uploadedCount > 1 ? "s" : ""} needed.`}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => void handleSubmit()}
          disabled={!allReady || submitting}
          activeOpacity={0.85}
          style={{ borderRadius: 14 }}
        >
          <LinearGradient
            colors={
              allReady && !submitting
                ? ["#FBBF24", "#F59E0B"]
                : ["#E5E7EB", "#E5E7EB"]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.submitGrad}
          >
            {submitting ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={[styles.submitText, { fontSize: 13 }]} numberOfLines={1}>
                  {uploadStatusText || "Submitting…"}
                </Text>
              </View>
            ) : (
              <>
                <Text style={[styles.submitText, !allReady && { color: "#9CA3AF" }]}>
                  Submit for Verification
                </Text>
                <SafeInlineIcon name="arrow" size={18} color={allReady ? "#fff" : "#9CA3AF"} />
              </>
            )}
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
    borderBottomWidth: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerCenter: { alignItems: "center" },
  headerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: "500",
    color: "#6B7280",
    marginTop: 1,
  },

  // Dot-and-line progress
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  progressSegment: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  progressLine: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    marginHorizontal: -1,
  },

  // Upload count bar
  uploadCountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
  },
  uploadTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
  },
  uploadFill: { height: "100%", borderRadius: 3 },
  uploadCountLabel: { fontSize: 12, fontWeight: "700", color: "#111827" },

  // Scroll
  scroll: { paddingHorizontal: 16, paddingTop: 14, gap: 14 },

  // Banner
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#6EE7B7",
    backgroundColor: "#D1FAE5",
  },
  bannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: "#A7F3D0",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerTitle: { fontSize: 14, fontWeight: "800", color: "#065F46", marginBottom: 2 },
  bannerSub:   { fontSize: 12, fontWeight: "500", color: "#047857", lineHeight: 17 },

  // Doc list
  docList: { gap: 12 },

  // Card — shadow/border/bg injected inline via useColors()
  card: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 14,
    gap: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  docIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  docEmoji:       { /* replaced by Feather icon */ },
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

  // Loading — bg/border injected inline
  loadingBox: {
    height: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  loadingText: { fontSize: 13, fontWeight: "500" },

  // Locked / waiting empty box — bg/border injected inline
  lockedEmptyBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 18,
    borderRadius: 12,
    borderWidth: 1,
  },
  lockedLabel: { fontSize: 13, fontWeight: "700" },

  // Rejected banner — bg/border injected inline
  rejectedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  rejectedBannerText: { fontSize: 13, fontWeight: "700" },

  // Upload zone — bg/border injected inline
  // NOTE: borderStyle:"dashed" is intentionally NOT used — on Android it uses a
  // special canvas path that silently blocks all touch events on children.
  uploadZone: {
    borderWidth: 1.5,
    borderStyle: "solid",
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 10,
  },
  // NOTE: overflow:"hidden" is on the inner solid View, NOT on the TouchableOpacity.
  // On Android New Architecture (RN 0.81+) overflow:"hidden" on a TouchableOpacity
  // clips the touch ripple area and can prevent press registration entirely.
  uploadBtn:      { width: "100%", borderRadius: 12 },
  uploadBtnSolid: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    overflow: "hidden",
  },
  uploadBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  uploadHint:    { fontSize: 12, textAlign: "center" },
  tagsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  tag:     { flexDirection: "row", alignItems: "center", gap: 3 },
  tagText: { fontSize: 10, fontWeight: "500" },
  tagDot:  { width: 3, height: 3, borderRadius: 1.5 },

  // Preview
  previewWrap: {
    width: "100%",
    height: 260,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#F3F4F6",
    marginTop: 18,
  },
  previewWrapSquare: { height: 260 },
  previewImg: {
    width: "100%",
    height: "100%" as unknown as number,
  },
  previewFallback: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  previewFallbackText: {
    color: "#6B7280",
    fontSize: 12,
    fontWeight: "500" as const,
    textAlign: "center" as const,
  },

  previewBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderRadius: 12,
    marginTop: 8,
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
  barBtnText: { fontSize: 11, fontWeight: "700", color: "#fff" },

  // Already-submitted compact box (re-upload mode)
  alreadySubmittedBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 8,
    marginTop: 4,
  },
  alreadySubmittedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 4,
  },
  alreadySubmittedTitle: { fontSize: 13, fontWeight: "700" },
  alreadySubmittedRow:   { flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 2 },
  alreadySubmittedItem:  { fontSize: 13 },

  // Document number fields
  numSection: {
    marginTop: 20,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 16,
  },
  // Inline number input — rendered directly beneath the last card of its group
  numInline: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  numHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  numHeaderText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  numSubText: {
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: -8,
  },
  numField: {
    gap: 5,
  },
  numLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  numInput: {
    height: 46,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  numError: {
    fontSize: 11.5,
    fontWeight: "500",
    marginLeft: 2,
  },

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
  tipDot:   { width: 4, height: 4, borderRadius: 2 },
  tipText:  { fontSize: 12 },

  // Platform note (Android) — bg/text injected inline
  platformNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 10,
    borderRadius: 10,
  },
  platformNoteText: { fontSize: 11, flex: 1 },

  // Footer
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    gap: 10,
  },
  footerHint: { flexDirection: "row", alignItems: "center", gap: 7 },
  hintText:   { fontSize: 12, flex: 1 },
  submitBtn:  { borderRadius: 14, overflow: "hidden" },
  submitGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  submitText: { fontSize: 16, fontWeight: "800", color: "#fff" },
});
