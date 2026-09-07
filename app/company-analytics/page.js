"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../../lib/supabase";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function compactMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function clientName(client) {
  return (
    client?.company_name ||
    client?.name ||
    "Unknown client"
  );
}

function safeDateParts(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3]),
  };
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function percentage(part, whole) {
  if (!whole) return 0;

  return Math.max(
    0,
    Math.min(100, (Number(part || 0) / Number(whole)) * 100)
  );
}

/**
 * Splits one invoice into the money that belongs to us and the money
 * that belongs to the other company, and works out how much of each
 * has actually been collected.
 *
 * internal_amount  = our share
 * agency_commission = the other company's share (total - internal_amount)
 *
 * When an invoice is only part paid we assume the payment is shared
 * in the same proportion as the invoice itself.
 */
function splitInvoice(invoice) {
  const total = Number(invoice.total || 0);

  const mine = Number(
    invoice.internal_amount ?? total
  );

  const theirs = Number(
    invoice.agency_commission ??
      Math.max(0, total - mine)
  );

  const isPaid = invoice.status === "paid";

  const balance = Math.max(
    0,
    Math.min(
      total,
      Number(
        invoice.balance_due ?? (isPaid ? 0 : total)
      )
    )
  );

  const received = Math.max(0, total - balance);

  const collectedRate =
    total > 0 ? received / total : isPaid ? 1 : 0;

  return {
    total,
    mine,
    theirs,
    received,
    outstanding: balance,
    isSettled: isPaid || balance <= 0,
    mineReceived: mine * collectedRate,
    mineOutstanding: mine * (1 - collectedRate),
    theirsReceived: theirs * collectedRate,
  };
}

function emptyBucket() {
  return {
    jobs: 0,
    invoiced: 0,
    mine: 0,
    theirs: 0,
    received: 0,
    outstanding: 0,
    mineReceived: 0,
    mineOutstanding: 0,
    theirsReceived: 0,
    unpaidJobs: 0,
  };
}

function addToBucket(bucket, split) {
  bucket.jobs += 1;
  bucket.invoiced += split.total;
  bucket.mine += split.mine;
  bucket.theirs += split.theirs;
  bucket.received += split.received;
  bucket.outstanding += split.outstanding;
  bucket.mineReceived += split.mineReceived;
  bucket.mineOutstanding += split.mineOutstanding;
  bucket.theirsReceived += split.theirsReceived;

  if (!split.isSettled) {
    bucket.unpaidJobs += 1;
  }

  return bucket;
}

function roundBucket(bucket) {
  return {
    ...bucket,
    invoiced: round2(bucket.invoiced),
    mine: round2(bucket.mine),
    theirs: round2(bucket.theirs),
    received: round2(bucket.received),
    outstanding: round2(bucket.outstanding),
    mineReceived: round2(bucket.mineReceived),
    mineOutstanding: round2(bucket.mineOutstanding),
    theirsReceived: round2(bucket.theirsReceived),
  };
}

// ============================================================
// SMALL UI PIECES
// ============================================================

function Figure({
  label,
  value,
  note,
  tone = "slate",
}) {
  const tones = {
    slate: "text-slate-900",
    emerald: "text-emerald-700",
    violet: "text-violet-700",
    rose: "text-rose-700",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-semibold text-slate-500">
        {label}
      </p>

      <p
        className={`mt-2 text-3xl font-bold tabular-nums tracking-tight ${
          tones[tone] || tones.slate
        }`}
      >
        {value}
      </p>

      {note && (
        <p className="mt-1.5 text-sm text-slate-500">
          {note}
        </p>
      )}
    </div>
  );
}

function SplitBar({ mine, theirs }) {
  const total = Number(mine || 0) + Number(theirs || 0);
  const minePercent = percentage(mine, total);
  const theirsPercent = 100 - minePercent;

  if (total <= 0) {
    return (
      <div className="h-3 rounded-full bg-slate-100" />
    );
  }

  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
      <div
        className="bg-emerald-500"
        style={{ width: `${minePercent}%` }}
      />

      <div
        className="bg-violet-500"
        style={{ width: `${theirsPercent}%` }}
      />
    </div>
  );
}

function MonthColumns({
  months,
  activeMonth,
  onSelect,
}) {
  const maximum = Math.max(
    1,
    ...months.map((month) => month.invoiced)
  );

  return (
    <div className="flex items-end gap-1.5 sm:gap-2">
      {months.map((month) => {
        const isActive =
          activeMonth === month.monthIndex;

        const isEmpty = month.jobs === 0;

        const height = percentage(
          month.invoiced,
          maximum
        );

        const mineShare = percentage(
          month.mine,
          month.invoiced
        );

        return (
          <button
            key={month.monthIndex}
            type="button"
            onClick={() => onSelect(month.monthIndex)}
            aria-pressed={isActive}
            title={`${MONTH_NAMES[month.monthIndex]} — ${month.jobs} jobs, ${money(
              month.invoiced
            )} invoiced`}
            className={`group flex flex-1 flex-col items-center gap-2 rounded-lg px-0.5 pb-2 pt-3 outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
              isActive
                ? "bg-slate-100"
                : "hover:bg-slate-50"
            }`}
          >
            <span
              className={`text-[11px] font-semibold tabular-nums ${
                isEmpty
                  ? "text-slate-300"
                  : "text-slate-600"
              }`}
            >
              {isEmpty
                ? "—"
                : compactMoney(month.invoiced)}
            </span>

            <span className="flex h-32 w-full items-end sm:h-40">
              <span
                className="flex w-full flex-col-reverse overflow-hidden rounded-md bg-slate-100"
                style={{
                  height: `${Math.max(
                    isEmpty ? 2 : 6,
                    height
                  )}%`,
                }}
              >
                <span
                  className={
                    isActive
                      ? "bg-emerald-500"
                      : "bg-emerald-400 group-hover:bg-emerald-500"
                  }
                  style={{ height: `${mineShare}%` }}
                />

                <span
                  className={
                    isActive
                      ? "bg-violet-500"
                      : "bg-violet-400 group-hover:bg-violet-500"
                  }
                  style={{
                    height: `${100 - mineShare}%`,
                  }}
                />
              </span>
            </span>

            <span
              className={`text-xs font-semibold ${
                isActive
                  ? "text-slate-900"
                  : "text-slate-500"
              }`}
            >
              {month.month}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// PAGE
// ============================================================

export default function CompanyAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [invoices, setInvoices] = useState([]);

  const [selectedYear, setSelectedYear] =
    useState("");

  // -1 means every month in the selected year.
  const [selectedMonth, setSelectedMonth] =
    useState(-1);

  const [search, setSearch] = useState("");

  const [onlyOwing, setOnlyOwing] = useState(false);

  const [expandedCompany, setExpandedCompany] =
    useState("");

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

      const { data, error } = await supabase
        .from("invoices")
        .select(
          `
            id,
            client_id,
            invoice_number,
            issue_date,
            paid_at,
            total,
            internal_amount,
            agency_commission,
            amount_paid,
            balance_due,
            status,
            client:clients(
              id,
              name,
              company_name
            )
          `
        )
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .neq("status", "cancelled")
        .order("issue_date", { ascending: true });

      if (error) {
        throw error;
      }

      const loadedInvoices = data || [];
      setInvoices(loadedInvoices);

      const years = loadedInvoices
        .map((invoice) =>
          safeDateParts(invoice.issue_date)
        )
        .filter(Boolean)
        .map((date) => date.year)
        .sort((first, second) => second - first);

      const latestYear = years[0];

      setSelectedYear((current) => {
        if (
          current &&
          years.includes(Number(current))
        ) {
          return current;
        }

        return latestYear
          ? String(latestYear)
          : String(new Date().getFullYear());
      });
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "Could not load company analytics."
      );
    } finally {
      setLoading(false);
    }
  }

  const availableYears = useMemo(() => {
    return Array.from(
      new Set(
        invoices
          .map((invoice) =>
            safeDateParts(invoice.issue_date)
          )
          .filter(Boolean)
          .map((date) => date.year)
      )
    ).sort((first, second) => second - first);
  }, [invoices]);

  // Every invoice in the chosen year, whatever month.
  const yearInvoices = useMemo(() => {
    const year = Number(selectedYear);

    return invoices.filter((invoice) => {
      const date = safeDateParts(invoice.issue_date);

      return date && date.year === year;
    });
  }, [invoices, selectedYear]);

  // Twelve months of the chosen year, always all twelve
  // so the shape of the year stays readable.
  const monthlyData = useMemo(() => {
    const months = MONTHS.map((month, monthIndex) => ({
      month,
      monthIndex,
      ...emptyBucket(),
    }));

    for (const invoice of yearInvoices) {
      const date = safeDateParts(invoice.issue_date);
      const bucket = months[date.monthIndex];

      if (!bucket) continue;

      addToBucket(bucket, splitInvoice(invoice));
    }

    return months.map(roundBucket);
  }, [yearInvoices]);

  // The invoices the filters actually select.
  const filteredInvoices = useMemo(() => {
    return yearInvoices.filter((invoice) => {
      const date = safeDateParts(invoice.issue_date);

      if (
        selectedMonth >= 0 &&
        date.monthIndex !== selectedMonth
      ) {
        return false;
      }

      if (search.trim()) {
        const name = clientName(
          invoice.client
        ).toLowerCase();

        if (
          !name.includes(
            search.trim().toLowerCase()
          )
        ) {
          return false;
        }
      }

      return true;
    });
  }, [yearInvoices, selectedMonth, search]);

  const totals = useMemo(() => {
    const bucket = emptyBucket();

    for (const invoice of filteredInvoices) {
      addToBucket(bucket, splitInvoice(invoice));
    }

    return roundBucket(bucket);
  }, [filteredInvoices]);

  const companyRows = useMemo(() => {
    const companies = new Map();

    for (const invoice of filteredInvoices) {
      const key =
        invoice.client_id ||
        `unknown-${clientName(invoice.client)}`;

      if (!companies.has(key)) {
        companies.set(key, {
          key,
          name: clientName(invoice.client),
          monthMap: new Map(),
          ...emptyBucket(),
        });
      }

      const company = companies.get(key);
      const split = splitInvoice(invoice);

      addToBucket(company, split);

      // Keep the same invoice in a per-month bucket so the
      // row can be opened to show which months are unpaid.
      const date = safeDateParts(invoice.issue_date);

      if (date) {
        if (!company.monthMap.has(date.monthIndex)) {
          company.monthMap.set(date.monthIndex, {
            monthIndex: date.monthIndex,
            ...emptyBucket(),
          });
        }

        addToBucket(
          company.monthMap.get(date.monthIndex),
          split
        );
      }
    }

    let rows = Array.from(companies.values()).map(
      (company) => {
        const { monthMap, ...rest } = company;

        return {
          ...roundBucket(rest),
          months: Array.from(monthMap.values())
            .map(roundBucket)
            .sort(
              (first, second) =>
                first.monthIndex - second.monthIndex
            ),
        };
      }
    );

    if (onlyOwing) {
      rows = rows.filter(
        (row) => row.outstanding > 0
      );
    }

    return rows.sort(
      (first, second) =>
        second.outstanding - first.outstanding ||
        second.mine - first.mine ||
        first.name.localeCompare(second.name)
    );
  }, [filteredInvoices, onlyOwing]);

  const periodLabel =
    selectedMonth >= 0
      ? `${MONTH_NAMES[selectedMonth]} ${selectedYear}`
      : String(selectedYear);

  const owingCompanies = companyRows.filter(
    (row) => row.outstanding > 0
  ).length;

  const collectedPercent = percentage(
    totals.received,
    totals.invoiced
  );

  if (loading) {
    return (
      <p className="text-slate-500">
        Loading company analytics...
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            Company analytics
          </h1>

          <p className="mt-2 max-w-2xl text-slate-500">
            What each company owes you, what they have
            paid, and how the money splits between you
            and the other company.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-600">
              Year
            </span>

            <select
              value={selectedYear}
              onChange={(event) => {
                setSelectedYear(event.target.value);
                setSelectedMonth(-1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {availableYears.length === 0 && (
                <option value={selectedYear}>
                  {selectedYear}
                </option>
              )}

              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-600">
              Month
            </span>

            <select
              value={selectedMonth}
              onChange={(event) =>
                setSelectedMonth(
                  Number(event.target.value)
                )
              }
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value={-1}>
                All months
              </option>

              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-600">
              Company
            </span>

            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search companies"
              className="w-48 rounded-lg border border-slate-300 bg-white px-4 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>
      </header>

      {message && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
        </div>
      )}

      {/* ---------------------------------------------- */}
      {/* HEADLINE SPLIT                                  */}
      {/* ---------------------------------------------- */}

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-baseline">
          <h2 className="text-lg font-bold text-slate-900">
            Where the money went in {periodLabel}
          </h2>

          <p className="text-sm text-slate-500 tabular-nums">
            {money(totals.invoiced)} invoiced across{" "}
            {totals.jobs}{" "}
            {totals.jobs === 1 ? "job" : "jobs"}
          </p>
        </div>

        <div className="mt-5">
          <SplitBar
            mine={totals.mine}
            theirs={totals.theirs}
          />
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />

              <span className="text-sm font-semibold text-slate-600">
                Yours
              </span>
            </div>

            <p className="mt-1.5 text-3xl font-bold tabular-nums text-emerald-700">
              {money(totals.mine)}
            </p>

            <p className="mt-1 text-sm text-slate-500 tabular-nums">
              {percentage(
                totals.mine,
                totals.invoiced
              ).toFixed(0)}
              % of everything invoiced
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />

              <span className="text-sm font-semibold text-slate-600">
                The other company
              </span>
            </div>

            <p className="mt-1.5 text-3xl font-bold tabular-nums text-violet-700">
              {money(totals.theirs)}
            </p>

            <p className="mt-1 text-sm text-slate-500 tabular-nums">
              {percentage(
                totals.theirs,
                totals.invoiced
              ).toFixed(0)}
              % of everything invoiced
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------- */}
      {/* FIGURES                                         */}
      {/* ---------------------------------------------- */}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Your money received"
          value={money(totals.mineReceived)}
          note={`${money(
            totals.mineOutstanding
          )} still to come in`}
          tone="emerald"
        />

        <Figure
          label="Still owed to you"
          value={money(totals.outstanding)}
          note={
            owingCompanies === 0
              ? "Everything is settled"
              : `${owingCompanies} ${
                  owingCompanies === 1
                    ? "company owes"
                    : "companies owe"
                } you`
          }
          tone="rose"
        />

        <Figure
          label="Paid"
          value={money(totals.received)}
          note={`${collectedPercent.toFixed(
            0
          )}% of what you invoiced`}
        />

        <Figure
          label="Completed jobs"
          value={totals.jobs}
          note={`${totals.unpaidJobs} still unpaid`}
        />
      </section>

      {/* ---------------------------------------------- */}
      {/* MONTH PICKER CHART                              */}
      {/* ---------------------------------------------- */}

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {selectedYear} month by month
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Pick a month to filter everything on
              this page.
            </p>
          </div>

          {selectedMonth >= 0 && (
            <button
              type="button"
              onClick={() => setSelectedMonth(-1)}
              className="self-start rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Show all months
            </button>
          )}
        </div>

        <div className="mt-5">
          <MonthColumns
            months={monthlyData}
            activeMonth={selectedMonth}
            onSelect={(monthIndex) =>
              setSelectedMonth(
                selectedMonth === monthIndex
                  ? -1
                  : monthIndex
              )
            }
          />
        </div>
      </section>

      {/* ---------------------------------------------- */}
      {/* MONTHLY TABLE                                   */}
      {/* ---------------------------------------------- */}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-bold text-slate-900">
            Owed and paid by month
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Grouped by the date each invoice was
            issued.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead className="bg-slate-50 text-sm text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">
                  Month
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Jobs
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Invoiced
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Yours
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Other company
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Paid
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Still owed
                </th>
              </tr>
            </thead>

            <tbody>
              {monthlyData.map((month) => {
                const isActive =
                  selectedMonth === month.monthIndex;

                const isEmpty = month.jobs === 0;

                return (
                  <tr
                    key={month.monthIndex}
                    onClick={() =>
                      setSelectedMonth(
                        isActive
                          ? -1
                          : month.monthIndex
                      )
                    }
                    className={`cursor-pointer border-t border-slate-200 tabular-nums ${
                      isActive
                        ? "bg-blue-50"
                        : "hover:bg-slate-50"
                    } ${
                      isEmpty ? "text-slate-400" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {
                        MONTH_NAMES[
                          month.monthIndex
                        ]
                      }
                    </td>

                    <td className="px-4 py-3 text-right">
                      {month.jobs || "—"}
                    </td>

                    <td className="px-4 py-3 text-right font-semibold">
                      {isEmpty
                        ? "—"
                        : money(month.invoiced)}
                    </td>

                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                      {isEmpty
                        ? "—"
                        : money(month.mine)}
                    </td>

                    <td className="px-4 py-3 text-right text-violet-700">
                      {isEmpty
                        ? "—"
                        : money(month.theirs)}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {isEmpty
                        ? "—"
                        : money(month.received)}
                    </td>

                    <td
                      className={`px-4 py-3 text-right font-semibold ${
                        month.outstanding > 0
                          ? "text-rose-700"
                          : "text-slate-400"
                      }`}
                    >
                      {isEmpty
                        ? "—"
                        : money(month.outstanding)}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold tabular-nums">
                <td className="px-4 py-3">
                  {selectedYear} total
                </td>

                <td className="px-4 py-3 text-right">
                  {monthlyData.reduce(
                    (sum, month) => sum + month.jobs,
                    0
                  )}
                </td>

                <td className="px-4 py-3 text-right">
                  {money(
                    monthlyData.reduce(
                      (sum, month) =>
                        sum + month.invoiced,
                      0
                    )
                  )}
                </td>

                <td className="px-4 py-3 text-right text-emerald-700">
                  {money(
                    monthlyData.reduce(
                      (sum, month) =>
                        sum + month.mine,
                      0
                    )
                  )}
                </td>

                <td className="px-4 py-3 text-right text-violet-700">
                  {money(
                    monthlyData.reduce(
                      (sum, month) =>
                        sum + month.theirs,
                      0
                    )
                  )}
                </td>

                <td className="px-4 py-3 text-right">
                  {money(
                    monthlyData.reduce(
                      (sum, month) =>
                        sum + month.received,
                      0
                    )
                  )}
                </td>

                <td className="px-4 py-3 text-right text-rose-700">
                  {money(
                    monthlyData.reduce(
                      (sum, month) =>
                        sum + month.outstanding,
                      0
                    )
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ---------------------------------------------- */}
      {/* COMPANY TABLE                                   */}
      {/* ---------------------------------------------- */}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Companies in {periodLabel}
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Sorted by what they still owe you.
            </p>
          </div>

          <label className="flex items-center gap-2.5 self-start">
            <input
              type="checkbox"
              checked={onlyOwing}
              onChange={(event) =>
                setOnlyOwing(event.target.checked)
              }
              className="h-4 w-4 rounded border-slate-300"
            />

            <span className="text-sm font-semibold text-slate-700">
              Only companies that owe me
            </span>
          </label>
        </div>

        {companyRows.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            {onlyOwing
              ? `Every company has paid up in ${periodLabel}.`
              : `No invoices were issued in ${periodLabel}.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead className="bg-slate-50 text-sm text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">
                    Company
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Jobs
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Invoiced
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Yours
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Other company
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Paid
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Still owed
                  </th>
                </tr>
              </thead>

              <tbody>
                {companyRows.map((company) => {
                  const isOpen =
                    expandedCompany === company.key;

                  const owingMonths =
                    company.months.filter(
                      (month) => month.outstanding > 0
                    );

                  return (
                <Fragment key={company.key}>
                  <tr
                    onClick={() =>
                      setExpandedCompany(
                        isOpen ? "" : company.key
                      )
                    }
                    className={`cursor-pointer border-t border-slate-200 tabular-nums ${
                      isOpen
                        ? "bg-slate-50"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={`mt-1 select-none text-xs text-slate-400 transition-transform ${
                            isOpen ? "rotate-90" : ""
                          }`}
                        >
                          &#9654;
                        </span>

                        <div>
                          <div className="font-semibold text-slate-900">
                            {company.name}
                          </div>

                          {owingMonths.length > 0 && (
                            <div className="mt-1 text-xs font-semibold text-rose-600">
                              Owes you in{" "}
                              {owingMonths
                                .map(
                                  (month) =>
                                    MONTHS[
                                      month.monthIndex
                                    ]
                                )
                                .join(", ")}
                            </div>
                          )}

                          <div className="mt-2 w-40">
                            <SplitBar
                              mine={company.mine}
                              theirs={company.theirs}
                            />
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4 text-right">
                      {company.jobs}

                      {company.unpaidJobs > 0 && (
                        <div className="mt-0.5 text-xs text-rose-600">
                          {company.unpaidJobs}{" "}
                          unpaid
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-4 text-right font-semibold">
                      {money(company.invoiced)}
                    </td>

                    <td className="px-4 py-4 text-right font-semibold text-emerald-700">
                      {money(company.mine)}
                    </td>

                    <td className="px-4 py-4 text-right text-violet-700">
                      {money(company.theirs)}
                    </td>

                    <td className="px-4 py-4 text-right">
                      {money(company.received)}
                    </td>

                    <td
                      className={`px-4 py-4 text-right font-semibold ${
                        company.outstanding > 0
                          ? "text-rose-700"
                          : "text-slate-400"
                      }`}
                    >
                      {company.outstanding > 0
                        ? money(
                            company.outstanding
                          )
                        : "Settled"}
                    </td>
                  </tr>

                  {isOpen &&
                    company.months.map((month) => (
                      <tr
                        key={`${company.key}-${month.monthIndex}`}
                        className="border-t border-slate-100 bg-slate-50/60 text-sm tabular-nums"
                      >
                        <td className="py-2.5 pl-12 pr-4 text-slate-600">
                          {
                            MONTH_NAMES[
                              month.monthIndex
                            ]
                          }{" "}
                          {selectedYear}
                        </td>

                        <td className="px-4 py-2.5 text-right text-slate-600">
                          {month.jobs}

                          {month.unpaidJobs > 0 && (
                            <span className="ml-1 text-xs text-rose-600">
                              ({month.unpaidJobs}{" "}
                              unpaid)
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-2.5 text-right text-slate-600">
                          {money(month.invoiced)}
                        </td>

                        <td className="px-4 py-2.5 text-right text-emerald-700">
                          {money(month.mine)}
                        </td>

                        <td className="px-4 py-2.5 text-right text-violet-700">
                          {money(month.theirs)}
                        </td>

                        <td className="px-4 py-2.5 text-right text-slate-600">
                          {money(month.received)}
                        </td>

                        <td
                          className={`px-4 py-2.5 text-right font-semibold ${
                            month.outstanding > 0
                              ? "text-rose-700"
                              : "text-slate-400"
                          }`}
                        >
                          {month.outstanding > 0
                            ? money(
                                month.outstanding
                              )
                            : "Settled"}
                        </td>
                      </tr>
                    ))}
                </Fragment>
                  );
                })}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold tabular-nums">
                  <td className="px-4 py-3">
                    {companyRows.length}{" "}
                    {companyRows.length === 1
                      ? "company"
                      : "companies"}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {companyRows.reduce(
                      (sum, row) => sum + row.jobs,
                      0
                    )}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {money(
                      companyRows.reduce(
                        (sum, row) =>
                          sum + row.invoiced,
                        0
                      )
                    )}
                  </td>

                  <td className="px-4 py-3 text-right text-emerald-700">
                    {money(
                      companyRows.reduce(
                        (sum, row) => sum + row.mine,
                        0
                      )
                    )}
                  </td>

                  <td className="px-4 py-3 text-right text-violet-700">
                    {money(
                      companyRows.reduce(
                        (sum, row) =>
                          sum + row.theirs,
                        0
                      )
                    )}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {money(
                      companyRows.reduce(
                        (sum, row) =>
                          sum + row.received,
                        0
                      )
                    )}
                  </td>

                  <td className="px-4 py-3 text-right text-rose-700">
                    {money(
                      companyRows.reduce(
                        (sum, row) =>
                          sum + row.outstanding,
                        0
                      )
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}