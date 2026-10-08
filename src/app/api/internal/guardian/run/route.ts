import { NextResponse } from "next/server";
import { isNotificationsCronAuthorized } from "@/modules/notifications/cron-auth";
import { runGuardianJobs } from "@/server/use-cases/guardian";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isNotificationsCronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runGuardianJobs();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ ok: false, error: "guardian_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
