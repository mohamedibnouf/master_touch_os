import { describe, expect, it } from "vitest";
import { dirFor, format, pickLocalized, resolveLocale } from "./config";
import { ar } from "./dictionaries/ar";
import { en } from "./dictionaries/en";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
}

describe("i18n dictionaries", () => {
  it("English covers exactly the Arabic keys", () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(ar).sort());
  });

  it("keeps the same placeholders in both languages", () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    const leaf = (dict: unknown, path: string) =>
      path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], dict);
    for (const path of keyPaths(ar)) {
      const a = leaf(ar, path);
      const e = leaf(en, path);
      if (typeof a === "string" && typeof e === "string") {
        expect(placeholders(e), path).toEqual(placeholders(a));
      }
    }
  });
});

describe("i18n config", () => {
  it("defaults unknown cookie values to Arabic", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("fr")).toBe("ar");
    expect(resolveLocale(undefined)).toBe("ar");
  });

  it("maps locales to text direction", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
  });

  it("picks the localized field with fallback", () => {
    expect(pickLocalized("en", "مشروع", "Project")).toBe("Project");
    expect(pickLocalized("en", "مشروع", "  ")).toBe("مشروع");
    expect(pickLocalized("ar", null, "Project")).toBe("Project");
  });

  it("formats placeholders and leaves unknown ones", () => {
    expect(format("Hi {name} {x}", { name: "Ali" })).toBe("Hi Ali {x}");
  });
});
