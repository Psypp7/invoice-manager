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

  const text = String(value);
  const isoDate = text.match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (isoDate) {
    return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
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

function getInvoiceDescription(invoice) {
  return (
    invoice.invoice_items?.[0]?.description ||
    ""
  ).trim();
}

function getReportType(description) {
  const text = String(description || "").trim();
  const lower = text.toLowerCase();

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

  if (lower.includes("inspection")) {
    return "Inspection";
  }

  return "Report";
}

function getPropertyAddress(invoice) {
  if (invoice.property) {
    const propertyText = [
      invoice.property.property_name,
      invoice.property.address_line_1,
      invoice.property.postcode,
    ]
      .filter(Boolean)
      .join(", ");

    if (propertyText) {
      return propertyText;
    }
  }

  const description =
    getInvoiceDescription(invoice);

  if (!description) {
    return "No property";
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

    case "partially_paid":
      return "bg-purple-100 text-purple-700";

    default:
      return "bg-amber-100 text-amber-700";
  }
}

function paymentText(invoice) {
  if (invoice.status === "paid") {
    return invoice.paid_at
      ? `Paid ${formatDate(invoice.paid_at)}`
      : "Paid";
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
  icon,
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500">
            {title}
          </p>

          <p className="mt-3 break-words text-3xl font-bold tracking-tight text-slate-900">
            {value}
          </p>

          {secondary && (
            <p className="mt-2 text-sm text-slate-500">
              {secondary}
            </p>
          )}
        </div>

        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl transition group-hover:bg-blue-50">
          {icon}
        </div>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const [business, setBusiness] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [clientsCount, setClientsCount] = useState(0);
  const [propertiesCount, setPropertiesCount] =
    useState(0);
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
        throw new Error(
          "You must sign in before viewing the dashboard."
        );
      }

      const {
        data: businessData,
        error: businessError,
      } = await supabase
        .from("businesses")
        .select("id, business_name")
        .eq("owner_user_id", user.id)
        .single();

      if (businessError) {
        throw businessError;
      }

      setBusiness(businessData);

      const [
        invoicesResult,
        clientsResult,
        propertiesResult,
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
              customer_name,
              created_at,
              property:properties(
                id,
                property_name,
                address_line_1,
                postcode
              ),
              invoice_items(
                id,
                description
              )
            `
          )
          .eq("business_id", businessData.id)
          .is("deleted_at", null),

        supabase
          .from("clients")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("business_id", businessData.id)
          .eq("is_active", true),

        supabase
          .from("properties")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("business_id", businessData.id)
          .eq("is_active", true),
      ]);

      if (invoicesResult.error) {
        throw invoicesResult.error;
      }

      if (clientsResult.error) {
        throw clientsResult.error;
      }

      if (propertiesResult.error) {
        throw propertiesResult.error;
      }

      const sortedInvoices = [
        ...(invoicesResult.data || []),
      ].sort(
        (a, b) =>
          invoiceNumberValue(b.invoice_number) -
          invoiceNumberValue(a.invoice_number)
      );

      setInvoices(sortedInvoices);
      setClientsCount(
        clientsResult.count || 0
      );
      setPropertiesCount(
        propertiesResult.count || 0
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
    const monthStart =
      startOfCurrentMonth();

    const activeInvoices = invoices.filter(
      (invoice) =>
        invoice.status !== "cancelled"
    );

    const unpaidInvoices =
      activeInvoices.filter(
        (invoice) =>
          invoice.status !== "paid" &&
          Number(invoice.balance_due) > 0
      );

    const paidThisMonth =
      activeInvoices.filter((invoice) => {
        if (
          invoice.status !== "paid" ||
          !invoice.paid_at
        ) {
          return false;
        }

        return (
          String(invoice.paid_at).slice(0, 10) >=
          monthStart
        );
      });

    const outstandingTotal =
      unpaidInvoices.reduce(
        (sum, invoice) =>
          sum +
          Number(invoice.balance_due || 0),
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

    const averagePaymentDays = (() => {
      const paidWithDates =
        activeInvoices.filter(
          (invoice) =>
            invoice.status === "paid" &&
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
      (a, b) =>
        daysBetween(b.issue_date) -
        daysBetween(a.issue_date)
    )[0];

    const recentInvoices =
      activeInvoices.slice(0, 6);

    return {
      activeInvoices,
      unpaidInvoices,
      paidThisMonth,
      outstandingTotal,
      paidThisMonthTotal,
      totalInvoiceValue,
      averagePaymentDays,
      oldestUnpaid,
      recentInvoices,
    };
  }, [invoices]);

  if (loading) {
    return (
      <div className="min-w-0 max-w-full">
        <p className="text-slate-500">
          Loading dashboard...
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-8 overflow-x-hidden">
      <header className="flex min-w-0 flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">
            Right Inventories
          </p>

          <h1 className="mt-1 break-words text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Dashboard
          </h1>

          <p className="mt-2 max-w-2xl text-slate-500">
            A clear overview of invoices,
            payments, clients and properties.
          </p>
        </div>

        <div className="flex w-full flex-wrap gap-3 xl:w-auto xl:justify-end">
          <Link
            href="/invoices/import"
            className="min-w-0 flex-1 rounded-lg border border-blue-600 px-4 py-3 text-center font-semibold text-blue-600 hover:bg-blue-50 sm:flex-none"
          >
            Import spreadsheet
          </Link>

          <Link
            href="/invoices"
            className="min-w-0 flex-1 rounded-lg bg-blue-600 px-4 py-3 text-center font-semibold text-white hover:bg-blue-700 sm:flex-none"
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
          icon="£"
        />

        <StatCard
          title="Paid this month"
          value={formatMoney(
            dashboardData.paidThisMonthTotal
          )}
          secondary={`${dashboardData.paidThisMonth.length} paid invoices`}
          href="/invoices"
          icon="✓"
        />

        <StatCard
          title="Active clients"
          value={clientsCount}
          secondary="Agencies, landlords and companies"
          href="/clients"
          icon="◉"
        />

        <StatCard
          title="Properties"
          value={propertiesCount}
          secondary="Active property records"
          href="/properties"
          icon="⌂"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-bold">
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
            <>
              <div className="hidden lg:block">
                <table className="w-full table-fixed text-left">
                  <thead className="bg-slate-50 text-sm text-slate-500">
                    <tr>
                      <th className="w-[13%] whitespace-nowrap px-4 py-3">
                        Invoice
                      </th>
                      <th className="w-[20%] px-4 py-3">
                        Client
                      </th>
                      <th className="w-[31%] px-4 py-3">
                        Property
                      </th>
                      <th className="w-[13%] px-4 py-3">
                        Total
                      </th>
                      <th className="w-[13%] px-4 py-3">
                        Status
                      </th>
                      <th className="w-[10%] px-4 py-3">
                        Open
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {dashboardData.recentInvoices.map(
                      (invoice) => (
                        <tr
                          key={invoice.id}
                          className="border-t border-slate-100"
                        >
                          <td className="whitespace-nowrap px-4 py-4 font-bold">
                            {
                              invoice.invoice_number
                            }
                          </td>

                          <td className="break-words px-4 py-4">
                            {invoice.customer_name ||
                              "—"}
                          </td>

                          <td className="min-w-0 px-4 py-4">
                            <p className="break-words font-medium leading-snug text-slate-900">
                              {
                                getPropertyAddress(
                                  invoice
                                )
                              }
                            </p>

                            <p className="mt-1 text-sm text-slate-500">
                              {getReportType(
                                getInvoiceDescription(
                                  invoice
                                )
                              )}
                            </p>
                          </td>

                          <td className="px-4 py-4 font-semibold">
                            {formatMoney(
                              invoice.total
                            )}
                          </td>

                          <td className="px-4 py-4">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusClass(
                                invoice.status
                              )}`}
                            >
                              {invoice.status.replace(
                                "_",
                                " "
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

              <div className="divide-y divide-slate-200 lg:hidden">
                {dashboardData.recentInvoices.map(
                  (invoice) => (
                    <article
                      key={invoice.id}
                      className="p-4 sm:p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="whitespace-nowrap font-bold">
                            {
                              invoice.invoice_number
                            }
                          </p>

                          <p className="mt-1 break-words text-sm text-slate-600">
                            {invoice.customer_name ||
                              "—"}
                          </p>
                        </div>

                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusClass(
                            invoice.status
                          )}`}
                        >
                          {invoice.status.replace(
                            "_",
                            " "
                          )}
                        </span>
                      </div>

                      <div className="mt-4 rounded-lg bg-slate-50 p-3">
                        <p className="break-words font-medium">
                          {
                            getPropertyAddress(
                              invoice
                            )
                          }
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          {getReportType(
                            getInvoiceDescription(
                              invoice
                            )
                          )}
                        </p>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <strong>
                          {formatMoney(
                            invoice.total
                          )}
                        </strong>

                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="font-semibold text-blue-600"
                        >
                          View invoice
                        </Link>
                      </div>
                    </article>
                  )
                )}
              </div>
            </>
          )}
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">
              Payment overview
            </h2>

            <div className="mt-5 space-y-4">
              <div className="flex items-start justify-between gap-4 rounded-xl bg-slate-50 p-4">
                <div>
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

                <span className="text-2xl">
                  ◷
                </span>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">
                  Oldest unpaid invoice
                </p>

                {dashboardData.oldestUnpaid ? (
                  <>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <Link
                        href={`/invoices/${dashboardData.oldestUnpaid.id}`}
                        className="whitespace-nowrap font-bold text-blue-600"
                      >
                        {
                          dashboardData.oldestUnpaid
                            .invoice_number
                        }
                      </Link>

                      <span className="text-sm font-semibold text-amber-700">
                        {paymentText(
                          dashboardData.oldestUnpaid
                        )}
                      </span>
                    </div>

                    <p className="mt-2 break-words text-sm text-slate-600">
                      {getPropertyAddress(
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

              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
                <div>
                  <p className="text-sm text-slate-500">
                    Total active invoice value
                  </p>

                  <p className="mt-1 text-xl font-bold">
                    {formatMoney(
                      dashboardData.totalInvoiceValue
                    )}
                  </p>
                </div>

                <span className="text-2xl">
                  Σ
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">
              Quick actions
            </h2>

            <div className="mt-4 grid gap-3">
              <Link
                href="/invoices"
                className="rounded-xl border border-slate-200 px-4 py-3 font-semibold hover:border-blue-200 hover:bg-blue-50"
              >
                Create a new invoice
              </Link>

              <Link
                href="/invoices/import"
                className="rounded-xl border border-slate-200 px-4 py-3 font-semibold hover:border-blue-200 hover:bg-blue-50"
              >
                Import spreadsheet
              </Link>

              <Link
                href="/invoices/deleted"
                className="rounded-xl border border-slate-200 px-4 py-3 font-semibold hover:border-red-200 hover:bg-red-50"
              >
                View deleted invoices
              </Link>

              <Link
                href="/clients"
                className="rounded-xl border border-slate-200 px-4 py-3 font-semibold hover:border-blue-200 hover:bg-blue-50"
              >
                Manage clients
              </Link>

              <Link
                href="/properties"
                className="rounded-xl border border-slate-200 px-4 py-3 font-semibold hover:border-blue-200 hover:bg-blue-50"
              >
                Manage properties
              </Link>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
