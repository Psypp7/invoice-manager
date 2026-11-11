/**
 * M & P Windows: a separate app inside the same project.
 *
 * A login is an M & P Windows account when its Supabase app_metadata has
 * { "app": "mp_windows" }. app_metadata can only be set from Supabase
 * itself (not by the user), so it is safe to route on.
 */

export const WINDOWS_APP = "mp_windows";
export const WINDOWS_HOME = "/windows";
export const SURVEY_BUCKET = "mp-surveys";

// Used the first time the account opens the app. Editable on the
// Prices screen at any time.
export const STARTER_PRICES = [
  { name: "Window", price: 80 },
  { name: "Patio door", price: 100 },
];

export function isWindowsUser(user) {
  return user?.app_metadata?.app === WINDOWS_APP;
}

export function isWindowsPath(pathname) {
  return (
    pathname === WINDOWS_HOME ||
    pathname.startsWith(`${WINDOWS_HOME}/`)
  );
}

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

export function formatMoney(value) {
  return money.format(Number(value) || 0);
}

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function todayIso() {
  const now = new Date();
  const local = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  );
  return local.toISOString().slice(0, 10);
}

export function formatJobDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function jobTotal(items) {
  return roundMoney(
    (items || []).reduce(
      (sum, item) =>
        sum + (Number(item.price) || 0) * (Number(item.qty) || 0),
      0
    )
  );
}

function plural(name, qty) {
  if (qty === 1) return name;

  // "Patio (per panel)" -> "Patios (per panel)"
  const bracket = String(name).match(/^(.*?)(\s*\(.*\))$/);
  if (bracket) return `${plural(bracket[1], qty)}${bracket[2]}`;

  if (/(s|x|ch|sh)$/i.test(name)) return `${name}es`;
  return `${name}s`;
}

/** "3 Windows, 1 Patio door" */
export function itemsSummary(items) {
  return (items || [])
    .filter((item) => Number(item.qty) > 0)
    .map((item) => `${item.qty} ${plural(item.name, Number(item.qty))}`)
    .join(", ");
}

/**
 * Shrinks a phone photo before upload (phones produce 5 to 10 MB
 * images). Keeps it sharp enough to read a survey sheet.
 */
export async function compressImage(file, maxSide = 2000, quality = 0.85) {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });

    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );

    return blob || file;
  } catch {
    // Some browsers cannot decode every format (e.g. HEIC); upload as is.
    return file;
  }
}

/**
 * The account's price list, oldest first. Adds the starter prices the
 * first time, when the list is empty.
 */
export async function loadPriceList(supabase, userId) {
  const { data, error } = await supabase
    .from("mp_price_items")
    .select("id, name, price, sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  if (data.length > 0) return data;

  const { data: seeded, error: seedError } = await supabase
    .from("mp_price_items")
    .insert(
      STARTER_PRICES.map((item, index) => ({
        user_id: userId,
        name: item.name,
        price: item.price,
        sort_order: index,
      }))
    )
    .select("id, name, price, sort_order");

  if (seedError) throw seedError;

  return seeded;
}
/**
 * Works out what each job has been paid and what is still owed.
 *
 *  1. A payment linked to a job counts against that job.
 *  2. A payment with no job picked is taken off the oldest unpaid
 *     jobs first.
 *  3. Anything paid over a job's total moves on to the next oldest
 *     unpaid job, and whatever is left over at the end is credit.
 *
 * So the total still owed is always: work done minus money received.
 */
export function buildBalance(jobs, payments) {
  const ordered = [...(jobs || [])].sort(
    (a, b) =>
      String(a.job_date).localeCompare(String(b.job_date)) ||
      String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );

  const rows = ordered.map((job) => ({
    ...job,
    total: roundMoney(job.total),
    linked: 0,
    autoApplied: 0,
    paid: 0,
    left: 0,
    payments: [],
  }));

  const byId = new Map(rows.map((row) => [row.id, row]));
  let pool = 0;
  let unlinked = 0;
  let cash = 0;
  let bank = 0;

  for (const payment of payments || []) {
    const amount = Number(payment.amount) || 0;
    if (payment.method === "cash") cash += amount;
    else bank += amount;

    const row = payment.job_id ? byId.get(payment.job_id) : null;
    if (row) {
      row.linked += amount;
      row.payments.push(payment);
    } else {
      pool += amount;
      unlinked += amount;
    }
  }

  // Overpayments on a job join the pool.
  for (const row of rows) {
    if (row.linked > row.total) {
      pool += row.linked - row.total;
    }
  }

  for (const row of rows) {
    const covered = Math.min(row.linked, row.total);
    const gap = row.total - covered;
    const take = Math.min(gap, pool);

    row.autoApplied = roundMoney(take);
    pool -= take;
    row.paid = roundMoney(covered + take);
    row.left = roundMoney(Math.max(0, row.total - row.paid));
    row.linked = roundMoney(row.linked);
  }

  const workDone = roundMoney(rows.reduce((n, row) => n + row.total, 0));
  const received = roundMoney(cash + bank);

  return {
    jobs: rows,
    workDone,
    cash: roundMoney(cash),
    bank: roundMoney(bank),
    received,
    stillOwed: roundMoney(Math.max(0, workDone - received)),
    credit: roundMoney(Math.max(0, received - workDone)),
    unlinked: roundMoney(unlinked),
  };
}

export function daysAgo(iso) {
  if (!iso) return 0;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - then) / 86400000));
}