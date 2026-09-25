import { NextResponse } from "next/server";
import { isNotificationsCronAuthorized } from "@/modules/notifications/cron-auth";
import { runNotificationJobs } from "@/server/use-cases/notifications-hub";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  return isNotificationsCronAuthorized(req.headers.get("authorization"));
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runNotificationJobs();
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return POST(req);
}
