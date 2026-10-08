import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  currentPackageStepKeys,
  projectNeedsActivity,
  projectNeedsCommercialBundle,
  projectNeedsDocumentCatalog,
  projectNeedsEngineeringBundle,
  projectNeedsOrgUserDirectory,
  projectNeedsStagePackages,
} from "./project-detail-loaders";

const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");

describe("project detail tab loaders", () => {
  it("does not fetch stage packages or engineering bundles on overview", () => {
    expect(projectNeedsStagePackages("overview")).toBe(false);
    expect(projectNeedsEngineeringBundle("overview")).toBe(false);
    expect(projectNeedsCommercialBundle("overview")).toBe(false);
    expect(projectNeedsActivity("overview")).toBe(false);
    expect(projectNeedsOrgUserDirectory("overview")).toBe(false);
    expect(projectNeedsDocumentCatalog("overview")).toBe(false);
  });

  it("stages tab loads packages for the current step only", () => {
    expect(projectNeedsStagePackages("stages")).toBe(true);
    expect(
      currentPackageStepKeys([
        { stepKey: "procurement", engineStatus: "completed", visual: "completed" },
        { stepKey: "execution", engineStatus: "ready", visual: "current", canComplete: true },
        { stepKey: "handover", engineStatus: "pending", visual: "upcoming" },
      ]),
    ).toEqual(["execution"]);
  });

  it("page wires tab-gated loaders and Link tabs", () => {
    expect(page).toMatch(/projectNeedsStagePackages/);
    expect(page).toMatch(/projectNeedsEngineeringBundle/);
    expect(page).toMatch(/currentPackageStepKeys/);
    expect(page).toMatch(/<Link/);
    expect(page).toContain("prefetch={false}");
    expect(page).toMatch(/instanceRes/);
    expect(page).not.toMatch(/<a[\s\S]{0,80}href=\{`\/projects\/\$\{project\.id\}\?tab=\$\{item\.id\}`\}/);
  });
});
