---
name: Login hero is an image asset, not SVG
description: Why the BikeCourier login-phase hero is a cropped reference image instead of the SVG map, and where each hero is used.
---

# Login hero illustration

The LOGIN phase hero (frosted-glass India map + monuments + clouds + pins + route
lines + delivery scooter on a glowing glass platform) is rendered as a single
full-bleed **image asset** `artifacts/mobile/assets/images/login-hero.png`, via the
`LoginHeroImage` component in `app/login.tsx`. It is cropped from the reference
mockup that lives in `attached_assets/` (status bar excluded, the "BikeCourier"
logo sliver trimmed off the bottom).

**Why:** the reference is a photorealistic 3D render. An earlier attempt rebuilt it
in react-native-svg (`SetupHero` + `INDIA_PATH`), which cannot reach the required
95% visual fidelity. Using the source illustration as an image is the only reliable
way to match it 1:1. The scooter in the crop is the same `scooter-hero.png` already
shipped, so it satisfies the "reuse existing scooter" constraint visually.

**How to apply:**
- Don't try to "improve" the login hero by editing the SVG — edit/replace the PNG.
- `SetupHero` (the SVG map hero) is STILL used by the `phone`/OTP phases, so it is
  not dead code; don't delete it when touching the login hero.
- Full-bleed is achieved with `marginLeft/Right: -22` (cancels ScrollView
  `paddingHorizontal: 22`) and `marginTop: -r.topPad` (removes design spacing while
  preserving the safe-area inset). Hero height tracks the asset aspect (614/853).
- On web preview the boot splash overlay stays up (`authLoading=true`,
  `fontsLoaded=false`); it clears on a real device in Expo Go. Not a hero bug.
