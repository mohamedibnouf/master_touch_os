import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";
import { isNotificationsCronPath, requiresInteractiveLogin } from "@/lib/http/session-gate";
import { startPerf } from "@/lib/perf/server-timing";

/**
 * Session refresh + login gate only.
 * Inactive profile/employee checks live in getAuthContext + app layout so every
 * navigation is not two extra Supabase round trips (IAD↔Singapore RTT).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (isNotificationsCronPath(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  const done = startPerf("middleware_update_session");
  let response = NextResponse.next({ request });
  const env = getPublicEnv();

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = !requiresInteractiveLogin(pathname);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    done();
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    done();
    return NextResponse.redirect(url);
  }

  done();
  return response;
}
