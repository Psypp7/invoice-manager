"use client";

import { useEffect, useMemo, useState } from "react";
import WindowsFrame from "../../../components/windows/WindowsFrame";
import PeriodPicker, { periodFor } from "../../../components/windows/PeriodPicker";
import { supabase } from "../../../lib/supabase";
import {
  buildBalance,
  formatJobDate,
  formatMoney,
  roundMoney,
  todayIso,
} from "../../../lib/windows";

const METHODS = {
  cash: { label: "Cash", tone: "bg-[#E6F4EA] text-[#1E6B34]" },
  bank: { label: "Bank transfer", tone: "bg-[#E3ECF7] text-[#1F4E8C]" },
};

function emptyForm(jobId = "") {
  return { id: null, method: "cash", amount: "", paid_on: todayIso(), note: "", job_id: jobId };
}

function dayHeading(iso) {
  const today = todayIso();
  if (iso === today) return "Today";
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yesterday = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (iso === yesterday) return "Yesterday";
  return formatJobDate(iso);
}

export default function WindowsMoneyInPage() {
  const [userId, setUserId] = useState(null);
  const [payments, setPayments] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [picker, setPicker] = useState({ mode: "week", offset: 0, from: "", to: "" });

  async function loadAll() {
    const [paymentsResult, jobsResult] = await Promise.all([
      supabase
        .from("mp_payments")
        .select("id, method, amount, paid_on, note, job_id, created_at")
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("mp_jobs")
        .select("id, job_number, job_date, address, total, created_at"),
    ]);

    if (paymentsResult.error) {
      throw paymentsResult.error.message?.includes("job_id")
        ? new Error("Run the Supabase update (mp-balance.sql) first.")
        : paymentsResult.error;
    }
    if (jobsResult.error) throw jobsResult.error;

    setPayments(paymentsResult.data || []);
    setJobs(jobsResult.data || []);
  }

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);
        await loadAll();

        // Opened from "Log payment" on the Balance screen.
        const jobFromLink = new URLSearchParams(window.location.search).get("job");
        if (jobFromLink) {
          setForm(emptyForm(jobFromLink));
          setSheetOpen(true);
        }
      } catch (e) {
        setPageError(e.message || "Your payments could not be loaded.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Close the sheet with Escape, and stop the page scrolling behind it.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setSheetOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const balance = useMemo(() => buildBalance(jobs, payments), [jobs, payments]);
  const jobById = useMemo(
    () => new Map(balance.jobs.map((job) => [job.id, job])),
    [balance]
  );
  const jobOptions = useMemo(
    () => [
      ...balance.jobs.filter((job) => job.left > 0),
      ...balance.jobs.filter((job) => job.left <= 0).reverse(),
    ],
    [balance]
  );
  const pickedJob = form.job_id ? jobById.get(form.job_id) : null;

  const period = periodFor(picker.mode, picker.offset, picker);

  const result = useMemo(() => {
    const list = payments
      .filter((p) => p.paid_on >= period.start && p.paid_on <= period.end)
      .sort(
        (a, b) =>
          String(b.paid_on).localeCompare(String(a.paid_on)) ||
          String(b.created_at || "").localeCompare(String(a.created_at || ""))
      );
    const sum = (method) =>
      roundMoney(
        list
          .filter((p) => !method || p.method === method)
          .reduce((n, p) => n + Number(p.amount || 0), 0)
      );

    const days = [];
    for (const p of list) {
      const last = days[days.length - 1];
      if (last && last.date === p.paid_on) {
        last.items.push(p);
        last.total += Number(p.amount || 0);
      } else {
        days.push({ date: p.paid_on, items: [p], total: Number(p.amount || 0) });
      }
    }

    return { count: list.length, days, cash: sum("cash"), bank: sum("bank"), total: sum(null) };
  }, [payments, period.start, period.end]);

  function openNew() {
    setFormError("");
    setForm(emptyForm());
    setSheetOpen(true);
  }

  function openEdit(payment) {
    setFormError("");
    setForm({
      id: payment.id,
      method: payment.method,
      amount: String(payment.amount),
      paid_on: payment.paid_on,
      note: payment.note || "",
      job_id: payment.job_id || "",
    });
    setSheetOpen(true);
  }

  async function savePayment(event) {
    event.preventDefault();
    setFormError("");

    const amount = roundMoney(form.amount);
    if (!(amount > 0)) {
      setFormError("Enter how much you received.");
      return;
    }
    if (!form.paid_on) {
      setFormError("Pick the date you received it.");
      return;
    }

    const payload = {
      method: form.method,
      amount,
      paid_on: form.paid_on,
      note: form.note.trim() || null,
      job_id: form.job_id || null,
    };

    setSaving(true);
    try {
      const { error } = form.id
        ? await supabase.from("mp_payments").update(payload).eq("id", form.id)
        : await supabase.from("mp_payments").insert({ ...payload, user_id: userId });
      if (error) throw error;

      await loadAll();
      setToast(
        `${form.id ? "Updated" : "Saved"}: ${formatMoney(amount)} ${METHODS[form.method].label.toLowerCase()}`
      );
      setSheetOpen(false);
      setForm(emptyForm());
    } catch (e) {
      setFormError(e.message || "The payment could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePayment() {
    if (!form.id) return;
    if (!window.confirm("Delete this payment? This cannot be undone.")) return;

    setSaving(true);
    try {
      const { error } = await supabase.from("mp_payments").delete().eq("id", form.id);
      if (error) throw error;
      await loadAll();
      setToast("Payment deleted");
      setSheetOpen(false);
      setForm(emptyForm());
    } catch (e) {
      setFormError(e.message || "The payment could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  const field =
    "w-full rounded-lg border border-[#C9D6D6] bg-white px-3 py-3 text-base focus:border-[#0F766E] focus:outline-none focus:ring-2 focus:ring-[#0F766E]/25";

  const cashShare = result.total > 0 ? (result.cash / result.total) * 100 : 0;

  return (
    <WindowsFrame>
      <h1 className="text-2xl font-bold tracking-tight">Money in</h1>
      <p className="mt-1 text-sm text-slate-600">
        Every payment you have received, in cash or by bank transfer.
      </p>

      <div className="mt-5">
        <PeriodPicker value={picker} onChange={setPicker} />
      </div>

      {pageError ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {pageError}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-8 text-slate-500">Loading…</p>
      ) : (
        <>
          {/* Summary */}
          <section className="mt-4 rounded-2xl bg-[#13232E] p-5 text-white">
            <p className="text-sm text-slate-300">Received</p>
            <p className="mt-0.5 text-4xl font-extrabold tabular-nums tracking-tight">
              {formatMoney(result.total)}
            </p>
            <p className="text-sm text-slate-300">
              {result.count} payment{result.count === 1 ? "" : "s"}
            </p>

            <div
              className="mt-4 flex h-2 gap-[2px] overflow-hidden rounded-full bg-white/10"
              role="img"
              aria-label={`Cash ${formatMoney(result.cash)}, bank transfer ${formatMoney(result.bank)}`}
            >
              {result.cash > 0 ? (
                <span className="h-full rounded-l-full bg-[#86D19A]" style={{ width: `${cashShare}%` }} />
              ) : null}
              {result.bank > 0 ? (
                <span className="h-full flex-1 rounded-r-full bg-[#8DB5EA]" />
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm text-slate-300">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[#86D19A]" />
                  Cash
                </p>
                <p className="text-xl font-bold tabular-nums">{formatMoney(result.cash)}</p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-sm text-slate-300">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[#8DB5EA]" />
                  Bank transfer
                </p>
                <p className="text-xl font-bold tabular-nums">{formatMoney(result.bank)}</p>
              </div>
            </div>
          </section>

          {/* Payments, by day */}
          {result.days.length === 0 ? (
            <div className="mt-5 rounded-xl border-2 border-dashed border-[#9FB8B8] p-6 text-center">
              <p className="font-semibold">Nothing received in this period</p>
              <p className="mt-1 text-sm text-slate-600">
                Tap Add money in when you get paid.
              </p>
            </div>
          ) : (
            result.days.map((day) => (
              <section key={day.date} className="mt-5">
                <div className="flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                    {dayHeading(day.date)}
                  </h2>
                  <p className="text-sm font-bold tabular-nums text-slate-500">
                    {formatMoney(day.total)}
                  </p>
                </div>
                <ul className="mt-1.5 divide-y divide-[#D5E0E0] overflow-hidden rounded-xl border border-[#D5E0E0] bg-white">
                  {day.items.map((payment) => {
                    const job = payment.job_id ? jobById.get(payment.job_id) : null;
                    const method = METHODS[payment.method] || { label: payment.method, tone: "" };

                    return (
                      <li key={payment.id}>
                        <button
                          type="button"
                          onClick={() => openEdit(payment)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#F1FAF8]"
                        >
                          <span className="min-w-0 flex-1">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${method.tone}`}>
                              {method.label}
                            </span>
                            <span className="mt-1 block truncate text-sm font-semibold text-[#13232E]">
                              {job
                                ? `Job ${job.job_number}${job.address ? `, ${job.address}` : ""}`
                                : "Not for one job"}
                            </span>
                            {payment.note ? (
                              <span className="block truncate text-sm text-slate-500">{payment.note}</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-lg font-bold tabular-nums">
                            {formatMoney(payment.amount)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}

          {result.days.length ? (
            <p className="mt-3 text-center text-xs text-slate-500">
              Tap a payment to change or delete it.
            </p>
          ) : null}
        </>
      )}

      {/* Add button, always within reach */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#EEF3F3] via-[#EEF3F3] to-transparent pt-6">
        <div
          className="mx-auto max-w-2xl px-4 pb-4"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={openNew}
            disabled={loading || Boolean(pageError)}
            className="w-full rounded-xl bg-[#0F766E] py-4 text-lg font-bold text-white shadow-lg hover:bg-[#0B5F58] disabled:opacity-50"
          >
            + Add money in
          </button>
        </div>
      </div>

      {toast ? (
        <p
          role="status"
          className="fixed inset-x-4 bottom-24 z-30 mx-auto max-w-sm rounded-xl bg-[#13232E] px-4 py-3 text-center text-sm font-semibold text-white shadow-lg"
        >
          {toast}
        </p>
      ) : null}

      {/* Add / edit sheet */}
      {sheetOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-[#13232E]/50 sm:items-center"
          onClick={() => setSheetOpen(false)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
            onSubmit={savePayment}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
            style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
            <div className="flex items-center justify-between">
              <h2 id="sheet-title" className="text-xl font-bold">
                {form.id ? "Change payment" : "Add money in"}
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="How you were paid">
              {Object.entries(METHODS).map(([id, method]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={form.method === id}
                  onClick={() => setForm((f) => ({ ...f, method: id }))}
                  className={`rounded-xl border-2 py-3 font-bold ${
                    form.method === id
                      ? "border-[#13232E] bg-[#13232E] text-white"
                      : "border-[#C9D6D6] bg-white text-[#13232E]"
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>

            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-semibold">Amount</span>
              <span className="flex items-center rounded-xl border-2 border-[#C9D6D6] bg-white focus-within:border-[#0F766E]">
                <span className="pl-4 text-2xl font-bold text-slate-400">£</span>
                <input
                  value={form.amount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9.]/g, "") }))
                  }
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="Amount received"
                  className="w-full rounded-xl bg-transparent px-2 py-3 text-2xl font-bold tabular-nums focus:outline-none"
                />
              </span>
            </label>

            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-semibold">
                Which job? <span className="font-normal text-slate-500">(optional)</span>
              </span>
              <select
                value={form.job_id}
                onChange={(e) => setForm((f) => ({ ...f, job_id: e.target.value }))}
                className={field}
              >
                <option value="">Not for one job (comes off the oldest first)</option>
                {jobOptions.map((job) => (
                  <option key={job.id} value={job.id}>
                    {`Job ${job.job_number}${job.address ? `, ${job.address}` : ""} · ${
                      job.left > 0 ? `${formatMoney(job.left)} left` : "paid"
                    }`}
                  </option>
                ))}
              </select>
            </label>

            {pickedJob && pickedJob.left > 0 ? (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-[#F1FAF8] px-3 py-2 text-sm">
                <span>
                  Still owes <strong className="tabular-nums">{formatMoney(pickedJob.left)}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, amount: String(pickedJob.left) }))}
                  className="shrink-0 rounded-md border border-[#0F766E] px-2 py-1 font-semibold text-[#0F766E] hover:bg-white"
                >
                  Use this amount
                </button>
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1 block text-sm font-semibold">Date received</span>
                <input
                  type="date"
                  value={form.paid_on}
                  onChange={(e) => setForm((f) => ({ ...f, paid_on: e.target.value }))}
                  className={field}
                />
              </label>
              <label>
                <span className="mb-1 block text-sm font-semibold">
                  Note <span className="font-normal text-slate-500">(optional)</span>
                </span>
                <input
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Who paid"
                  className={field}
                />
              </label>
            </div>

            {formError ? (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
                {formError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="mt-5 w-full rounded-xl bg-[#0F766E] py-4 text-lg font-bold text-white hover:bg-[#0B5F58] disabled:opacity-60"
            >
              {saving ? "Saving…" : form.id ? "Save changes" : "Save payment"}
            </button>

            {form.id ? (
              <button
                type="button"
                onClick={deletePayment}
                disabled={saving}
                className="mt-3 w-full rounded-xl py-3 text-sm font-semibold text-red-700 hover:bg-red-50"
              >
                Delete this payment
              </button>
            ) : null}
          </form>
        </div>
      ) : null}
    </WindowsFrame>
  );
}