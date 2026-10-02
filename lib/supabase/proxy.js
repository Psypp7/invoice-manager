import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import {
  WINDOWS_HOME,
  isWindowsPath,
  isWindowsUser,
} from "../windows";

export async function updateSession(request) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  const publicRoutes = [
    "/login",
    "/auth/callback",
  ];

  const isPublicRoute = publicRoutes.some(
    (route) =>
      pathname === route ||
      pathname.startsWith(`${route}/`)
  );

  if (!user && !isPublicRoute) {
    const loginUrl = request.nextUrl.clone();

    loginUrl.pathname = "/login";
    loginUrl.searchParams.set(
      "redirect",
      `${pathname}${request.nextUrl.search}`
    );

    return NextResponse.redirect(loginUrl);
  }

  const windowsUser = isWindowsUser(user);

  if (user && pathname === "/login") {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = windowsUser ? WINDOWS_HOME : "/";
    dashboardUrl.search = "";

    return NextResponse.redirect(dashboardUrl);
  }

  // M & P Windows accounts only ever see the windows app, and
  // Right Inventories accounts never see it.
  if (user && !isPublicRoute) {
    const onWindowsPath = isWindowsPath(pathname);

    if (windowsUser !== onWindowsPath) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Not allowed." },
          { status: 403 }
        );
      }

      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = windowsUser ? WINDOWS_HOME : "/";
      homeUrl.search = "";

      return NextResponse.redirect(homeUrl);
    }
  }

  return response;
}