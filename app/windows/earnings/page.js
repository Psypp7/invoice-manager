"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import WindowsFrame from "../../../components/windows/WindowsFrame";
import { supabase } from "../../../lib/supabase";
import {
  formatJobDate,
  formatMoney,
  roundMoney,
  todayIso,
} from "../../../lib/windows";

function toIso(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function fromIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function presetRange(preset) {
  const today = fromIso(todayIso());
  const y = today.getFullYear();
  const m = today.getMonth();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  switch (preset) {
    case "this-week": {
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return [toIso(monday), toIso(sunday)];
    }
    case "last-week": {
      const start = new Date(monday);
      start.setDate(monday.getDate() - 7);
      const end = new Date(monday);
      end.setDate(monday.getDate() - 1);
      return [toIso(start), toIso(end)];
    }
    case "this-month":
      return [toIso(new Date(y, m, 1)), toIso(new Date(y, m + 1, 0))];
    case "last-month":
      return [toIso(new Date(y, m - 1, 1)), toIso(new Date(y, m, 0))];
    case "this-year":
      return [toIso(new Date(y, 0, 1)), toIso(new Date(y, 11, 31))];
    default:
      return null;
  }
}

const PRESETS = [
  { id: "this-week", label: "This week" },
  { id: "last-week", label: "Last week" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-year", label: "This year" },
];

function shortDate(iso) {
  return fromIso(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function WindowsEarningsPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const initial = presetRange("this-month");
  const [preset, setPreset] = useState("this-month");
  const [from, setFrom] = useState(initial[0]);
  const [to, setTo] = useState(initial[1]);

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
        setError(e.message || "Your jobs could not be loaded.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function choosePreset(id) {
    const range = presetRange(id);
    setPreset(id);
    setFrom(range[0]);
    setTo(range[1]);
  }

  // Let the dates be picked in either order.
  const start = from && to && from > to ? to : from;
  const end = from && to && from > to ? from : to;

  const result = useMemo(() => {
    const inRange = jobs.filter(
      (job) => (!start || job.job_date >= start) && (!end || job.job_date <= end)
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

    return {
      jobs: inRange,
      total,
      average: inRange.length ? roundMoney(total / inRange.length) : 0,
      items: [...byItem.values()]
        .map((item) => ({ ...item, amount: roundMoney(item.amount) }))
        .sort((a, b) => b.amount - a.amount),
    };
  }, [jobs, start, end]);

  const field =
    "w-full rounded-lg border border-[#C9D6D6] bg-white px-3 py-3 text-base focus:border-[#0F766E] focus:outline-none focus:ring-2 focus:ring-[#0F766E]/25";

  return (
    <WindowsFrame>
      <h1 className="text-2xl font-bold tracking-tight">Earnings</h1>
      <p className="mt-1 text-sm text-slate-600">
        Pick a period to see what you made, by job date.
      </p>

      {/* Period */}
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Quick periods">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => choosePreset(p.id)}
            aria-pressed={preset === p.id}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              preset === p.id
                ? "bg-[#13232E] text-white"
                : "border border-[#C9D6D6] bg-white text-[#13232E] hover:border-[#13232E]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label>
          <span className="mb-1 block text-sm font-semibold">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPreset("custom");
            }}
            className={field}
          />
        </label>
        <label>
          <span className="mb-1 block text-sm font-semibold">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPreset("custom");
            }}
            className={field}
          />
        </label>
      </div>

      {loading ? <p className="mt-8 text-slate-500">Loading…</p> : null}

      {error ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {!loading && !error ? (
        <>
          {/* Total */}
          <section className="mt-6 rounded-xl bg-[#13232E] p-5 text-white">
            <p className="text-sm text-slate-300">
              {start && end ? `${shortDate(start)} to ${shortDate(end)}` : "All dates"}
            </p>
            <p className="mt-1 text-4xl font-extrabold tabular-nums tracking-tight">
              {formatMoney(result.total)}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/15 pt-4">
              <div>
                <p className="text-sm text-slate-300">Jobs</p>
                <p className="text-xl font-bold tabular-nums">{result.jobs.length}</p>
              </div>
              <div>
                <p className="text-sm text-slate-300">Average per job</p>
                <p className="text-xl font-bold tabular-nums">{formatMoney(result.average)}</p>
              </div>
            </div>
          </section>

          {/* What was fitted */}
          <section className="mt-6">
            <h2 className="text-lg font-bold">What you did</h2>

            {result.items.length === 0 ? (
              <p className="mt-2 text-slate-500">No jobs in this period.</p>
            ) : (
              <table className="mt-2 w-full overflow-hidden rounded-xl border border-[#D5E0E0] bg-white text-left">
                <thead className="bg-[#E3ECEC] text-sm">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">Item</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Made</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#D5E0E0]">
                  {result.items.map((item) => (
                    <tr key={item.name}>
                      <td className="px-3 py-3">{item.name}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{item.qty}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">
                        {formatMoney(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Jobs in the period */}
          {result.jobs.length ? (
            <section className="mt-6">
              <h2 className="text-lg font-bold">Jobs</h2>
              <ul className="mt-2 divide-y divide-[#D5E0E0] overflow-hidden rounded-xl border border-[#D5E0E0] bg-white">
                {result.jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/windows/jobs/${job.id}`}
                      className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-[#F1FAF8]"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-500">
                          {formatJobDate(job.job_date)}
                        </span>
                        <span className="block truncate font-semibold">
                          Job {job.job_number}
                          {job.address ? (
                            <span className="font-normal text-slate-600">, {job.address}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="font-bold tabular-nums">{formatMoney(job.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </WindowsFrame>
  );
}