"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

const NAV = [
  { href: "/windows", label: "Jobs" },
  { href: "/windows/prices", label: "Prices" },
];

export default function WindowsFrame({ children, wide = false }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[#EEF3F3] text-[#13232E]">
      <header className="bg-[#13232E] text-white">
        <div
          className={`mx-auto flex items-center justify-between gap-4 px-4 py-3 ${
            wide ? "max-w-5xl" : "max-w-2xl"
          }`}
        >
          <Link href="/windows" className="flex items-center gap-3">
            {/* Four-pane window mark */}
            <span
              aria-hidden="true"
              className="grid h-8 w-8 grid-cols-2 gap-[3px] rounded-[5px] border-[3px] border-white p-[2px]"
            >
              <span className="rounded-[1px] bg-[#7FD1C7]" />
              <span className="rounded-[1px] bg-[#7FD1C7]/60" />
              <span className="rounded-[1px] bg-[#7FD1C7]/60" />
              <span className="rounded-[1px] bg-[#7FD1C7]" />
            </span>
            <span className="text-lg font-bold tracking-tight">
              M &amp; P Windows
            </span>
          </Link>

          <button
            type="button"
            onClick={signOut}
            className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7FD1C7]"
          >
            Sign out
          </button>
        </div>

        <nav
          className={`mx-auto flex gap-1 px-2 ${
            wide ? "max-w-5xl" : "max-w-2xl"
          }`}
        >
          {NAV.map((item) => {
            const active =
              item.href === "/windows"
                ? pathname === "/windows" ||
                  pathname.startsWith("/windows/jobs")
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`border-b-[3px] px-4 pb-2 pt-1 text-sm font-semibold ${
                  active
                    ? "border-[#7FD1C7] text-white"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main
        className={`mx-auto px-4 pb-32 pt-5 ${
          wide ? "max-w-5xl" : "max-w-2xl"
        }`}
      >
        {children}
      </main>
    </div>
  );
}