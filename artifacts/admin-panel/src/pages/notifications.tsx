import { SidebarLayout } from "@/components/sidebar-layout";
import { Bell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATS = [
  { label: "Sent Today",      value: "—", desc: "Push notifications sent" },
  { label: "Delivery Rate",   value: "—", desc: "Successfully delivered" },
  { label: "Campaigns",       value: "—", desc: "Active campaigns" },
  { label: "Scheduled",       value: "—", desc: "Queued notifications" },
];

export default function NotificationsPage() {
  return (
    <SidebarLayout>
      <div className="p-6 lg:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground mt-1">Push notification campaigns and delivery logs</p>
        </div>

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-8">
          {STATS.map(({ label, value, desc }) => (
            <Card key={label}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                <Bell className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="rounded-lg border bg-muted/20 p-16 flex flex-col items-center gap-4 text-center">
          <Bell className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-sm">Notification centre coming soon</p>
          <p className="text-xs text-muted-foreground">Broadcast FCM push notifications to drivers, create campaigns, and view delivery logs.</p>
        </div>
      </div>
    </SidebarLayout>
  );
}
