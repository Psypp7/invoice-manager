"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../../../lib/supabase";

function clean(value) {
  return String(value ?? "").trim();
}

function normaliseName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseInvoiceNumber(value) {
  return clean(value)
    .toUpperCase()
    .replace(/\s+/g, "");
}

function validInvoiceNumber(value) {
  return /^RL\d{4,}$/.test(
    normaliseInvoiceNumber(value)
  );
}

function parseAmount(value) {
  const number = Number(
    clean(value)
      .replace(/£/g, "")
      .replace(/,/g, "")
  );

  return Number.isFinite(number)
    ? number
    : 0;
}

function getYearFromDescription(description) {
  const match = clean(description).match(
    /\b\d{1,2}\/\d{1,2}\/(\d{4})\b/
  );

  return match ? Number(match[1]) : 2026;
}

function parseSpreadsheetDate(value, description) {
  if (value instanceof Date) {
    // Use the local calendar parts directly.
    // Do NOT use toISOString(), because converting a UK/BST midnight
    // value to UTC can move the date back by one day.
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    const parsed =
      XLSX.SSF.parse_date_code(value);

    if (
      parsed &&
      parsed.y &&
      parsed.m &&
      parsed.d
    ) {
      return [
        parsed.y,
        String(parsed.m).padStart(2, "0"),
        String(parsed.d).padStart(2, "0"),
      ].join("-");
    }
  }

  const text = clean(value);
  const year =
    getYearFromDescription(description);

  const numeric = text.match(
    /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/
  );

  if (numeric) {
    const parsedYear = numeric[3]
      ? Number(
          numeric[3].length === 2
            ? `20${numeric[3]}`
            : numeric[3]
        )
      : year;

    return [
      parsedYear,
      String(Number(numeric[2])).padStart(2, "0"),
      String(Number(numeric[1])).padStart(2, "0"),
    ].join("-");
  }

  const monthNames = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };

  const named = text.match(
    /^(\d{1,2})[-\s]([A-Za-z]{3,9})(?:[-\s](\d{2,4}))?$/
  );

  if (named) {
    const month =
      monthNames[
        named[2].slice(0, 3).toLowerCase()
      ];

    if (month) {
      const parsedYear = named[3]
        ? Number(
            named[3].length === 2
              ? `20${named[3]}`
              : named[3]
          )
        : year;

      return [
        parsedYear,
        String(month).padStart(2, "0"),
        String(Number(named[1])).padStart(2, "0"),
      ].join("-");
    }
  }

  return "";
}

function extractAddressFromDescription(description) {
  const text = clean(description);

  if (!text) {
    return {
      address_line_1: "",
      address_line_2: "",
      city: "",
      postcode: "",
    };
  }

  // The report descriptions consistently use "... at <property address>".
  const atMatches = [...text.matchAll(/\s+at\s+/gi)];
  const addressText = atMatches.length
    ? text.slice(
        atMatches[atMatches.length - 1].index +
          atMatches[atMatches.length - 1][0].length
      )
    : text;

  const parts = addressText
    .replace(/[.;\s]+$/, "")
    .split(",")
    .map((part) => clean(part))
    .filter(Boolean);

  const postcodePattern =
    /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i;

  let postcode = "";
  let postcodeIndex = -1;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const match = parts[index].match(postcodePattern);

    if (match) {
      postcode = match[0]
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim();

      parts[index] = clean(
        parts[index].replace(match[0], "")
      );

      postcodeIndex = index;
      break;
    }
  }

  if (postcodeIndex >= 0 && !parts[postcodeIndex]) {
    parts.splice(postcodeIndex, 1);
  }

  const city =
    parts.length >= 2
      ? parts.pop()
      : "";

  let addressLine1 = "";
  let addressLine2 = "";

  const firstPart =
    parts[0] || "";

  const isFlatOrUnitPrefix =
    /^(flat|apartment|apt|unit|room|studio|suite)\b/i.test(
      firstPart
    );

  if (
    isFlatOrUnitPrefix &&
    parts.length >= 2
  ) {
    addressLine1 = [
      parts[0],
      parts[1],
    ]
      .filter(Boolean)
      .join(", ");

    addressLine2 = parts
      .slice(2)
      .join(", ");
  } else {
    addressLine1 =
      parts.shift() || "";

    addressLine2 =
      parts.join(", ");
  }

  return {
    address_line_1: addressLine1,
    address_line_2: addressLine2,
    city,
    postcode,
  };
}

function proposedLandlordName(value) {
  return clean(value);
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function rowProblem(row) {
  if (!validInvoiceNumber(row.invoice_number)) {
    return "Invalid invoice number";
  }

  if (!row.issue_date) {
    return "Invalid date";
  }

  if (!row.client_text) {
    return "Missing client";
  }

  if (!row.description) {
    return "Missing description";
  }

  if (Number(row.selected_amount) <= 0) {
    return "Invalid amount";
  }

  if (
    !row.client_id &&
    !row.create_landlord
  ) {
    return "Select a client or create landlord";
  }

  if (
    row.create_landlord &&
    !clean(row.new_client_name)
  ) {
    return "Landlord name is required";
  }

  if (
    row.create_landlord &&
    !clean(row.new_client_address_line_1)
  ) {
    return "Property address is required";
  }

  if (
    row.create_landlord &&
    !clean(row.new_client_postcode)
  ) {
    return "Postcode is required";
  }

  return "";
}

export default function ImportInvoicesPage() {
  const [business, setBusiness] =
    useState(null);
  const [clients, setClients] =
    useState([]);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] =
    useState("");
  const [message, setMessage] =
    useState("");
  const [loading, setLoading] =
    useState(false);
  const [importing, setImporting] =
    useState(false);

  const [activeInvoiceNumbers, setActiveInvoiceNumbers] =
    useState(new Set());

  const [deletedInvoiceMap, setDeletedInvoiceMap] =
    useState(new Map());

  const importableRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.selected &&
          !rowProblem(row)
      ),
    [rows]
  );

  async function ensureBusinessAndClients() {
    if (business?.id && clients.length) {
      return {
        businessData: business,
        clientData: clients,
      };
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error(
        "You must sign in before importing invoices."
      );
    }

    const {
      data: businessData,
      error: businessError,
    } = await supabase
      .from("businesses")
      .select(
        "id, business_name, default_vat_rate"
      )
      .eq("owner_user_id", user.id)
      .single();

    if (businessError) {
      throw businessError;
    }

    const {
      data: clientData,
      error: clientsError,
    } = await supabase
      .from("clients")
      .select(
        `
          id,
          name,
          company_name,
          email,
          address_line_1,
          address_line_2,
          city,
          county,
          postcode,
          client_type
        `
      )
      .eq("business_id", businessData.id)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (clientsError) {
      throw clientsError;
    }

    setBusiness(businessData);
    setClients(clientData || []);

    return {
      businessData,
      clientData: clientData || [],
    };
  }

  function matchClient(clientText, clientData) {
    const target =
      normaliseName(clientText);

    if (!target) return null;

    return (
      clientData.find(
        (client) =>
          normaliseName(client.company_name) ===
            target ||
          normaliseName(client.name) === target
      ) ||
      clientData.find((client) => {
        const company = normaliseName(
          client.company_name
        );
        const name = normaliseName(
          client.name
        );

        return (
          (company &&
            (company.includes(target) ||
              target.includes(company))) ||
          (name &&
            (name.includes(target) ||
              target.includes(name)))
        );
      }) ||
      null
    );
  }

  async function checkInvoiceNumbers(
    businessId,
    invoiceNumbers
  ) {
    if (!invoiceNumbers.length) {
      return {
        activeNumbers: new Set(),
        deletedMap: new Map(),
      };
    }

    const { data, error } = await supabase
      .from("invoices")
      .select(
        "id, invoice_number, deleted_at"
      )
      .eq("business_id", businessId)
      .in("invoice_number", invoiceNumbers);

    if (error) {
      throw error;
    }

    const activeNumbers = new Set();
    const deletedMap = new Map();

    for (const invoice of data || []) {
      const number = normaliseInvoiceNumber(
        invoice.invoice_number
      );

      if (!number) continue;

      if (invoice.deleted_at) {
        deletedMap.set(number, invoice.id);
      } else {
        activeNumbers.add(number);
      }
    }

    return {
      activeNumbers,
      deletedMap,
    };
  }

  async function readSpreadsheet(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    setLoading(true);
    setMessage("");
    setRows([]);
    setFileName(file.name);

    try {
      const {
        businessData,
        clientData,
      } = await ensureBusinessAndClients();

      const arrayBuffer =
        await file.arrayBuffer();

      const workbook = XLSX.read(arrayBuffer, {
        type: "array",

        // Keep spreadsheet dates as Excel/ODS serial values where possible.
        // This avoids JavaScript timezone conversion entirely.
        cellDates: false,
      });

      const sheetName =
        workbook.SheetNames[0];

      if (!sheetName) {
        throw new Error(
          "The spreadsheet has no worksheets."
        );
      }

      const worksheet =
        workbook.Sheets[sheetName];

      const rawRows =
        XLSX.utils.sheet_to_json(
          worksheet,
          {
            header: 1,
            raw: true,
            defval: "",
          }
        );

      const parsed = rawRows
        .map((cells, index) => {
          const invoiceNumber =
            normaliseInvoiceNumber(
              cells[0]
            );

          const description =
            clean(cells[3]);

          // Column E is Right Inventories' own earnings.
          const internalAmount =
            parseAmount(cells[4]);

          // When Column F contains a value, that is the amount shown
          // on the customer invoice. Otherwise Column E is used.
          const columnFInvoiceAmount =
            parseAmount(cells[5]);

          const invoiceAmount =
            columnFInvoiceAmount > 0
              ? columnFInvoiceAmount
              : internalAmount;

          const agencyCommission =
            Math.max(
              0,
              Number(
                (invoiceAmount - internalAmount).toFixed(2)
              )
            );

          const clientText =
            clean(cells[2]);

          const matchedClient =
            matchClient(
              clientText,
              clientData
            );

          const parsedAddress =
            extractAddressFromDescription(
              description
            );

          return {
            id: `${index}-${invoiceNumber}`,
            source_row: index + 1,
            invoice_number:
              invoiceNumber,
            issue_date:
              parseSpreadsheetDate(
                cells[1],
                description
              ),
            client_text: clientText,
            client_id:
              matchedClient?.id || "",

            // When no existing client matches, default to creating a landlord.
            create_landlord:
              !matchedClient,

            new_client_name:
              proposedLandlordName(
                clientText
              ),

            new_client_address_line_1:
              parsedAddress.address_line_1,

            new_client_address_line_2:
              parsedAddress.address_line_2,

            new_client_city:
              parsedAddress.city,

            new_client_postcode:
              parsedAddress.postcode,

            description,
            internal_amount:
              internalAmount,
            invoice_amount:
              invoiceAmount,
            agency_commission:
              agencyCommission,
            selected_amount:
              invoiceAmount,
            selected: false,
            active_duplicate: false,
            deleted_invoice_id: null,
          };
        })
        .filter(
          (row) =>
            row.invoice_number ||
            row.client_text ||
            row.description ||
            row.selected_amount
        );

      const {
        activeNumbers,
        deletedMap,
      } = await checkInvoiceNumbers(
        businessData.id,
        parsed
          .map((row) => row.invoice_number)
          .filter(Boolean)
      );

      setActiveInvoiceNumbers(activeNumbers);
      setDeletedInvoiceMap(deletedMap);

      setRows(
        parsed.map((row) => ({
          ...row,
          active_duplicate:
            activeNumbers.has(
              row.invoice_number
            ),
          deleted_invoice_id:
            deletedMap.get(
              row.invoice_number
            ) || null,

          // Nothing is selected automatically.
          selected: false,
        }))
      );

      setMessage(
        `${parsed.length} spreadsheet rows loaded. Nothing has been selected automatically.`
      );
    } catch (error) {
      console.error(error);
      setMessage(
        error?.message ||
          "The spreadsheet could not be read."
      );
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  function updateRow(id, changes) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) {
          return row;
        }

        const updated = {
          ...row,
          ...changes,
        };

        if (
          Object.prototype.hasOwnProperty.call(
            changes,
            "client_id"
          )
        ) {
          updated.create_landlord =
            !changes.client_id;
        }

        if (
          Object.prototype.hasOwnProperty.call(
            changes,
            "create_landlord"
          )
        ) {
          if (changes.create_landlord) {
            updated.client_id = "";
          }
        }

        if (
          Object.prototype.hasOwnProperty.call(
            changes,
            "invoice_number"
          )
        ) {
          const invoiceNumber =
            normaliseInvoiceNumber(
              changes.invoice_number
            );

          updated.invoice_number =
            invoiceNumber;

          updated.active_duplicate =
            activeInvoiceNumbers.has(
              invoiceNumber
            );

          updated.deleted_invoice_id =
            deletedInvoiceMap.get(
              invoiceNumber
            ) || null;

        }

        return updated;
      })
    );
  }

  function selectOnlyNewInvoices() {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        selected: !rowProblem(row),
      }))
    );

    setMessage(
      "Selected all valid spreadsheet invoices. Existing invoices will be updated and new invoices will be created."
    );
  }

  function clearAllSelections() {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        selected: false,
      }))
    );

    setMessage(
      "All selections cleared. You can now tick the rows yourself."
    );
  }

  async function getOrCreateLandlord(
    row,
    createdClientCache = new Map()
  ) {
    if (row.client_id) {
      const existingClient = clients.find(
        (client) =>
          client.id === row.client_id
      );

      if (!existingClient) {
        throw new Error(
          "The selected client could not be found."
        );
      }

      return existingClient;
    }

    if (!row.create_landlord) {
      throw new Error(
        "Select a client or create a landlord."
      );
    }

    const targetName =
      normaliseName(
        row.new_client_name
      );

    const cachedClient =
      createdClientCache.get(
        targetName
      );

    if (cachedClient) {
      return cachedClient;
    }

    const existingLandlord = clients.find(
      (client) =>
        normaliseName(
          client.company_name
        ) === targetName ||
        normaliseName(client.name) ===
          targetName
    );

    if (existingLandlord) {
      return existingLandlord;
    }

    const payload = {
      business_id: business.id,
      name: clean(
        row.new_client_name
      ),
      company_name: null,
      email: null,
      phone: null,
      client_type: "landlord",
      address_line_1: clean(
        row.new_client_address_line_1
      ),
      address_line_2:
        clean(
          row.new_client_address_line_2
        ) || null,
      city:
        clean(row.new_client_city) ||
        null,
      county: null,
      postcode: clean(
        row.new_client_postcode
      ).toUpperCase(),
      payment_terms_days: null,
      is_active: true,
    };

    const {
      data: createdClient,
      error,
    } = await supabase
      .from("clients")
      .insert(payload)
      .select(
        `
          id,
          name,
          company_name,
          email,
          address_line_1,
          address_line_2,
          city,
          county,
          postcode,
          client_type
        `
      )
      .single();

    if (error) {
      throw error;
    }

    createdClientCache.set(
      targetName,
      createdClient
    );

    setClients((current) => [
      ...current,
      createdClient,
    ]);

    return createdClient;
  }

  function buildClientAddress(client) {
    return [
      client.address_line_1,
      client.address_line_2,
      client.city,
      client.county,
      client.postcode,
    ]
      .filter(Boolean)
      .join(", ");
  }

  async function importInvoices() {
    if (!business?.id) {
      setMessage(
        "Your business could not be identified."
      );
      return;
    }

    if (!importableRows.length) {
      setMessage(
        "There are no valid selected rows to import."
      );
      return;
    }

    const confirmed = window.confirm(
      `Import ${importableRows.length} invoices?`
    );

    if (!confirmed) return;

    setImporting(true);
    setMessage("");

    let imported = 0;
    const errors = [];
    const createdClientCache =
      new Map();

    try {
      for (const row of importableRows) {
        try {
          const client =
            await getOrCreateLandlord(
              row,
              createdClientCache
            );

          const amount = Number(
            row.invoice_amount ||
              row.selected_amount ||
              0
          );

          const internalAmount = Number(
            row.internal_amount || amount
          );

          const agencyCommission = Number(
            row.agency_commission ??
              Math.max(0, amount - internalAmount)
          );

          const invoicePayload = {
            invoice_number:
              row.invoice_number,
            business_id: business.id,
            client_id: client.id,
            property_id: null,
            issue_date: row.issue_date,
            supply_date: null,
            due_date: null,
            status: "unpaid",
            currency: "GBP",
            subtotal: amount,
            vat_total: 0,
            total: amount,
            internal_amount: Number(
              internalAmount.toFixed(2)
            ),
            agency_commission: Number(
              agencyCommission.toFixed(2)
            ),
            amount_paid: 0,
            balance_due: amount,
            customer_name:
              client.company_name ||
              client.name,
            customer_email:
              client.email || null,
            customer_address:
              buildClientAddress(
                client
              ) || null,
            notes: null,
            payment_terms: null,
            paid_at: null,
            deleted_at: null,
            deletion_reason: null,
            updated_at:
              new Date().toISOString(),
          };

          let createdInvoice;
          let replacedExistingItems = false;

          if (row.active_duplicate) {
            const {
              data: existingInvoice,
              error: existingInvoiceError,
            } = await supabase
              .from("invoices")
              .select("id")
              .eq("business_id", business.id)
              .eq(
                "invoice_number",
                row.invoice_number
              )
              .is("deleted_at", null)
              .maybeSingle();

            if (existingInvoiceError) {
              throw existingInvoiceError;
            }

            if (!existingInvoice?.id) {
              throw new Error(
                `${row.invoice_number} was marked as existing but could not be found. Reload the spreadsheet and try again.`
              );
            }

            const {
              data: updatedInvoice,
              error: updateError,
            } = await supabase
              .from("invoices")
              .update(invoicePayload)
              .eq("id", existingInvoice.id)
              .eq("business_id", business.id)
              .select("id")
              .single();

            if (updateError) {
              throw updateError;
            }

            const {
              error: oldItemsError,
            } = await supabase
              .from("invoice_items")
              .delete()
              .eq(
                "invoice_id",
                existingInvoice.id
              );

            if (oldItemsError) {
              throw oldItemsError;
            }

            createdInvoice = updatedInvoice;
            replacedExistingItems = true;
          } else if (row.deleted_invoice_id) {
            const {
              data: restoredInvoice,
              error: restoreError,
            } = await supabase
              .from("invoices")
              .update(invoicePayload)
              .eq(
                "id",
                row.deleted_invoice_id
              )
              .eq(
                "business_id",
                business.id
              )
              .select("id")
              .single();

            if (restoreError) {
              throw restoreError;
            }

            const {
              error: oldItemsError,
            } = await supabase
              .from("invoice_items")
              .delete()
              .eq(
                "invoice_id",
                row.deleted_invoice_id
              );

            if (oldItemsError) {
              throw oldItemsError;
            }

            createdInvoice = restoredInvoice;
            replacedExistingItems = true;
          } else {
            const {
              data: insertedInvoice,
              error: invoiceError,
            } = await supabase
              .from("invoices")
              .insert(invoicePayload)
              .select("id")
              .single();

            if (invoiceError) {
              throw invoiceError;
            }

            createdInvoice = insertedInvoice;
          }

          const { error: itemError } =
            await supabase
              .from("invoice_items")
              .insert({
                invoice_id:
                  createdInvoice.id,
                description:
                  row.description,
                quantity: 1,
                unit_price: amount,
                vat_rate: 0,
                line_subtotal: amount,
                line_vat: 0,
                line_total: amount,
                sort_order: 0,
              });

          if (itemError) {
            if (
              !row.deleted_invoice_id &&
              !row.active_duplicate &&
              !replacedExistingItems
            ) {
              await supabase
                .from("invoices")
                .delete()
                .eq(
                  "id",
                  createdInvoice.id
                );
            }

            throw itemError;
          }

          imported += 1;

          setActiveInvoiceNumbers(
            (current) => {
              const next = new Set(current);
              next.add(row.invoice_number);
              return next;
            }
          );

          updateRow(row.id, {
            selected: false,
            active_duplicate: true,
            deleted_invoice_id: null,
          });
        } catch (rowError) {
          console.error(
            "Import row error:",
            rowError
          );

          errors.push(
            `${row.invoice_number}: ${
              rowError?.message ||
              "Import failed"
            }`
          );
        }
      }

      try {
        await supabase.rpc(
          "sync_rl_invoice_sequence"
        );
      } catch (syncError) {
        console.error(
          "Sequence sync error:",
          syncError
        );
      }

      setMessage(
        errors.length
          ? `${imported} invoices imported. ${errors.length} rows failed: ${errors.join(
              " | "
            )}`
          : `${imported} invoices imported successfully.`
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold">
            Import invoices
          </h1>

          <p className="mt-2 text-slate-500">
            Upload your Right Inventories
            spreadsheet and create the RL
            invoices automatically.
          </p>
        </div>

        <Link
          href="/invoices"
          className="rounded-lg border border-slate-300 px-5 py-3 font-semibold"
        >
          Back to invoices
        </Link>
      </header>

      {message && (
        <div className="mt-6 rounded-lg bg-white p-4 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      )}

      <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">
          Select spreadsheet
        </h2>

        <p className="mt-2 text-sm text-slate-500">
          Accepted formats: ODS, XLSX and
          XLS. The importer reads columns
          A–F in the same layout as your
          current spreadsheet.
        </p>

        <input
          type="file"
          accept=".ods,.xlsx,.xls"
          onChange={readSpreadsheet}
          disabled={loading || importing}
          className="mt-5 block w-full rounded-lg border border-slate-300 px-4 py-3"
        />

        {fileName && (
          <p className="mt-3 text-sm text-slate-500">
            Loaded: {fileName}
          </p>
        )}
      </section>

      {rows.length > 0 && (
        <section className="mt-8 overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-bold">
                Import preview
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {importableRows.length} valid
                selected rows are ready.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={selectOnlyNewInvoices}
                disabled={importing}
                className="rounded-lg border border-green-600 px-5 py-3 font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50"
              >
                Select all valid invoices
              </button>

              <button
                type="button"
                onClick={clearAllSelections}
                disabled={importing}
                className="rounded-lg border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-50 disabled:opacity-50"
              >
                Clear all selections
              </button>

              <button
              type="button"
              onClick={importInvoices}
              disabled={
                importing ||
                importableRows.length === 0
              }
              className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {importing
                ? "Importing..."
                : `Import ${importableRows.length} invoices`}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1850px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3">
                    Import
                  </th>
                  <th className="px-4 py-3">
                    Invoice
                  </th>
                  <th className="px-4 py-3">
                    Date
                  </th>
                  <th className="px-4 py-3">
                    Spreadsheet client
                  </th>
                  <th className="px-4 py-3">
                    Client in app
                  </th>
                  <th className="px-4 py-3">
                    Description
                  </th>
                  <th className="px-4 py-3">
                    My money
                  </th>
                  <th className="px-4 py-3">
                    Invoice total
                  </th>
                  <th className="px-4 py-3">
                    Other company
                  </th>
                  <th className="px-4 py-3">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const problem =
                    rowProblem(row);

                  return (
                    <tr
                      key={row.id}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(event) =>
                            updateRow(row.id, {
                              selected:
                                event.target
                                  .checked,
                            })
                          }
                        />
                      </td>

                      <td className="px-4 py-3">
                        <input
                          value={
                            row.invoice_number
                          }
                          onChange={(event) =>
                            updateRow(row.id, {
                              invoice_number:
                                normaliseInvoiceNumber(
                                  event.target
                                    .value
                                ),
                            })
                          }
                          className="w-28 rounded border border-slate-300 px-2 py-2 uppercase"
                        />
                      </td>

                      <td className="px-4 py-3">
                        <input
                          type="date"
                          value={row.issue_date}
                          onChange={(event) =>
                            updateRow(row.id, {
                              issue_date:
                                event.target
                                  .value,
                            })
                          }
                          className="rounded border border-slate-300 px-2 py-2"
                        />
                      </td>

                      <td className="px-4 py-3 font-medium">
                        {row.client_text ||
                          "—"}
                      </td>

                      <td className="px-4 py-3">
                        <div className="w-80 space-y-3">
                          <select
                            value={
                              row.create_landlord
                                ? "__new_landlord__"
                                : row.client_id
                            }
                            onChange={(event) => {
                              const value =
                                event.target.value;

                              if (
                                value ===
                                "__new_landlord__"
                              ) {
                                updateRow(row.id, {
                                  create_landlord:
                                    true,
                                  client_id: "",
                                });
                              } else {
                                updateRow(row.id, {
                                  create_landlord:
                                    false,
                                  client_id: value,
                                });
                              }
                            }}
                            className="w-full rounded border border-slate-300 px-3 py-2"
                          >
                            <option value="">
                              Select existing client
                            </option>

                            <option value="__new_landlord__">
                              + Create new landlord
                            </option>

                            {clients.map(
                              (client) => (
                                <option
                                  key={
                                    client.id
                                  }
                                  value={
                                    client.id
                                  }
                                >
                                  {client.company_name
                                    ? `${client.company_name} — ${client.name}`
                                    : client.name}
                                </option>
                              )
                            )}
                          </select>

                          {row.create_landlord && (
                            <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                                New landlord
                              </p>

                              <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-600">
                                  Landlord name
                                </label>

                                <input
                                  value={
                                    row.new_client_name
                                  }
                                  onChange={(event) =>
                                    updateRow(
                                      row.id,
                                      {
                                        new_client_name:
                                          event
                                            .target
                                            .value,
                                      }
                                    )
                                  }
                                  className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-600">
                                  Address line 1
                                </label>

                                <input
                                  value={
                                    row.new_client_address_line_1
                                  }
                                  onChange={(event) =>
                                    updateRow(
                                      row.id,
                                      {
                                        new_client_address_line_1:
                                          event
                                            .target
                                            .value,
                                      }
                                    )
                                  }
                                  placeholder="Flat 4, Skellen Lodge"
                                  className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-600">
                                  Address line 2
                                </label>

                                <input
                                  value={
                                    row.new_client_address_line_2
                                  }
                                  onChange={(event) =>
                                    updateRow(
                                      row.id,
                                      {
                                        new_client_address_line_2:
                                          event
                                            .target
                                            .value,
                                      }
                                    )
                                  }
                                  placeholder="Optional"
                                  className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                                    City
                                  </label>

                                  <input
                                    value={
                                      row.new_client_city
                                    }
                                    onChange={(event) =>
                                      updateRow(
                                        row.id,
                                        {
                                          new_client_city:
                                            event
                                              .target
                                              .value,
                                        }
                                      )
                                    }
                                    placeholder="London"
                                    className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                                  />
                                </div>

                                <div>
                                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                                    Postcode
                                  </label>

                                  <input
                                    value={
                                      row.new_client_postcode
                                    }
                                    onChange={(event) =>
                                      updateRow(
                                        row.id,
                                        {
                                          new_client_postcode:
                                            event
                                              .target
                                              .value
                                              .toUpperCase(),
                                        }
                                      )
                                    }
                                    placeholder="SE1 6PU"
                                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 uppercase"
                                  />
                                </div>
                              </div>

                              <div className="rounded bg-white p-3 text-sm">
                                <p className="font-semibold">
                                  Invoice address preview
                                </p>

                                <p className="mt-2">
                                  {row.new_client_name ||
                                    "Landlord name"}
                                </p>

                                <p>
                                  {row.new_client_address_line_1 ||
                                    "Address line 1"}
                                </p>

                                {row.new_client_address_line_2 && (
                                  <p>
                                    {
                                      row.new_client_address_line_2
                                    }
                                  </p>
                                )}

                                {row.new_client_city && (
                                  <p>
                                    {
                                      row.new_client_city
                                    }
                                  </p>
                                )}

                                {row.new_client_postcode && (
                                  <p>
                                    {
                                      row.new_client_postcode
                                    }
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <textarea
                          value={
                            row.description
                          }
                          onChange={(event) =>
                            updateRow(row.id, {
                              description:
                                event.target
                                  .value,
                            })
                          }
                          rows={4}
                          className="w-96 resize-y rounded border border-slate-300 px-3 py-2"
                        />
                      </td>

                      <td className="px-4 py-3 font-semibold text-green-700">
                        {formatMoney(
                          row.internal_amount
                        )}
                      </td>

                      <td className="px-4 py-3 font-semibold">
                        {formatMoney(
                          row.invoice_amount
                        )}
                      </td>

                      <td className="px-4 py-3 font-semibold text-purple-700">
                        {formatMoney(
                          row.agency_commission
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            problem
                              ? "bg-red-100 text-red-700"
                              : row.deleted_invoice_id
                                ? "bg-amber-100 text-amber-700"
                                : row.create_landlord
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-green-100 text-green-700"
                          }`}
                        >
                          {problem ||
                            (row.deleted_invoice_id
                              ? "Deleted copy will be restored"
                              : row.create_landlord
                                ? "New landlord will be created"
                                : "Ready")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
