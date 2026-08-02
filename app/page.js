"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function startOfCurrentMonth() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    "01",
  ].join("-");
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "—";

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (match) {
    return `${match[3]} ${new Intl.DateTimeFormat(
      "en-GB",
      { month: "short" }
    ).format(
      new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
      )
    )} ${match[1]}`;
  }

  return "—";
}

function daysBetween(startDate, endDate = getToday()) {
  if (!startDate) return 0;

  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);

  return Math.max(
    0,
    Math.floor(
      (end.getTime() - start.getTime()) /
        86400000
    )
  );
}

function invoiceNumberValue(invoiceNumber) {
  const match = String(invoiceNumber || "")
    .toUpperCase()
    .match(/(\d+)$/);

  return match ? Number(match[1]) : 0;
}

function getDescription(invoice) {
  return (
    invoice.invoice_items?.[0]?.description ||
    ""
  ).trim();
}

function getReportType(description) {
  const lower = String(description || "")
    .toLowerCase();

  if (
    lower.includes("check-in") ||
    lower.includes("check in")
  ) {
    return "Check-in";
  }

  if (
    lower.includes("check-out") ||
    lower.includes("check out")
  ) {
    return "Check-out";
  }

  if (lower.includes("midterm")) {
    return "Midterm";
  }

  if (lower.includes("inventory")) {
    return "Inventory";
  }

  return "Report";
}

function getPropertyText(invoice) {
  const description = getDescription(invoice);

  if (!description) {
    return "No description";
  }

  const atMatches = [
    ...description.matchAll(/\s+at\s+/gi),
  ];

  if (!atMatches.length) {
    return description;
  }

  return description
    .slice(
      atMatches[atMatches.length - 1].index +
        atMatches[atMatches.length - 1][0].length
    )
    .trim();
}

function statusClass(status) {
  switch (status) {
    case "paid":
      return "bg-green-100 text-green-700";

    case "cancelled":
      return "bg-slate-200 text-slate-600";

    case "draft":
      return "bg-blue-100 text-blue-700";

    default:
      return "bg-amber-100 text-amber-700";
  }
}

function paymentText(invoice) {
  if (invoice.status === "paid") {
    return "Paid";
  }

  if (invoice.status === "cancelled") {
    return "Cancelled";
  }

  if (invoice.status === "draft") {
    return "Draft";
  }

  const days = daysBetween(invoice.issue_date);

  if (days === 0) return "Unpaid today";
  if (days === 1) return "Unpaid for 1 day";

  return `Unpaid for ${days} days`;
}

function StatCard({
  title,
  value,
  secondary,
  href,
  accent = "text-slate-900",
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <p className="text-sm font-semibold text-slate-500">
        {title}
      </p>

      <p
        className={`mt-3 break-words text-3xl font-bold tracking-tight ${accent}`}
      >
        {value}
      </p>

      <p className="mt-2 text-sm text-slate-500">
        {secondary}
      </p>
    </Link>
  );
}

export default function DashboardPage() {
  const [invoices, setInvoices] = useState([]);
  const [clientsCount, setClientsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    initialiseDashboard();
  }, []);

  async function initialiseDashboard() {
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

      const {
        data: business,
        error: businessError,
      } = await supabase
        .from("businesses")
        .select("id")
        .eq("owner_user_id", user.id)
        .single();

      if (businessError || !business) {
        throw (
          businessError ||
          new Error("Business not found.")
        );
      }

      const [
        invoicesResult,
        clientsResult,
      ] = await Promise.all([
        supabase
          .from("invoices")
          .select(
            `
              id,
              invoice_number,
              issue_date,
              status,
              total,
              amount_paid,
              balance_due,
              paid_at,
              sent_at,
              customer_name,
              client:clients(
                id,
                name,
                company_name
              ),
              invoice_items(
                id,
                description,
                sort_order
              )
            `
          )
          .eq("business_id", business.id)
          .is("deleted_at", null),

        supabase
          .from("clients")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("business_id", business.id)
          .eq("is_active", true),
      ]);

      if (invoicesResult.error) {
        throw invoicesResult.error;
      }

      if (clientsResult.error) {
        throw clientsResult.error;
      }

      const sortedInvoices = [
        ...(invoicesResult.data || []),
      ]
        .map((invoice) => ({
          ...invoice,
          invoice_items: [
            ...(invoice.invoice_items || []),
          ].sort(
            (first, second) =>
              Number(first.sort_order || 0) -
              Number(second.sort_order || 0)
          ),
        }))
        .sort(
          (first, second) =>
            invoiceNumberValue(
              second.invoice_number
            ) -
            invoiceNumberValue(
              first.invoice_number
            )
        );

      setInvoices(sortedInvoices);
      setClientsCount(
        clientsResult.count || 0
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "The dashboard could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  const dashboardData = useMemo(() => {
    const monthStart = startOfCurrentMonth();

    const activeInvoices = invoices.filter(
      (invoice) =>
        invoice.status !== "cancelled"
    );

    const unpaidInvoices =
      activeInvoices.filter(
        (invoice) =>
          invoice.status !== "paid" &&
          Number(
            invoice.balance_due ??
              invoice.total ??
              0
          ) > 0
      );

    const paidInvoices =
      activeInvoices.filter(
        (invoice) =>
          invoice.status === "paid"
      );

    const paidThisMonth =
      paidInvoices.filter((invoice) => {
        if (!invoice.paid_at) return false;

        return (
          String(invoice.paid_at).slice(0, 10) >=
          monthStart
        );
      });

    const outstandingTotal =
      unpaidInvoices.reduce(
        (sum, invoice) =>
          sum +
          Number(
            invoice.balance_due ??
              invoice.total ??
              0
          ),
        0
      );

    const paidThisMonthTotal =
      paidThisMonth.reduce(
        (sum, invoice) =>
          sum +
          Number(
            invoice.amount_paid ||
              invoice.total ||
              0
          ),
        0
      );

    const totalInvoiceValue =
      activeInvoices.reduce(
        (sum, invoice) =>
          sum + Number(invoice.total || 0),
        0
      );

    const sentCount =
      activeInvoices.filter(
        (invoice) => invoice.sent_at
      ).length;

    const notSentCount =
      activeInvoices.length - sentCount;

    const averagePaymentDays = (() => {
      const paidWithDates =
        paidInvoices.filter(
          (invoice) =>
            invoice.issue_date &&
            invoice.paid_at
        );

      if (!paidWithDates.length) {
        return 0;
      }

      const totalDays =
        paidWithDates.reduce(
          (sum, invoice) =>
            sum +
            daysBetween(
              invoice.issue_date,
              String(invoice.paid_at).slice(
                0,
                10
              )
            ),
          0
        );

      return Math.round(
        totalDays /
          paidWithDates.length
      );
    })();

    const oldestUnpaid = [
      ...unpaidInvoices,
    ].sort(
      (first, second) =>
        daysBetween(second.issue_date) -
        daysBetween(first.issue_date)
    )[0];

    const recentInvoices =
      activeInvoices.slice(0, 7);

    return {
      activeInvoices,
      unpaidInvoices,
      paidInvoices,
      paidThisMonth,
      outstandingTotal,
      paidThisMonthTotal,
      totalInvoiceValue,
      sentCount,
      notSentCount,
      averagePaymentDays,
      oldestUnpaid,
      recentInvoices,
    };
  }, [invoices]);

  if (loading) {
    return (
      <div className="text-slate-500">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <header className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">
            Right Inventories
          </p>

          <h1 className="mt-1 text-4xl font-bold tracking-tight text-slate-900">
            Dashboard
          </h1>

          <p className="mt-2 max-w-3xl text-slate-500">
            A focused overview of invoices,
            payments, clients and email status.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/invoices/import"
            className="rounded-lg border border-blue-600 px-4 py-3 font-semibold text-blue-600 hover:bg-blue-50"
          >
            Import spreadsheet
          </Link>

          <Link
            href="/invoices"
            className="rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700"
          >
            Create invoice
          </Link>
        </div>
      </header>

      {message && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Outstanding"
          value={formatMoney(
            dashboardData.outstandingTotal
          )}
          secondary={`${dashboardData.unpaidInvoices.length} unpaid invoices`}
          href="/invoices"
          accent="text-red-700"
        />

        <StatCard
          title="Paid this month"
          value={formatMoney(
            dashboardData.paidThisMonthTotal
          )}
          secondary={`${dashboardData.paidThisMonth.length} paid invoices`}
          href="/invoices"
          accent="text-green-700"
        />

        <StatCard
          title="Total invoiced"
          value={formatMoney(
            dashboardData.totalInvoiceValue
          )}
          secondary={`${dashboardData.activeInvoices.length} active invoice records`}
          href="/company-analytics"
        />

        <StatCard
          title="Active clients"
          value={clientsCount}
          secondary="Agencies, landlords and companies"
          href="/clients"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Recent invoices
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Highest invoice numbers first
              </p>
            </div>

            <Link
              href="/invoices"
              className="font-semibold text-blue-600 hover:text-blue-800"
            >
              View all invoices
            </Link>
          </div>

          {dashboardData.recentInvoices.length === 0 ? (
            <div className="p-10 text-center text-slate-500">
              No invoices have been created yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-slate-50 text-sm text-slate-500">
                  <tr>
                    <th className="px-4 py-3">
                      Invoice
                    </th>
                    <th className="px-4 py-3">
                      Client
                    </th>
                    <th className="px-4 py-3">
                      Description
                    </th>
                    <th className="px-4 py-3 text-right">
                      Total
                    </th>
                    <th className="px-4 py-3">
                      Payment
                    </th>
                    <th className="px-4 py-3 text-center">
                      Sent
                    </th>
                    <th className="px-4 py-3">
                      Open
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {dashboardData.recentInvoices.map(
                    (invoice) => (
                      <tr
                        key={invoice.id}
                        className="border-t border-slate-200"
                      >
                        <td className="px-4 py-4 font-bold">
                          {invoice.invoice_number}
                        </td>

                        <td className="px-4 py-4">
                          {invoice.client
                            ?.company_name ||
                            invoice.client?.name ||
                            invoice.customer_name ||
                            "—"}
                        </td>

                        <td className="max-w-[330px] px-4 py-4">
                          <div className="font-semibold text-slate-900">
                            {getPropertyText(invoice)}
                          </div>

                          <div className="mt-1 text-sm text-slate-500">
                            {getReportType(
                              getDescription(invoice)
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-4 text-right font-bold">
                          {formatMoney(
                            invoice.total
                          )}
                        </td>

                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              invoice.status === "paid"
                                ? "bg-green-100 text-green-700"
                                : "bg-red-50 text-red-600"
                            }`}
                          >
                            {paymentText(invoice)}
                          </span>
                        </td>

                        <td className="px-4 py-4 text-center">
                          <span
                            title={
                              invoice.sent_at
                                ? `Sent on ${formatDate(
                                    invoice.sent_at
                                  )}`
                                : "Not sent"
                            }
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border ${
                              invoice.sent_at
                                ? "border-green-600 bg-green-600 text-white"
                                : "border-slate-300 bg-white text-slate-300"
                            }`}
                          >
                            {invoice.sent_at ? (
                              <svg
                                viewBox="0 0 20 20"
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M4 10.5 8 14.5 16 5.5" />
                              </svg>
                            ) : (
                              <span className="h-2 w-2 rounded-sm bg-current" />
                            )}
                          </span>
                        </td>

                        <td className="px-4 py-4">
                          <Link
                            href={`/invoices/${invoice.id}`}
                            className="font-semibold text-blue-600 hover:text-blue-800"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">
              Payment overview
            </h2>

            <div className="mt-5 space-y-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">
                  Average payment time
                </p>

                <p className="mt-1 text-2xl font-bold">
                  {
                    dashboardData.averagePaymentDays
                  }{" "}
                  days
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">
                  Oldest unpaid invoice
                </p>

                {dashboardData.oldestUnpaid ? (
                  <>
                    <div className="mt-2 flex items-center justify-between gap-4">
                      <Link
                        href={`/invoices/${dashboardData.oldestUnpaid.id}`}
                        className="font-bold text-blue-600"
                      >
                        {
                          dashboardData
                            .oldestUnpaid
                            .invoice_number
                        }
                      </Link>

                      <span className="font-semibold text-red-600">
                        Unpaid for{" "}
                        {daysBetween(
                          dashboardData
                            .oldestUnpaid
                            .issue_date
                        )}{" "}
                        days
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-slate-600">
                      {getPropertyText(
                        dashboardData.oldestUnpaid
                      )}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 font-semibold text-green-700">
                    No unpaid invoices
                  </p>
                )}
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">
                  Paid invoices
                </p>

                <p className="mt-1 text-2xl font-bold text-green-700">
                  {
                    dashboardData.paidInvoices
                      .length
                  }
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">
              Sending overview
            </h2>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-green-50 p-4">
                <p className="text-sm font-semibold text-green-700">
                  Sent
                </p>

                <p className="mt-1 text-3xl font-bold text-green-800">
                  {dashboardData.sentCount}
                </p>
              </div>

              <div className="rounded-xl bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-700">
                  Not sent
                </p>

                <p className="mt-1 text-3xl font-bold text-amber-800">
                  {dashboardData.notSentCount}
                </p>
              </div>
            </div>

            <Link
              href="/invoices"
              className="mt-4 block rounded-lg border border-slate-300 px-4 py-2 text-center font-semibold text-slate-700 hover:bg-slate-50"
            >
              Review invoice sending
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
