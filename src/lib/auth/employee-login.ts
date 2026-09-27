/**
 * Employee-number login mapping. Employee number is an identifier, not a credential.
 * Schema: unique (organization_id, employee_number) — not globally unique (003).
 */

export const EMPLOYEE_LOGIN_FAILURE_AR = "الرقم الوظيفي أو كلمة المرور غير صحيحة.";

export const LOGIN_RATE_LIMIT_AR = "تعذر إتمام تسجيل الدخول حالياً. حاول بعد قليل.";

export type LoginCandidate = {
  profile_id: string;
  organization_id: string;
  is_active: boolean;
  employee_number: string | null;
};

export type ResolveLoginResult =
  | { kind: "unique"; candidate: LoginCandidate }
  | { kind: "none" }
  | { kind: "ambiguous" };

export function isEmailIdentifier(value: string): boolean {
  return value.includes("@");
}

export function normalizeEmployeeNumber(value: string): string {
  return value.trim();
}

/** Exact match on stored employee_number (trimmed). Collisions across orgs are ambiguous. */
export function resolveLoginCandidates(
  rows: LoginCandidate[],
  employeeNumber: string,
): ResolveLoginResult {
  const n = normalizeEmployeeNumber(employeeNumber);
  if (!n) return { kind: "none" };
  const matches = rows.filter((row) => row.employee_number === n);
  if (matches.length === 0) return { kind: "none" };
  if (matches.length > 1) return { kind: "ambiguous" };
  return { kind: "unique", candidate: matches[0] };
}

export function isEmployeeLoginAllowed(input: {
  employeeActive: boolean;
  profileActive: boolean;
  membershipActive: boolean;
}): boolean {
  return input.employeeActive && input.profileActive && input.membershipActive;
}

/** Internal Auth email — never shown on employee login UI. */
export function generateInternalAuthEmail(organizationId: string, employeeNumber: string): string {
  const org = organizationId.replace(/-/g, "").slice(0, 12);
  const num = normalizeEmployeeNumber(employeeNumber)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  return `mt.${org}.${num}@login.mastertouch.internal`;
}

export type EmployeeLoginUiStatus = "not_provisioned" | "ready" | "disabled";

export function deriveEmployeeLoginUiStatus(input: {
  employeeActive: boolean;
  profileActive: boolean;
  membershipActive: boolean;
  employeeNumber: string | null;
  loginProvisioned: boolean;
  hasSignedIn: boolean;
}): EmployeeLoginUiStatus {
  if (!input.employeeActive || !input.profileActive || !input.membershipActive) {
    return "disabled";
  }
  if (!normalizeEmployeeNumber(input.employeeNumber ?? "")) {
    return "not_provisioned";
  }
  if (input.loginProvisioned || input.hasSignedIn) {
    return "ready";
  }
  return "not_provisioned";
}

export const EMPLOYEE_LOGIN_STATUS_LABEL_AR: Record<EmployeeLoginUiStatus, string> = {
  not_provisioned: "غير مفعّل",
  ready: "جاهز للدخول",
  disabled: "موقوف",
};

type Bucket = { count: number; resetAt: number };
const loginBuckets = new Map<string, Bucket>();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

export function assertLoginRateLimit(ipKey: string): boolean {
  const now = Date.now();
  const key = `login:${ipKey || "unknown"}`;
  let b = loginBuckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginBuckets.set(key, b);
  }
  b.count += 1;
  return b.count <= LOGIN_MAX_ATTEMPTS;
}

export function resetLoginRateLimitsForTests(): void {
  loginBuckets.clear();
}

export const EMPLOYEE_NUMBER_UNIQUENESS = "organization_scoped" as const;
