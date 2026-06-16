import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Login         from "@/pages/login";
import Dashboard     from "@/pages/dashboard";
import Orders        from "@/pages/orders";
import Customers     from "@/pages/customers";
import Drivers       from "@/pages/drivers";
import KYC           from "@/pages/kyc";
import WalletPage    from "@/pages/wallet";
import NotificationsPage from "@/pages/notifications";
import AdminRolesPage    from "@/pages/admin-roles";
import ActivityLogsPage  from "@/pages/activity-logs";
import NotFound      from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/"              component={Login}              />
      <Route path="/dashboard"     component={Dashboard}          />
      <Route path="/orders"        component={Orders}             />
      <Route path="/customers"     component={Customers}          />
      <Route path="/drivers"       component={Drivers}            />
      <Route path="/kyc"           component={KYC}                />
      <Route path="/wallet"        component={WalletPage}         />
      <Route path="/notifications" component={NotificationsPage}  />
      <Route path="/admin-roles"   component={AdminRolesPage}     />
      <Route path="/activity-logs" component={ActivityLogsPage}   />
      <Route                       component={NotFound}           />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
