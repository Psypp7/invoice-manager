"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import WindowsFrame from "../../components/windows/WindowsFrame";
import { supabase } from "../../lib/supabase";
import {
  formatJobDate,
  formatMoney,
  itemsSummary,
  roundMoney,
  todayIso,
} from "../../lib/windows";

function startOfWeekIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function monthLabel(iso) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export default function WindowsJobsPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data, error: loadError } = await supabase
          .from("mp_jobs")
          .select("id, job_number, job_date, address, items, photos, total")
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

  const totals = useMemo(() => {
    const today = todayIso();
    const weekStart = startOfWeekIso(today);
    const monthStart = `${today.slice(0, 7)}-01`;

    const sum = (from) =>
      roundMoney(
        jobs
          .filter((job) => job.job_date >= from && job.job_date <= today)
          .reduce((n, job) => n + Number(job.total || 0), 0)
      );

    return {
      today: sum(today),
      week: sum(weekStart),
      month: sum(monthStart),
    };
  }, [jobs]);

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? jobs.filter((job) =>
          [job.job_number, job.address, itemsSummary(job.items)]
            .join(" ")
            .toLowerCase()
            .includes(term)
        )
      : jobs;

    const byMonth = new Map();
    for (const job of filtered) {
      const key = String(job.job_date).slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(job);
    }

    return [...byMonth.entries()].map(([key, list]) => ({
      key,
      label: monthLabel(`${key}-01`),
      jobs: list,
      total: roundMoney(list.reduce((n, job) => n + Number(job.total || 0), 0)),
    }));
  }, [jobs, search]);

  return (
    <WindowsFrame>
      {/* Earnings */}
      <section className="grid grid-cols-3 overflow-hidden rounded-xl border border-[#D5E0E0] bg-white">
        {[
          { label: "Today", value: totals.today },
          { label: "This week", value: totals.week },
          { label: "This month", value: totals.month },
        ].map((stat, index) => (
          <div
            key={stat.label}
            className={`px-3 py-4 ${index > 0 ? "border-l border-[#D5E0E0]" : ""}`}
          >
            <p className="text-sm text-slate-500">{stat.label}</p>
            <p className="mt-1 text-xl font-extrabold tabular-nums tracking-tight sm:text-2xl">
              {formatMoney(stat.value)}
            </p>
          </div>
        ))}
      </section>

      <Link
        href="/windows/jobs/new"
        className="mt-4 block rounded-xl bg-[#0F766E] py-4 text-center text-lg font-bold text-white hover:bg-[#0B5F58]"
      >
        + New job
      </Link>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search job number or address"
        aria-label="Search jobs"
        className="mt-5 w-full rounded-lg border border-[#C9D6D6] bg-white px-3 py-3 text-base focus:border-[#0F766E] focus:outline-none focus:ring-2 focus:ring-[#0F766E]/25"
      />

      {loading ? <p className="mt-8 text-slate-500">Loading jobs…</p> : null}

      {error ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {!loading && !error && jobs.length === 0 ? (
        <div className="mt-8 rounded-xl border-2 border-dashed border-[#9FB8B8] p-8 text-center">
          <p className="font-semibold">No jobs yet</p>
          <p className="mt-1 text-sm text-slate-600">
            Tap New job to photograph the survey and add up what you fitted.
          </p>
        </div>
      ) : null}

      {!loading && jobs.length > 0 && groups.length === 0 ? (
        <p className="mt-8 text-center text-slate-500">
          No jobs match &ldquo;{search}&rdquo;.
        </p>
      ) : null}

      {groups.map((group) => (
        <section key={group.key} className="mt-7">
          <div className="flex items-baseline justify-between border-b-2 border-[#13232E] pb-1">
            <h2 className="text-lg font-bold">{group.label}</h2>
            <p className="font-bold tabular-nums">{formatMoney(group.total)}</p>
          </div>

          <ul className="mt-2 space-y-2">
            {group.jobs.map((job) => {
              const summary = itemsSummary(job.items);
              const photoCount = (job.photos || []).length;

              return (
                <li key={job.id}>
                  <Link
                    href={`/windows/jobs/${job.id}`}
                    className="flex items-start gap-3 rounded-xl border border-[#D5E0E0] bg-white p-4 hover:border-[#0F766E]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-500">
                        {formatJobDate(job.job_date)}
                      </p>
                      <p className="mt-0.5 font-bold">
                        Job {job.job_number}
                        {job.address ? (
                          <span className="font-normal text-slate-600">, {job.address}</span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        {summary || "No items added"}
                      </p>
                      {photoCount ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {photoCount} survey photo{photoCount === 1 ? "" : "s"}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-lg font-extrabold tabular-nums">
                      {formatMoney(job.total)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </WindowsFrame>
  );
}