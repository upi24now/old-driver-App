---
name: Expo Go Android image picker quirks
description: Critical Android-specific image picker behavior in Expo Go
---

## Rule
Always use `allowsEditing: false` in `expo-image-picker` on Android/Expo Go.

**Why:** `allowsEditing: true` launches Android's UCrop activity, which silently drops the result in Expo Go — the picker returns with no image selected and no error. This is a known Expo Go limitation.

**How to apply:**
```tsx
const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  allowsEditing: false,   // NEVER true on Android/Expo Go
  quality: 0.85,
});
```

Also: Never use `ActionSheetIOS` via dynamic require inside callbacks. Always use `Alert.alert` for cross-platform picker sheets.
