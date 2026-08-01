"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function clientName(client) {
  return client?.company_name || client?.name || "Unknown client";
}

function barWidth(value, max) {
  if (!max) return 0;
  return Math.max(3, Math.min(100, (Number(value || 0) / max) * 100));
}

export default function CompanyAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState([]);

  useEffect(() => {
    loadAnalytics();
  }, []);

  async function loadAnalytics() {
    setLoading(true);
    setMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        window.location.href = "/login";
        return;
      }

      const { data: business, error: businessError } =
        await supabase
          .from("businesses")
          .select("id")
          .eq("owner_user_id", user.id)
          .single();

      if (businessError || !business) {
        throw businessError || new Error("Business not found.");
      }

      const [
        { data: invoices, error: invoiceError },
        { data: jobs, error: jobsError },
      ] = await Promise.all([
        supabase
          .from("invoices")
          .select(`
            id,
            client_id,
            total,
            balance_due,
            status,
            client:clients(id,name,company_name)
          `)
          .eq("business_id", business.id)
          .is("deleted_at", null),

        supabase
          .from("jobs")
          .select(`
            id,
            client_id,
            status,
            client:clients(id,name,company_name)
          `)
          .eq("business_id", business.id),
      ]);

      if (invoiceError) throw invoiceError;
      if (jobsError) throw jobsError;

      const map = new Map();

      function ensure(clientId, client) {
        const key = clientId || `unknown-${clientName(client)}`;
        if (!map.has(key)) {
          map.set(key, {
            key,
            name: clientName(client),
            jobCount: 0,
            invoiceCount: 0,
            totalInvoiced: 0,
            totalPaid: 0,
            totalOutstanding: 0,
            unpaidInvoiceCount: 0,
          });
        }
        return map.get(key);
      }

      for (const invoice of invoices || []) {
        const row = ensure(invoice.client_id, invoice.client);
        const total = Number(invoice.total || 0);
        const balance = Number(
          invoice.balance_due ??
            (invoice.status === "paid" ? 0 : total)
        );

        row.invoiceCount += 1;
        row.totalInvoiced += total;
        row.totalOutstanding += Math.max(0, balance);
        row.totalPaid += Math.max(0, total - balance);

        if (
          invoice.status !== "paid" &&
          invoice.status !== "cancelled" &&
          balance > 0
        ) {
          row.unpaidInvoiceCount += 1;
        }
      }

      for (const job of jobs || []) {
        ensure(job.client_id, job.client).jobCount += 1;
      }

      const prepared = Array.from(map.values()).sort(
        (a, b) =>
          b.totalOutstanding - a.totalOutstanding ||
          b.jobCount - a.jobCount ||
          a.name.localeCompare(b.name)
      );

      setRows(prepared);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "Could not load company analytics.");
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          acc.companies += 1;
          acc.jobs += row.jobCount;
          acc.invoices += row.invoiceCount;
          acc.invoiced += row.totalInvoiced;
          acc.paid += row.totalPaid;
          acc.outstanding += row.totalOutstanding;
          return acc;
        },
        {
          companies: 0,
          jobs: 0,
          invoices: 0,
          invoiced: 0,
          paid: 0,
          outstanding: 0,
        }
      ),
    [rows]
  );

  const maxJobs = Math.max(0, ...rows.map((row) => row.jobCount));
  const maxOutstanding = Math.max(
    0,
    ...rows.map((row) => row.totalOutstanding)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Company Analytics
          </h1>
          <p className="mt-2 text-slate-600">
            Compare jobs, invoiced amounts, payments received and money still owed by each agent or company.
          </p>
        </div>

        <button
          type="button"
          onClick={loadAnalytics}
          disabled={loading}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {message && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {message}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Card label="Companies" value={totals.companies} />
        <Card label="Jobs" value={totals.jobs} />
        <Card label="Invoices" value={totals.invoices} />
        <Card label="Total invoiced" value={money(totals.invoiced)} />
        <Card label="Paid" value={money(totals.paid)} valueClass="text-green-700" />
        <Card label="Still owed" value={money(totals.outstanding)} valueClass="text-red-700" />
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">
          Loading company analytics...
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Chart title="Jobs by agent or company">
              {rows.map((row) => (
                <Bar
                  key={row.key}
                  label={row.name}
                  value={`${row.jobCount} job${row.jobCount === 1 ? "" : "s"}`}
                  width={barWidth(row.jobCount, maxJobs)}
                  className="bg-blue-600"
                />
              ))}
            </Chart>

            <Chart title="Outstanding money by company">
              {rows.map((row) => (
                <Bar
                  key={row.key}
                  label={row.name}
                  value={money(row.totalOutstanding)}
                  width={barWidth(row.totalOutstanding, maxOutstanding)}
                  className={row.totalOutstanding > 0 ? "bg-red-500" : "bg-green-500"}
                />
              ))}
            </Chart>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-xl font-bold text-slate-900">
                Company payment breakdown
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1000px] w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Agent / company</th>
                    <th className="px-4 py-3 text-right">Jobs</th>
                    <th className="px-4 py-3 text-right">Invoices</th>
                    <th className="px-4 py-3 text-right">Total invoiced</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-right">Still owed</th>
                    <th className="px-4 py-3 text-right">Unpaid invoices</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.key} className={index % 2 ? "bg-slate-50" : "bg-white"}>
                      <td className="border-t border-slate-200 px-4 py-3 font-semibold">
                        {row.name}
                      </td>
                      <td className="border-t border-slate-200 px-4 py-3 text-right">
                        {row.jobCount}
                      </td>
                      <td className="border-t border-slate-200 px-4 py-3 text-right">
                        {row.invoiceCount}
                      </td>
                      <td className="border-t border-slate-200 px-4 py-3 text-right font-semibold">
                        {money(row.totalInvoiced)}
                      </td>
                      <td className="border-t border-slate-200 px-4 py-3 text-right font-semibold text-green-700">
                        {money(row.totalPaid)}
                      </td>
                      <td className="border-t border-slate-200 px-4 py-3 text-right font-bold text-red-700">
                        {money(row.totalOutstanding)}
                      </td>
                      <td className="border-t border-slate-200 px-4 py-3 text-right">
                        {row.unpaidInvoiceCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, value, valueClass = "text-slate-900" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

function Chart({ title, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

function Bar({ label, value, width, className }) {
  return (
    <div>
      <div className="flex justify-between gap-4 text-sm">
        <span className="truncate font-medium text-slate-700">{label}</span>
        <span className="shrink-0 font-bold text-slate-900">{value}</span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${className}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
