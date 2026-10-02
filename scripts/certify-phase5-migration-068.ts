#!/usr/bin/env node
/**
 * 068 certification: grant matrix + rolled-back structural tests.
 * Does not create Auth users. Never logs secrets.
 */
import { connect, identityOk, ORG, EIGHT } from "./phase5-db-gate";

type Case = { id: string; status: "PASS" | "FAIL" | "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE"; detail?: string };

function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string; code?: string; detail?: string };
    return [o.message, o.code, o.detail].filter(Boolean).join(" | ") || JSON.stringify(e);
  }
  return String(e);
}

async function main() {
  const client = await connect();
  const cases: Case[] = [];
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }

    const grants = await client.query<{ code: string; permission_key: string }>(
      `select r.code, rp.permission_key
       from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where rp.permission_key in ('job_title.read','job_title.manage')`,
    );
    const has = (code: string, key: string) =>
      grants.rows.some((g) => g.code === code && g.permission_key === key);

    cases.push({
      id: "I.employee_no_job_title_manage",
      status: has("employee", "job_title.manage") || has("employee", "job_title.read") ? "FAIL" : "PASS",
    });
    cases.push({
      id: "J.hr_officer_no_job_title_manage",
      status: has("hr_officer", "job_title.manage") ? "FAIL" : "PASS",
    });
    cases.push({
      id: "J2.hr_officer_has_read",
      status: has("hr_officer", "job_title.read") ? "PASS" : "FAIL",
    });

    const employee = await client.query<{ permission_key: string }>(
      `select rp.permission_key from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'employee' and r.organization_id is null`,
    );
    const eightOk =
      employee.rows.length === 8 && EIGHT.every((k) => employee.rows.some((r) => r.permission_key === k));
    cases.push({ id: "employee_eight_frozen", status: eightOk ? "PASS" : "FAIL" });

    const noDelete = await client.query(
      `select 1 from pg_policies where schemaname='public' and tablename='job_titles' and cmd='DELETE'`,
    );
    cases.push({
      id: "G.no_authenticated_delete_policy",
      status: noDelete.rows.length === 0 ? "PASS" : "FAIL",
    });

    await client.query("begin");
    const run = async (id: string, fn: () => Promise<void>) => {
      await client.query(`savepoint ${id.replace(/[^a-zA-Z0-9]/g, "_")}`);
      try {
        await fn();
        await client.query(`release savepoint ${id.replace(/[^a-zA-Z0-9]/g, "_")}`);
      } catch (e) {
        await client.query(`rollback to savepoint ${id.replace(/[^a-zA-Z0-9]/g, "_")}`);
        throw e;
      }
    };

    try {
      const dept = await client.query<{ id: string }>(
        `select id from public.departments where organization_id = $1 and is_active = true order by code limit 2`,
        [ORG],
      );
      const d1 = dept.rows[0]?.id;
      const d2 = dept.rows[1]?.id;
      if (!d1) throw new Error("no department in Master Touch org");

      try {
        await run("sp_a", async () => {
          await client.query(
            `insert into public.job_titles (organization_id, name_ar, name_en, department_id)
             values ($1, 'شهادة-مسمى-أ', 'Cert Title A', $2)`,
            [ORG, d1],
          );
        });
        cases.push({ id: "A.same_org_title_accepted", status: "PASS" });
      } catch (e) {
        cases.push({
          id: "A.same_org_title_accepted",
          status: "FAIL",
          detail: errMsg(e).slice(0, 180),
        });
      }

      try {
        await run("sp_b", async () => {
          const otherOrg = await client.query<{ id: string }>(
            `insert into public.organizations (name_ar, name_en)
             values ('منظمة شهادة مؤقتة', 'Cert Temp Org')
             returning id`,
          );
          const otherDept = await client.query<{ id: string }>(
            `insert into public.departments (organization_id, code, name_ar, name_en)
             values ($1, 'CERT-TMP', 'قسم شهادة مؤقت', 'Cert Temp Dept')
             returning id`,
            [otherOrg.rows[0].id],
          );
          await client.query(
            `insert into public.job_titles (organization_id, name_ar, name_en, department_id)
             values ($1, 'شهادة-مسمى-ب', 'Cert Title B', $2)`,
            [ORG, otherDept.rows[0].id],
          );
        });
        cases.push({ id: "B.cross_org_department_rejected", status: "FAIL", detail: "insert succeeded" });
      } catch (e) {
        const msg = errMsg(e);
        cases.push({
          id: "B.cross_org_department_rejected",
          status: msg.includes("JOB_TITLE_DEPARTMENT_ORG_MISMATCH") ? "PASS" : "FAIL",
          detail: msg.includes("JOB_TITLE_DEPARTMENT_ORG_MISMATCH")
            ? "JOB_TITLE_DEPARTMENT_ORG_MISMATCH"
            : msg.slice(0, 180),
        });
      }

      try {
        await run("sp_c", async () => {
          await client.query(
            `insert into public.job_titles (organization_id, name_ar, name_en)
             values ($1, 'مسمى-عام-شهادة', 'Org Wide Cert'), ($1, '  مسمى-عام-شهادة  ', 'Org Wide Cert 2')`,
            [ORG],
          );
        });
        cases.push({ id: "C.duplicate_org_wide_name_rejected", status: "FAIL", detail: "duplicate inserted" });
      } catch {
        cases.push({ id: "C.duplicate_org_wide_name_rejected", status: "PASS" });
      }

      try {
        await run("sp_d", async () => {
          await client.query(
            `insert into public.job_titles (organization_id, department_id, name_ar, name_en)
             values ($1, $2, 'مسمى-قسم-شهادة', 'Dept Cert'), ($1, $2, 'مسمى-قسم-شهادة', 'Dept Cert 2')`,
            [ORG, d1],
          );
        });
        cases.push({ id: "D.duplicate_department_name_rejected", status: "FAIL" });
      } catch {
        cases.push({ id: "D.duplicate_department_name_rejected", status: "PASS" });
      }

      if (d1 && d2) {
        try {
          await run("sp_e", async () => {
            await client.query(
              `insert into public.job_titles (organization_id, department_id, name_ar, name_en)
               values ($1, $2, 'اسم-مشترك-شهادة', 'Shared Name'), ($1, $3, 'اسم-مشترك-شهادة', 'Shared Name')`,
              [ORG, d1, d2],
            );
          });
          cases.push({ id: "E.same_name_two_departments_allowed", status: "PASS" });
        } catch (e) {
          cases.push({
            id: "E.same_name_two_departments_allowed",
            status: "FAIL",
            detail: errMsg(e).slice(0, 180),
          });
        }
      } else {
        cases.push({
          id: "E.same_name_two_departments_allowed",
          status: "FAIL",
          detail: "need two departments",
        });
      }

      try {
        const inactive = await client.query(
          `insert into public.job_titles (organization_id, name_ar, name_en, is_active)
           values ($1, 'مسمى-موقوف-شهادة', 'Inactive Cert', false)
           returning is_active`,
          [ORG],
        );
        cases.push({
          id: "F.inactive_flag_supported",
          status: inactive.rows[0]?.is_active === false ? "PASS" : "FAIL",
        });
      } catch (e) {
        cases.push({
          id: "F.inactive_flag_supported",
          status: "FAIL",
          detail: errMsg(e).slice(0, 180),
        });
      }

      try {
        await run("sp_created_by", async () => {
          const foreignMember = await client.query<{ profile_id: string }>(
            `select profile_id from public.organization_members
             where organization_id is distinct from $1
             limit 1`,
            [ORG],
          );
          const createdBy =
            foreignMember.rows[0]?.profile_id ?? "00000000-0000-0000-0000-000000000001";
          await client.query(
            `insert into public.job_titles (organization_id, name_ar, name_en, created_by)
             values ($1, 'مسمى-منشئ-أجنبي', 'Foreign Creator', $2)`,
            [ORG, createdBy],
          );
        });
        cases.push({ id: "created_by_foreign_rejected", status: "FAIL", detail: "insert succeeded" });
      } catch (e) {
        const msg = errMsg(e);
        cases.push({
          id: "created_by_foreign_rejected",
          status: msg.includes("JOB_TITLE_CREATED_BY_ORG_MISMATCH") ? "PASS" : "FAIL",
          detail: msg.includes("JOB_TITLE_CREATED_BY_ORG_MISMATCH")
            ? "JOB_TITLE_CREATED_BY_ORG_MISMATCH"
            : msg.slice(0, 180),
        });
      }

      try {
        await run("sp_code_blank", async () => {
          await client.query(
            `insert into public.job_titles (organization_id, name_ar, name_en, code)
             values ($1, 'رمز-فارغ-1', 'Blank Code 1', '   '),
                    ($1, 'رمز-فارغ-2', 'Blank Code 2', '   ')`,
            [ORG],
          );
        });
        cases.push({
          id: "blank_whitespace_code_not_unique",
          status: "PASS",
          detail: "whitespace/blank codes allowed to duplicate (excluded from unique index)",
        });
      } catch (e) {
        cases.push({
          id: "blank_whitespace_code_not_unique",
          status: "FAIL",
          detail: errMsg(e).slice(0, 180),
        });
      }

      try {
        await run("sp_code_dup", async () => {
          await client.query(
            `insert into public.job_titles (organization_id, name_ar, name_en, code)
             values ($1, 'رمز-مكرر-1', 'Dup Code 1', 'ENG-01'),
                    ($1, 'رمز-مكرر-2', 'Dup Code 2', ' eng-01 ')`,
            [ORG],
          );
        });
        cases.push({ id: "nonempty_code_unique_in_org", status: "FAIL", detail: "duplicate code inserted" });
      } catch {
        cases.push({ id: "nonempty_code_unique_in_org", status: "PASS" });
      }
    } finally {
      await client.query("rollback");
    }

    const leftover = await client.query(
      `select count(*)::int as n from public.job_titles
       where name_en like '%Cert%'
          or name_en like '%Blank Code%'
          or name_en like '%Dup Code%'
          or name_en like '%Foreign Creator%'
          or name_ar like '%شهادة%'`,
    );
    cases.push({
      id: "temp_rows_cleaned",
      status: leftover.rows[0]?.n === 0 ? "PASS" : "FAIL",
      detail: `remaining=${leftover.rows[0]?.n}`,
    });

    cases.push({
      id: "H.cross_org_write_as_authenticated",
      status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
      detail: "Supabase Auth JWT is outside DB transaction; no permanent test users created",
    });
    cases.push({
      id: "RLS_as_authenticated_member",
      status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
    });

    console.log(JSON.stringify({ cases }, null, 2));
    const failed = cases.filter((c) => c.status === "FAIL");
    if (failed.length) process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
