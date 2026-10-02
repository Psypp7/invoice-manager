"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  fetchMyBusinesses,
  readActiveBusinessId,
  setActiveBusinessId,
} from "../lib/activeBusiness";

const menuItems = [
  { name: "Dashboard", href: "/" },
  {
    name: "Company Analytics",
    href: "/company-analytics",
  },
  { name: "Invoices", href: "/invoices" },
  {
    name: "Invoice Register",
    href: "/invoice-register",
  },
  { name: "Clients", href: "/clients" },
  { name: "Calendar", href: "/calendar" },

  {
    name: "AI Inventory",
    href: "/reports/ai-test",
  },

  { name: "Settings", href: "/settings" },
  {
    name: "Invoice Email",
    href: "/settings/email",
  },
];

const publicRoutes = ["/login"];

function companyInitials(name) {
  const words = String(name || "")
    .replace(/\b(ltd|limited)\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words
    .slice(0, 3)
    .map((word) => word[0].toUpperCase())
    .join("");
}

// Pages that show one specific invoice. After switching company the
// invoice belongs to the other company, so go back to the list.
function isSingleInvoicePage(pathname) {
  return (
    /^\/invoices\/[^/]+/.test(pathname) &&
    !pathname.startsWith("/invoices/deleted") &&
    !pathname.startsWith("/invoices/import")
  );
}

function CompanySwitcher({ pathname }) {
  const [companies, setCompanies] = useState([]);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || cancelled) return;

      const { data, error } = await fetchMyBusinesses(
        supabase,
        user.id
      );

      if (error || !data?.length || cancelled) return;

      const saved = readActiveBusinessId();
      const current =
        data.find((company) => company.id === saved) ||
        data[0];

      // Repair a missing or stale choice so every page agrees.
      if (current.id !== saved) {
        setActiveBusinessId(current.id);
      }

      setCompanies(data);
      setActiveId(current.id);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  function switchTo(companyId) {
    if (companyId === activeId) return;

    setActiveBusinessId(companyId);
    setActiveId(companyId);

    // Every page loads its data on mount, so a fresh load is the
    // simplest way to make sure nothing from the other company is
    // left on screen.
    if (isSingleInvoicePage(pathname)) {
      window.location.assign("/invoices");
    } else {
      window.location.reload();
    }
  }

  const active = companies.find(
    (company) => company.id === activeId
  );

  if (companies.length < 2) {
    return (
      <p className="mt-1 text-sm text-slate-400">
        {active?.business_name || "Right Inventories"}
      </p>
    );
  }

  return (
    <div className="mt-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Company
      </p>

      <div className="space-y-1.5 rounded-xl bg-slate-900 p-1.5 ring-1 ring-slate-800">
        {companies.map((company) => {
          const selected = company.id === activeId;

          return (
            <button
              key={company.id}
              type="button"
              onClick={() => switchTo(company.id)}
              aria-pressed={selected}
              className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                selected
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                  selected
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-300"
                }`}
              >
                {companyInitials(company.business_name)}
              </span>

              <span className="min-w-0 flex-1 truncate font-medium">
                {company.business_name}
              </span>

              {selected ? (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();

  const isPublicRoute = publicRoutes.some(
    (route) =>
      pathname === route ||
      pathname.startsWith(`${route}/`)
  );

  async function handleLogout() {
    const { error } =
      await supabase.auth.signOut();

    if (error) {
      console.error("Logout error:", error);
      window.alert(
        error.message ||
          "You could not be signed out."
      );
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  if (isPublicRoute) {
    return (
      <main className="min-h-screen bg-slate-100 p-5 text-slate-900 md:p-10">
        {children}
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 md:flex">
      <aside className="w-full bg-slate-950 text-white md:min-h-screen md:w-64">
        <div className="border-b border-slate-800 p-6">
          <h1 className="text-xl font-bold">
            Invoice Manager
          </h1>

          <CompanySwitcher pathname={pathname} />
        </div>

        <nav className="flex gap-2 overflow-x-auto p-4 md:block md:space-y-2">
          {menuItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" &&
                pathname.startsWith(
                  `${item.href}/`
                ));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block whitespace-nowrap rounded-lg px-4 py-3 font-medium ${
                  isActive
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {item.name}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={handleLogout}
            className="block w-full whitespace-nowrap rounded-lg px-4 py-3 text-left font-medium text-slate-300 hover:bg-red-900 hover:text-white"
          >
            Sign out
          </button>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 p-5 md:p-10">
        {children}
      </main>
    </div>
  );
}