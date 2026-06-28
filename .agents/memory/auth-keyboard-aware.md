---
name: Auth screens keyboard-awareness
description: Why auth screens must use KeyboardAwareScrollViewCompat, not raw KeyboardAvoidingView + ScrollView.
---

Auth screens (`login.tsx`, `create-pin.tsx`) must render inside `@/components/KeyboardAwareScrollViewCompat` (wraps `react-native-keyboard-controller`'s `KeyboardAwareScrollView`), NOT a raw `KeyboardAvoidingView` + `ScrollView`.

**Why:** raw KAV (`behavior="height"` on Android) + plain `ScrollView` does NOT auto-scroll the focused input above the soft keyboard, so the mobile/PIN/OTP fields and the Continue button get covered while typing. The app already ships `react-native-keyboard-controller` and mounts `<KeyboardProvider>` at root in `app/_layout.tsx`, so the compat wrapper "just works" everywhere else.

**How to apply:** keep `style={ss.root}` (flex:1) on the wrapper, move the old ScrollView `contentContainerStyle` onto it, add `bottomOffset={24}` (bump to 32 only if small-screen clipping appears), and preserve `keyboardShouldPersistTaps="handled"`, `bounces={false}`, `overScrollMode="never"`. Remove the now-unused `KeyboardAvoidingView`/`ScrollView` (and `Platform` if it becomes unused) from the react-native import. This is a purely presentational swap — never change the OTP/PIN auth logic or routing while doing it.
