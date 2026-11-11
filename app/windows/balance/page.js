"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import WindowsFrame from "../../../components/windows/WindowsFrame";
import { supabase } from "../../../lib/supabase";
import {
  buildBalance,
  daysAgo,
  formatJobDate,
  formatMoney,
  itemsSummary,
} from "../../../lib/windows";
import { translate, useLang } from "../../../lib/windowsLang";

function ageLabel(days) {
  return translate("daysAgo", { n: days });
}

function ageTone(days) {
  if (days >= 60) return "bg-[#9F1239] text-white";
  if (days >= 30) return "bg-rose-100 text-rose-800";
  if (days >= 14) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

function Line({ label, value, minus = false, strong = false, note }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "" : "text-slate-200"}`}>
      <span>
        <span className={strong ? "font-bold text-white" : ""}>{label}</span>
        {note ? <span className="block text-xs text-slate-400">{note}</span> : null}
      </span>
      <span className={`tabular-nums ${strong ? "text-xl font-extrabold text-white" : "font-semibold"}`}>
        {minus ? "− " : ""}
        {formatMoney(value)}
      </span>
    </div>
  );
}

export default function WindowsBalancePage() {
  const { t } = useLang();
  const [jobs, setJobs] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPaid, setShowPaid] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [jobsResult, paymentsResult] = await Promise.all([
          supabase
            .from("mp_jobs")
            .select("id, job_number, job_date, address, items, total, created_at"),
          supabase.from("mp_payments").select("id, method, amount, paid_on, job_id"),
        ]);

        if (jobsResult.error) throw jobsResult.error;
        if (paymentsResult.error) throw paymentsResult.error;

        setJobs(jobsResult.data || []);
        setPayments(paymentsResult.data || []);
      } catch (e) {
        setError(
          e.message?.includes("job_id")
            ? translate("runBalanceSql")
            : e.message || translate("balance.loadError")
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const balance = useMemo(() => buildBalance(jobs, payments), [jobs, payments]);
  const owing = balance.jobs.filter((job) => job.left > 0);
  const paidUp = balance.jobs.filter((job) => job.left <= 0).reverse();

  return (
    <WindowsFrame>
      <h1 className="text-2xl font-bold tracking-tight">{t("nav.balance")}</h1>
      <p className="mt-1 text-sm text-slate-600">{t("balance.intro")}</p>

      {loading ? <p className="mt-8 text-slate-500">{t("loading")}</p> : null}

      {error ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {!loading && !error ? (
        <>
          {/* The deduction, written out */}
          <section className="mt-5 rounded-xl bg-[#13232E] p-5 text-white">
            <p className="text-sm text-slate-300">
              {balance.credit > 0 ? t("balance.advance") : t("balance.toCollect")}
            </p>
            <p
              className={`mt-1 text-4xl font-extrabold tabular-nums tracking-tight ${
                balance.credit > 0 ? "text-[#7FD1C7]" : balance.stillOwed > 0 ? "text-[#FDA4AF]" : "text-[#7FD1C7]"
              }`}
            >
              {formatMoney(balance.credit > 0 ? balance.credit : balance.stillOwed)}
            </p>

            <div className="mt-4 border-t border-white/15 pt-2">
              <Line
                label={t("balance.workDone")}
                note={t("jobCount", { n: balance.jobs.length })}
                value={balance.workDone}
              />
              <Line label={t("balance.cash")} value={balance.cash} minus />
              <Line label={t("balance.bank")} value={balance.bank} minus />
              <div className="mt-1 border-t border-white/30 pt-1">
                <Line
                  strong
                  label={balance.credit > 0 ? t("balance.inCredit") : t("balance.stillOwed")}
                  value={balance.credit > 0 ? balance.credit : balance.stillOwed}
                />
              </div>
            </div>
          </section>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#D5E0E0] bg-white p-4">
              <p className="text-sm text-slate-500">{t("balance.gotBack")}</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums">
                {formatMoney(balance.received)}
              </p>
              <p className="text-xs text-slate-500">
                {balance.workDone > 0
                  ? t("balance.ofWork", { p: Math.min(100, Math.round((balance.received / balance.workDone) * 100)) })
                  : t("jobs.emptyTitle")}
              </p>
            </div>
            <div className="rounded-xl border border-[#D5E0E0] bg-white p-4">
              <p className="text-sm text-slate-500">{t("balance.notPaid")}</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums">{owing.length}</p>
              <p className="text-xs text-slate-500">
                {t("balance.paidCount", { n: paidUp.length })}
              </p>
            </div>
          </div>

          {balance.unlinked > 0 ? (
            <p className="mt-4 rounded-lg bg-[#E3ECEC] px-4 py-3 text-sm text-slate-700">
              {t("balance.unlinked", { amount: formatMoney(balance.unlinked) })}{" "}
              <Link href="/windows/payments" className="font-semibold text-[#0F766E] underline">
                {t("nav.moneyIn")}
              </Link>
              .
            </p>
          ) : null}

          {/* Jobs still owed */}
          <section className="mt-7">
            <div className="flex items-baseline justify-between border-b-2 border-[#13232E] pb-1">
              <h2 className="text-lg font-bold">{t("balance.toCollect")}</h2>
              <p className="font-bold tabular-nums text-[#9F1239]">
                {formatMoney(balance.stillOwed)}
              </p>
            </div>

            {owing.length === 0 ? (
              <p className="mt-4 rounded-xl border-2 border-dashed border-[#9FB8B8] p-6 text-center text-slate-600">
                {balance.jobs.length === 0
                  ? t("jobs.emptyTitle")
                  : t("balance.allPaid")}
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {owing.map((job) => {
                  const days = daysAgo(job.job_date);
                  const percent = job.total > 0 ? Math.round((job.paid / job.total) * 100) : 0;

                  return (
                    <li key={job.id} className="rounded-xl border border-[#D5E0E0] bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <Link href={`/windows/jobs/${job.id}`} className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-bold">{t("job.title", { n: job.job_number })}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ageTone(days)}`}>
                              {ageLabel(days)}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-sm text-slate-500">
                            {formatJobDate(job.job_date)}
                            {job.address ? `, ${job.address}` : ""}
                          </span>
                          <span className="mt-0.5 block text-sm text-slate-700">
                            {itemsSummary(job.items)}
                          </span>
                        </Link>
                        <span className="shrink-0 text-right">
                          <span className="block text-lg font-extrabold tabular-nums text-[#9F1239]">
                            {formatMoney(job.left)}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {t("balance.leftOf", { total: formatMoney(job.total) })}
                          </span>
                        </span>
                      </div>

                      <div
                        className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
                        role="img"
                        aria-label={t("balance.percentPaid", { p: percent })}
                      >
                        <div
                          className="h-full rounded-full bg-[#0F766E]"
                          style={{ width: `${percent}%` }}
                        />
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-500">
                          {job.paid > 0 ? t("balance.paid", { amount: formatMoney(job.paid) }) : t("balance.nothingPaid")}
                          {job.autoApplied > 0 ? ` ${t("balance.someAuto")}` : ""}
                        </span>
                        <Link
                          href={`/windows/payments?job=${job.id}`}
                          className="shrink-0 rounded-lg bg-[#0F766E] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0B5F58]"
                        >
                          {t("balance.logPayment")}
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Paid jobs */}
          {paidUp.length ? (
            <section className="mt-7">
              <button
                type="button"
                onClick={() => setShowPaid((v) => !v)}
                aria-expanded={showPaid}
                className="flex w-full items-baseline justify-between border-b border-[#9FB8B8] pb-1 text-left"
              >
                <span className="text-lg font-bold">
                  {t("balance.paidInFull", { n: paidUp.length })}
                </span>
                <span className="text-sm font-semibold text-[#0F766E]">
                  {showPaid ? t("hide") : t("show")}
                </span>
              </button>

              {showPaid ? (
                <ul className="mt-2 divide-y divide-[#D5E0E0] overflow-hidden rounded-xl border border-[#D5E0E0] bg-white">
                  {paidUp.map((job) => (
                    <li key={job.id}>
                      <Link
                        href={`/windows/jobs/${job.id}`}
                        className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-[#F1FAF8]"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold">{t("job.title", { n: job.job_number })}</span>
                          <span className="block truncate text-sm text-slate-500">
                            {formatJobDate(job.job_date)}
                            {job.address ? `, ${job.address}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-bold tabular-nums">{formatMoney(job.total)}</span>
                          <span className="block text-xs font-semibold text-[#0F766E]">{t("balance.paidTag")}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </WindowsFrame>
  );
}