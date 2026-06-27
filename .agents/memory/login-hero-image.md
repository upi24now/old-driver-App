---
name: Login hero is an image asset, not SVG
description: Why the BikeCourier login-phase hero is a cropped reference image instead of the SVG map, and where each hero is used.
---

# Login hero illustration

The LOGIN phase hero (frosted-glass India map + monuments + clouds + pins + route
lines + delivery scooter on a glowing glass platform) is rendered as a single
**image asset** `artifacts/mobile/assets/images/login-hero.png` (853x648), via the
`LoginHeroImage` component in `app/login.tsx`. It is cropped from the reference
mockup that lives in `attached_assets/` (status bar excluded, the "BikeCourier"
logo sliver trimmed off the bottom).

**CRITICAL — white background, not full-bleed:** the user's top complaint was the
hero looking like "a rectangular image pasted on top". Root cause: the old crop had
a CREAM/peach bg bleeding to all 4 edges (corners ~250, not 255) AND was rendered
full-bleed edge-to-edge, so the off-white rectangle was visible against the white
page. FIX: re-crop so all 4 corners are PURE white (255) — `magick ref -crop
853x648+0+60 +repage` then `-fuzz 8% -fill white -opaque white` — and render it
CENTERED at ~0.88*WIN_W (NOT full-bleed) so the white asset bg melts into the white
page with equal L/R margins and no visible boundary. Verify corners are 255 after
any re-crop.

**Why:** the reference is a photorealistic 3D render. An earlier attempt rebuilt it
in react-native-svg (`SetupHero` + `INDIA_PATH`), which cannot reach the required
95% visual fidelity. Using the source illustration as an image is the only reliable
way to match it 1:1. The scooter in the crop is the same `scooter-hero.png` already
shipped, so it satisfies the "reuse existing scooter" constraint visually.

**How to apply:**
- Don't try to "improve" the login hero by editing the SVG — edit/replace the PNG.
- `SetupHero` (the SVG map hero) is STILL used by the `phone`/OTP phases, so it is
  not dead code; don't delete it when touching the login hero.
- Sizing: `loginHeroImg` width `Math.round(WIN_W*0.88)`, height tracks the asset
  aspect `648/853`, `alignSelf: "center"`. Do NOT full-bleed (no negative L/R
  margins) — centering on white is what hides the rectangle.
- PIN boxes: `pinCellShell` must be `flex:1 + aspectRatio:1 + maxWidth:50` (NOT a
  fixed 48px) or the 6 cells overflow the card on a 390px viewport.
- On web preview the `AnimatedSplash` NEVER completes because `isReady` depends on
  `fontsLoaded`, which stays false in the browser (fonts load only on a real
  device/Expo Go) — the dark-green splash blocks the whole preview indefinitely. To
  screenshot the login layout, TEMPORARILY init `splashVisible` to
  `Platform.OS !== "web"` in `_layout.tsx`, capture, then REVERT. Not a hero bug.
