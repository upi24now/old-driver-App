import { SidebarLayout } from "@/components/sidebar-layout";
import { Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATS = [
  { label: "Total Disbursed",    value: "₹ —",  desc: "All-time payouts" },
  { label: "Pending Payouts",    value: "—",     desc: "Awaiting disbursement" },
  { label: "Today's Earnings",   value: "₹ —",  desc: "Platform earnings today" },
  { label: "Active Wallets",     value: "—",     desc: "Drivers with balance" },
];

export default function WalletPage() {
  return (
    <SidebarLayout>
      <div className="p-6 lg:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Wallet</h1>
          <p className="text-sm text-muted-foreground mt-1">Driver earnings and payout management</p>
        </div>

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-8">
          {STATS.map(({ label, value, desc }) => (
            <Card key={label}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="rounded-lg border bg-muted/20 p-16 flex flex-col items-center gap-4 text-center">
          <Wallet className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-sm">Wallet management coming soon</p>
          <p className="text-xs text-muted-foreground">Driver payouts, transaction history, and withdrawal approvals will appear here.</p>
        </div>
      </div>
    </SidebarLayout>
  );
}
