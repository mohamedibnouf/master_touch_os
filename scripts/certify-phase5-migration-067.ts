#!/usr/bin/env node
/**
 * 067 grant certification from the live role_permissions rowset.
 * Does not create Auth users. Does not insert user_roles.
 * Never logs secrets.
 */
import { connect, identityOk, EIGHT, FORBIDDEN_GRANTS } from "./phase5-db-gate";

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }

    const grants = await client.query<{ permission_key: string }>(
      `select rp.permission_key
       from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'employee' and r.organization_id is null`,
    );
    const set = new Set(grants.rows.map((r) => r.permission_key));

    const positive = EIGHT.map((key) => ({
      caseId: key,
      status: set.has(key) ? "PASS" : "FAIL",
    }));
    const negative = FORBIDDEN_GRANTS.map((key) => ({
      caseId: `not:${key}`,
      status: set.has(key) ? "FAIL" : "PASS",
    }));

    const identityCases = [
      "has_permission() as authenticated employee user",
      "RLS punch/leave/payslip as authenticated employee user",
      "createEmployeeAction live",
    ].map((name) => ({
      caseId: name,
      status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
      detail: "Supabase Auth identities are outside a rolled-back DB transaction; no permanent test users created",
    }));

    console.log(
      JSON.stringify(
        {
          grant_count: grants.rows.length,
          grants: [...set].sort(),
          positive,
          negative,
          identity_dependent: identityCases,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
