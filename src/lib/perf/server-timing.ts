import { logger } from "@/lib/logger";

/** Opt-in via PERF_LOG=1. Never logs payloads or secrets. */
export function startPerf(label: string): () => void {
  if (process.env.PERF_LOG !== "1") return () => {};
  const t0 = performance.now();
  return () => {
    logger.info("perf", { label, ms: Math.round(performance.now() - t0) });
  };
}
