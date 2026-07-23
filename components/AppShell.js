"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

const menuItems = [
  { name: "Dashboard", href: "/" },
  { name: "Jobs", href: "/jobs" },
  { name: "Invoices", href: "/invoices" },
  { name: "Clients", href: "/clients" },
  { name: "Properties", href: "/properties" },
  { name: "Calendar", href: "/calendar" },
  { name: "Settings", href: "/settings" },
  { name: "Invoice Email", href: "/settings/email" },
];

const publicRoutes = ["/login"];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();

  const isPublicRoute = publicRoutes.some(
    (route) =>
      pathname === route ||
      pathname.startsWith(`${route}/`)
  );

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout error:", error);
      window.alert(
        error.message || "You could not be signed out."
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

          <p className="mt-1 text-sm text-slate-400">
            Right Inventories
          </p>
        </div>

        <nav className="flex gap-2 overflow-x-auto p-4 md:block md:space-y-2">
          {menuItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" &&
                pathname.startsWith(`${item.href}/`));

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

      <main className="flex-1 p-5 md:p-10">
        {children}
      </main>
    </div>
  );
}