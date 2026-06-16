import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDrivers, approveDriver, rejectDriver,
  type DriverEntry, type DocType,
} from "@/lib/api";
import { SidebarLayout } from "@/components/sidebar-layout";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, ExternalLink, CheckCircle, XCircle } from "lucide-react";

const DOC_LABELS: Record<string, string> = {
  selfie:       "Selfie / Profile Photo",
  aadhaarFront: "Aadhaar (Front)",
  aadhaarBack:  "Aadhaar (Back)",
  pan:          "PAN Card",
  licenseFront: "Driving Licence (Front)",
  licenseBack:  "Driving Licence (Back)",
  rcFront:      "Vehicle RC (Front)",
  rcBack:       "Vehicle RC (Back)",
};

const ALL_DOC_IDS = Object.keys(DOC_LABELS) as DocType[];

function resolveImageUrl(entry: any) {
  if (!entry) return null;
  const path = entry.url ?? entry.uri;
  if (!path) return null;
  return path.startsWith("http") ? path : `/api${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function KYC() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DriverEntry | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectDocIds, setRejectDocIds] = useState<string[]>([]);

  useEffect(() => {
    if (!sessionStorage.getItem("adminApiKey")) setLocation("/");
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
      if (selected?.uid === uid) setSelected(null);
    },
    onError: (err: any) => toast({ title: "Failed to approve", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ uid, reason, docIds }: { uid: string; reason: string; docIds: string[] }) =>
      rejectDriver(uid, reason, docIds),
    onSuccess: (_, { uid }) => {
      toast({ title: "Driver rejected" });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setRejectOpen(false);
      setRejectReason("");
      setRejectDocIds([]);
      if (selected?.uid === uid) setSelected(null);
    },
    onError: (err: any) => toast({ title: "Failed to reject", description: err.message, variant: "destructive" }),
  });

  const openRejectDialog = () => {
    const uploaded = ALL_DOC_IDS.filter(id => {
      const e = selected?.documents[id];
      return e && (e.url ?? e.uri);
    });
    setRejectDocIds(uploaded);
    setRejectOpen(true);
  };

  const filtered = drivers.filter(d =>
    !search ||
    d.name?.toLowerCase().includes(search.toLowerCase()) ||
    d.phone?.includes(search) ||
    d.uid.includes(search)
  );

  if (error) {
    return (
      <SidebarLayout>
        <div className="p-8 text-center text-destructive">
          <p>Failed to load drivers. Check your API key.</p>
          <Button onClick={() => { sessionStorage.removeItem("adminApiKey"); setLocation("/"); }} className="mt-4" variant="outline">
            Back to Login
          </Button>
        </div>
      </SidebarLayout>
    );
  }

  return (
    <SidebarLayout>
      <div className="flex h-full">
        {/* Left panel */}
        <div className="w-80 shrink-0 border-r flex flex-col h-screen overflow-hidden">
          <div className="p-4 border-b space-y-3">
            <div>
              <h2 className="font-semibold">Rider KYC</h2>
              <p className="text-xs text-muted-foreground">Document review queue</p>
            </div>
            <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="all">All Submitted</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, phone…"
                className="pl-8"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y">
            {isLoading ? (
              <div className="p-8 flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No drivers found.</div>
            ) : (
              filtered.map(d => (
                <button
                  key={d.uid}
                  onClick={() => setSelected(d)}
                  className={`w-full text-left p-4 hover:bg-muted/50 transition-colors ${selected?.uid === d.uid ? "bg-muted" : ""}`}
                >
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <span className="font-medium text-sm truncate">{d.name || "Unknown"}</span>
                    <Badge
                      variant={d.verificationStatus === "pending" ? "secondary" : d.verificationStatus === "approved" ? "default" : "destructive"}
                      className="shrink-0 text-xs"
                    >
                      {d.verificationStatus}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{d.phone || "No phone"}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{d.uid}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {selected ? (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="bg-background border rounded-lg p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">{selected.name || "Unknown Driver"}</h2>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm text-muted-foreground mt-3">
                      <div><span className="font-medium text-foreground">Phone:</span> {selected.phone || "—"}</div>
                      <div><span className="font-medium text-foreground">City:</span> {selected.city || "—"}</div>
                      <div><span className="font-medium text-foreground">Vehicle:</span> {selected.vehicleNumber || "—"}</div>
                      <div><span className="font-medium text-foreground">Licence:</span> {selected.licenseNumber || "—"}</div>
                      <div className="col-span-2 font-mono text-xs">{selected.uid}</div>
                    </div>
                  </div>

                  {selected.verificationStatus === "pending" && (
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="destructive"
                        onClick={openRejectDialog}
                        disabled={rejectMutation.isPending || approveMutation.isPending}
                        data-testid="button-reject"
                      >
                        <XCircle className="mr-2 h-4 w-4" /> Reject
                      </Button>
                      <Button
                        onClick={() => approveMutation.mutate(selected.uid)}
                        disabled={rejectMutation.isPending || approveMutation.isPending}
                        data-testid="button-approve"
                      >
                        {approveMutation.isPending
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : <CheckCircle className="mr-2 h-4 w-4" />}
                        Approve
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {ALL_DOC_IDS.map(docType => {
                  const docEntry = selected.documents[docType];
                  const url = resolveImageUrl(docEntry);
                  if (!docEntry) return null;
                  return (
                    <div key={docType} className="bg-background rounded-lg border overflow-hidden shadow-sm">
                      <div className="p-3 border-b bg-muted/30 flex justify-between items-center">
                        <span className="font-medium text-sm">{DOC_LABELS[docType]}</span>
                        {url && (
                          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary flex items-center hover:underline">
                            Full <ExternalLink className="ml-1 h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <div className="p-4 flex items-center justify-center bg-muted/10 min-h-36">
                        {url ? (
                          <img
                            src={url}
                            alt={docType}
                            className="max-h-56 object-contain rounded border"
                            onError={e => {
                              (e.target as HTMLImageElement).style.display = "none";
                              e.currentTarget.parentElement!.innerHTML = '<div class="text-sm text-muted-foreground">Image not found</div>';
                            }}
                          />
                        ) : (
                          <div className="text-sm text-muted-foreground">No image</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Select a driver to review their KYC documents
            </div>
          )}
        </div>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject KYC</DialogTitle>
            <DialogDescription>
              Select failed documents and provide a reason shown to the driver.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Documents to reject</p>
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3">
                {ALL_DOC_IDS.filter(id => {
                  const e = selected?.documents[id];
                  return e && (e.url ?? e.uri);
                }).map(id => {
                  const checked = rejectDocIds.includes(id);
                  return (
                    <label key={id} className="flex items-center gap-3 cursor-pointer text-sm select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setRejectDocIds(prev =>
                          checked ? prev.filter(d => d !== id) : [...prev, id]
                        )}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      {DOC_LABELS[id] ?? id}
                    </label>
                  );
                })}
              </div>
              {rejectDocIds.length === 0 && (
                <p className="text-xs text-destructive mt-1">Select at least one document.</p>
              )}
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Reason (shown to driver)</p>
              <Textarea
                placeholder="e.g., Aadhaar photo is blurry — please re-upload"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectOpen(false); setRejectDocIds([]); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectDocIds.length === 0 || rejectMutation.isPending}
              onClick={() => {
                if (selected) rejectMutation.mutate({ uid: selected.uid, reason: rejectReason, docIds: rejectDocIds });
              }}
              data-testid="button-confirm-reject"
            >
              {rejectMutation.isPending ? "Rejecting…" : `Reject ${rejectDocIds.length} Document${rejectDocIds.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarLayout>
  );
}
