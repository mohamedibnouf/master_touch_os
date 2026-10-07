import { NextResponse } from "next/server";
import { parseNotificationReadId } from "@/lib/notifications/tap";
import { markOwnedNotificationRead } from "@/server/use-cases/notification-read";

export const dynamic = "force-dynamic";

/** Cookie-authenticated mark-read. Must not revalidate the current page. */
export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const id = parseNotificationReadId(body);
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  const result = await markOwnedNotificationRead(id);
  if (!result.ok) return NextResponse.json({ ok: false }, { status: result.status });
  return NextResponse.json({ ok: true });
}
