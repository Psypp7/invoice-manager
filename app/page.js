"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabase";

// ============================================================
// BRAND
// ============================================================
// Every colour comes from the logo or the invoice letterhead so
// the app, the PDF and the logo all agree.

const BRAND = {
  ink: "#1C1917",
  blush: "#ECD8D3",
  blushSoft: "#F7EDEB",
  magenta: "#D0007F",
  moss: "#426429",
  mute: "#78716C",
  line: "#E7E1DF",
  wash: "#F5F1F0",
};

const AGE_BUCKETS = [
  {
    id: "fresh",
    label: "Under 2 weeks",
    short: "< 2 wks",
    test: (days) => days < 14,
    colour: "#E3CBC6",
    onColour: "#1C1917",
  },
  {
    id: "chase",
    label: "2 to 4 weeks",
    short: "2\u20134 wks",
    test: (days) => days >= 14 && days < 30,
    colour: "#E0899F",
    onColour: "#1C1917",
  },
  {
    id: "late",
    label: "1 to 2 months",
    short: "1\u20132 mths",
    test: (days) => days >= 30 && days < 60,
    colour: "#D0007F",
    onColour: "#FFFFFF",
  },
  {
    id: "serious",
    label: "Over 2 months",
    short: "2 mths +",
    test: (days) => days >= 60,
    colour: "#8A0050",
    onColour: "#FFFFFF",
  },
];

function bucketFor(days) {
  return (
    AGE_BUCKETS.find((bucket) => bucket.test(days)) ||
    AGE_BUCKETS[0]
  );
}

// ============================================================
// DATES AND NUMBERS
// ============================================================

function getToday() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function monthKey(value) {
  return String(value || "").slice(0, 7);
}

function yearKey(value) {
  return String(value || "").slice(0, 4);
}

function shiftMonth(offset) {
  const now = new Date();
  now.setDate(1);
  now.setMonth(now.getMonth() + offset);

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
  ].join("-");
}

function monthLabel(key, style = "long") {
  const parts = String(key || "").split("-");

  if (parts.length !== 2) return "";

  return new Intl.DateTimeFormat("en-GB", {
    month: style,
  }).format(
    new Date(Number(parts[0]), Number(parts[1]) - 1, 1)
  );
}

function longDate(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (!match) return "\u2014";

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(
    new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    )
  );
}

function shortDate(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (!match) return "\u2014";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(
    new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    )
  );
}

function daysBetween(startDate, endDate = getToday()) {
  if (!startDate) return 0;

  const start = new Date(
    `${String(startDate).slice(0, 10)}T12:00:00`
  );

  const end = new Date(
    `${String(endDate).slice(0, 10)}T12:00:00`
  );

  return Math.max(
    0,
    Math.floor((end.getTime() - start.getTime()) / 86400000)
  );
}

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function exactMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function percentage(part, whole) {
  if (!whole) return 0;

  return Math.max(
    0,
    Math.min(100, (Number(part || 0) / Number(whole)) * 100)
  );
}

// ============================================================
// INVOICE HELPERS
// ============================================================

function getDescription(invoice) {
  return (
    invoice.invoice_items?.[0]?.description || ""
  ).trim();
}

function getReportType(invoice) {
  const lower = getDescription(invoice).toLowerCase();

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

  if (lower.includes("midterm")) return "Midterm";
  if (lower.includes("inventory")) return "Inventory";

  return "Report";
}

function getPropertyText(invoice) {
  const description = getDescription(invoice);

  if (!description) return "No description";

  const atMatches = [...description.matchAll(/\s+at\s+/gi)];

  if (!atMatches.length) return description;

  const last = atMatches[atMatches.length - 1];

  return description
    .slice(last.index + last[0].length)
    .trim();
}

function clientLabel(invoice) {
  return (
    invoice.client?.company_name ||
    invoice.client?.name ||
    invoice.customer_name ||
    "Unknown client"
  );
}

function balanceOf(invoice) {
  const total = Number(invoice.total || 0);

  if (invoice.status === "paid") return 0;

  return Math.max(
    0,
    Math.min(total, Number(invoice.balance_due ?? total))
  );
}

function myShareOf(invoice) {
  return Number(
    invoice.internal_amount ?? invoice.total ?? 0
  );
}

// ============================================================
// UI PIECES
// ============================================================

function Panel({ children, className = "" }) {
  return (
    <section
      className={`rounded-xl bg-white ${className}`}
      style={{
        border: `1px solid ${BRAND.line}`,
        boxShadow: "0 1px 2px rgba(28,25,23,0.04)",
      }}
    >
      {children}
    </section>
  );
}

function PanelHead({ title, note, action }) {
  return (
    <div
      className="flex flex-col justify-between gap-2 px-6 py-4 sm:flex-row sm:items-center"
      style={{ borderBottom: `1px solid ${BRAND.line}` }}
    >
      <div>
        <h2
          className="text-base font-semibold"
          style={{ color: BRAND.ink }}
        >
          {title}
        </h2>

        {note && (
          <p
            className="mt-0.5 text-sm"
            style={{ color: BRAND.mute }}
          >
            {note}
          </p>
        )}
      </div>

      {action}
    </div>
  );
}

function AgeTag({ days }) {
  const bucket = bucketFor(days);

  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
      style={{
        backgroundColor: bucket.colour,
        color: bucket.onColour,
      }}
    >
      {days} {days === 1 ? "day" : "days"}
    </span>
  );
}

/** Aged debt, the panel Xero leads with. */
function AgedColumns({ buckets, active, onSelect }) {
  const maximum = Math.max(
    1,
    ...buckets.map((bucket) => bucket.amount)
  );

  return (
    <div className="flex items-end gap-3 sm:gap-5">
      {buckets.map((bucket) => {
        const isActive = active === bucket.id;
        const isEmpty = bucket.count === 0;

        return (
          <button
            key={bucket.id}
            type="button"
            disabled={isEmpty}
            onClick={() =>
              onSelect(isActive ? "" : bucket.id)
            }
            aria-pressed={isActive}
            className="flex flex-1 flex-col items-center gap-2 rounded-lg p-2 outline-none transition disabled:cursor-default"
            style={{
              backgroundColor: isActive
                ? BRAND.blushSoft
                : "transparent",
            }}
          >
            <span
              className="text-sm font-semibold tabular-nums"
              style={{
                color: isEmpty ? "#C4BDBA" : BRAND.ink,
              }}
            >
              {isEmpty ? "\u2014" : money(bucket.amount)}
            </span>

            <span className="flex h-24 w-full items-end sm:h-32">
              <span
                className="w-full rounded-t-md transition-all"
                style={{
                  height: `${Math.max(
                    isEmpty ? 3 : 8,
                    percentage(bucket.amount, maximum)
                  )}%`,
                  backgroundColor: isEmpty
                    ? "#F1ECEA"
                    : bucket.colour,
                  opacity: !active || isActive ? 1 : 0.4,
                }}
              />
            </span>

            <span
              className="text-xs font-semibold"
              style={{
                color: isActive ? BRAND.ink : BRAND.mute,
              }}
            >
              {bucket.short}
            </span>

            <span
              className="text-xs tabular-nums"
              style={{ color: BRAND.mute }}
            >
              {bucket.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TrendChart({ months }) {
  const maximum = Math.max(
    1,
    ...months.map((month) =>
      Math.max(month.invoiced, month.collected)
    )
  );

  return (
    <div>
      <div className="flex items-end gap-4 sm:gap-8">
        {months.map((month) => (
          <div
            key={month.key}
            className="flex flex-1 flex-col items-center gap-2"
          >
            <span className="flex h-28 w-full items-end justify-center gap-1.5">
              <span
                title={`Invoiced ${exactMoney(
                  month.invoiced
                )}`}
                className="w-1/2 max-w-[26px] rounded-t"
                style={{
                  height: `${Math.max(
                    2,
                    percentage(month.invoiced, maximum)
                  )}%`,
                  backgroundColor: BRAND.blush,
                }}
              />

              <span
                title={`Collected ${exactMoney(
                  month.collected
                )}`}
                className="w-1/2 max-w-[26px] rounded-t"
                style={{
                  height: `${Math.max(
                    2,
                    percentage(month.collected, maximum)
                  )}%`,
                  backgroundColor: BRAND.moss,
                }}
              />
            </span>

            <span
              className="text-xs font-semibold"
              style={{ color: BRAND.mute }}
            >
              {monthLabel(month.key, "short")}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-5">
        {[
          { colour: BRAND.blush, label: "Invoiced" },
          { colour: BRAND.moss, label: "Collected" },
        ].map((item) => (
          <span
            key={item.label}
            className="flex items-center gap-2"
          >
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: item.colour }}
            />

            <span
              className="text-sm"
              style={{ color: BRAND.mute }}
            >
              {item.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// PAGE
// ============================================================

export default function DashboardPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [activeBucket, setActiveBucket] = useState("");
  const [openDebtor, setOpenDebtor] = useState("");

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

      const { data: business, error: businessError } =
        await supabase
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

      const { data, error } = await supabase
        .from("invoices")
        .select(
          `
            id,
            invoice_number,
            issue_date,
            status,
            total,
            internal_amount,
            agency_commission,
            balance_due,
            paid_at,
            sent_at,
            customer_name,
            customer_email,
            client_id,
            client:clients(
              id,
              name,
              company_name,
              email
            ),
            invoice_items(
              id,
              description,
              sort_order
            )
          `
        )
        .eq("business_id", business.id)
        .is("deleted_at", null);

      if (error) throw error;

      setInvoices(
        (data || []).map((invoice) => ({
          ...invoice,
          invoice_items: [
            ...(invoice.invoice_items || []),
          ].sort(
            (first, second) =>
              Number(first.sort_order || 0) -
              Number(second.sort_order || 0)
          ),
        }))
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

  const data = useMemo(() => {
    const thisMonth = shiftMonth(0);
    const lastMonth = shiftMonth(-1);
    const thisYear = getToday().slice(0, 4);

    const active = invoices.filter(
      (invoice) => invoice.status !== "cancelled"
    );

    const unpaid = active
      .filter((invoice) => balanceOf(invoice) > 0)
      .map((invoice) => {
        const age = daysBetween(invoice.issue_date);

        return {
          ...invoice,
          age,
          balance: balanceOf(invoice),
          bucket: bucketFor(age).id,
        };
      })
      .sort((first, second) => second.age - first.age);

    const buckets = AGE_BUCKETS.map((bucket) => {
      const rows = unpaid.filter(
        (invoice) => invoice.bucket === bucket.id
      );

      return {
        ...bucket,
        count: rows.length,
        amount: rows.reduce(
          (sum, invoice) => sum + invoice.balance,
          0
        ),
      };
    });

    const outstanding = unpaid.reduce(
      (sum, invoice) => sum + invoice.balance,
      0
    );

    const myOutstanding = unpaid.reduce((sum, invoice) => {
      const total = Number(invoice.total || 0);
      const rate = total > 0 ? invoice.balance / total : 1;

      return sum + myShareOf(invoice) * rate;
    }, 0);

    const neverSent = unpaid.filter(
      (invoice) => !invoice.sent_at
    );

    // Debt grouped by client. Chasing happens per client,
    // not per invoice, so this is the list that gets used.
    const debtorMap = new Map();

    for (const invoice of unpaid) {
      const key =
        invoice.client_id ||
        `unknown-${clientLabel(invoice)}`;

      if (!debtorMap.has(key)) {
        debtorMap.set(key, {
          key,
          name: clientLabel(invoice),
          email:
            invoice.client?.email ||
            invoice.customer_email ||
            "",
          owed: 0,
          mine: 0,
          count: 0,
          neverSentCount: 0,
          oldest: 0,
          rows: [],
        });
      }

      const debtor = debtorMap.get(key);
      const total = Number(invoice.total || 0);
      const rate = total > 0 ? invoice.balance / total : 1;

      debtor.owed += invoice.balance;
      debtor.mine += myShareOf(invoice) * rate;
      debtor.count += 1;
      debtor.oldest = Math.max(debtor.oldest, invoice.age);
      debtor.rows.push(invoice);

      if (!invoice.sent_at) debtor.neverSentCount += 1;
    }

    const debtors = Array.from(debtorMap.values())
      .map((debtor) => ({
        ...debtor,
        rows: debtor.rows.sort(
          (first, second) => second.age - first.age
        ),
      }))
      .sort(
        (first, second) =>
          second.owed - first.owed ||
          second.oldest - first.oldest
      );

    const paidIn = (key) =>
      active.filter(
        (invoice) =>
          invoice.status === "paid" &&
          invoice.paid_at &&
          monthKey(invoice.paid_at) === key
      );

    const issuedIn = (key) =>
      active.filter(
        (invoice) => monthKey(invoice.issue_date) === key
      );

    const sumTotal = (rows) =>
      rows.reduce(
        (sum, invoice) => sum + Number(invoice.total || 0),
        0
      );

    const sumMine = (rows) =>
      rows.reduce(
        (sum, invoice) => sum + myShareOf(invoice),
        0
      );

    const trend = [];

    for (let offset = -5; offset <= 0; offset += 1) {
      const key = shiftMonth(offset);

      trend.push({
        key,
        invoiced: sumTotal(issuedIn(key)),
        collected: sumTotal(paidIn(key)),
      });
    }

    const paidThisMonth = paidIn(thisMonth);
    const paidThisMonthTotal = sumTotal(paidThisMonth);
    const paidLastMonthTotal = sumTotal(paidIn(lastMonth));
    const myPaidThisMonth = sumMine(paidThisMonth);

    const paidThisYear = active.filter(
      (invoice) =>
        invoice.status === "paid" &&
        invoice.paid_at &&
        yearKey(invoice.paid_at) === thisYear
    );

    const settled = active.filter(
      (invoice) => balanceOf(invoice) === 0
    );

    const averagePaymentDays = (() => {
      const withDates = settled.filter(
        (invoice) => invoice.issue_date && invoice.paid_at
      );

      if (!withDates.length) return 0;

      return Math.round(
        withDates.reduce(
          (sum, invoice) =>
            sum +
            daysBetween(
              invoice.issue_date,
              invoice.paid_at
            ),
          0
        ) / withDates.length
      );
    })();

    const jobsThisMonth = issuedIn(thisMonth).length;
    const jobsLastMonth = issuedIn(lastMonth).length;

    return {
      active,
      unpaid,
      buckets,
      outstanding,
      myOutstanding,
      neverSent,
      debtors,
      trend,
      thisMonth,
      lastMonth,
      thisYear,
      paidThisMonthTotal,
      paidLastMonthTotal,
      myPaidThisMonth,
      otherPaidThisMonth:
        paidThisMonthTotal - myPaidThisMonth,
      myEarnedThisYear: sumMine(paidThisYear),
      paidThisYearCount: paidThisYear.length,
      averagePaymentDays,
      averageInvoiceValue: active.length
        ? sumTotal(active) / active.length
        : 0,
      jobsThisMonth,
      jobsLastMonth,
      monthChange:
        paidLastMonthTotal > 0
          ? ((paidThisMonthTotal - paidLastMonthTotal) /
              paidLastMonthTotal) *
            100
          : null,
    };
  }, [invoices]);

  const visibleDebtors = useMemo(() => {
    if (!activeBucket) return data.debtors.slice(0, 8);

    return data.debtors
      .map((debtor) => {
        const rows = debtor.rows.filter(
          (invoice) => invoice.bucket === activeBucket
        );

        return {
          ...debtor,
          rows,
          count: rows.length,
          owed: rows.reduce(
            (sum, invoice) => sum + invoice.balance,
            0
          ),
          oldest: rows.reduce(
            (top, invoice) => Math.max(top, invoice.age),
            0
          ),
        };
      })
      .filter((debtor) => debtor.rows.length > 0)
      .sort((first, second) => second.owed - first.owed)
      .slice(0, 8);
  }, [data.debtors, activeBucket]);

  if (loading) {
    return (
      <p style={{ color: BRAND.mute }}>
        Loading dashboard...
      </p>
    );
  }

  const activeBucketLabel = AGE_BUCKETS.find(
    (bucket) => bucket.id === activeBucket
  )?.label;

  const metrics = [
    {
      label: `Yours in ${data.thisYear}`,
      value: money(data.myEarnedThisYear),
      note: `Collected on ${data.paidThisYearCount} invoices`,
      colour: BRAND.moss,
    },
    {
      label: "Average time to get paid",
      value: `${data.averagePaymentDays} days`,
      note: "From issue to payment",
    },
    {
      label: "Average invoice",
      value: money(data.averageInvoiceValue),
      note: `Across ${data.active.length} invoices`,
    },
    {
      label: `Jobs in ${monthLabel(data.thisMonth)}`,
      value: data.jobsThisMonth,
      note:
        data.jobsLastMonth > 0
          ? `${data.jobsLastMonth} in ${monthLabel(
              data.lastMonth
            )}`
          : "First month with work",
    },
  ];

  return (
    <div
      className="space-y-5"
      style={{
        color: BRAND.ink,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* -------------------------------------------------- */}
      {/* MASTHEAD                                            */}
      {/* -------------------------------------------------- */}

      <header
        className="flex flex-col gap-5 rounded-xl px-6 py-5 md:flex-row md:items-center md:justify-between"
        style={{
          backgroundColor: BRAND.blushSoft,
          border: `1px solid ${BRAND.blush}`,
        }}
      >
        <div className="flex items-center gap-4">
          <span
            className="shrink-0 overflow-hidden rounded-lg"
            style={{ border: `1px solid ${BRAND.blush}` }}
          >
            <Image
              src="/right-inventories-logo.png"
              alt="Right Inventories"
              width={166}
              height={166}
              className="h-14 w-14 object-cover"
              priority
            />
          </span>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Right Inventories London
            </h1>

            <p
              className="mt-0.5 text-sm"
              style={{ color: BRAND.mute }}
            >
              {longDate(getToday())}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/invoices/import"
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold transition hover:opacity-80"
            style={{
              border: `1px solid ${BRAND.blush}`,
              color: BRAND.ink,
            }}
          >
            Import spreadsheet
          </Link>

          <Link
            href="/invoices"
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: BRAND.magenta }}
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

      {data.neverSent.length > 0 && (
        <div
          className="flex flex-col gap-3 rounded-xl px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          style={{
            backgroundColor: "#FDF2F8",
            border: `1px solid ${BRAND.blush}`,
          }}
        >
          <p className="text-sm">
            <span className="font-semibold tabular-nums">
              {data.neverSent.length}
            </span>{" "}
            unpaid{" "}
            {data.neverSent.length === 1
              ? "invoice has"
              : "invoices have"}{" "}
            never been emailed, worth{" "}
            <span className="font-semibold tabular-nums">
              {money(
                data.neverSent.reduce(
                  (sum, invoice) => sum + invoice.balance,
                  0
                )
              )}
            </span>
            .
          </p>

          <Link
            href="/invoices"
            className="shrink-0 text-sm font-semibold"
            style={{ color: BRAND.magenta }}
          >
            Send them
          </Link>
        </div>
      )}

      {/* -------------------------------------------------- */}
      {/* OWED  +  MONEY IN                                   */}
      {/* -------------------------------------------------- */}

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel>
          <PanelHead
            title="Invoices owed to you"
            note="Select a column to narrow the list below"
          />

          <div className="p-6">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-5xl font-semibold tabular-nums tracking-tight">
                {exactMoney(data.outstanding)}
              </p>

              <p
                className="text-sm"
                style={{ color: BRAND.mute }}
              >
                from {data.debtors.length}{" "}
                {data.debtors.length === 1
                  ? "client"
                  : "clients"}
                , {data.unpaid.length}{" "}
                {data.unpaid.length === 1
                  ? "invoice"
                  : "invoices"}
              </p>
            </div>

            <p
              className="mt-1 text-sm tabular-nums"
              style={{ color: BRAND.mute }}
            >
              {exactMoney(data.myOutstanding)} of this is
              yours once the other company is paid
            </p>

            {data.outstanding > 0 && (
              <div className="mt-6">
                <AgedColumns
                  buckets={data.buckets}
                  active={activeBucket}
                  onSelect={setActiveBucket}
                />
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title={`Paid in ${monthLabel(data.thisMonth)}`}
          />

          <div className="p-6">
            <p
              className="text-4xl font-semibold tabular-nums tracking-tight"
              style={{ color: BRAND.moss }}
            >
              {exactMoney(data.paidThisMonthTotal)}
            </p>

            <p
              className="mt-1 text-sm"
              style={{ color: BRAND.mute }}
            >
              {data.monthChange === null ? (
                <>
                  Nothing came in during{" "}
                  {monthLabel(data.lastMonth)}
                </>
              ) : (
                <>
                  <span
                    className="font-semibold"
                    style={{
                      color:
                        data.monthChange >= 0
                          ? BRAND.moss
                          : "#B4243F",
                    }}
                  >
                    {data.monthChange >= 0 ? "+" : ""}
                    {data.monthChange.toFixed(0)}%
                  </span>{" "}
                  on {monthLabel(data.lastMonth)}
                </>
              )}
            </p>

            {data.paidThisMonthTotal > 0 && (
              <div
                className="mt-6 pt-5"
                style={{
                  borderTop: `1px solid ${BRAND.line}`,
                }}
              >
                <div
                  className="flex h-2.5 overflow-hidden rounded-full"
                  style={{ backgroundColor: "#F1ECEA" }}
                >
                  <div
                    style={{
                      width: `${percentage(
                        data.myPaidThisMonth,
                        data.paidThisMonthTotal
                      )}%`,
                      backgroundColor: BRAND.moss,
                    }}
                  />

                  <div
                    style={{
                      width: `${percentage(
                        data.otherPaidThisMonth,
                        data.paidThisMonthTotal
                      )}%`,
                      backgroundColor: BRAND.blush,
                    }}
                  />
                </div>

                <div className="mt-3 flex justify-between text-sm">
                  <span style={{ color: BRAND.mute }}>
                    Yours{" "}
                    <span
                      className="font-semibold tabular-nums"
                      style={{ color: BRAND.moss }}
                    >
                      {money(data.myPaidThisMonth)}
                    </span>
                  </span>

                  <span style={{ color: BRAND.mute }}>
                    Other company{" "}
                    <span className="font-semibold tabular-nums">
                      {money(data.otherPaidThisMonth)}
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* -------------------------------------------------- */}
      {/* METRIC STRIP                                        */}
      {/* -------------------------------------------------- */}

      <Panel>
        <div className="grid divide-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
          {metrics.map((metric, index) => (
            <div
              key={metric.label}
              className="px-6 py-5"
              style={{
                borderLeft:
                  index > 0
                    ? `1px solid ${BRAND.line}`
                    : "none",
                borderColor: BRAND.line,
              }}
            >
              <p
                className="text-sm font-medium"
                style={{ color: BRAND.mute }}
              >
                {metric.label}
              </p>

              <p
                className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight"
                style={{
                  color: metric.colour || BRAND.ink,
                }}
              >
                {metric.value}
              </p>

              <p
                className="mt-0.5 text-sm"
                style={{ color: BRAND.mute }}
              >
                {metric.note}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      {/* -------------------------------------------------- */}
      {/* WHO OWES YOU                                        */}
      {/* -------------------------------------------------- */}

      <Panel>
        <PanelHead
          title={
            activeBucketLabel
              ? `Owing \u2014 ${activeBucketLabel.toLowerCase()}`
              : "Who owes you the most"
          }
          note="Open a client to see their unpaid invoices"
          action={
            activeBucket ? (
              <button
                type="button"
                onClick={() => setActiveBucket("")}
                className="rounded-lg px-3.5 py-2 text-sm font-semibold"
                style={{
                  border: `1px solid ${BRAND.line}`,
                  color: BRAND.ink,
                }}
              >
                Show all
              </button>
            ) : (
              <Link
                href="/company-analytics"
                className="text-sm font-semibold"
                style={{ color: BRAND.magenta }}
              >
                Company analytics
              </Link>
            )
          }
        />

        {visibleDebtors.length === 0 ? (
          <div
            className="p-12 text-center"
            style={{ color: BRAND.mute }}
          >
            Nothing outstanding here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr
                  className="text-sm"
                  style={{
                    color: BRAND.mute,
                    backgroundColor: BRAND.wash,
                  }}
                >
                  <th className="px-6 py-3 font-medium">
                    Client
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Invoices
                  </th>
                  <th className="px-4 py-3 text-center font-medium">
                    Oldest
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Yours
                  </th>
                  <th className="px-6 py-3 text-right font-medium">
                    Owed
                  </th>
                </tr>
              </thead>

              <tbody>
                {visibleDebtors.map((debtor) => {
                  const isOpen = openDebtor === debtor.key;

                  return (
                    <Fragment key={debtor.key}>
                      <tr
                        onClick={() =>
                          setOpenDebtor(
                            isOpen ? "" : debtor.key
                          )
                        }
                        className="cursor-pointer tabular-nums"
                        style={{
                          borderTop: `1px solid ${BRAND.line}`,
                          backgroundColor: isOpen
                            ? BRAND.wash
                            : "transparent",
                        }}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2.5">
                            <span
                              aria-hidden="true"
                              className="select-none text-xs transition-transform"
                              style={{
                                color: BRAND.mute,
                                transform: isOpen
                                  ? "rotate(90deg)"
                                  : "none",
                              }}
                            >
                              &#9654;
                            </span>

                            <span className="font-semibold">
                              {debtor.name}
                            </span>

                            {debtor.neverSentCount >
                              0 && (
                              <span
                                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                                style={{
                                  backgroundColor:
                                    BRAND.blushSoft,
                                  color: BRAND.magenta,
                                }}
                              >
                                {debtor.neverSentCount}{" "}
                                not sent
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-4 text-right">
                          {debtor.count}
                        </td>

                        <td className="px-4 py-4 text-center">
                          <AgeTag days={debtor.oldest} />
                        </td>

                        <td
                          className="px-4 py-4 text-right font-semibold"
                          style={{ color: BRAND.moss }}
                        >
                          {money(debtor.mine)}
                        </td>

                        <td className="px-6 py-4 text-right text-lg font-semibold">
                          {exactMoney(debtor.owed)}
                        </td>
                      </tr>

                      {isOpen &&
                        debtor.rows.map((invoice) => (
                          <tr
                            key={invoice.id}
                            className="text-sm tabular-nums"
                            style={{
                              borderTop: `1px solid ${BRAND.line}`,
                              backgroundColor:
                                BRAND.wash,
                            }}
                          >
                            <td className="py-3 pl-14 pr-4">
                              <Link
                                href={`/invoices/${invoice.id}`}
                                className="font-semibold"
                                style={{
                                  color: BRAND.magenta,
                                }}
                              >
                                {invoice.invoice_number}
                              </Link>

                              <div
                                className="mt-0.5"
                                style={{
                                  color: BRAND.mute,
                                }}
                              >
                                {getPropertyText(invoice)}
                              </div>
                            </td>

                            <td
                              className="px-4 py-3 text-right"
                              style={{ color: BRAND.mute }}
                            >
                              {getReportType(invoice)}
                            </td>

                            <td className="px-4 py-3 text-center">
                              <span
                                style={{
                                  color: BRAND.mute,
                                }}
                              >
                                {shortDate(
                                  invoice.issue_date
                                )}
                              </span>
                            </td>

                            <td className="px-4 py-3 text-right">
                              {invoice.sent_at ? (
                                <span
                                  style={{
                                    color: BRAND.mute,
                                  }}
                                >
                                  Sent{" "}
                                  {shortDate(
                                    invoice.sent_at
                                  )}
                                </span>
                              ) : (
                                <Link
                                  href={`/invoices/${invoice.id}/email`}
                                  className="rounded-md px-2.5 py-1 text-xs font-semibold"
                                  style={{
                                    border: `1px solid ${BRAND.magenta}`,
                                    color: BRAND.magenta,
                                  }}
                                >
                                  Send
                                </Link>
                              )}
                            </td>

                            <td className="px-6 py-3 text-right font-semibold">
                              {exactMoney(
                                invoice.balance
                              )}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* -------------------------------------------------- */}
      {/* TREND                                               */}
      {/* -------------------------------------------------- */}

      <Panel>
        <PanelHead
          title="Invoiced against collected"
          note="The last six months"
        />

        <div className="p-6">
          <TrendChart months={data.trend} />
        </div>
      </Panel>
    </div>
  );
}