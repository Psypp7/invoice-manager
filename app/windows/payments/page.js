"use client";

import { useEffect, useMemo, useState } from "react";
import WindowsFrame from "../../../components/windows/WindowsFrame";
import { supabase } from "../../../lib/supabase";
import {
  formatJobDate,
  formatMoney,
  roundMoney,
  todayIso,
} from "../../../lib/windows";

const METHODS = {
  cash: { label: "Cash", tone: "bg-[#E6F4EA] text-[#1E6B34]" },
  bank: { label: "Bank transfer", tone: "bg-[#E3ECF7] text-[#1F4E8C]" },
};

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

function emptyForm() {
  return { id: null, method: "cash", amount: "", paid_on: todayIso(), note: "" };
}

export default function WindowsPaymentsPage() {
  const [userId, setUserId] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const [form, setForm] = useState(emptyForm());

  const initial = presetRange("this-month");
  const [preset, setPreset] = useState("this-month");
  const [from, setFrom] = useState(initial[0]);
  const [to, setTo] = useState(initial[1]);

  async function loadPayments() {
    const { data, error: loadError } = await supabase
      .from("mp_payments")
      .select("id, method, amount, paid_on, note")
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false });

    if (loadError) throw loadError;
    setPayments(data || []);
  }

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);
        await loadPayments();
      } catch (e) {
        setError(e.message || "Your payments could not be loaded.");
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

  const start = from && to && from > to ? to : from;
  const end = from && to && from > to ? from : to;

  const result = useMemo(() => {
    const inRange = payments.filter(
      (p) => (!start || p.paid_on >= start) && (!end || p.paid_on <= end)
    );
    const sum = (method) =>
      roundMoney(
        inRange
          .filter((p) => !method || p.method === method)
          .reduce((n, p) => n + Number(p.amount || 0), 0)
      );

    return {
      list: inRange,
      cash: sum("cash"),
      bank: sum("bank"),
      total: sum(null),
    };
  }, [payments, start, end]);

  function editPayment(payment) {
    setError("");
    setSaved("");
    setForm({
      id: payment.id,
      method: payment.method,
      amount: String(payment.amount),
      paid_on: payment.paid_on,
      note: payment.note || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function savePayment(event) {
    event.preventDefault();
    setError("");
    setSaved("");

    const amount = roundMoney(form.amount);
    if (!(amount > 0)) {
      setError("Enter how much you received.");
      return;
    }
    if (!form.paid_on) {
      setError("Pick the date you received it.");
      return;
    }

    const payload = {
      method: form.method,
      amount,
      paid_on: form.paid_on,
      note: form.note.trim() || null,
    };

    setSaving(true);
    try {
      const { error: saveError } = form.id
        ? await supabase.from("mp_payments").update(payload).eq("id", form.id)
        : await supabase.from("mp_payments").insert({ ...payload, user_id: userId });

      if (saveError) throw saveError;

      await loadPayments();
      setSaved(
        `${form.id ? "Updated" : "Saved"}: ${formatMoney(amount)} ${
          METHODS[form.method].label.toLowerCase()
        } on ${formatJobDate(form.paid_on)}.`
      );
      setForm(emptyForm());
    } catch (e) {
      setError(e.message || "The payment could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePayment() {
    if (!form.id) return;
    if (!window.confirm("Delete this payment? This cannot be undone.")) return;

    setSaving(true);
    try {
      const { error: deleteError } = await supabase
        .from("mp_payments")
        .delete()
        .eq("id", form.id);
      if (deleteError) throw deleteError;

      await loadPayments();
      setSaved("Payment deleted.");
      setForm(emptyForm());
    } catch (e) {
      setError(e.message || "The payment could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  const field =
    "w-full rounded-lg border border-[#C9D6D6] bg-white px-3 py-3 text-base focus:border-[#0F766E] focus:outline-none focus:ring-2 focus:ring-[#0F766E]/25";

  return (
    <WindowsFrame>
      <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
      <p className="mt-1 text-sm text-slate-600">
        Log the money you receive, in cash or by bank transfer.
      </p>

      {/* Add / edit a payment */}
      <form
        onSubmit={savePayment}
        className="mt-5 rounded-xl border border-[#D5E0E0] bg-white p-4"
      >
        <h2 className="font-bold">
          {form.id ? "Edit payment" : "Add a payment"}
        </h2>

        <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="How you were paid">
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

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label>
            <span className="mb-1 block text-sm font-semibold">Amount</span>
            <span className="flex items-center rounded-lg border border-[#C9D6D6] bg-white focus-within:border-[#0F766E] focus-within:ring-2 focus-within:ring-[#0F766E]/25">
              <span className="pl-3 text-slate-500">£</span>
              <input
                value={form.amount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9.]/g, "") }))
                }
                inputMode="decimal"
                placeholder="0.00"
                className="w-full rounded-lg bg-transparent px-2 py-3 text-base tabular-nums focus:outline-none"
              />
            </span>
          </label>
          <label>
            <span className="mb-1 block text-sm font-semibold">Date received</span>
            <input
              type="date"
              value={form.paid_on}
              onChange={(e) => setForm((f) => ({ ...f, paid_on: e.target.value }))}
              className={field}
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-semibold">
            Note <span className="font-normal text-slate-500">(optional)</span>
          </span>
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="e.g. Job 4512, or who paid"
            className={field}
          />
        </label>

        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {saved}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="mt-4 w-full rounded-xl bg-[#0F766E] py-4 text-lg font-bold text-white hover:bg-[#0B5F58] disabled:opacity-60"
        >
          {saving ? "Saving…" : form.id ? "Save changes" : "Save payment"}
        </button>

        {form.id ? (
          <div className="mt-3 flex justify-between">
            <button
              type="button"
              onClick={() => setForm(emptyForm())}
              className="text-sm font-semibold text-slate-600 hover:underline"
            >
              Cancel edit
            </button>
            <button
              type="button"
              onClick={deletePayment}
              disabled={saving}
              className="text-sm font-semibold text-red-700 hover:underline"
            >
              Delete payment
            </button>
          </div>
        ) : null}
      </form>

      {/* Period */}
      <h2 className="mt-8 text-lg font-bold">Received</h2>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick periods">
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

      {loading ? <p className="mt-6 text-slate-500">Loading…</p> : (
        <>
          <section className="mt-5 overflow-hidden rounded-xl bg-[#13232E] text-white">
            <div className="p-5">
              <p className="text-sm text-slate-300">Total received</p>
              <p className="mt-1 text-4xl font-extrabold tabular-nums tracking-tight">
                {formatMoney(result.total)}
              </p>
            </div>
            <div className="grid grid-cols-2 border-t border-white/15">
              <div className="p-4">
                <p className="text-sm text-slate-300">Cash</p>
                <p className="text-xl font-bold tabular-nums">{formatMoney(result.cash)}</p>
              </div>
              <div className="border-l border-white/15 p-4">
                <p className="text-sm text-slate-300">Bank transfer</p>
                <p className="text-xl font-bold tabular-nums">{formatMoney(result.bank)}</p>
              </div>
            </div>
          </section>

          {result.list.length === 0 ? (
            <p className="mt-5 text-center text-slate-500">
              No payments in this period.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[#D5E0E0] overflow-hidden rounded-xl border border-[#D5E0E0] bg-white">
              {result.list.map((payment) => (
                <li key={payment.id}>
                  <button
                    type="button"
                    onClick={() => editPayment(payment)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[#F1FAF8]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            METHODS[payment.method]?.tone || ""
                          }`}
                        >
                          {METHODS[payment.method]?.label || payment.method}
                        </span>
                        <span className="text-sm text-slate-500">
                          {formatJobDate(payment.paid_on)}
                        </span>
                      </span>
                      {payment.note ? (
                        <span className="mt-1 block truncate text-sm text-slate-700">
                          {payment.note}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-bold tabular-nums">
                      {formatMoney(payment.amount)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {result.list.length ? (
            <p className="mt-2 text-center text-xs text-slate-500">
              Tap a payment to change or delete it.
            </p>
          ) : null}
        </>
      )}
    </WindowsFrame>
  );
}