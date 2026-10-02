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