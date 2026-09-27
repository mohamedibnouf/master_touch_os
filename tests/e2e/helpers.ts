import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

loadEnvConfig(process.cwd());

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const ORG_ID = "11111111-1111-1111-1111-111111111111";

type PostgrestLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  name?: string;
  status?: number;
  statusCode?: number;
} | null;

/** Serialize Supabase/PostgREST/fetch failures that sometimes omit message. */
export function serializeSupabaseError(error: unknown): string {
  if (error == null) return "null error";
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const cause =
      "cause" in error && error.cause != null ? ` cause=${serializeSupabaseError(error.cause)}` : "";
    return `${error.name}: ${error.message || "(empty message)"}${cause}`;
  }
  if (typeof error === "object") {
    const e = error as Record<string, unknown>;
    const parts = [e.name, e.code, e.message, e.details, e.hint, e.status, e.statusCode]
      .filter((v) => v != null && String(v).trim() !== "")
      .map(String);
    if (parts.length > 0) return parts.join(" ");
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

export async function requireData<T>(
  operation: PromiseLike<{ data: T; error: PostgrestLikeError }>,
  label: string,
): Promise<Exclude<T, null | undefined>> {
  let data: T;
  let error: PostgrestLikeError;
  try {
    ({ data, error } = await operation);
  } catch (thrown) {
    throw new Error(`${label}: thrown ${serializeSupabaseError(thrown)}`);
  }
  if (error) {
    throw new Error(`${label}: ${serializeSupabaseError(error)}`);
  }
  if (data == null) {
    throw new Error(`${label}: returned no data`);
  }
  return data as Exclude<T, null | undefined>;
}

/**
 * Navigate without waiting for full `load` (HMR/dev can keep load open or abort it).
 * Prefer relative paths so Playwright baseURL applies.
 */
export async function gotoApp(page: Page, path: string) {
  const url = path.startsWith("http") ? path : path;
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for E2E fixtures");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function roleId(admin: SupabaseClient, code: string): Promise<string> {
  const role = await requireData(
    admin.from("roles").select("id").eq("code", code).is("organization_id", null).single(),
    `role ${code}`,
  );
  return role.id;
}

export type E2EFixture = {
  runId: string;
  orgId: string;
  projectId: string;
  users: Record<"engineer" | "procurement" | "approver" | "finance", string>;
  passwords: Record<"engineer" | "procurement" | "approver" | "finance", string>;
  userIds: Record<"engineer" | "procurement" | "approver" | "finance", string>;
  supplierIds: { alpha: string; beta: string };
};

export async function createE2EFixture(runId: string): Promise<E2EFixture> {
  const admin = adminClient();
  const prefix = process.env.E2E_PASSWORD ?? "E2eTest1!";

  const org = await requireData(
    admin.from("organizations").select("id").eq("id", ORG_ID).single(),
    "ORG_ID must exist (seed Master Touch org)",
  );

  const users = {
    engineer: `e2e-eng-${runId}@test.local`,
    procurement: `e2e-proc-${runId}@test.local`,
    approver: `e2e-appr-${runId}@test.local`,
    finance: `e2e-fin-${runId}@test.local`,
  } as const;

  const passwords = {
    engineer: `${prefix}eng`,
    procurement: `${prefix}proc`,
    approver: `${prefix}appr`,
    finance: `${prefix}fin`,
  } as const;

  // Roles must cover the happy-path permissions used by the UI (not just RLS).
  const roleMap = {
    engineer: "engineer",
    procurement: "procurement_manager",
    approver: "super_admin",
    finance: "finance_manager",
  } as const;

  const userIds: E2EFixture["userIds"] = {
    engineer: "",
    procurement: "",
    approver: "",
    finance: "",
  };

  for (const key of Object.keys(users) as Array<keyof typeof users>) {
    const { data, error } = await admin.auth.admin.createUser({
      email: users[key],
      password: passwords[key],
      email_confirm: true,
      user_metadata: {
        full_name_ar: `مستخدم E2E ${key}`,
        full_name_en: `E2E ${key}`,
        locale: "ar",
      },
    });
    if (error || !data.user) {
      throw new Error(`createUser ${key}: ${error?.message ?? "no user"}`);
    }
    userIds[key] = data.user.id;

    await requireData(
      admin
        .from("organization_members")
        .insert({ organization_id: org.id, profile_id: data.user.id, status: "active" })
        .select("profile_id")
        .single(),
      `organization_members ${key}`,
    );

    await requireData(
      admin
        .from("employees")
        .insert({
          organization_id: org.id,
          profile_id: data.user.id,
          employment_status: "active",
          is_active: true,
        })
        .select("id")
        .single(),
      `employees ${key}`,
    );

    const rid = await roleId(admin, roleMap[key]);
    await requireData(
      admin
        .from("user_roles")
        .insert({
          organization_id: org.id,
          profile_id: data.user.id,
          role_id: rid,
          scope_type: "organization",
        })
        .select("id")
        .single(),
      `user_roles ${key}`,
    );
  }

  // Dedicated project for this run — avoids stale shared project membership races.
  const project = await requireData(
    admin
      .from("projects")
      .insert({
        organization_id: org.id,
        project_code: `E2E-${runId}`,
        name_ar: `مشروع E2E ${runId}`,
        name_en: `E2E Project ${runId}`,
        status: "active",
        priority: "medium",
        progress_percentage: 0,
        risk_level: "low",
        created_by: userIds.approver,
      })
      .select("id")
      .single(),
    "create e2e project",
  );

  for (const [key, profileId] of Object.entries(userIds)) {
    await requireData(
      admin
        .from("project_members")
        .upsert(
          {
            organization_id: org.id,
            project_id: project.id,
            profile_id: profileId,
            role_label: key,
            is_active: true,
          },
          { onConflict: "project_id,profile_id" },
        )
        .select("id")
        .single(),
      `project_members ${key}`,
    );
  }

  // Ensure PO threshold coverage exists for award/PO approval amounts in this org.
  const { data: thresholdRows } = await admin
    .from("approval_threshold_rules")
    .select("id")
    .eq("organization_id", org.id)
    .eq("process_type", "purchase_order")
    .eq("is_active", true)
    .limit(1);
  if (!thresholdRows?.length) {
    await requireData(
      admin
        .from("approval_threshold_rules")
        .insert({
          organization_id: org.id,
          process_type: "purchase_order",
          min_amount: 0,
          max_amount: null,
          required_roles: ["super_admin", "procurement_manager"],
          is_active: true,
        })
        .select("id")
        .single(),
      "approval_threshold_rules fallback",
    );
  }

  // Valid UUIDs only — string labels like "e2e-sup1-..." fail uuid inserts silently when ignored.
  const supplierAlpha = await requireData(
    admin
      .from("suppliers")
      .insert({
        organization_id: org.id,
        supplier_code: `E2E-${runId}-A`,
        legal_name: `Supplier Alpha ${runId}`,
        status: "active",
        payment_terms_days: 30,
        created_by: userIds.approver,
      })
      .select("id")
      .single(),
    "supplier alpha",
  );
  const supplierBeta = await requireData(
    admin
      .from("suppliers")
      .insert({
        organization_id: org.id,
        supplier_code: `E2E-${runId}-B`,
        legal_name: `Supplier Beta ${runId}`,
        status: "active",
        payment_terms_days: 45,
        created_by: userIds.approver,
      })
      .select("id")
      .single(),
    "supplier beta",
  );

  return {
    runId,
    orgId: org.id,
    projectId: project.id,
    users,
    passwords,
    userIds,
    supplierIds: { alpha: supplierAlpha.id, beta: supplierBeta.id },
  };
}

export async function cleanupE2EFixture(fixture: E2EFixture | null): Promise<void> {
  if (!fixture) return;
  const admin = adminClient();

  // Best-effort commercial cleanup for this run's project, then users.
  await admin.from("projects").delete().eq("id", fixture.projectId);
  await admin.from("suppliers").delete().in("id", [fixture.supplierIds.alpha, fixture.supplierIds.beta]);

  const { data: listed } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const email of Object.values(fixture.users)) {
    const match = listed?.users.find((u) => u.email === email);
    if (match) await admin.auth.admin.deleteUser(match.id);
  }
}

/** @deprecated use createE2EFixture */
export async function createE2EUsers(runId: string) {
  const fixture = await createE2EFixture(runId);
  return { users: fixture.users, passwords: fixture.passwords, ids: fixture.userIds, fixture };
}

/** @deprecated use cleanupE2EFixture */
export async function cleanupE2EUsers(userEmails: string[]) {
  if (userEmails.length === 0) return;
  const admin = adminClient();
  const { data: listed } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const email of userEmails) {
    const match = listed?.users.find((u) => u.email === email);
    if (match) await admin.auth.admin.deleteUser(match.id);
  }
}

export async function assertAuthenticatedPage(page: Page, expectedNamePart?: string) {
  const url = page.url();
  if (url.includes("/login")) {
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 500);
    throw new Error(`Expected authenticated page but URL is /login.\nURL: ${url}\nBody: ${body}`);
  }
  if (url.includes("/error")) {
    throw new Error(`Landed on error page: ${url}`);
  }

  const title = await page.title();
  const logout = page.getByRole("button", { name: "خروج" });
  await expect(logout, `Missing logout control. URL=${url} title=${title}`).toBeVisible({
    timeout: 15_000,
  });

  if (expectedNamePart) {
    const shellText = await page.locator("header").innerText();
    if (!shellText.includes(expectedNamePart)) {
      throw new Error(
        `Authenticated shell did not show expected user "${expectedNamePart}". header=${shellText.slice(0, 200)} url=${url}`,
      );
    }
  }
}

export async function signInViaUI(page: Page, email: string, password: string, expectedNamePart?: string) {
  await gotoApp(page, "/login");

  const existingLogout = page.getByRole("button", { name: "خروج" });
  if (await existingLogout.isVisible().catch(() => false)) {
    if (expectedNamePart) {
      const shellText = await page.locator("header").innerText().catch(() => "");
      if (shellText.includes(expectedNamePart)) {
        await assertAuthenticatedPage(page, expectedNamePart);
        return;
      }
    }
    await Promise.all([
      page.waitForURL(/\/login/, { timeout: 30_000 }).catch(() => null),
      existingLogout.click(),
    ]);
    await gotoApp(page, "/login");
  }

  await page.waitForSelector('form button[type="submit"]', { state: "visible" });
  await page.locator('[name="identifier"]').fill(email);
  await page.locator('[name="password"]').fill(password);

  const submit = page.locator('form button[type="submit"]');
  await expect(submit).toBeEnabled();
  await submit.click();

  // Avoid Promise.race dangling waiters — they keep observing navigations after login succeeds.
  const logout = page.getByRole("button", { name: "خروج" });
  const loginError = page.locator("p.text-danger");

  try {
    await expect(logout.or(loginError)).toBeVisible({ timeout: 120_000 });
  } catch {
    const url = page.url();
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 800);
    throw new Error(`UI sign-in failed for ${email}: timeout:${url}:${body}`);
  }

  if (await logout.isVisible().catch(() => false)) {
    await assertAuthenticatedPage(page, expectedNamePart);
    return;
  }

  if (await loginError.isVisible().catch(() => false)) {
    const msg = await loginError.innerText();
    throw new Error(`UI sign-in failed for ${email}: error:${msg}`);
  }

  await assertAuthenticatedPage(page, expectedNamePart);
}

export async function expectPageMarker(page: Page, testId: string) {
  const marker = page.getByTestId(testId);
  try {
    await expect(marker).toBeVisible({ timeout: 20_000 });
  } catch {
    const url = page.url();
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 800);
    throw new Error(
      `Expected page marker [data-testid="${testId}"] missing.\nURL: ${url}\nBody excerpt:\n${body}`,
    );
  }
}

export async function signInApiClient(email: string, password: string): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`API sign-in failed for ${email}: ${error?.message ?? "no session"}`);
  }
  return client;
}
