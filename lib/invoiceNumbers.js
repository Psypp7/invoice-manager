/**
 * Right Inventories London invoice-number helpers.
 *
 * The SQL function get_next_rl_invoice_number() atomically reserves
 * the next RL number, preventing two invoices from receiving the same number.
 */

export async function getNextRlInvoiceNumber(supabase) {
  const { data, error } = await supabase.rpc(
    "get_next_rl_invoice_number"
  );

  if (error) {
    console.error("RL invoice-number error:", error);

    throw new Error(
      error.message ||
        "The next RL invoice number could not be generated."
    );
  }

  if (!data || typeof data !== "string") {
    throw new Error(
      "Supabase did not return a valid RL invoice number."
    );
  }

  return data.toUpperCase();
}

export function normaliseInvoiceNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function validateRlInvoiceNumber(value) {
  const number = normaliseInvoiceNumber(value);

  if (!/^RL\d{4,}$/.test(number)) {
    return {
      valid: false,
      message:
        "The invoice number must begin with RL and contain at least four digits, for example RL1045.",
    };
  }

  return {
    valid: true,
    value: number,
  };
}

/**
 * Call before inserting or updating an invoice.
 * It allows manual edits but prevents duplicate numbers.
 */
export async function ensureInvoiceNumberAvailable(
  supabase,
  invoiceNumber,
  currentInvoiceId = null
) {
  const validation = validateRlInvoiceNumber(invoiceNumber);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  let query = supabase
    .from("invoices")
    .select("id")
    .eq("invoice_number", validation.value)
    .limit(1);

  if (currentInvoiceId) {
    query = query.neq("id", currentInvoiceId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      error.message ||
        "The invoice number could not be checked."
    );
  }

  if (Array.isArray(data) && data.length > 0) {
    throw new Error(
      `Invoice number ${validation.value} is already in use.`
    );
  }

  return validation.value;
}
