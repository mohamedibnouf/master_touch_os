#!/usr/bin/env node
/** Shared identity-gated DATABASE_URL connection. Never logs secrets. */
import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(process.cwd());

export const EXPECTED_REF = "xjwhnxjdcrcmsxjjstsh";
export const ORG = "11111111-1111-1111-1111-111111111111";
export const FILE_070 = "070_custom_role_rpc_execute_hardening.sql";
export const FILE_069 = "069_organization_custom_roles.sql";
export const FILE_068 = "068_job_titles.sql";
export const FILE_067 = "067_base_employee_role.sql";
export const FILE_066 = "066_document_lifecycle.sql";
export const FILE_065 = "065_phase5_document_drive_dual_source.sql";
export const EMPLOYEE_ROLE_ID = "20000000-0000-0000-0000-000000000018";

export const EIGHT = [
  "attendance.view_self",
  "attendance.check_in",
  "attendance.check_out",
  "leave.view_self",
  "leave.request",
  "leave.cancel_self",
  "notification.read",
  "payroll.view_self",
] as const;

export const FORBIDDEN_GRANTS = [
  "employee.create",
  "employee.manage",
  "employee.read",
  "employee.read_sensitive",
  "attendance.view_team",
  "attendance.view_all",
  "attendance.manage",
  "attendance.adjust",
  "leave.view_team",
  "leave.approve_manager",
  "leave.view_all",
  "leave.manage",
  "leave.adjust_balance",
  "payroll.view_all",
  "document.archive",
  "document.upload",
  "settings.manage",
  "role.assign",
  "reports.management.read",
] as const;

export function assertTargetIdentity(): void {
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let ref: string | null = null;
  try {
    ref = new URL(publicUrl).hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1] ?? null;
  } catch {
    ref = null;
  }
  if (ref !== EXPECTED_REF) {
    console.error("STOP: Supabase project ref mismatch.");
    process.exit(2);
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const parsed = new URL(dbUrl);
  const hostOk = parsed.hostname.includes(EXPECTED_REF);
  const userOk = parsed.username === "postgres" || decodeURIComponent(parsed.username).includes(EXPECTED_REF);
  if (!hostOk && !userOk) {
    console.error("STOP: DATABASE_URL does not match expected project.");
    process.exit(2);
  }
}

export async function connect(): Promise<pg.Client> {
  assertTargetIdentity();
  const dbUrl = process.env.DATABASE_URL!;
  const parsed = new URL(dbUrl);
  const password = decodeURIComponent(parsed.password);
  const candidates = [
    dbUrl,
    `postgresql://postgres.${EXPECTED_REF}:${encodeURIComponent(password)}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
  ];
  for (const url of candidates) {
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
    try {
      await client.connect();
      return client;
    } catch {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error("NO_DB_CONNECT");
}

export async function identityOk(client: pg.Client): Promise<boolean> {
  const ident = await client.query("select current_database() as db, current_user as usr");
  const dbOk = ident.rows[0]?.db === "postgres";
  const userOk =
    ident.rows[0]?.usr === "postgres" || String(ident.rows[0]?.usr).includes(EXPECTED_REF);
  console.log("identity.db", ident.rows[0]?.db);
  console.log("identity.user", userOk ? "expected_admin" : "UNEXPECTED");
  const org = await client.query("select 1 from public.organizations where id = $1", [ORG]);
  console.log("org_present", org.rows.length === 1);
  return dbOk && userOk && org.rows.length === 1;
}
