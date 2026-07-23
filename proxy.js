import { updateSession } from "./lib/supabase/proxy";

export async function proxy(request) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every route except:
     * - Next.js static files
     * - Next.js image files
     * - favicon
     * - common public image files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
