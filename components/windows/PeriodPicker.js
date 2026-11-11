"use client";

import { todayIso } from "../../lib/windows";
import { locale, translate as tr, useLang } from "../../lib/windowsLang";

// ============================================================
// Periods. Weeks run Monday to Sunday.
// ============================================================

export function toIso(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function fromIso(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const date = fromIso(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

export function mondayOf(iso) {
  const date = fromIso(iso);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return toIso(date);
}

function short(iso, withYear = false) {
  return fromIso(iso).toLocaleDateString(locale(), {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function weekRangeText(start, end) {
  const a = fromIso(start);
  const b = fromIso(end);
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${short(end, true)}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${short(start)} – ${short(end, true)}`;
  }
  return `${short(start, true)} – ${short(end, true)}`;
}

/**
 * offset 0 = this week / month / year, -1 = the one before, and so on.
 */
export function periodFor(mode, offset = 0, custom = {}) {
  const today = todayIso();

  if (mode === "week") {
    const start = addDays(mondayOf(today), offset * 7);
    const end = addDays(start, 6);
    const label =
      offset === 0 ? tr("period.thisWeek") : offset === -1 ? tr("period.lastWeek") : tr("period.weekOf", { date: short(start) });
    return { start, end, label, sub: weekRangeText(start, end) };
  }

  if (mode === "month") {
    const now = fromIso(today);
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const name = first.toLocaleDateString(locale(), { month: "long", year: "numeric" });
    return {
      start: toIso(first),
      end: toIso(last),
      label: offset === 0 ? tr("period.thisMonth") : offset === -1 ? tr("period.lastMonth") : name,
      sub: name,
    };
  }

  if (mode === "year") {
    const year = fromIso(today).getFullYear() + offset;
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      label: offset === 0 ? tr("period.thisYear") : String(year),
      sub: tr("period.janDec", { year }),
    };
  }

  const a = custom.from || today;
  const b = custom.to || today;
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  return {
    start,
    end,
    label: tr("period.yourDates"),
    sub: `${short(start, true)} – ${short(end, true)}`,
  };
}

const MODES = [
  { id: "week", key: "period.week" },
  { id: "month", key: "period.month" },
  { id: "year", key: "period.year" },
  { id: "custom", key: "period.dates" },
];

/**
 * Week / Month / Year / Dates, with arrows to step back and forward.
 */
export default function PeriodPicker({ value, onChange }) {
  const { t } = useLang();
  const { mode, offset, from, to } = value;
  const period = periodFor(mode, offset, { from, to });

  const field =
    "w-full rounded-lg border border-[#C9D6D6] bg-white px-3 py-2.5 text-base focus:border-[#0F766E] focus:outline-none focus:ring-2 focus:ring-[#0F766E]/25";

  return (
    <div>
      <div
        role="tablist"
        aria-label={t("period.label")}
        className="grid grid-cols-4 rounded-xl bg-[#DCE7E7] p-1"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() =>
              onChange({
                ...value,
                mode: m.id,
                offset: 0,
                from: from || period.start,
                to: to || period.end,
              })
            }
            className={`rounded-lg py-2 text-sm font-bold transition ${
              mode === m.id
                ? "bg-white text-[#13232E] shadow-sm"
                : "text-slate-600 hover:text-[#13232E]"
            }`}
          >
            {t(m.key)}
          </button>
        ))}
      </div>

      {mode === "custom" ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label>
            <span className="mb-1 block text-sm font-semibold">{t("period.from")}</span>
            <input
              type="date"
              value={from}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className={field}
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-semibold">{t("period.to")}</span>
            <input
              type="date"
              value={to}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className={field}
            />
          </label>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...value, offset: offset - 1 })}
            aria-label={t("period.previous")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#C9D6D6] bg-white text-xl font-bold text-[#13232E] active:bg-slate-100"
          >
            ‹
          </button>

          <div className="min-w-0 text-center">
            <p className="text-lg font-bold leading-tight">{period.label}</p>
            <p className="text-sm text-slate-500">{period.sub}</p>
          </div>

          <button
            type="button"
            onClick={() => onChange({ ...value, offset: offset + 1 })}
            disabled={offset >= 0}
            aria-label={t("period.next")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#C9D6D6] bg-white text-xl font-bold text-[#13232E] active:bg-slate-100 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      )}

      {mode !== "custom" && offset !== 0 ? (
        <button
          type="button"
          onClick={() => onChange({ ...value, offset: 0 })}
          className="mx-auto mt-1 block text-sm font-semibold text-[#0F766E]"
        >
          {t(mode === "week" ? "period.backWeek" : mode === "month" ? "period.backMonth" : "period.backYear")}
        </button>
      ) : null}
    </div>
  );
}