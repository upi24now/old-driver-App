import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDrivers, suspendDriver, blacklistDriver, unsuspendDriver,
  fetchDriverDetail,
  type DriverEntry, type DriverDetail,
} from "@/lib/api";
import { SidebarLayout } from "@/components/sidebar-layout";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Search, ShieldOff, Ban, ShieldCheck, RefreshCw,
         IndianRupee, Star, CheckCircle2, XCircle, Clock,
         MapPin, ExternalLink, Navigation, Wallet, Truck } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────

type BlockAction = "suspend" | "blacklist" | "restore";

const ACTION_META: Record<BlockAction, {
  title: string; description: string; confirmLabel: string;
  variant: "destructive" | "default" | "outline"; requiresReason: boolean;
}> = {
  suspend: {
    title:        "Suspend Driver?",
    description:  "The driver will be immediately forced offline and blocked from receiving orders. They will see a suspended screen on the app. You can restore access later.",
    confirmLabel: "Suspend Driver",
    variant:      "destructive",
    requiresReason: true,
  },
  blacklist: {
    title:        "Blacklist Driver?",
    description:  "The driver will be permanently blocked and forced offline immediately. They will see a blacklisted screen on the app.",
    confirmLabel: "Blacklist Driver",
    variant:      "destructive",
    requiresReason: true,
  },
  restore: {
    title:        "Restore Driver Access?",
    description:  "The driver's account will be reactivated. They must go online again manually.",
    confirmLabel: "Restore Access",
    variant:      "default",
    requiresReason: false,
  },
};

function verificationBadge(status: string | null) {
  if (status === "approved" || status === "verified")
    return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">{status}</Badge>;
  if (status === "rejected")
    return <Badge variant="destructive">{status}</Badge>;
  return <Badge variant="secondary">{status ?? "pending"}</Badge>;
}

function accountBadge(status: string | null | undefined) {
  if (!status || status === "active")
    return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">active</Badge>;
  if (status === "suspended")
    return <Badge className="bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100">suspended</Badge>;
  if (status === "blacklisted")
    return <Badge variant="destructive">blacklisted</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function fmtAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Driver Detail Panel ────────────────────────────────────────────────────────

function DriverDetailPanel({
  driver,
  onBlock,
  onClose,
}: {
  driver: DriverEntry;
  onBlock: (action: BlockAction) => void;
  onClose: () => void;
}) {
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["driver-detail", driver.uid],
    queryFn:  () => fetchDriverDetail(driver.uid),
    retry:    false,
    staleTime: 30_000,
  });

  const isBlocked = driver.accountStatus === "suspended" || driver.accountStatus === "blacklisted";

  const gmapsUrl = detail?.latitude != null && detail.longitude != null
    ? `https://maps.google.com/?q=${detail.latitude},${detail.longitude}`
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="p-4 border-b flex items-start justify-between shrink-0">
        <div>
          <p className="font-semibold text-base">{driver.name || "Unknown Driver"}</p>
          <p className="text-xs text-muted-foreground">{driver.phone || "—"}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{driver.uid}</p>
        </div>
        <div className="flex items-center gap-2">
          {accountBadge(driver.accountStatus)}
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Account info */}
        <div className="rounded-lg border p-4 bg-background space-y-2 text-sm">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Profile</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <div><span className="text-muted-foreground">City</span><p className="font-medium">{driver.city || "—"}</p></div>
            <div><span className="text-muted-foreground">Vehicle No</span><p className="font-medium">{driver.vehicleNumber || "—"}</p></div>
            <div><span className="text-muted-foreground">Licence</span><p className="font-medium">{driver.licenseNumber || "—"}</p></div>
            <div><span className="text-muted-foreground">KYC</span>{verificationBadge(driver.verificationStatus)}</div>
          </div>
          {detail?.suspendReason && (
            <div className="mt-2 rounded bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-800">
              <span className="font-semibold">Suspend reason: </span>{detail.suspendReason}
            </div>
          )}
          {detail?.blacklistReason && (
            <div className="mt-2 rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
              <span className="font-semibold">Blacklist reason: </span>{detail.blacklistReason}
            </div>
          )}
        </div>

        {/* Stats */}
        {detailLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : detail ? (
          <>
            {/* Order counts */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Order Stats</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {([
                  { label: "Completed",  value: detail.ordersCompleted,  icon: CheckCircle2, color: "text-green-600" },
                  { label: "Cancelled",  value: detail.ordersCancelled,   icon: XCircle,     color: "text-red-500"   },
                  { label: "Rejections", value: detail.ordersRejectedBy,  icon: Clock,       color: "text-orange-500"},
                ] as const).map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="rounded-lg border bg-background p-3">
                    <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
                    <p className="text-xl font-bold">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Earnings / Wallet */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Earnings &amp; Wallet</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Wallet className="h-3.5 w-3.5" /> Wallet Balance
                  </div>
                  <p className="text-xl font-bold flex items-center gap-0.5">
                    <IndianRupee className="h-4 w-4" />{detail.walletBalance.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <IndianRupee className="h-3.5 w-3.5" /> Total Earnings
                  </div>
                  <p className="text-xl font-bold flex items-center gap-0.5">
                    <IndianRupee className="h-4 w-4" />{detail.totalEarnings.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" /> Rating
                  </div>
                  <p className="text-xl font-bold">
                    {detail.rating != null ? Number(detail.rating).toFixed(1) : "5.0"}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Truck className="h-3.5 w-3.5" /> Total Paid Out
                  </div>
                  <p className="text-xl font-bold flex items-center gap-0.5">
                    <IndianRupee className="h-4 w-4" />{detail.totalPaid.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {/* Live Location */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Live Location</p>
                <div className="flex items-center gap-1.5">
                  <div className={`h-2 w-2 rounded-full ${detail.isOnline ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`} />
                  <span className="text-xs text-muted-foreground">{detail.isOnline ? "Online" : "Offline"}</span>
                </div>
              </div>

              {detail.latitude != null && detail.longitude != null ? (
                <div className="rounded-lg border overflow-hidden">
                  <iframe
                    title={`map-${driver.uid}`}
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${detail.longitude - 0.008},${detail.latitude - 0.008},${detail.longitude + 0.008},${detail.latitude + 0.008}&layer=mapnik&marker=${detail.latitude},${detail.longitude}`}
                    className="w-full h-44 border-0"
                    loading="lazy"
                  />
                  <div className="p-3 bg-muted/20 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-muted-foreground">
                        {detail.latitude.toFixed(5)}, {detail.longitude.toFixed(5)}
                      </span>
                      {gmapsUrl && (
                        <a
                          href={gmapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-primary hover:underline font-medium"
                        >
                          <ExternalLink className="h-3 w-3" /> Google Maps
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Navigation className="h-3 w-3" />
                      <span>Last seen: {fmtAgo(detail.lastSeenAt)} ({fmtTime(detail.lastSeenAt)})</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  <MapPin className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                  <p>No location data</p>
                  <p className="text-xs mt-0.5">Driver has not reported a GPS position yet.</p>
                  {detail.lastSeenAt && (
                    <p className="text-xs mt-1">Last seen: {fmtTime(detail.lastSeenAt)}</p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Actions footer */}
      <div className="p-4 border-t shrink-0 flex flex-wrap gap-2">
        {!isBlocked && (
          <Button
            size="sm" variant="outline"
            className="border-orange-300 text-orange-700 hover:bg-orange-50"
            onClick={() => onBlock("suspend")}
            data-testid={`panel-btn-suspend-${driver.uid}`}
          >
            <ShieldOff className="h-3.5 w-3.5 mr-1.5" /> Suspend
          </Button>
        )}
        {driver.accountStatus !== "blacklisted" && (
          <Button
            size="sm" variant="destructive"
            onClick={() => onBlock("blacklist")}
            data-testid={`panel-btn-blacklist-${driver.uid}`}
          >
            <Ban className="h-3.5 w-3.5 mr-1.5" /> Blacklist
          </Button>
        )}
        {isBlocked && (
          <Button
            size="sm" variant="outline"
            className="border-green-300 text-green-700 hover:bg-green-50"
            onClick={() => onBlock("restore")}
            data-testid={`panel-btn-restore-${driver.uid}`}
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Restore Access
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main Drivers Page ──────────────────────────────────────────────────────────

export default function Drivers() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DriverEntry | null>(null);
  const [blockTarget, setBlockTarget] = useState<DriverEntry | null>(null);
  const [blockAction, setBlockAction] = useState<BlockAction | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!sessionStorage.getItem("adminJwt")) setLocation("/");
  }, [setLocation]);

  const { data: drivers = [], isLoading, refetch } = useQuery({
    queryKey: ["drivers", "all"],
    queryFn:  () => fetchDrivers("all"),
    retry:    false,
  });

  const suspendMutation  = useMutation({ mutationFn: ({ uid, r }: { uid: string; r?: string }) => suspendDriver(uid, r),   onSuccess: onMutationSuccess("suspended") });
  const blacklistMutation = useMutation({ mutationFn: ({ uid, r }: { uid: string; r?: string }) => blacklistDriver(uid, r), onSuccess: onMutationSuccess("blacklisted") });
  const unsuspendMutation = useMutation({ mutationFn: (uid: string) => unsuspendDriver(uid), onSuccess: onMutationSuccess("restored") });

  function onMutationSuccess(label: string) {
    return (_: unknown, vars: unknown) => {
      const uid = typeof vars === "string" ? vars : (vars as { uid: string }).uid;
      toast({ title: `Driver ${label} — app will enforce within 2 s` });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver-detail", uid] });
      // Update selected driver's accountStatus optimistically
      if (selected?.uid === uid) {
        const next = label === "suspended" ? "suspended" : label === "blacklisted" ? "blacklisted" : "active";
        setSelected(prev => prev ? { ...prev, accountStatus: next } : prev);
      }
      closeBlockDialog();
    };
  }

  const closeBlockDialog = () => {
    setBlockAction(null);
    setBlockTarget(null);
    setReason("");
  };

  const openBlock = (driver: DriverEntry, action: BlockAction) => {
    setBlockTarget(driver);
    setBlockAction(action);
    setReason("");
  };

  const confirmBlock = () => {
    if (!blockTarget || !blockAction) return;
    const r = reason.trim() || undefined;
    if (blockAction === "suspend")   suspendMutation.mutate({ uid: blockTarget.uid, r });
    if (blockAction === "blacklist") blacklistMutation.mutate({ uid: blockTarget.uid, r });
    if (blockAction === "restore")   unsuspendMutation.mutate(blockTarget.uid);
  };

  const busy = suspendMutation.isPending || blacklistMutation.isPending || unsuspendMutation.isPending;

  const filtered = drivers.filter(d =>
    !search ||
    (d.name?.toLowerCase().includes(search.toLowerCase())) ||
    (d.phone?.includes(search)) ||
    d.uid.includes(search)
  );

  return (
    <SidebarLayout>
      <div className="flex h-full overflow-hidden">
        {/* Left: driver list */}
        <div className={`flex flex-col overflow-hidden transition-all ${selected ? "w-[40%] min-w-[300px]" : "w-full"}`}>
          {/* Toolbar */}
          <div className="p-4 border-b flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold">Drivers</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isLoading ? "Loading…" : `${filtered.length} drivers`}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, phone, UID…"
                className="pl-8"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Driver list */}
          <div className="flex-1 overflow-y-auto divide-y">
            {isLoading ? (
              <div className="p-12 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">No drivers found.</div>
            ) : (
              filtered.map(d => (
                <button
                  key={d.uid}
                  onClick={() => setSelected(d)}
                  className={`w-full text-left p-4 hover:bg-muted/50 transition-colors ${selected?.uid === d.uid ? "bg-muted" : ""}`}
                  data-testid={`driver-row-${d.uid}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-medium text-sm">{d.name || "Unknown Driver"}</span>
                    <div className="flex gap-1.5 shrink-0">
                      {accountBadge(d.accountStatus)}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{d.phone || "No phone"}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {verificationBadge(d.verificationStatus)}
                    {d.vehicleNumber && (
                      <span className="text-xs text-muted-foreground">{d.vehicleNumber}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: driver detail */}
        {selected && (
          <div className="flex-1 border-l bg-background flex flex-col overflow-hidden min-w-[340px]">
            <DriverDetailPanel
              driver={selected}
              onBlock={(action) => openBlock(selected, action)}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>

      {/* Block / Restore Dialog */}
      {blockAction && blockTarget && (
        <Dialog open onOpenChange={open => { if (!open) closeBlockDialog(); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{ACTION_META[blockAction].title}</DialogTitle>
              <DialogDescription>{ACTION_META[blockAction].description}</DialogDescription>
            </DialogHeader>
            <div className="py-2 space-y-3">
              <p className="text-sm text-muted-foreground">
                Driver: <span className="font-medium text-foreground">{blockTarget.name || blockTarget.uid}</span>
              </p>
              {ACTION_META[blockAction].requiresReason && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Reason <span className="text-muted-foreground font-normal">(shown to driver)</span>
                  </label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                    rows={3}
                    placeholder={
                      blockAction === "suspend"
                        ? "e.g. Multiple customer complaints, behaviour issue…"
                        : "e.g. Fraudulent activity, chargeback abuse…"
                    }
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    disabled={busy}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeBlockDialog} disabled={busy}>Cancel</Button>
              <Button
                variant={ACTION_META[blockAction].variant}
                onClick={confirmBlock}
                disabled={busy}
                data-testid="btn-confirm-block"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {ACTION_META[blockAction].confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </SidebarLayout>
  );
}
