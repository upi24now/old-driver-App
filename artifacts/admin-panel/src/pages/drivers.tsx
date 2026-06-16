import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDrivers, suspendDriver, blacklistDriver, unsuspendDriver,
  type DriverEntry,
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Search, ShieldOff, Ban, ShieldCheck, RefreshCw } from "lucide-react";

type BlockAction = "suspend" | "blacklist" | "restore";

const ACTION_META: Record<BlockAction, { title: string; description: string; confirmLabel: string; variant: "destructive" | "default" | "outline" }> = {
  suspend: {
    title:        "Suspend Driver?",
    description:  "The driver will be immediately forced offline and blocked from receiving orders. They will see a suspended screen on the app. You can restore access later.",
    confirmLabel: "Suspend Driver",
    variant:      "destructive",
  },
  blacklist: {
    title:        "Blacklist Driver?",
    description:  "The driver will be permanently blocked and forced offline immediately. They will see a blacklisted screen on the app.",
    confirmLabel: "Blacklist Driver",
    variant:      "destructive",
  },
  restore: {
    title:        "Restore Driver Access?",
    description:  "The driver's account will be reactivated. They must go online again manually.",
    confirmLabel: "Restore Access",
    variant:      "default",
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

export default function Drivers() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<DriverEntry | null>(null);
  const [blockAction, setBlockAction] = useState<BlockAction | null>(null);

  useEffect(() => {
    if (!sessionStorage.getItem("adminApiKey")) setLocation("/");
  }, [setLocation]);

  const { data: drivers = [], isLoading, refetch } = useQuery({
    queryKey: ["drivers", "all"],
    queryFn: () => fetchDrivers("all"),
    retry: false,
  });

  const suspendMutation  = useMutation({ mutationFn: suspendDriver,   onSuccess: onSuccess("suspended") });
  const blacklistMutation = useMutation({ mutationFn: blacklistDriver, onSuccess: onSuccess("blacklisted") });
  const unsuspendMutation = useMutation({ mutationFn: unsuspendDriver, onSuccess: onSuccess("restored") });

  function onSuccess(label: string) {
    return () => {
      toast({ title: `Driver ${label} — app will enforce within 2 s` });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setBlockAction(null);
      setTarget(null);
    };
  }

  const confirmBlock = () => {
    if (!target || !blockAction) return;
    if (blockAction === "suspend")   suspendMutation.mutate(target.uid);
    if (blockAction === "blacklist") blacklistMutation.mutate(target.uid);
    if (blockAction === "restore")   unsuspendMutation.mutate(target.uid);
  };

  const busy = suspendMutation.isPending || blacklistMutation.isPending || unsuspendMutation.isPending;

  const isBlocked = (d: DriverEntry) =>
    d.accountStatus === "suspended" || d.accountStatus === "blacklisted";

  const filtered = drivers.filter(d =>
    !search ||
    d.name?.toLowerCase().includes(search.toLowerCase()) ||
    d.phone?.includes(search) ||
    d.uid.includes(search)
  );

  return (
    <SidebarLayout>
      <div className="p-6 lg:p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Drivers</h1>
            <p className="text-sm text-muted-foreground mt-1">Account management — suspend, blacklist, restore</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, phone, UID…"
            className="pl-8"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="rounded-lg border bg-background overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>KYC Status</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-sm text-muted-foreground">
                    No drivers found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(d => (
                  <TableRow key={d.uid}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{d.name || "—"}</p>
                        <p className="text-xs text-muted-foreground font-mono">{d.uid}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{d.phone || "—"}</TableCell>
                    <TableCell>{verificationBadge(d.verificationStatus)}</TableCell>
                    <TableCell>{accountBadge(d.accountStatus)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.vehicleNumber || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!isBlocked(d) && (
                          <Button
                            size="sm" variant="outline"
                            className="border-orange-300 text-orange-700 hover:bg-orange-50 h-7 px-2 text-xs"
                            onClick={() => { setTarget(d); setBlockAction("suspend"); }}
                            disabled={busy}
                            data-testid={`btn-suspend-${d.uid}`}
                          >
                            <ShieldOff className="h-3 w-3 mr-1" /> Suspend
                          </Button>
                        )}
                        {d.accountStatus !== "blacklisted" && (
                          <Button
                            size="sm" variant="destructive"
                            className="h-7 px-2 text-xs"
                            onClick={() => { setTarget(d); setBlockAction("blacklist"); }}
                            disabled={busy}
                            data-testid={`btn-blacklist-${d.uid}`}
                          >
                            <Ban className="h-3 w-3 mr-1" /> Blacklist
                          </Button>
                        )}
                        {isBlocked(d) && (
                          <Button
                            size="sm" variant="outline"
                            className="border-green-300 text-green-700 hover:bg-green-50 h-7 px-2 text-xs"
                            onClick={() => { setTarget(d); setBlockAction("restore"); }}
                            disabled={busy}
                            data-testid={`btn-restore-${d.uid}`}
                          >
                            <ShieldCheck className="h-3 w-3 mr-1" /> Restore
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {blockAction && target && (
        <Dialog open onOpenChange={open => { if (!open) { setBlockAction(null); setTarget(null); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{ACTION_META[blockAction].title}</DialogTitle>
              <DialogDescription>{ACTION_META[blockAction].description}</DialogDescription>
            </DialogHeader>
            <div className="py-2 text-sm text-muted-foreground">
              Driver: <span className="font-medium text-foreground">{target.name || target.uid}</span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setBlockAction(null); setTarget(null); }} disabled={busy}>
                Cancel
              </Button>
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
