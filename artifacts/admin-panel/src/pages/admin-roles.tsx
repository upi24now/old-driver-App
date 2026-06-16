import { useState }        from "react";
import { SidebarLayout }   from "@/components/sidebar-layout";
import { ShieldCheck, UserPlus, RefreshCw } from "lucide-react";
import { Button }          from "@/components/ui/button";
import { Input }           from "@/components/ui/input";
import { Label }           from "@/components/ui/label";
import { useToast }        from "@/hooks/use-toast";
import {
  fetchAdminUsers,
  createAdminUser,
  disableAdminUser,
  enableAdminUser,
  type AdminUser,
} from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const ROLE_LABELS: Record<string, string> = {
  owner:   "Owner",
  manager: "Manager",
  support: "Support",
};

const ROLE_COLORS: Record<string, string> = {
  owner:   "bg-purple-100 text-purple-800",
  manager: "bg-blue-100 text-blue-800",
  support: "bg-gray-100 text-gray-700",
};

function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_COLORS[role] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

export default function AdminUsersPage() {
  const { toast }   = useToast();
  const qc          = useQueryClient();
  const [showForm,  setShowForm]  = useState(false);
  const [newPhone,  setNewPhone]  = useState("");
  const [newName,   setNewName]   = useState("");
  const [newRole,   setNewRole]   = useState<"owner" | "manager" | "support">("manager");

  const { data: users = [], isLoading, refetch } = useQuery<AdminUser[]>({
    queryKey:    ["admin-users"],
    queryFn:     fetchAdminUsers,
    retry:       false,
  });

  const addMutation = useMutation({
    mutationFn: () => createAdminUser(newPhone, newName, newRole),
    onSuccess:  () => {
      toast({ title: "Admin user added" });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setShowForm(false);
      setNewPhone(""); setNewName(""); setNewRole("manager");
    },
    onError: (err: unknown) => toast({
      title:       "Failed to add user",
      description: err instanceof Error ? err.message : "Unknown error",
      variant:     "destructive",
    }),
  });

  const disableMutation = useMutation({
    mutationFn: (phone: string) => disableAdminUser(phone),
    onSuccess:  () => {
      toast({ title: "Admin user disabled" });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: unknown) => toast({
      title:       "Failed to disable",
      description: err instanceof Error ? err.message : "Unknown error",
      variant:     "destructive",
    }),
  });

  const enableMutation = useMutation({
    mutationFn: (phone: string) => enableAdminUser(phone),
    onSuccess:  () => {
      toast({ title: "Admin user enabled" });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: unknown) => toast({
      title:       "Failed to enable",
      description: err instanceof Error ? err.message : "Unknown error",
      variant:     "destructive",
    }),
  });

  return (
    <SidebarLayout>
      <div className="p-6 lg:p-8">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Admin Users</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Only approved numbers can log in. Owner can add / disable admins.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Admin
            </Button>
          </div>
        </div>

        {/* Add form */}
        {showForm && (
          <div className="mb-6 rounded-lg border bg-muted/20 p-5 space-y-4">
            <h2 className="font-semibold text-sm">New Admin User</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-phone">Mobile Number</Label>
                <Input
                  id="new-phone"
                  type="tel"
                  placeholder="9876543210"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-name">Full Name</Label>
                <Input
                  id="new-name"
                  placeholder="Ravi Kumar"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-role">Role</Label>
                <select
                  id="new-role"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "owner" | "manager" | "support")}
                >
                  <option value="owner">Owner</option>
                  <option value="manager">Manager</option>
                  <option value="support">Support</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={addMutation.isPending || !newPhone.trim() || !newName.trim()}
                onClick={() => addMutation.mutate()}
              >
                {addMutation.isPending ? "Adding…" : "Add User"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="rounded-lg border bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <ShieldCheck className="h-8 w-8 opacity-30" />
                      <p className="text-sm">No admin users yet.</p>
                    </div>
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.phone} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{u.name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{u.phone}</td>
                  <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                  <td className="px-4 py-3">
                    {u.isActive
                      ? <span className="text-green-600 text-xs font-medium">Active</span>
                      : <span className="text-red-600 text-xs font-medium">Disabled</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.isActive ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        disabled={disableMutation.isPending}
                        onClick={() => disableMutation.mutate(u.phone)}
                      >
                        Disable
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={enableMutation.isPending}
                        onClick={() => enableMutation.mutate(u.phone)}
                      >
                        Enable
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SidebarLayout>
  );
}
