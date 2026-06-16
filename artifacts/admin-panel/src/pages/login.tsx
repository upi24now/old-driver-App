import { useState, useEffect } from "react";
import { useLocation }         from "wouter";
import { Button }              from "@/components/ui/button";
import { Input }               from "@/components/ui/input";
import { Label }               from "@/components/ui/label";
import { useToast }            from "@/hooks/use-toast";
import { requestOtp, verifyOtp } from "@/lib/api";

type Step = "phone" | "otp";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast }       = useToast();

  const [step,    setStep]    = useState<Step>("phone");
  const [phone,   setPhone]   = useState("");
  const [otp,     setOtp]     = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("adminJwt")) setLocation("/dashboard");
  }, [setLocation]);

  // ── Step 1: Request OTP ───────────────────────────────────────────────────

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setLoading(true);
    try {
      await requestOtp(phone.trim());
      toast({ title: "OTP sent", description: "Check your mobile for the 6-digit code." });
      setStep("otp");
    } catch (err: unknown) {
      toast({
        title:       "Login failed",
        description: err instanceof Error ? err.message : "Could not send OTP.",
        variant:     "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Verify OTP ────────────────────────────────────────────────────

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) return;
    setLoading(true);
    try {
      const { token } = await verifyOtp(phone.trim(), otp.trim());
      sessionStorage.setItem("adminJwt", token);
      setLocation("/dashboard");
    } catch (err: unknown) {
      toast({
        title:       "Verification failed",
        description: err instanceof Error ? err.message : "Invalid OTP.",
        variant:     "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // ── UI ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6 bg-background p-8 rounded-lg border shadow-sm">

        {/* Header */}
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Admin Portal</h1>
          <p className="text-sm text-muted-foreground">
            {step === "phone"
              ? "Enter your registered mobile number"
              : `Enter the OTP sent to ${phone}`}
          </p>
        </div>

        {/* Step 1 — Phone */}
        {step === "phone" && (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Mobile Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading}
                autoComplete="tel"
                data-testid="input-phone"
              />
              <p className="text-xs text-muted-foreground">
                Only approved admin numbers can login.
              </p>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !phone.trim()}
              data-testid="button-send-otp"
            >
              {loading ? "Sending OTP…" : "Send OTP"}
            </Button>
          </form>
        )}

        {/* Step 2 — OTP */}
        {step === "otp" && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp">OTP</Label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                disabled={loading}
                autoComplete="one-time-code"
                data-testid="input-otp"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading || otp.length < 6}
              data-testid="button-verify-otp"
            >
              {loading ? "Verifying…" : "Verify & Sign In"}
            </Button>
            <button
              type="button"
              className="w-full text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => { setStep("phone"); setOtp(""); }}
            >
              ← Change number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
