import { SidebarLayout } from "@/components/sidebar-layout";
import { ShoppingBag } from "lucide-react";

export default function Orders() {
  return (
    <SidebarLayout>
      <div className="p-6 lg:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Delivery order management</p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-16 flex flex-col items-center gap-4 text-center">
          <ShoppingBag className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">Order management coming soon.</p>
        </div>
      </div>
    </SidebarLayout>
  );
}
