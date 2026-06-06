# Bike Courier

A driver-facing mobile app for bike, auto, and truck courier delivery partners in India.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/mobile/constants/colors.ts` — unified semantic token file (source of truth for all colours)
- `artifacts/mobile/constants/typography.ts` — shared type scale
- `artifacts/mobile/hooks/useColors.ts` — theme hook (returns `colors.light` or `colors.dark`)
- `artifacts/mobile/app/(tabs)/index.tsx` — home dashboard screen
- `artifacts/mobile/app/(tabs)/_layout.tsx` — GlassTabBar bottom nav
- `artifacts/mobile/app/ride-request.tsx` — incoming order accept/reject sheet
- `artifacts/mobile/app/lock-alert.tsx` — lock-screen style FCM notification card
- `artifacts/mobile/app/active-delivery.tsx` — 5-stage live delivery flow
- `artifacts/mobile/app/delivery-command-center.tsx` — multi-order command hub
- `artifacts/api-server/src/lib/fcm-dispatcher.ts` — FCM push logic (do not touch)

## Architecture decisions

- **Semantic colour tokens only** — all screens consume tokens from `constants/colors.ts`; no raw hex in JSX or StyleSheet. `active-delivery.tsx` uses module-level brand constants (`GREEN`, `PINK`, `ORANGE`, `BLUE`, `RED`) as a bridge so the StyleSheet can reference them — those constants map 1:1 to the semantic tokens.
- **Contract-first API** — OpenAPI spec drives codegen (Orval) for React Query hooks and Zod schemas; server validates with the same schemas.
- **FCM via custom Express server** — Firebase Admin SDK in `api-server`; channel ID `incoming_orders_v2` is fixed and must not change.
- **Ringtone/vibration pattern** `[0, 1200, 200, 1200, 200, 1200, 500]` appears in 5 locations — never alter without updating all.
- **Map destination marker** stays `#FF3B30` (Apple/Google Maps red) — universal convention, intentionally outside the token system.

## Product

Driver-facing React Native (Expo SDK 54) app for bike/auto/truck delivery partners in India:
- Real-time FCM ride requests with accept/reject and a slide-to-accept gesture
- Lock-screen style alert card that appears over the OS lock screen
- 5-stage delivery workflow (to_pickup → at_pickup → to_drop → at_drop → delivered) with Google Maps navigation and server-verified OTP at drop
- Multi-order command center supporting up to 3 concurrent deliveries
- Earnings wallet with live balance and transaction history
- Firebase Auth + Firestore real-time order tracking

## Gotchas

- `pnpm run typecheck` has a pre-existing error in `scripts/src/audit-delivered-order.ts` (missing module declaration); use `pnpm --filter @workspace/mobile run typecheck` to verify mobile changes cleanly.
- expo-av was removed in SDK 54; audio uses `expo-audio@1.1.1` with `useAudioPlayer` hook.
- `allowsEditing: true` in the Android image picker causes UCrop to silently drop the result — always use `false`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
