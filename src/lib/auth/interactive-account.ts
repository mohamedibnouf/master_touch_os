import type { AuthContext } from "@/types/models";

/** Matches prior middleware: inactive profile or inactive employee row cannot use the app. */
export function isDisabledInteractiveAccount(ctx: AuthContext): boolean {
  if (ctx.profile.is_active === false) return true;
  if (ctx.employee && ctx.employee.is_active === false) return true;
  return false;
}
