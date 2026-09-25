import type { ManagementAttentionItem } from "./types";
import type { RiskFinding } from "./risk/types";
import { summarizeFindingsAsAttention } from "./risk/engine";

/**
 * @deprecated Phase 5.2 — attention is derived from RiskFinding[] via summarizeFindingsAsAttention.
 * Kept as a thin wrapper so ECC and tests share one path.
 */
export function buildAttentionFromFindings(findings: RiskFinding[]): ManagementAttentionItem[] {
  return summarizeFindingsAsAttention(findings);
}
