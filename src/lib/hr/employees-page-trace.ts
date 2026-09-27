import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const EMPLOYEES_PAGE_ROUTE = "/employees";

const SQLSTATE_OR_PGRST = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;

function postgrestCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const record = error as { code?: unknown; causeError?: unknown };
  const nested =
    record.causeError && typeof record.causeError === "object"
      ? (record.causeError as { code?: unknown }).code
      : undefined;
  const candidates = [nested, record.code];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && SQLSTATE_OR_PGRST.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function employeesPageFailureContext(operation: string, error: unknown) {
  return {
    route: EMPLOYEES_PAGE_ROUTE,
    operation,
    errorClass: error instanceof Error ? error.name : "unknown",
    code: postgrestCode(error),
  };
}

export function logEmployeesPageFailure(operation: string, error: unknown): void {
  logger.error("employees page op failed", employeesPageFailureContext(operation, error));
}

export async function traceEmployeesPageOp<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logEmployeesPageFailure(operation, error);
    throw error;
  }
}

export function failEmployeesQuery(
  operation: string,
  error: { message?: string; code?: string; details?: string; hint?: string } | null,
): never {
  logEmployeesPageFailure(operation, error);
  throw new DatabaseError(error);
}
