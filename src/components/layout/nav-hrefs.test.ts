import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isUuid } from "@/lib/utils";

const APP = path.join(process.cwd(), "src", "app", "(app)");

const SIDEBAR_HREFS = [
  "/",
  "/attendance",
  "/leave",
  "/approvals",
  "/notifications",
  "/notifications/preferences",
  "/my/payslips",
  "/projects",
  "/engineering",
  "/document-control",
  "/documents",
  "/search",
  "/procurement",
  "/finance",
  "/employees",
  "/departments",
  "/hr/leave",
  "/hr/attendance",
  "/payroll",
  "/management",
  "/management/analyst",
  "/settings",
  "/settings/roles",
];

const FINANCE_SUB = [
  "/finance",
  "/finance/supplier-invoices",
  "/finance/client-valuations",
  "/finance/client-invoices",
  "/finance/variations",
  "/finance/receivables",
];

function pageFileForHref(href: string) {
  if (href === "/") return path.join(APP, "page.tsx");
  return path.join(APP, href.slice(1), "page.tsx");
}

describe("sidebar navigation hrefs", () => {
  it("every sidebar and finance sub-link has a page.tsx", () => {
    for (const href of [...SIDEBAR_HREFS, ...FINANCE_SUB]) {
      expect(existsSync(pageFileForHref(href)), href).toBe(true);
    }
  });

  it("operational areas have loading.tsx skeletons", () => {
    const loadingFiles = [
      path.join(APP, "loading.tsx"),
      path.join(APP, "projects", "[id]", "loading.tsx"),
      path.join(APP, "employees", "[id]", "loading.tsx"),
      path.join(APP, "payroll", "[id]", "loading.tsx"),
      path.join(APP, "management", "loading.tsx"),
      path.join(APP, "finance", "loading.tsx"),
      path.join(APP, "procurement", "loading.tsx"),
      path.join(APP, "hr", "attendance", "loading.tsx"),
    ];
    for (const file of loadingFiles) {
      expect(existsSync(file), file).toBe(true);
    }
  });

  it("accepts UUID-shaped ids and rejects garbage", () => {
    expect(isUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
