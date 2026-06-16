import { SidebarLayout } from "@/components/sidebar-layout";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ROLES = [
  { name: "Super Admin",    permissions: "Full access",                members: "—" },
  { name: "Operations",     permissions: "Orders, Drivers, KYC",       members: "—" },
  { name: "Support",        permissions: "Customers, Orders (read)",   members: "—" },
  { name: "Finance",        permissions: "Wallet, Payouts",            members: "—" },
];

export default function AdminRolesPage() {
  return (
    <SidebarLayout>
      <div className="p-6 lg:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Admin Roles</h1>
          <p className="text-sm text-muted-foreground mt-1">Role-based access control for admin users</p>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {ROLES.map(({ name, permissions, members }) => (
            <Card key={name}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium">{name}</CardTitle>
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold">{members}</div>
                <p className="text-xs text-muted-foreground mt-1">{permissions}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="rounded-lg border bg-muted/20 p-16 flex flex-col items-center gap-4 text-center">
          <ShieldCheck className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-sm">Role management coming soon</p>
          <p className="text-xs text-muted-foreground">Create admin accounts, assign roles, and manage granular permissions per team member.</p>
        </div>
      </div>
    </SidebarLayout>
  );
}
