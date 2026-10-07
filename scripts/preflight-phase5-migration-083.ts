#!/usr/bin/env node
/** Read-only snapshot before 083. Never writes. Never logs secrets. Never calls lazy get RPCs. */
import { connect, identityOk, ORG } from "./phase5-db-gate";

const FILES = [
  "079_workflow_gate_approval_documents.sql",
  "080_workflow_procurement_completion_gate.sql",
  "081_project_mobilization_readiness.sql",
  "082_project_execution_control.sql",
  "083_final_workflow_evidence_gates.sql",
];
const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const STEP08 = "1208e0a0-15b4-44c1-afe1-8c75f2864c00";
const STEP09 = "40ab8f7c-b03c-40a5-9c46-202aef871684";
const STEP10 = "a9203b87-15ec-4bfe-b1ac-a37490eb5390";

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);
    const latest = await client.query(
      `select filename from public.schema_migrations
       where filename ~ '^[0-9]{3}_'
       order by filename desc limit 3`,
    );
    const mig = await client.query(
      `select filename, count(*)::int as n from public.schema_migrations where filename = any($1::text[]) group by 1 order by 1`,
      [FILES],
    );
    const stage = await client.query(
      `select s.step_key, s.status::text, s.responsible_user_id, s.sequence
       from public.workflow_instance_steps s
       where s.id = any($1::uuid[])
       order by s.sequence`,
      [[STEP08, STEP09, STEP10]],
    );
    const applyDef = await client.query(
      `select pg_get_functiondef(p.oid) as def
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_workflow_step_outcome'`,
    );
    const def = String(applyDef.rows[0]?.def ?? "");
    console.log(
      JSON.stringify(
        {
          org: ORG,
          project: PROJECT,
          latest: latest.rows,
          migrations: mig.rows,
          stages: stage.rows,
          live_apply: {
            procurement: def.includes("WORKFLOW_PROCUREMENT_NOT_READY"),
            mobilization: def.includes("WORKFLOW_MOBILIZATION_NOT_READY"),
            execution: def.includes("WORKFLOW_EXECUTION_NOT_READY"),
            commissioning: def.includes("WORKFLOW_COMMISSIONING_NOT_READY"),
            handover: def.includes("WORKFLOW_HANDOVER_NOT_READY"),
            gate: def.includes("WORKFLOW_GATE_REQUIRED"),
          },
        },
        null,
        2,
      ),
    );
    const byFile = Object.fromEntries(mig.rows.map((row: { filename: string; n: number }) => [row.filename, row.n]));
    for (const f of FILES.slice(0, 4)) {
      if (byFile[f] !== 1) {
        console.error(`STOP: ${f} count`, byFile[f] ?? 0);
        process.exit(2);
      }
    }
    if ((byFile["083_final_workflow_evidence_gates.sql"] ?? 0) !== 0) {
      console.error("STOP: 083 already recorded");
      process.exit(2);
    }
    const s08 = stage.rows.find((row: { step_key: string }) => row.step_key === "testing_commissioning");
    const s09 = stage.rows.find((row: { step_key: string }) => row.step_key === "handover");
    const s10 = stage.rows.find((row: { step_key: string }) => row.step_key === "closeout");
    if (!s08 || !s09 || !s10) {
      console.error("STOP: missing Stage 08/09/10 rows");
      process.exit(2);
    }
    if (s08.status === "completed" || s09.status === "completed" || s10.status === "completed") {
      console.error("STOP: Stage 08/09/10 already completed");
      process.exit(2);
    }
    if (!def.includes("WORKFLOW_EXECUTION_NOT_READY") || !def.includes("WORKFLOW_GATE_REQUIRED")) {
      console.error("STOP: live apply missing 079/082 gates");
      process.exit(2);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
