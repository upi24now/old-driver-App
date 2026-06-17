import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { fetchAllOrders, fetchDriverDetail, type OrderEntry, type DriverDetail } from "@/lib/api";
import { SidebarLayout } from "@/components/sidebar-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, Search, RefreshCw, User, Truck, MapPin, IndianRupee,
  Phone, Star, ArrowRight, CheckCircle2, XCircle, Clock,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; cls: string }> = {
  delivered:      { label: "Delivered",      cls: "bg-green-100 text-green-800 border-green-200"   },
  driver_assigned:{ label: "Assigned",        cls: "bg-blue-100  text-blue-800  border-blue-200"    },
  to_pickup:      { label: "To Pickup",       cls: "bg-blue-100  text-blue-800  border-blue-200"    },
  at_pickup:      { label: "At Pickup",       cls: "bg-blue-100  text-blue-800  border-blue-200"    },
  to_drop:        { label: "En Route",        cls: "bg-indigo-100 text-indigo-800 border-indigo-200"},
  at_drop:        { label: "At Drop",         cls: "bg-indigo-100 text-indigo-800 border-indigo-200"},
  cancelled:      { label: "Cancelled",       cls: "bg-red-100   text-red-800   border-red-200"     },
  searching:      { label: "Searching",       cls: "bg-yellow-100 text-yellow-800 border-yellow-200"},
  pending:        { label: "Pending",         cls: "bg-yellow-100 text-yellow-800 border-yellow-200"},
  dispatched:     { label: "Dispatched",      cls: "bg-orange-100 text-orange-800 border-orange-200"},
};

function statusBadge(status: string) {
  const m = STATUS_META[status] ?? { label: status, cls: "bg-muted text-muted-foreground border" };
  return (
    <Badge className={`border ${m.cls} hover:${m.cls} text-xs`}>{m.label}</Badge>
  );
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function fmtShortId(id: string) {
  return id.length > 10 ? `#${id.slice(-8).toUpperCase()}` : `#${id.toUpperCase()}`;
}

const STATUS_FILTERS = [
  { value: "all",            label: "All Orders"   },
  { value: "delivered",      label: "Delivered"    },
  { value: "driver_assigned",label: "Assigned"     },
  { value: "to_pickup",      label: "To Pickup"    },
  { value: "at_pickup",      label: "At Pickup"    },
  { value: "to_drop",        label: "En Route"     },
  { value: "at_drop",        label: "At Drop"      },
  { value: "cancelled",      label: "Cancelled"    },
  { value: "searching",      label: "Searching"    },
];

// ── Customer Profile Modal ─────────────────────────────────────────────────────

function CustomerProfileModal({
  order, onClose,
}: { order: OrderEntry; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Customer Profile</DialogTitle>
          <DialogDescription>Customer details for this order</DialogDescription>
        </DialogHeader>
        <div className="py-3 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <User className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-base">{order.customerName || "Unknown Customer"}</p>
              <p className="text-xs text-muted-foreground font-mono">{order.customerId || "—"}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Phone</p>
              <div className="flex items-center gap-1.5 font-medium">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {order.customerPhone || "—"}
              </div>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Rating</p>
              <div className="flex items-center gap-1.5 font-medium">
                <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                {order.customerRating != null ? order.customerRating.toFixed(1) : "—"}
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-muted/40 p-3 space-y-2 text-sm">
            <div className="flex gap-2">
              <div className="mt-0.5 flex-shrink-0">
                <div className="h-2 w-2 rounded-full bg-green-500 mt-1" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pickup</p>
                <p className="font-medium">{order.pickupAddress || "—"}</p>
              </div>
            </div>
            <div className="ml-1 border-l-2 border-dashed border-muted-foreground/30 h-3" />
            <div className="flex gap-2">
              <div className="mt-0.5 flex-shrink-0">
                <div className="h-2 w-2 rounded-full bg-red-500 mt-1" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Drop</p>
                <p className="font-medium">{order.dropAddress || "—"}</p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Driver Profile Modal ───────────────────────────────────────────────────────

function DriverProfileModal({
  driverUid, driverName, onClose,
}: { driverUid: string; driverName: string | null; onClose: () => void }) {
  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ["driver-detail", driverUid],
    queryFn:  () => fetchDriverDetail(driverUid),
    retry:    false,
    staleTime: 30_000,
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Driver Profile</DialogTitle>
          <DialogDescription>Live profile and stats for {driverName || driverUid}</DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="py-6 text-center text-sm text-destructive">
            Failed to load driver profile.
          </div>
        )}

        {detail && (
          <div className="py-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Truck className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-base">{detail.name || "—"}</p>
                <p className="text-xs text-muted-foreground">{detail.phone || "—"}</p>
                <p className="text-xs text-muted-foreground font-mono">{driverUid}</p>
              </div>
              <div className="ml-auto">
                {detail.isOnline
                  ? <Badge className="bg-green-100 text-green-800 border-green-200">Online</Badge>
                  : <Badge variant="secondary">Offline</Badge>
                }
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              {([
                { label: "Completed",  value: detail.ordersCompleted, icon: CheckCircle2, color: "text-green-600" },
                { label: "Cancelled",  value: detail.ordersCancelled,  icon: XCircle,     color: "text-red-500"   },
                { label: "Rejections", value: detail.ordersRejectedBy, icon: Clock,       color: "text-orange-500"},
              ] as const).map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="rounded-lg border bg-background p-3">
                  <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
                  <p className="text-lg font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Wallet Balance</p>
                <p className="text-lg font-bold flex items-center gap-1">
                  <IndianRupee className="h-4 w-4" />{detail.walletBalance.toFixed(2)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Total Earnings</p>
                <p className="text-lg font-bold flex items-center gap-1">
                  <IndianRupee className="h-4 w-4" />{detail.totalEarnings.toFixed(2)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Rating</p>
                <p className="text-lg font-bold flex items-center gap-1">
                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                  {detail.rating != null ? Number(detail.rating).toFixed(1) : "5.0"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Vehicle</p>
                <p className="text-sm font-medium truncate">{detail.vehicleNumber || "—"}</p>
              </div>
            </div>

            {detail.latitude != null && detail.longitude != null && (
              <div className="rounded-lg border overflow-hidden">
                <iframe
                  title="driver-location"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${detail.longitude - 0.01},${detail.latitude - 0.01},${detail.longitude + 0.01},${detail.latitude + 0.01}&layer=mapnik&marker=${detail.latitude},${detail.longitude}`}
                  className="w-full h-40 border-0"
                />
                <div className="p-2 text-xs text-muted-foreground flex items-center justify-between bg-muted/30">
                  <span className="font-mono">{detail.latitude.toFixed(5)}, {detail.longitude.toFixed(5)}</span>
                  {detail.lastSeenAt && (
                    <span>Updated {fmtTime(detail.lastSeenAt)}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Order Detail Panel ─────────────────────────────────────────────────────────

function OrderDetail({ order, onClose }: { order: OrderEntry; onClose: () => void }) {
  const [showCustomer, setShowCustomer] = useState(false);
  const [showDriver,   setShowDriver]   = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <p className="font-semibold text-base">{fmtShortId(order.id)}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{order.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(order.status)}
          <button
            onClick={onClose}
            className="ml-1 rounded p-1 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Fare */}
        <div className="rounded-lg border p-4 bg-background">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Fare</p>
              <p className="text-2xl font-bold flex items-center gap-0.5">
                <IndianRupee className="h-5 w-5" />
                {order.fareEstimate != null ? order.fareEstimate.toFixed(2) : "—"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Payment</p>
              <p className="font-medium capitalize">{order.paymentMode || "—"}</p>
            </div>
          </div>
        </div>

        {/* Route */}
        <div className="rounded-lg border p-4 bg-background space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Route</p>
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="h-2.5 w-2.5 rounded-full bg-green-500 mt-0.5" />
              <div className="flex-1 border-l-2 border-dashed border-muted-foreground/30 my-1" />
              <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
            </div>
            <div className="space-y-3 flex-1">
              <div>
                <p className="text-xs text-muted-foreground">Pickup</p>
                <p className="text-sm font-medium">{order.pickupAddress || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Drop</p>
                <p className="text-sm font-medium">{order.dropAddress || "—"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Customer */}
        <div className="rounded-lg border bg-background">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-sm">{order.customerName || "Unknown Customer"}</p>
                <p className="text-xs text-muted-foreground">{order.customerPhone || "—"}</p>
              </div>
            </div>
            <Button
              size="sm" variant="outline"
              className="h-7 px-2.5 text-xs gap-1"
              onClick={() => setShowCustomer(true)}
              data-testid="btn-customer-profile"
            >
              Open Profile <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Driver */}
        <div className="rounded-lg border bg-background">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                <Truck className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-sm">{order.driverName || (order.driverUid ? "Assigned Driver" : "Unassigned")}</p>
                <p className="text-xs text-muted-foreground font-mono">{order.driverUid || "—"}</p>
              </div>
            </div>
            {order.driverUid && (
              <Button
                size="sm" variant="outline"
                className="h-7 px-2.5 text-xs gap-1"
                onClick={() => setShowDriver(true)}
                data-testid="btn-driver-profile"
              >
                Open Profile <ArrowRight className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="rounded-lg border p-4 bg-background space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Timeline</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{fmtTime(order.createdAt)}</span>
            </div>
            {order.acceptedAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Accepted</span>
                <span>{fmtTime(order.acceptedAt)}</span>
              </div>
            )}
            {order.deliveredAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Delivered</span>
                <span>{fmtTime(order.deliveredAt)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCustomer && (
        <CustomerProfileModal order={order} onClose={() => setShowCustomer(false)} />
      )}
      {showDriver && order.driverUid && (
        <DriverProfileModal
          driverUid={order.driverUid}
          driverName={order.driverName}
          onClose={() => setShowDriver(false)}
        />
      )}
    </div>
  );
}

// ── Main Orders Page ───────────────────────────────────────────────────────────

export default function Orders() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OrderEntry | null>(null);

  useEffect(() => {
    if (!sessionStorage.getItem("adminJwt")) setLocation("/");
  }, [setLocation]);

  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ["orders", statusFilter],
    queryFn:  () => fetchAllOrders(statusFilter === "all" ? undefined : statusFilter, 200),
    retry:    false,
    staleTime: 30_000,
  });

  const filtered = orders.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      (o.customerName  ?? "").toLowerCase().includes(q) ||
      (o.customerPhone ?? "").includes(q) ||
      (o.driverName    ?? "").toLowerCase().includes(q) ||
      (o.driverUid     ?? "").toLowerCase().includes(q) ||
      (o.pickupAddress ?? "").toLowerCase().includes(q) ||
      (o.dropAddress   ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <SidebarLayout>
      <div className="flex h-full overflow-hidden">
        {/* Left: order list */}
        <div className={`flex flex-col overflow-hidden transition-all ${selected ? "w-[55%]" : "w-full"}`}>
          {/* Toolbar */}
          <div className="p-4 border-b flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold">Orders</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isLoading ? "Loading…" : `${filtered.length} orders`}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
              </Button>
            </div>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search ID, customer, driver, address…"
                  className="pl-8"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Order ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead className="text-right">Fare</TableHead>
                  <TableHead>Created</TableHead>
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
                      No orders found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(o => (
                    <TableRow
                      key={o.id}
                      className={`cursor-pointer hover:bg-muted/50 ${selected?.id === o.id ? "bg-muted" : ""}`}
                      onClick={() => setSelected(o)}
                    >
                      <TableCell className="font-mono text-xs">{fmtShortId(o.id)}</TableCell>
                      <TableCell>{statusBadge(o.status)}</TableCell>
                      <TableCell className="text-sm">
                        <p className="font-medium">{o.customerName || "—"}</p>
                        <p className="text-xs text-muted-foreground">{o.customerPhone || ""}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        <p className="font-medium">{o.driverName || (o.driverUid ? "Assigned" : "—")}</p>
                        <p className="text-xs text-muted-foreground font-mono">{o.driverUid ? o.driverUid.slice(0, 12) + "…" : ""}</p>
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {o.fareEstimate != null ? `₹${o.fareEstimate.toFixed(0)}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {fmtTime(o.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Right: order detail */}
        {selected && (
          <div className="w-[45%] border-l bg-background flex flex-col overflow-hidden">
            <OrderDetail order={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </SidebarLayout>
  );
}
