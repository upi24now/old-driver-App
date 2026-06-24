---
name: Cash/COD order wallet credit rule
description: Why CASH/COD deliveries must never credit the driver's withdrawable wallet, and where the gate lives.
---

# Cash/COD orders must NOT credit the withdrawable wallet

**Rule:** For CASH / COD orders the driver collects the fare directly from the customer in cash. The wallet must therefore NOT add the fare to `balance` / `total_earnings`, must NOT increment `completed_deliveries`, and must NOT create a payable credit/payout transaction. The only allowed ledger row is an audit-only `cash_collected` entry with amount `0`. ONLINE / PREPAID orders credit normally.

**Why:** Crediting a cash order double-pays the driver (cash in hand + wallet credit). This was introduced by a wallet-logic bug during the Firestore→PG migration/testing.

**How to apply:**
- Classification helper `isCashPayment(paymentMode)` lives in `wallet-pg-service.ts`. It is an ONLINE allow-list (online, prepaid, upi, card, razorpay, paid, wallet, paytm, gpay, phonepe, netbanking). Anything else — including empty/null/unknown — is treated as CASH (fail-safe: unknown never pays out).
- The credit must be gated at every completion write path. There were FOUR: `pgCompleteDelivery`, `projectWalletCreditToFirestore`, the Firestore-fallback tx in `orders.ts`, and the PG shadow `pgCreditOrderEarning`. Missing any one re-opens the double-credit.
- Daily activity stats (`todayEarnings` / `tripsToday`) intentionally still count BOTH modes — they are activity metrics, not the payable wallet.
- The `type` column on `wallet_transactions` is free-text `z.string()` (no enum), so `cash_collected` needs no schema migration — just document it.

# Repairing historical wrong cash credits

- Reversing past wrong cash credits drives `balance` negative, because the driver already withdrew the inflated funds. balance = total_earnings − total_paid; once cash credits are removed, paid > earned.
- Two repair options: (A) honest negative balance, (B) write-off adjustment (+amount) so company absorbs the loss and the driver never sees a negative balance. Business chose B for this bug since it was our fault.
- **PG and Firestore wallets can be divergent.** When repairing, audit BOTH stores independently — do not assume PG totals equal Firestore totals. In one real case PG held only 2 of 7 wrong cash credits; the other 5 existed only in the Firestore ledger. Reconcile the aggregate `wallets/{uid}` doc (balance / totalEarnings / completedDeliveries; leave totalPaid) to the clean target rather than trusting either store's transaction set.
- Firebase Admin one-off scripts: run as `.mjs` from `artifacts/api-server` (firebase-admin is a dep there) using FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY; the private key needs `.replace(/\\n/g,"\n")`. Delete the temp script afterward.
