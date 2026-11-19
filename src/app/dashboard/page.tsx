import { redirect } from "next/navigation";
import { VaultDashboard } from "@/components/vault/VaultDashboard";
import { VaultProvider } from "@/components/vault/VaultProvider";
import { isDemoMode } from "@/lib/demo-auth";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  if (isDemoMode) {
    return (
      <VaultProvider>
        <VaultDashboard />
      </VaultProvider>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <VaultProvider>
      <VaultDashboard />
    </VaultProvider>
  );
}
