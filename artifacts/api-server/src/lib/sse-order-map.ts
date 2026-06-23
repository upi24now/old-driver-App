/**
 * Map a PG `orders` row to the OrderDoc-shaped JSON the Driver App's
 * orderDocToRide() and isStaleDispatch() expect (Phase 5J-Tier-6 SSE offer
 * stream). Keys are camelCase to match the Firestore OrderDoc the mobile client
 * previously received from onSnapshot.
 *
 * Numeric columns (string from pg) are coerced to numbers; timestamps are
 * emitted as epoch-ms numbers so the client's tsToMillis() handles them. Fields
 * absent from the PG schema (customerRating, pickupSub, dropSub, etc.) are simply
 * omitted — orderDocToRide() already supplies safe defaults for every one.
 */

import type { Order } from "@workspace/db";

function num(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function ms(v: Date | null): number | undefined {
  return v ? v.getTime() : undefined;
}

export function pgOrderToOrderDoc(o: Order): Record<string, unknown> {
  return {
    id:                    o.id,
    status:                o.status,
    driverUid:             o.driverUid ?? null,
    activeOfferDriverUids: o.activeOfferDriverUids ?? [],

    customerName:  o.customerName ?? undefined,
    customerPhone: o.customerPhone ?? undefined,

    pickup:     o.pickup ?? undefined,
    pickupCity: o.pickupCity ?? undefined,
    drop:       o.drop ?? undefined,
    dropCity:   o.dropCity ?? undefined,

    distanceKm:  num(o.distanceKm),
    durationMin: o.durationMin ?? undefined,

    fareEstimate:    num(o.fareEstimate),
    paymentMode:     o.paymentMode ?? undefined,
    surge:           o.surge ?? false,
    surgeMultiplier: num(o.surgeMultiplier),

    parcelType:   o.parcelType ?? undefined,
    parcelEmoji:  o.parcelEmoji ?? undefined,
    parcelWeight: o.parcelWeight ?? undefined,

    dispatchedAt:      ms(o.dispatchedAt),
    dispatchTimeoutAt: ms(o.dispatchTimeoutAt),
    fcmDispatchedAt:   ms(o.fcmDispatchedAt),
    createdAt:         ms(o.createdAt),
  };
}
