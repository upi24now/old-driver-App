---
name: Bike Courier colour system
description: Semantic token architecture and the brand-constants bridge pattern used in active-delivery.tsx.
---

## Rule
All screens must consume colours from `constants/colors.ts` semantic tokens — no raw hex in JSX or StyleSheet. Exception: map destination dot stays `#FF3B30` (universal map convention).

**Why:** Unified design system; future dark-mode support; brand changes propagate from one file.

## Token hex values (light mode)
| Token | Hex |
|---|---|
| primary | #E8336C |
| primaryPressed | #C4195A |
| success / money / online | #059669 |
| successSoft / moneySoft | #D1FAE5 |
| warning | #D97706 |
| warningSoft | #FEF3C7 |
| error / destructive | #DC2626 |
| errorSoft | #FEE2E2 |
| info | #2563EB |
| infoSoft | #DBEAFE |
| pending | #7C3AED |
| pendingSoft | #EDE9FE |
| navigation | #0284C7 |
| background | #F5F4F2 |

## Brand-constants bridge (active-delivery.tsx)
`StyleSheet.create({})` runs at module load time so it can't reference the `useColors()` hook. The file uses module-level constants that map 1:1 to tokens:

```ts
const GREEN  = "#059669"; // money/success
const PINK   = "#E8336C"; // primary
const ORANGE = "#D97706"; // warning
const BLUE   = "#2563EB"; // info
const NAVY   = "#0F172A"; // unchanged surface
const RED    = "#DC2626"; // error
```

All StyleSheet entries reference these constants; JSX uses them directly. Update constants only — never the StyleSheet entries individually.

**How to apply:** Any new screen that needs colours in both StyleSheet and JSX should follow this same bridge pattern rather than trying to call `useColors()` inside `StyleSheet.create`.
