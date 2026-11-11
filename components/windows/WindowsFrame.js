"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { LANGS, setLang, syncLangFromUser, useLang } from "../../lib/windowsLang";

const NAV = [
  { href: "/windows", key: "nav.jobs" },
  { href: "/windows/payments", key: "nav.moneyIn" },
  { href: "/windows/balance", key: "nav.balance" },
  { href: "/windows/earnings", key: "nav.totals" },
  { href: "/windows/prices", key: "nav.prices" },
];

function LanguageSwitch() {
  const { lang, t } = useLang();

  return (
    <div
      role="radiogroup"
      aria-label={t("language")}
      className="flex rounded-lg bg-white/10 p-0.5"
    >
      {LANGS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={lang === option.id}
          aria-label={option.label}
          title={option.label}
          onClick={() => setLang(option.id, supabase)}
          className={`rounded-md px-2.5 py-1.5 text-xs font-bold ${
            lang === option.id
              ? "bg-white text-[#13232E]"
              : "text-slate-300 hover:text-white"
          }`}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}

export default function WindowsFrame({ children, wide = false }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang } = useLang();

  // Pick up the language saved on the account (e.g. set on another phone).
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => syncLangFromUser(data?.user));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

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

          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <button
              type="button"
              onClick={signOut}
              className="rounded-md px-2 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7FD1C7]"
            >
              {t("signOut")}
            </button>
          </div>
        </div>

        <nav
          className={`mx-auto flex gap-1 overflow-x-auto px-2 ${
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
                className={`shrink-0 border-b-[3px] px-2.5 pb-2 pt-1 text-sm font-semibold ${
                  active
                    ? "border-[#7FD1C7] text-white"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                {t(item.key)}
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