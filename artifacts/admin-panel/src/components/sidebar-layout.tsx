import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, ShoppingBag, Users, Truck, FileCheck,
  Wallet, Bell, ShieldCheck, ClipboardList, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Dashboard",    href: "/dashboard",    icon: LayoutDashboard },
  { label: "Orders",       href: "/orders",       icon: ShoppingBag     },
  { label: "Customers",    href: "/customers",    icon: Users           },
  { label: "Drivers",      href: "/drivers",      icon: Truck           },
  { label: "Rider KYC",    href: "/kyc",          icon: FileCheck       },
  { label: "Wallet",       href: "/wallet",       icon: Wallet          },
  { label: "Notifications",href: "/notifications",icon: Bell            },
  { label: "Admin Users",  href: "/admin-roles",  icon: ShieldCheck     },
  { label: "Activity Logs",href: "/activity-logs",icon: ClipboardList   },
];

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();

  const handleLogout = () => {
    sessionStorage.removeItem("adminJwt");
    setLocation("/");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Sidebar ── */}
      <aside className="w-56 shrink-0 flex flex-col border-r bg-card">

        {/* Brand */}
        <div className="h-16 flex items-center gap-3 px-4 border-b shrink-0">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Truck className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate leading-tight">Bike Courier</p>
            <p className="text-xs text-muted-foreground">Admin Panel</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
            const active = location === href || location.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-2 border-t shrink-0">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Log out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
