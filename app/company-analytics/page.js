"use client";

import { useEffect, useMemo, useState } from "react";
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

function barWidth(value, maximum) {
  if (!maximum) {
    return 0;
  }

  return Math.max(
    3,
    Math.min(
      100,
      (Number(value || 0) / maximum) * 100
    )
  );
}

export default function CompanyAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [chartType, setChartType] = useState("bar");
  const [chartMetric, setChartMetric] =
    useState("invoiceTotal");
  const [selectedYear, setSelectedYear] =
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

      const {
        data,
        error,
      } = await supabase
        .from("invoices")
        .select(
          `
            id,
            client_id,
            invoice_number,
            issue_date,
            total,
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
        .order("issue_date", {
          ascending: true,
        });

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

  const companyRows = useMemo(() => {
    const companies = new Map();

    function ensureCompany(clientId, client) {
      const key =
        clientId ||
        `unknown-${clientName(client)}`;

      if (!companies.has(key)) {
        companies.set(key, {
          key,
          name: clientName(client),
          completedJobs: 0,
          invoiceCount: 0,
          totalInvoiced: 0,
          totalPaid: 0,
          totalOutstanding: 0,
          unpaidInvoiceCount: 0,
        });
      }

      return companies.get(key);
    }

    for (const invoice of invoices) {
      const company = ensureCompany(
        invoice.client_id,
        invoice.client
      );

      const total = Number(invoice.total || 0);
      const balance = Number(
        invoice.balance_due ??
          (invoice.status === "paid"
            ? 0
            : total)
      );

      company.completedJobs += 1;
      company.invoiceCount += 1;
      company.totalInvoiced += total;
      company.totalOutstanding += Math.max(
        0,
        balance
      );
      company.totalPaid += Math.max(
        0,
        total - balance
      );

      if (
        invoice.status !== "paid" &&
        balance > 0
      ) {
        company.unpaidInvoiceCount += 1;
      }
    }

    return Array.from(companies.values())
      .map((company) => ({
        ...company,
        totalInvoiced: Number(
          company.totalInvoiced.toFixed(2)
        ),
        totalPaid: Number(
          company.totalPaid.toFixed(2)
        ),
        totalOutstanding: Number(
          company.totalOutstanding.toFixed(2)
        ),
      }))
      .sort(
        (first, second) =>
          second.totalOutstanding -
            first.totalOutstanding ||
          second.completedJobs -
            first.completedJobs ||
          first.name.localeCompare(second.name)
      );
  }, [invoices]);

  const totals = useMemo(
    () =>
      companyRows.reduce(
        (result, company) => {
          result.companies += 1;
          result.completedJobs +=
            company.completedJobs;
          result.invoices +=
            company.invoiceCount;
          result.invoiced +=
            company.totalInvoiced;
          result.paid += company.totalPaid;
          result.outstanding +=
            company.totalOutstanding;

          return result;
        },
        {
          companies: 0,
          completedJobs: 0,
          invoices: 0,
          invoiced: 0,
          paid: 0,
          outstanding: 0,
        }
      ),
    [companyRows]
  );

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

  const monthlyData = useMemo(() => {
    const year = Number(selectedYear);

    const months = MONTHS.map(
      (month, monthIndex) => ({
        month,
        monthIndex,
        invoiceCount: 0,
        invoiceTotal: 0,
        paidTotal: 0,
        outstandingTotal: 0,
      })
    );

    for (const invoice of invoices) {
      const date = safeDateParts(
        invoice.issue_date
      );

      if (!date || date.year !== year) {
        continue;
      }

      const month = months[date.monthIndex];

      if (!month) {
        continue;
      }

      const total = Number(invoice.total || 0);
      const balance = Number(
        invoice.balance_due ??
          (invoice.status === "paid"
            ? 0
            : total)
      );

      month.invoiceCount += 1;
      month.invoiceTotal += total;
      month.paidTotal += Math.max(
        0,
        total - balance
      );
      month.outstandingTotal += Math.max(
        0,
        balance
      );
    }

    return months.map((month) => ({
      ...month,
      invoiceTotal: Number(
        month.invoiceTotal.toFixed(2)
      ),
      paidTotal: Number(
        month.paidTotal.toFixed(2)
      ),
      outstandingTotal: Number(
        month.outstandingTotal.toFixed(2)
      ),
    }));
  }, [invoices, selectedYear]);

  const selectedYearTotals = useMemo(
    () =>
      monthlyData.reduce(
        (result, month) => {
          result.invoiceCount +=
            month.invoiceCount;
          result.invoiceTotal +=
            month.invoiceTotal;
          result.paidTotal +=
            month.paidTotal;
          result.outstandingTotal +=
            month.outstandingTotal;

          return result;
        },
        {
          invoiceCount: 0,
          invoiceTotal: 0,
          paidTotal: 0,
          outstandingTotal: 0,
        }
      ),
    [monthlyData]
  );

  const maximumJobs = Math.max(
    0,
    ...companyRows.map(
      (company) => company.completedJobs
    )
  );

  const maximumOutstanding = Math.max(
    0,
    ...companyRows.map(
      (company) =>
        company.totalOutstanding
    )
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Company Analytics
          </h1>

          <p className="mt-2 max-w-4xl text-slate-600">
            Each non-cancelled invoice counts as one
            completed job. Compare companies and review
            invoice totals month by month.
          </p>
        </div>

        <button
          type="button"
          onClick={loadAnalytics}
          disabled={loading}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading
            ? "Refreshing..."
            : "Refresh"}
        </button>
      </div>

      {message && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {message}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard
          label="Companies"
          value={totals.companies}
        />

        <SummaryCard
          label="Completed jobs"
          value={totals.completedJobs}
        />

        <SummaryCard
          label="Invoice records"
          value={totals.invoices}
        />

        <SummaryCard
          label="Total invoiced"
          value={money(totals.invoiced)}
        />

        <SummaryCard
          label="Paid"
          value={money(totals.paid)}
          valueClass="text-green-700"
        />

        <SummaryCard
          label="Still owed"
          value={money(totals.outstanding)}
          valueClass="text-red-700"
        />
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          Loading company analytics...
        </div>
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Monthly invoice performance
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Calendar months are grouped by their
                  real invoice dates, including months
                  ending on the 28th, 29th, 30th or 31st.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm font-semibold text-slate-700">
                  Year
                  <select
                    value={selectedYear}
                    onChange={(event) =>
                      setSelectedYear(
                        event.target.value
                      )
                    }
                    className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900"
                  >
                    {availableYears.length === 0 ? (
                      <option
                        value={selectedYear}
                      >
                        {selectedYear}
                      </option>
                    ) : (
                      availableYears.map((year) => (
                        <option
                          key={year}
                          value={year}
                        >
                          {year}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
                  <button
                    type="button"
                    onClick={() =>
                      setChartType("bar")
                    }
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                      chartType === "bar"
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    Bar chart
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setChartType("line")
                    }
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                      chartType === "line"
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    Line chart
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <MiniCard
                label={`${selectedYear} invoices`}
                value={
                  selectedYearTotals.invoiceCount
                }
              />

              <MiniCard
                label={`${selectedYear} invoiced`}
                value={money(
                  selectedYearTotals.invoiceTotal
                )}
              />

              <MiniCard
                label={`${selectedYear} paid`}
                value={money(
                  selectedYearTotals.paidTotal
                )}
                valueClass="text-green-700"
              />

              <MiniCard
                label={`${selectedYear} still owed`}
                value={money(
                  selectedYearTotals.outstandingTotal
                )}
                valueClass="text-red-700"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 px-5 pt-5">
              <span className="mr-2 text-sm font-semibold text-slate-700">
                Show:
              </span>

              <MetricButton
                active={
                  chartMetric === "invoiceTotal"
                }
                onClick={() =>
                  setChartMetric("invoiceTotal")
                }
              >
                Invoice value
              </MetricButton>

              <MetricButton
                active={
                  chartMetric === "invoiceCount"
                }
                onClick={() =>
                  setChartMetric("invoiceCount")
                }
              >
                Number of invoices
              </MetricButton>

              <MetricButton
                active={
                  chartMetric === "paidTotal"
                }
                onClick={() =>
                  setChartMetric("paidTotal")
                }
              >
                Paid
              </MetricButton>

              <MetricButton
                active={
                  chartMetric ===
                  "outstandingTotal"
                }
                onClick={() =>
                  setChartMetric(
                    "outstandingTotal"
                  )
                }
              >
                Still owed
              </MetricButton>
            </div>

            <div className="p-4 sm:p-5">
              <MonthlyChart
                data={monthlyData}
                type={chartType}
                metric={chartMetric}
              />
            </div>

            <div className="overflow-x-auto border-t border-slate-200">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">
                      Month
                    </th>
                    <th className="px-4 py-3 text-right">
                      Invoices
                    </th>
                    <th className="px-4 py-3 text-right">
                      Total invoiced
                    </th>
                    <th className="px-4 py-3 text-right">
                      Paid
                    </th>
                    <th className="px-4 py-3 text-right">
                      Still owed
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {monthlyData.map(
                    (month, index) => (
                      <tr
                        key={month.month}
                        className={
                          index % 2 === 0
                            ? "bg-white"
                            : "bg-slate-50"
                        }
                      >
                        <td className="border-t border-slate-200 px-4 py-3 font-semibold">
                          {month.month}{" "}
                          {selectedYear}
                        </td>

                        <td className="border-t border-slate-200 px-4 py-3 text-right">
                          {month.invoiceCount}
                        </td>

                        <td className="border-t border-slate-200 px-4 py-3 text-right font-semibold">
                          {money(
                            month.invoiceTotal
                          )}
                        </td>

                        <td className="border-t border-slate-200 px-4 py-3 text-right font-semibold text-green-700">
                          {money(
                            month.paidTotal
                          )}
                        </td>

                        <td className="border-t border-slate-200 px-4 py-3 text-right font-semibold text-red-700">
                          {money(
                            month.outstandingTotal
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>

                <tfoot className="bg-slate-100 font-bold">
                  <tr>
                    <td className="border-t border-slate-300 px-4 py-3">
                      Total {selectedYear}
                    </td>

                    <td className="border-t border-slate-300 px-4 py-3 text-right">
                      {
                        selectedYearTotals.invoiceCount
                      }
                    </td>

                    <td className="border-t border-slate-300 px-4 py-3 text-right">
                      {money(
                        selectedYearTotals.invoiceTotal
                      )}
                    </td>

                    <td className="border-t border-slate-300 px-4 py-3 text-right text-green-700">
                      {money(
                        selectedYearTotals.paidTotal
                      )}
                    </td>

                    <td className="border-t border-slate-300 px-4 py-3 text-right text-red-700">
                      {money(
                        selectedYearTotals.outstandingTotal
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <CompanyBarCard
              title="Completed jobs by agent or company"
              rows={companyRows}
              valueKey="completedJobs"
              maximum={maximumJobs}
              valueFormatter={(value) =>
                `${value} job${
                  value === 1 ? "" : "s"
                }`
              }
              barClass="bg-blue-600"
            />

            <CompanyBarCard
              title="Outstanding money by company"
              rows={companyRows}
              valueKey="totalOutstanding"
              maximum={maximumOutstanding}
              valueFormatter={money}
              barClass="bg-red-500"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-xl font-bold text-slate-900">
                Company payment breakdown
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Sorted by the largest outstanding
                balance.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">
                      Agent / company
                    </th>
                    <th className="px-4 py-3 text-right">
                      Completed jobs
                    </th>
                    <th className="px-4 py-3 text-right">
                      Invoices
                    </th>
                    <th className="px-4 py-3 text-right">
                      Total invoiced
                    </th>
                    <th className="px-4 py-3 text-right">
                      Paid
                    </th>
                    <th className="px-4 py-3 text-right">
                      Still owed
                    </th>
                    <th className="px-4 py-3 text-right">
                      Unpaid invoices
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {companyRows.map(
                    (company, index) => (
                      <tr
                        key={company.key}
                        className={
                          index % 2 === 0
                            ? "bg-white"
                            : "bg-slate-50"
                        }
                      >
                        <td className="border-t border-slate-200 px-4 py-3 font-semibold">
                          {company.name}
                        </td>

                        <td className="border-t border-slate-200 px-4 py-3 text-right">
                          {
                            company.completedJobs
                          }
                        </td>

                        <td className="border-t border-slate-200 px-4 py-3 text-right">
                          {company.invoiceCount}
                        </td>

                        <td className="border-t border-slate-200 px-4 py-3 text-right font-semibold">
                          {money(
                            company.totalInvoiced
                          )}
                        </td>

                        <td className="border-t border-slate-200 px-4 py-3 text-right font-semibold text-green-700">
                          {money(
                            company.totalPaid
                          )}
                        </td>

                        <td className="border-t border-slate-200 px-4 py-3 text-right font-bold text-red-700">
                          {money(
                            company.totalOutstanding
                          )}
                        </td>

                        <td className="border-t border-slate-200 px-4 py-3 text-right">
                          {
                            company.unpaidInvoiceCount
                          }
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  valueClass = "text-slate-900",
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div
        className={`mt-2 text-2xl font-bold ${valueClass}`}
      >
        {value}
      </div>
    </div>
  );
}

function MiniCard({
  label,
  value,
  valueClass = "text-slate-900",
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div
        className={`mt-1 text-lg font-bold ${valueClass}`}
      >
        {value}
      </div>
    </div>
  );
}

function MetricButton({
  active,
  onClick,
  children,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
        active
          ? "border-blue-600 bg-blue-50 text-blue-700"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function MonthlyChart({
  data,
  type,
  metric,
}) {
  const width = 960;
  const height = 360;
  const padding = {
    top: 28,
    right: 24,
    bottom: 52,
    left: 82,
  };

  const innerWidth =
    width - padding.left - padding.right;
  const innerHeight =
    height - padding.top - padding.bottom;

  const values = data.map(
    (month) => Number(month[metric] || 0)
  );

  const maximum = Math.max(1, ...values);
  const segmentWidth =
    innerWidth / data.length;

  const yPosition = (value) =>
    padding.top +
    innerHeight -
    (Number(value || 0) / maximum) *
      innerHeight;

  const linePoints = data
    .map((month, index) => {
      const x =
        padding.left +
        segmentWidth * index +
        segmentWidth / 2;

      return `${x},${yPosition(
        month[metric]
      )}`;
    })
    .join(" ");

  const ticks = Array.from(
    { length: 5 },
    (_, index) =>
      (maximum / 4) * index
  );

  const formatter =
    metric === "invoiceCount"
      ? (value) =>
          Math.round(value).toLocaleString(
            "en-GB"
          )
      : compactMoney;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Monthly ${
          type === "bar"
            ? "bar"
            : "line"
        } chart`}
        className="min-w-[760px] w-full"
      >
        {ticks.map((tick) => {
          const y = yPosition(tick);

          return (
            <g key={tick}>
              <line
                x1={padding.left}
                y1={y}
                x2={
                  width - padding.right
                }
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />

              <text
                x={padding.left - 12}
                y={y + 4}
                textAnchor="end"
                fontSize="12"
                fill="#64748b"
              >
                {formatter(tick)}
              </text>
            </g>
          );
        })}

        {type === "bar" ? (
          data.map((month, index) => {
            const value = Number(
              month[metric] || 0
            );

            const x =
              padding.left +
              segmentWidth * index +
              segmentWidth * 0.18;

            const y = yPosition(value);
            const barHeight =
              padding.top +
              innerHeight -
              y;

            return (
              <g key={month.month}>
                <rect
                  x={x}
                  y={y}
                  width={
                    segmentWidth * 0.64
                  }
                  height={Math.max(
                    0,
                    barHeight
                  )}
                  rx="5"
                  fill="#2563eb"
                >
                  <title>
                    {month.month}:{" "}
                    {metric ===
                    "invoiceCount"
                      ? `${value} invoice${
                          value === 1
                            ? ""
                            : "s"
                        }`
                      : money(value)}
                  </title>
                </rect>
              </g>
            );
          })
        ) : (
          <>
            <polyline
              points={linePoints}
              fill="none"
              stroke="#2563eb"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {data.map(
              (month, index) => {
                const value = Number(
                  month[metric] || 0
                );

                const x =
                  padding.left +
                  segmentWidth * index +
                  segmentWidth / 2;

                const y =
                  yPosition(value);

                return (
                  <circle
                    key={month.month}
                    cx={x}
                    cy={y}
                    r="5"
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth="3"
                  >
                    <title>
                      {month.month}:{" "}
                      {metric ===
                      "invoiceCount"
                        ? `${value} invoice${
                            value === 1
                              ? ""
                              : "s"
                          }`
                        : money(value)}
                    </title>
                  </circle>
                );
              }
            )}
          </>
        )}

        {data.map((month, index) => {
          const x =
            padding.left +
            segmentWidth * index +
            segmentWidth / 2;

          return (
            <text
              key={month.month}
              x={x}
              y={
                height -
                padding.bottom +
                25
              }
              textAnchor="middle"
              fontSize="12"
              fontWeight="600"
              fill="#475569"
            >
              {month.month}
            </text>
          );
        })}

        <line
          x1={padding.left}
          y1={padding.top + innerHeight}
          x2={width - padding.right}
          y2={padding.top + innerHeight}
          stroke="#94a3b8"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}

function CompanyBarCard({
  title,
  rows,
  valueKey,
  maximum,
  valueFormatter,
  barClass,
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">
        {title}
      </h2>

      <div className="mt-5 space-y-4">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="flex items-end justify-between gap-4 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-700">
                {row.name}
              </span>

              <span className="shrink-0 font-bold text-slate-900">
                {valueFormatter(
                  row[valueKey]
                )}
              </span>
            </div>

            <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${barClass}`}
                style={{
                  width: `${barWidth(
                    row[valueKey],
                    maximum
                  )}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
