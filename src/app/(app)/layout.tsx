import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/context";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect("/login");
  }

  return <AppShell ctx={ctx}>{children}</AppShell>;
}
