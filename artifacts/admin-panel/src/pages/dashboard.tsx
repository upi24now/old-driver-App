import { SidebarLayout } from "@/components/sidebar-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Truck, FileCheck, Users, ShoppingBag } from "lucide-react";

const STAT_CARDS = [
  { label: "Total Drivers",   value: "—", icon: Truck,       desc: "Registered delivery partners" },
  { label: "KYC Pending",     value: "—", icon: FileCheck,   desc: "Awaiting document review"     },
  { label: "Active Orders",   value: "—", icon: ShoppingBag, desc: "Deliveries in progress"       },
  { label: "Total Customers", value: "—", icon: Users,       desc: "Registered app users"         },
];

export default function Dashboard() {
  return (
    <SidebarLayout>
      <div className="p-6 lg:p-8 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Platform overview</p>
        </div>

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-8">
          {STAT_CARDS.map(({ label, value, icon: Icon, desc }) => (
            <Card key={label}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="rounded-lg border bg-muted/20 p-12 text-center">
          <p className="text-muted-foreground text-sm">Analytics and live metrics coming soon.</p>
        </div>
      </div>
    </SidebarLayout>
  );
}
