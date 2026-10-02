/**
 * Which company is currently selected in the sidebar.
 *
 * The choice is stored in a cookie so that both the browser pages and
 * the API routes (email, bulk email, bulk download) agree on it.
 *
 * Right Inventories London is display_order 0, so it is the default
 * whenever nothing has been picked yet.
 */

export const ACTIVE_BUSINESS_COOKIE = "ri_active_business";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function readActiveBusinessId() {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) =>
      part.startsWith(`${ACTIVE_BUSINESS_COOKIE}=`)
    );

  if (!match) {
    return null;
  }

  return (
    decodeURIComponent(
      match.slice(ACTIVE_BUSINESS_COOKIE.length + 1)
    ) || null
  );
}

export function setActiveBusinessId(id) {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${ACTIVE_BUSINESS_COOKIE}=${encodeURIComponent(
    id || ""
  )}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

function withIdColumn(columns) {
  const text = String(columns || "id").trim();

  if (text === "*" || /(^|[\s,])id([\s,]|$)/.test(text)) {
    return text;
  }

  return `id, ${text}`;
}

/**
 * Every company the signed-in user owns, London first.
 */
export async function fetchMyBusinesses(
  supabase,
  userId,
  columns = "id, business_name, invoice_profile, display_order"
) {
  const result = await supabase
    .from("businesses")
    .select(withIdColumn(columns))
    .eq("owner_user_id", userId)
    .order("display_order", { ascending: true });

  // 42703 = column does not exist. That only happens if the code is
  // deployed before the Supabase migration has been run. Fall back to
  // the old single-company behaviour so nothing breaks in the meantime.
  if (result.error?.code === "42703") {
    const safeColumns = withIdColumn(columns)
      .split(",")
      .map((column) => column.trim())
      .filter(
        (column) =>
          column &&
          column !== "invoice_profile" &&
          column !== "display_order"
      )
      .join(", ");

    return supabase
      .from("businesses")
      .select(safeColumns || "id")
      .eq("owner_user_id", userId)
      .limit(1);
  }

  return result;
}

/**
 * Drop-in replacement for the old single-business lookup:
 *
 *   supabase.from("businesses").select(cols)
 *     .eq("owner_user_id", user.id).single()
 *
 * Returns { data, error } the same way. In API routes, pass the
 * cookie value as activeId because there is no document there.
 */
export async function fetchActiveBusiness(
  supabase,
  userId,
  columns = "id",
  activeId
) {
  const { data, error } = await fetchMyBusinesses(
    supabase,
    userId,
    columns
  );

  if (error) {
    return { data: null, error };
  }

  if (!data || data.length === 0) {
    return {
      data: null,
      error: new Error("Business not found."),
    };
  }

  const wantedId =
    activeId === undefined
      ? readActiveBusinessId()
      : activeId;

  const chosen =
    data.find((business) => business.id === wantedId) ||
    data[0];

  // Clients, agents and properties are shared by both companies.
  // They all live on the first company (Right Inventories London),
  // so they appear whichever company is selected.
  return {
    data: {
      ...chosen,
      client_book_id: data[0].id,
    },
    error: null,
  };
}

/**
 * Loads company details for the invoice PDF.
 *
 * Returns null for Right Inventories London, which keeps the exact
 * letterhead it has always had. Any other company gets its details
 * from Settings.
 */
export async function fetchInvoiceBranding(
  supabase,
  businessId
) {
  if (!businessId) {
    return null;
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id, business_name, invoice_profile")
    .eq("id", businessId)
    .maybeSingle();

  if (!business || business.invoice_profile !== "custom") {
    return null;
  }

  const { data: settingsRow } = await supabase
    .from("business_settings")
    .select("settings")
    .eq("business_id", businessId)
    .maybeSingle();

  const settings = settingsRow?.settings || {};
  const company = settings.company || {};
  const payment = settings.payment || {};

  const legalName =
    company.legal_name || business.business_name || "";

  const tradingName =
    company.trading_name || business.business_name || legalName;

  const cityLine = [company.city, company.postcode]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  return {
    brandLine: tradingName.toLowerCase(),
    legalName,
    addressLines: [
      company.address_line_1,
      company.address_line_2,
      cityLine,
    ]
      .map((line) => String(line || "").trim())
      .filter(Boolean),
    phone: String(company.phone || "").trim(),
    email: String(company.email || "").trim(),
    website: String(company.website || "").trim(),
    bankName: String(payment.bank_name || "").trim(),
    accountName: String(payment.account_name || "").trim(),
    sortCode: String(payment.sort_code || "").trim(),
    accountNumber: String(payment.account_number || "").trim(),
  };
}