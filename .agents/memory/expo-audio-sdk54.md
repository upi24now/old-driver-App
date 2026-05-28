---
name: expo-audio SDK 54 migration
description: expo-av removed in SDK 54; correct package and API for audio playback
---

## Rule
Use `expo-audio@1.1.1` (NOT expo-av, NOT expo-audio@56.x) for Expo SDK 54 projects.

**Why:** expo-av was deprecated and its native module is missing in SDK 54. expo-audio is the official replacement. The npm `latest` tag resolves to 56.x which has a version mismatch with Expo 54 — always pin to `1.1.1`.

**How to apply:**
```
pnpm add expo-audio@1.1.1
```

Correct API:
```tsx
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";

// In component (hook — must be unconditional):
const player = useAudioPlayer(null);

// When ready to play:
await setAudioModeAsync({
  playsInSilentMode: true,       // overrides Android silent/vibrate mode
  interruptionMode: "doNotMix",  // requests audio focus
  allowsRecording: false,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
});
player.pause();           // stop any previous playback
player.loop   = true;
player.volume = 1.0;
player.muted  = false;
player.replace(require("../assets/sound.wav") as number);
player.play();

// To stop:
player.pause();
```

Repeating vibration (Android Expo Go):
```tsx
Vibration.vibrate([0, 700, 200, 700, 200, 700, 1000], true); // true = loop
Vibration.cancel(); // to stop
```
