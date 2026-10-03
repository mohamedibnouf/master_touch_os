import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isPostgresUuid } from "@/lib/postgres-uuid";
import {
  mapStartWorkflowRpcError,
  parseStartWorkflowForm,
  startWorkflowValidationMessage,
} from "./start-workflow-input";

const definitionId = "40000000-0000-0000-0000-000000000005";
const projectId = "b0dd486f-f21c-42c0-8a9e-fbabcd60b015";

describe("parseStartWorkflowForm", () => {
  it("accepts a published system project_lifecycle start payload (seed UUID + RFC project UUID)", () => {
    const parsed = parseStartWorkflowForm({
      definitionId,
      entityType: "project",
      entityId: projectId,
    });
    expect(parsed).toEqual({
      ok: true,
      data: { definitionId, entityType: "project", entityId: projectId },
    });
  });

  it("documents why Production showed تعذر بدء مسار العمل before RPC", () => {
    expect(z.string().uuid().safeParse(definitionId).success).toBe(false);
    expect(isPostgresUuid(definitionId)).toBe(true);
  });

  it("rejects a missing template id before RPC", () => {
    expect(
      parseStartWorkflowForm({
        definitionId: "",
        entityType: "project",
        entityId: projectId,
      }),
    ).toEqual({ ok: false, field: "definitionId" });
    expect(startWorkflowValidationMessage("definitionId").ar).toContain("قالب");
  });

  it("parses document entity_type at the form boundary; RPC must still deny project mismatch", () => {
    const parsed = parseStartWorkflowForm({
      definitionId,
      entityType: "document",
      entityId: projectId,
    });
    expect(parsed.ok).toBe(true);
    expect(mapStartWorkflowRpcError("VALIDATION")).toMatchObject({
      kind: "VALIDATION",
      ar: "مسار العمل غير متاح لهذا المشروع.",
    });
  });

  it("maps unauthorized, duplicate, and incomplete-config RPC failures without raw SQL", () => {
    expect(mapStartWorkflowRpcError("FORBIDDEN").ar).toBe("ليس لديك صلاحية بدء مسار العمل.");
    expect(mapStartWorkflowRpcError("CONFLICT").ar).toBe("تم بدء مسار العمل مسبقاً.");
    expect(mapStartWorkflowRpcError("NOT_FOUND").ar).toBe("تعذر بدء المسار بسبب إعداد غير مكتمل.");
    expect(mapStartWorkflowRpcError("column status is of type workflow_step_status").ar).toBe(
      "تعذر بدء مسار العمل.",
    );
  });

  it("rejects malformed definition identifiers", () => {
    const bad = ["not-a-uuid", "40000000-0000-0000-0000-00000000000", "40000000-0000-0000-0000-000000000005X", "gggggggg-0000-0000-0000-000000000005"];
    for (const definitionId of bad) {
      expect(
        parseStartWorkflowForm({
          definitionId,
          entityType: "project",
          entityId: projectId,
        }),
      ).toEqual({ ok: false, field: "definitionId" });
    }
  });
});

describe("startWorkflowAction authorization contract", () => {
  it("requires workflow.start and does not add workflow.manage", () => {
    const src = readFileSync("src/server/use-cases/platform.ts", "utf8");
    const start = src.slice(src.indexOf("export async function startWorkflowAction"), src.indexOf("export async function updateWorkflowStepDeadlineAction"));
    expect(start).toContain('authorize(await getAuthContext(), "workflow.start")');
    expect(start).not.toContain("workflow.manage");
    expect(start).toContain('p_entity_type: parsed.data.entityType');
  });
});
