import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDrivers, approveDriver, rejectDriver, suspendDriver, blacklistDriver, unsuspendDriver,
  type DriverEntry, type DocType,
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, ExternalLink, CheckCircle, XCircle, ShieldOff, Ban, ShieldCheck } from "lucide-react";

type BlockAction = "suspend" | "blacklist" | "restore";

const BLOCK_ACTION_META: Record<BlockAction, { title: string; description: string; confirmLabel: string; variant: "destructive" | "default" | "outline" }> = {
  suspend: {
    title:        "Suspend Driver?",
    description:  "The driver will be immediately forced offline and blocked from receiving orders. They will see a 'suspended' screen on the app. You can restore access later.",
    confirmLabel: "Suspend",
    variant:      "destructive",
  },
  blacklist: {
    title:        "Blacklist Driver?",
    description:  "The driver will be permanently blocked and forced offline immediately. They will see a 'blacklisted' screen on the app.",
    confirmLabel: "Blacklist",
    variant:      "destructive",
  },
  restore: {
    title:        "Restore Driver Access?",
    description:  "The driver's account will be reactivated. They will need to go online again manually.",
    confirmLabel: "Restore Access",
    variant:      "default",
  },
};

export default function Drivers() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [search, setSearch] = useState("");
  const [selectedDriver, setSelectedDriver] = useState<DriverEntry | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectDocIds, setRejectDocIds] = useState<string[]>([]);
  const [blockAction, setBlockAction] = useState<BlockAction | null>(null);

  useEffect(() => {
    if (!sessionStorage.getItem("adminApiKey")) {
      setLocation("/");
    }
  }, [setLocation]);

  const { data: drivers = [], isLoading, error } = useQuery({
    queryKey: ["drivers", statusFilter],
    queryFn: () => fetchDrivers(statusFilter),
    retry: false,
  });

  const approveMutation = useMutation({
    mutationFn: (uid: string) => approveDriver(uid),
    onSuccess: (_, uid) => {
      toast({ title: "Driver approved" });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      if (selectedDriver?.uid === uid) setSelectedDriver(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to approve", description: err.message, variant: "destructive" });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: ({ uid, reason, docIds }: { uid: string; reason: string; docIds: string[] }) =>
      rejectDriver(uid, reason, docIds),
    onSuccess: (_, { uid }) => {
      toast({ title: "Driver rejected" });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setRejectDialogOpen(false);
      setRejectReason("");
      setRejectDocIds([]);
      if (selectedDriver?.uid === uid) setSelectedDriver(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to reject", description: err.message, variant: "destructive" });
    }
  });

  const suspendMutation = useMutation({
    mutationFn: (uid: string) => suspendDriver(uid),
    onSuccess: () => {
      toast({ title: "Driver suspended — app will enforce immediately" });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setBlockAction(null);
      setSelectedDriver(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to suspend", description: err.message, variant: "destructive" });
    }
  });

  const blacklistMutation = useMutation({
    mutationFn: (uid: string) => blacklistDriver(uid),
    onSuccess: () => {
      toast({ title: "Driver blacklisted — app will enforce immediately" });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setBlockAction(null);
      setSelectedDriver(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to blacklist", description: err.message, variant: "destructive" });
    }
  });

  const unsuspendMutation = useMutation({
    mutationFn: (uid: string) => unsuspendDriver(uid),
    onSuccess: () => {
      toast({ title: "Driver access restored" });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setBlockAction(null);
      setSelectedDriver(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to restore access", description: err.message, variant: "destructive" });
    }
  });

  const handleBlockConfirm = () => {
    if (!selectedDriver || !blockAction) return;
    if (blockAction === "suspend")   suspendMutation.mutate(selectedDriver.uid);
    if (blockAction === "blacklist") blacklistMutation.mutate(selectedDriver.uid);
    if (blockAction === "restore")   unsuspendMutation.mutate(selectedDriver.uid);
  };

  const blockMutationPending =
    suspendMutation.isPending || blacklistMutation.isPending || unsuspendMutation.isPending;

  const filteredDrivers = drivers.filter(d =>
    !search ||
    d.name?.toLowerCase().includes(search.toLowerCase()) ||
    d.phone?.includes(search) ||
    d.uid.includes(search)
  );

  const resolveImageUrl = (entry: any) => {
    if (!entry) return null;
    const path = entry.url ?? entry.uri;
    if (!path) return null;
    return path.startsWith("http") ? path : `/api${path.startsWith("/") ? "" : "/"}${path}`;
  };

  const accountStatusBadge = (status: string | null | undefined) => {
    if (!status || status === "active") return null;
    if (status === "suspended")   return <Badge variant="secondary" className="bg-orange-100 text-orange-800 border-orange-200">Suspended</Badge>;
    if (status === "blacklisted") return <Badge variant="destructive">Blacklisted</Badge>;
    return <Badge variant="outline">{status}</Badge>;
  };

  if (error) {
    return (
      <div className="p-8 text-center text-destructive">
        <p>Failed to load drivers. Check your API key.</p>
        <Button onClick={() => setLocation("/")} className="mt-4" variant="outline">Back to Login</Button>
      </div>
    );
  }

  const isBlocked = (d: DriverEntry) =>
    d.accountStatus === "suspended" || d.accountStatus === "blacklisted";

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col md:flex-row">
      {/* Sidebar List */}
      <div className="w-full md:w-80 lg:w-96 border-r bg-background flex flex-col h-screen overflow-hidden shrink-0">
        <div className="p-4 border-b space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="font-semibold tracking-tight">KYC Queue</h1>
            <Button variant="ghost" size="sm" onClick={() => {
              sessionStorage.removeItem("adminApiKey");
              setLocation("/");
            }}>Log out</Button>
          </div>
          
          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger data-testid="select-status">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending Review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All Drivers</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : filteredDrivers.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No drivers found.</div>
          ) : (
            <div className="divide-y">
              {filteredDrivers.map(d => (
                <button
                  key={d.uid}
                  data-testid={`driver-item-${d.uid}`}
                  onClick={() => setSelectedDriver(d)}
                  className={`w-full text-left p-4 hover:bg-muted/50 transition-colors ${selectedDriver?.uid === d.uid ? 'bg-muted' : ''}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium truncate">{d.name || "Unknown Name"}</span>
                    <div className="flex gap-1 ml-2 shrink-0">
                      <Badge variant={d.verificationStatus === 'pending' ? 'secondary' : d.verificationStatus === 'approved' ? 'default' : 'destructive'}>
                        {d.verificationStatus}
                      </Badge>
                      {isBlocked(d) && (
                        <Badge variant="destructive" className="text-xs">
                          {d.accountStatus}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{d.phone || "No phone"}</div>
                  <div className="text-xs text-muted-foreground truncate font-mono mt-1">{d.uid}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Detail View */}
      <div className="flex-1 h-screen overflow-y-auto bg-muted/10 p-4 md:p-8">
        {selectedDriver ? (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-background p-6 rounded-lg border shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight mb-2">{selectedDriver.name || "Unknown Driver"}</h2>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-muted-foreground">
                    <div><span className="font-medium text-foreground">UID:</span> <span className="font-mono">{selectedDriver.uid}</span></div>
                    <div><span className="font-medium text-foreground">Phone:</span> {selectedDriver.phone || "-"}</div>
                    <div><span className="font-medium text-foreground">City:</span> {selectedDriver.city || "-"}</div>
                    <div><span className="font-medium text-foreground">Vehicle:</span> {selectedDriver.vehicleNumber || "-"}</div>
                    <div><span className="font-medium text-foreground">License:</span> {selectedDriver.licenseNumber || "-"}</div>
                    <div>
                      <span className="font-medium text-foreground">KYC:</span>{" "}
                      <Badge variant="outline">{selectedDriver.verificationStatus}</Badge>
                    </div>
                    {selectedDriver.accountStatus && selectedDriver.accountStatus !== "active" && (
                      <div>
                        <span className="font-medium text-foreground">Account:</span>{" "}
                        {accountStatusBadge(selectedDriver.accountStatus)}
                      </div>
                    )}
                  </div>
                </div>

                {/* KYC actions — only for pending drivers */}
                {selectedDriver.verificationStatus === "pending" && (
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="destructive"
                      onClick={() => {
                        const uploaded = (["selfie","aadhaarFront","aadhaarBack","pan","licenseFront","licenseBack","rcFront","rcBack"] as DocType[])
                          .filter(id => {
                            const e = selectedDriver.documents[id];
                            return e && (e.url ?? e.uri);
                          });
                        setRejectDocIds(uploaded);
                        setRejectDialogOpen(true);
                      }}
                      disabled={rejectMutation.isPending || approveMutation.isPending}
                      data-testid="button-reject"
                    >
                      <XCircle className="mr-2 h-4 w-4" /> Reject
                    </Button>
                    <Button
                      onClick={() => approveMutation.mutate(selectedDriver.uid)}
                      disabled={rejectMutation.isPending || approveMutation.isPending}
                      data-testid="button-approve"
                    >
                      <CheckCircle className="mr-2 h-4 w-4" /> Approve
                    </Button>
                  </div>
                )}
              </div>

              {/* Account enforcement actions — available for all approved/verified drivers */}
              {(selectedDriver.verificationStatus === "approved" || selectedDriver.verificationStatus === "verified" || isBlocked(selectedDriver)) && (
                <div className="pt-3 border-t flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground mr-1">Account control:</span>
                  {!isBlocked(selectedDriver) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      onClick={() => setBlockAction("suspend")}
                      disabled={blockMutationPending}
                      data-testid="button-suspend"
                    >
                      <ShieldOff className="mr-2 h-4 w-4" /> Suspend
                    </Button>
                  )}
                  {selectedDriver.accountStatus !== "blacklisted" && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setBlockAction("blacklist")}
                      disabled={blockMutationPending}
                      data-testid="button-blacklist"
                    >
                      <Ban className="mr-2 h-4 w-4" /> Blacklist
                    </Button>
                  )}
                  {isBlocked(selectedDriver) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-green-300 text-green-700 hover:bg-green-50"
                      onClick={() => setBlockAction("restore")}
                      disabled={blockMutationPending}
                      data-testid="button-restore"
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" /> Restore Access
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {(["selfie", "aadhaarFront", "aadhaarBack", "pan", "licenseFront", "licenseBack", "rcFront", "rcBack"] as DocType[]).map(docType => {
                const doc = selectedDriver.documents[docType];
                const url = resolveImageUrl(doc);
                if (!doc) return null;
                
                return (
                  <div key={docType} className="bg-background rounded-lg border overflow-hidden flex flex-col shadow-sm">
                    <div className="p-3 border-b bg-muted/30 flex justify-between items-center">
                      <span className="font-medium text-sm capitalize">{docType.replace(/([A-Z])/g, ' $1').trim()}</span>
                      {url && (
                        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary flex items-center hover:underline">
                          View full <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="p-4 flex-1 flex items-center justify-center bg-muted/10">
                      {url ? (
                        <img
                          src={url}
                          alt={docType}
                          className="max-h-64 object-contain rounded border"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            e.currentTarget.parentElement!.innerHTML = '<div class="text-sm text-muted-foreground p-8">Image not found</div>';
                          }}
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground p-8">No image URL</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Select a driver from the list to review their KYC documents
          </div>
        )}
      </div>

      {/* ── KYC Reject dialog ── */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject KYC</DialogTitle>
            <DialogDescription>
              Select which documents failed verification, then provide a reason. Only checked documents will be marked as rejected.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Documents to reject</p>
              <div className="space-y-2 max-h-52 overflow-y-auto border rounded-md p-3">
                {(["selfie","aadhaarFront","aadhaarBack","pan","licenseFront","licenseBack","rcFront","rcBack"] as DocType[])
                  .filter(id => {
                    const e = selectedDriver?.documents[id];
                    return e && (e.url ?? e.uri);
                  })
                  .map(id => {
                    const label: Record<string, string> = {
                      selfie:       "Selfie / Profile Photo",
                      aadhaarFront: "Aadhaar (Front)",
                      aadhaarBack:  "Aadhaar (Back)",
                      pan:          "PAN Card",
                      licenseFront: "Driving Licence (Front)",
                      licenseBack:  "Driving Licence (Back)",
                      rcFront:      "Vehicle RC (Front)",
                      rcBack:       "Vehicle RC (Back)",
                    };
                    const checked = rejectDocIds.includes(id);
                    return (
                      <label key={id} className="flex items-center gap-3 cursor-pointer select-none text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setRejectDocIds(prev =>
                              checked ? prev.filter(d => d !== id) : [...prev, id]
                            )
                          }
                          className="h-4 w-4 rounded border-gray-300"
                          data-testid={`checkbox-doc-${id}`}
                        />
                        {label[id] ?? id}
                      </label>
                    );
                  })}
              </div>
              {rejectDocIds.length === 0 && (
                <p className="text-xs text-destructive mt-1">Select at least one document to reject.</p>
              )}
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Rejection reason (shown to driver)</p>
              <Textarea
                placeholder="e.g., Aadhaar photo is blurry, PAN card partially cut off — please re-upload"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                data-testid="input-reject-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialogOpen(false); setRejectDocIds([]); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectDocIds.length === 0 || rejectMutation.isPending}
              onClick={() => {
                if (selectedDriver) rejectMutation.mutate({ uid: selectedDriver.uid, reason: rejectReason, docIds: rejectDocIds });
              }}
              data-testid="button-confirm-reject"
            >
              {rejectMutation.isPending ? "Rejecting..." : `Reject ${rejectDocIds.length} Document${rejectDocIds.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Suspend / Blacklist / Restore confirmation dialog ── */}
      {blockAction && (
        <Dialog open={!!blockAction} onOpenChange={(open) => { if (!open) setBlockAction(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{BLOCK_ACTION_META[blockAction].title}</DialogTitle>
              <DialogDescription>{BLOCK_ACTION_META[blockAction].description}</DialogDescription>
            </DialogHeader>
            {selectedDriver && (
              <div className="py-2 text-sm text-muted-foreground">
                Driver: <span className="font-medium text-foreground">{selectedDriver.name || selectedDriver.uid}</span>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setBlockAction(null)} disabled={blockMutationPending}>
                Cancel
              </Button>
              <Button
                variant={BLOCK_ACTION_META[blockAction].variant}
                onClick={handleBlockConfirm}
                disabled={blockMutationPending}
                data-testid={`button-confirm-${blockAction}`}
              >
                {blockMutationPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {BLOCK_ACTION_META[blockAction].confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
