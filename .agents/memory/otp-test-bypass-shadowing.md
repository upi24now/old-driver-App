---
name: OTP test-bypass shadowing
description: Why a valid DB OTP can return 401 for phones listed in TEST_OTP_PHONES, and the fall-through fix.
---

# OTP test-bypass shadowing

A phone listed in `TEST_OTP_PHONES` (with a fixed dev OTP like `123456`) will have its
**real** `auth_otps` OTP rejected with 401 if the verify-otp test-bypass branch *hard-rejects*
on mismatch instead of falling through to the DB check.

**Why:** the bypass `if (testPhones.has(phone)) { return phoneOtp === submitted ? 200 : 401 }`
short-circuits before the DB path. In production a "test" number can still receive a real SMS
OTP, so the bypass shadows it. This was the exact cause of the reported `8299013350` login 401
(real DB OTP `733802` rejected). In prod that number was in `TEST_OTP_PHONES`.

**How to apply:** verify-otp must use `let verified=false; if (testPhones bypass matches) verified=true;
if (!verified) { DB path }`. The bypass becomes additive, never a gate. Also:
- accept OTP from `body.otp || body.code || body.otpCode` (clients vary).
- normalize phone identically in send-otp AND verify-otp (`authNormalizePhone`: strip non-digits,
  drop leading `91` from 12-digit, drop leading `0` from 11-digit) so the `auth_otps` key and the
  `"91"+phone` token uid always line up regardless of `+91`/`91`/`0` formatting.
- normalize the **keys** of the parsed `TEST_OTP_PHONES` map too (run them through the same
  normalizer) or `+91...` env entries silently stop matching.
- trim the submitted OTP; keep `expires_at > NOW()` + `consumed_at IS NULL`; set `consumed_at` on
  success; consume under `SELECT ... FOR UPDATE`.
