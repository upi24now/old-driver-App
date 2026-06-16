import { SidebarLayout } from "@/components/sidebar-layout";
import { ClipboardList } from "lucide-react";

const MOCK_EVENTS = [
  { time: "—",  actor: "admin",  action: "Approved KYC",   target: "driver UID ..." },
  { time: "—",  actor: "admin",  action: "Suspended driver", target: "driver UID ..." },
  { time: "—",  actor: "system", action: "Order dispatched", target: "order ..."      },
  { time: "—",  actor: "admin",  action: "Blacklisted driver", target: "driver UID ..." },
  { time: "—",  actor: "system", action: "Payment processed", target: "wallet ..."    },
];

export default function ActivityLogsPage() {
  return (
    <SidebarLayout>
      <div className="p-6 lg:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Activity Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">Audit trail of all admin and system actions</p>
        </div>

        <div className="rounded-lg border bg-background overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actor</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {MOCK_EVENTS.map((e, i) => (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{e.time}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${e.actor === "admin" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-700"}`}>
                      {e.actor}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{e.action}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{e.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border bg-muted/20 p-12 flex flex-col items-center gap-4 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-sm">Live audit logs coming soon</p>
          <p className="text-xs text-muted-foreground">Every admin action (KYC approvals, suspensions, payout approvals) will be logged here with timestamp and actor.</p>
        </div>
      </div>
    </SidebarLayout>
  );
}
