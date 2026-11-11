"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import WindowsFrame from "../../../components/windows/WindowsFrame";
import PeriodPicker, {
  addDays,
  fromIso,
  mondayOf,
  periodFor,
  toIso,
} from "../../../components/windows/PeriodPicker";
import { supabase } from "../../../lib/supabase";
import { locale, translate, useLang } from "../../../lib/windowsLang";
import {
  formatJobDate,
  formatMoney,
  roundMoney,
  todayIso,
} from "../../../lib/windows";

// Monday first. Polish: pon, wt, śr, czw, pt, sob, nd.
const DAY_LETTERS = {
  en: ["M", "T", "W", "T", "F", "S", "S"],
  pl: ["P", "W", "Ś", "C", "P", "S", "N"],
};
const MONTH_LETTERS = {
  en: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
  pl: ["S", "L", "M", "K", "M", "C", "L", "S", "W", "P", "L", "G"],
};

function letters(table) {
  return table[locale() === "pl-PL" ? "pl" : "en"];
}

function sumJobs(jobs, start, end) {
  return roundMoney(
    jobs
      .filter((job) => job.job_date >= start && job.job_date <= end)
      .reduce((n, job) => n + Number(job.total || 0), 0)
  );
}

/**
 * The bars for the chart: days for a week, weeks for a month,
 * months for a year.
 */
function buildBuckets(mode, period, jobs) {
  const { start, end } = period;
  const days = Math.round((fromIso(end) - fromIso(start)) / 86400000) + 1;

  const byDay = mode === "week" || (mode === "custom" && days <= 14);
  const byMonth = mode === "year" || (mode === "custom" && days > 92);

  if (byDay) {
    return Array.from({ length: days }, (_, i) => {
      const iso = addDays(start, i);
      const date = fromIso(iso);
      return {
        key: iso,
        short: mode === "week" ? letters(DAY_LETTERS)[i] : String(date.getDate()),
        long: formatJobDate(iso),
        start: iso,
        end: iso,
        value: sumJobs(jobs, iso, iso),
      };
    });
  }

  if (byMonth) {
    const out = [];
    const cursor = fromIso(start);
    cursor.setDate(1);
    while (toIso(cursor) <= end) {
      const first = toIso(cursor);
      const last = toIso(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
      const a = first < start ? start : first;
      const b = last > end ? end : last;
      out.push({
        key: first,
        short: letters(MONTH_LETTERS)[cursor.getMonth()],
        long: cursor.toLocaleDateString(locale(), { month: "long", year: "numeric" }),
        start: a,
        end: b,
        value: sumJobs(jobs, a, b),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
  }

  // Weeks (Monday to Sunday), cut to the period.
  const out = [];
  let monday = mondayOf(start);
  while (monday <= end) {
    const sunday = addDays(monday, 6);
    const a = monday < start ? start : monday;
    const b = sunday > end ? end : sunday;
    const fa = fromIso(a);
    const fb = fromIso(b);
    out.push({
      key: monday,
      short: a === b ? String(fa.getDate()) : `${fa.getDate()}–${fb.getDate()}`,
      long: `${fa.toLocaleDateString(locale(), { day: "numeric", month: "short" })} – ${fb.toLocaleDateString(locale(), { day: "numeric", month: "short" })}`,
      start: a,
      end: b,
      value: sumJobs(jobs, a, b),
    });
    monday = addDays(monday, 7);
  }
  return out;
}

function BarChart({ buckets, title }) {
  const today = todayIso();
  const max = Math.max(...buckets.map((b) => b.value), 0);

  const current = buckets.findIndex((b) => b.start <= today && b.end >= today);
  const best = max > 0 ? buckets.findIndex((b) => b.value === max) : -1;
  const [picked, setPicked] = useState(null);
  const shown = picked ?? (current >= 0 ? current : best >= 0 ? best : 0);
  const bucket = buckets[shown];

  return (
    <figure className="mt-5">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-300">{bucket?.long}</span>
        <span className="text-lg font-bold tabular-nums">
          {formatMoney(bucket?.value)}
        </span>
      </figcaption>

      <div
        className="mt-3 flex h-32 items-end gap-[2px] border-b border-white/25"
        role="group"
        aria-label={title}
      >
        {buckets.map((b, i) => {
          const height = max > 0 ? Math.max(b.value > 0 ? 4 : 0, (b.value / max) * 100) : 0;
          const active = i === shown;
          const isNow = i === current;

          return (
            <button
              key={b.key}
              type="button"
              onClick={() => setPicked(i)}
              aria-label={`${b.long}: ${formatMoney(b.value)}`}
              aria-pressed={active}
              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"
            >
              <span
                className={`w-full max-w-9 rounded-t-[4px] transition-colors ${
                  active ? "bg-[#7FD1C7]" : isNow ? "bg-[#4FB3A7]" : "bg-[#3B6E73] group-hover:bg-[#4FB3A7]"
                }`}
                style={{ height: `${height}%` }}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-[2px]" aria-hidden="true">
        {buckets.map((b, i) => (
          <span
            key={b.key}
            className={`min-w-0 flex-1 truncate text-center text-[11px] ${
              i === shown ? "font-bold text-white" : i === current ? "font-semibold text-slate-200" : "text-slate-400"
            }`}
          >
            {buckets.length > 16 && i % 2 === 1 ? "" : b.short}
          </span>
        ))}
      </div>
    </figure>
  );
}

export default function WindowsTotalsPage() {
  const { t, lang } = useLang();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState({ mode: "week", offset: 0, from: "", to: "" });

  useEffect(() => {
    (async () => {
      try {
        const { data, error: loadError } = await supabase
          .from("mp_jobs")
          .select("id, job_number, job_date, address, items, total")
          .order("job_date", { ascending: false })
          .order("created_at", { ascending: false });

        if (loadError) throw loadError;
        setJobs(data || []);
      } catch (e) {
        setError(e.message || translate("jobs.loadError"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const period = periodFor(picker.mode, picker.offset, picker);

  const result = useMemo(() => {
    const inRange = jobs.filter(
      (job) => job.job_date >= period.start && job.job_date <= period.end
    );

    const byItem = new Map();
    for (const job of inRange) {
      for (const item of job.items || []) {
        const key = String(item.name).trim().toLowerCase();
        const current = byItem.get(key) || { name: item.name, qty: 0, amount: 0 };
        current.qty += Number(item.qty) || 0;
        current.amount += (Number(item.price) || 0) * (Number(item.qty) || 0);
        byItem.set(key, current);
      }
    }

    const total = roundMoney(inRange.reduce((n, job) => n + Number(job.total || 0), 0));

    let previous = null;
    if (picker.mode !== "custom") {
      const before = periodFor(picker.mode, picker.offset - 1);
      previous = { label: before.label, total: sumJobs(jobs, before.start, before.end) };
    }

    return {
      jobs: inRange,
      total,
      average: inRange.length ? roundMoney(total / inRange.length) : 0,
      items: [...byItem.values()]
        .map((item) => ({ ...item, amount: roundMoney(item.amount) }))
        .sort((a, b) => b.amount - a.amount),
      previous,
      buckets: buildBuckets(picker.mode, period, jobs),
    };
  }, [jobs, period.start, period.end, picker.mode, picker.offset, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // The last 8 weeks, for the week view.
  const recentWeeks = useMemo(() => {
    if (picker.mode !== "week") return [];
    return Array.from({ length: 8 }, (_, i) => {
      const offset = -i;
      const week = periodFor("week", offset);
      const inWeek = jobs.filter((j) => j.job_date >= week.start && j.job_date <= week.end);
      return {
        offset,
        ...week,
        total: sumJobs(jobs, week.start, week.end),
        count: inWeek.length,
      };
    });
  }, [jobs, picker.mode, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekMax = Math.max(...recentWeeks.map((w) => w.total), 0);
  const change = result.previous ? roundMoney(result.total - result.previous.total) : 0;

  return (
    <WindowsFrame>
      <h1 className="text-2xl font-bold tracking-tight">{t("nav.totals")}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {t("totals.intro")}
      </p>

      <div className="mt-5">
        <PeriodPicker value={picker} onChange={setPicker} />
      </div>

      {loading ? <p className="mt-8 text-slate-500">{t("loading")}</p> : null}

      {error ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {!loading && !error ? (
        <>
          {/* Headline and chart */}
          <section className="mt-4 rounded-2xl bg-[#13232E] p-5 text-white">
            <p className="text-sm text-slate-300">{t("totals.youMade")}</p>
            <p className="mt-0.5 text-4xl font-extrabold tabular-nums tracking-tight">
              {formatMoney(result.total)}
            </p>

            {result.previous ? (
              <p className="mt-1 text-sm text-slate-300">
                {change === 0 ? (
                  <>{t("totals.same", { prev: result.previous.label.toLowerCase() })}</>
                ) : (
                  <>
                    <span className={change > 0 ? "font-semibold text-[#7FD1C7]" : "font-semibold text-[#FDA4AF]"}>
                      {change > 0 ? "▲" : "▼"} {formatMoney(Math.abs(change))}
                    </span>{" "}
                    {t("totals.vs", { prev: result.previous.label.toLowerCase(), amount: formatMoney(result.previous.total) })}
                  </>
                )}
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/15 pt-4">
              <div>
                <p className="text-sm text-slate-300">{t("nav.jobs")}</p>
                <p className="text-xl font-bold tabular-nums">{result.jobs.length}</p>
              </div>
              <div>
                <p className="text-sm text-slate-300">{t("totals.average")}</p>
                <p className="text-xl font-bold tabular-nums">{formatMoney(result.average)}</p>
              </div>
            </div>

            {result.buckets.length > 1 ? (
              <BarChart
                key={`${period.start}-${period.end}`}
                buckets={result.buckets}
                title={`${t("totals.chart")}, ${period.sub}`}
              />
            ) : null}
          </section>

          {/* What was fitted */}
          <section className="mt-6">
            <h2 className="text-lg font-bold">{t("whatYouDid")}</h2>

            {result.items.length === 0 ? (
              <p className="mt-2 rounded-xl border-2 border-dashed border-[#9FB8B8] p-5 text-center text-slate-600">
                {picker.mode === "week" && picker.offset === 0 ? t("totals.noneThisWeek") : t("totals.nonePeriod")}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-[#D5E0E0] overflow-hidden rounded-xl border border-[#D5E0E0] bg-white">
                {result.items.map((item) => (
                  <li key={item.name} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-[#E3ECEC] px-2 font-bold tabular-nums">
                      {item.qty}
                    </span>
                    <span className="min-w-0 flex-1 font-semibold">{item.name}</span>
                    <span className="font-bold tabular-nums">{formatMoney(item.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Jobs in the period */}
          {result.jobs.length ? (
            <section className="mt-6">
              <h2 className="text-lg font-bold">{t("nav.jobs")}</h2>
              <ul className="mt-2 divide-y divide-[#D5E0E0] overflow-hidden rounded-xl border border-[#D5E0E0] bg-white">
                {result.jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/windows/jobs/${job.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#F1FAF8]"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold">{t("job.title", { n: job.job_number })}</span>
                        <span className="block truncate text-sm text-slate-500">
                          {formatJobDate(job.job_date)}
                          {job.address ? `, ${job.address}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 font-bold tabular-nums">{formatMoney(job.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Past weeks */}
          {recentWeeks.length ? (
            <section className="mt-6">
              <h2 className="text-lg font-bold">{t("totals.past8")}</h2>
              <ul className="mt-2 divide-y divide-[#D5E0E0] overflow-hidden rounded-xl border border-[#D5E0E0] bg-white">
                {recentWeeks.map((week) => {
                  const selected = week.offset === picker.offset;
                  return (
                    <li key={week.start}>
                      <button
                        type="button"
                        onClick={() => {
                          setPicker((p) => ({ ...p, offset: week.offset }));
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        aria-current={selected ? "true" : undefined}
                        className={`w-full px-4 py-3 text-left ${selected ? "bg-[#F1FAF8]" : "hover:bg-[#F7FAFA]"}`}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block font-semibold">{week.label}</span>
                            <span className="block text-sm text-slate-500">
                              {week.sub} · {t("jobCount", { n: week.count })}
                            </span>
                          </span>
                          <span className="shrink-0 font-bold tabular-nums">{formatMoney(week.total)}</span>
                        </span>
                        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <span
                            className="block h-full rounded-full bg-[#0F766E]"
                            style={{ width: `${weekMax > 0 ? (week.total / weekMax) * 100 : 0}%` }}
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </WindowsFrame>
  );
}