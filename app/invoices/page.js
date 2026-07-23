"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function emptyItem() {
  return {
    description: "",
    quantity: "1",
    unit_price: "",
    vat_rate: "0",
  };
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function invoiceNumberValue(invoiceNumber) {
  const match = String(invoiceNumber || "")
    .toUpperCase()
    .match(/(\d+)$/);

  return match ? Number(match[1]) : 0;
}

function getInvoiceDescription(invoice) {
  return (
    invoice.invoice_items?.[0]?.description ||
    ""
  ).trim();
}

function getReportType(description) {
  const text = String(description || "").trim();

  if (!text) return "Report";

  const lower = text.toLowerCase();

  if (lower.includes("check-in") || lower.includes("check in")) {
    return "Check-in report";
  }

  if (lower.includes("check-out") || lower.includes("check out")) {
    return "Check-out report";
  }

  if (lower.includes("midterm")) {
    return "Midterm inspection";
  }

  if (lower.includes("inventory")) {
    return "Inventory report";
  }

  if (lower.includes("inspection")) {
    return "Inspection report";
  }

  return (
    text
      .split(/\s+from\s+|\s+at\s+/i)[0]
      .trim() || "Report"
  );
}

function getPropertyDisplay(invoice) {
  if (invoice.property) {
    const propertyName = [
      invoice.property.property_name,
      invoice.property.address_line_1,
      invoice.property.postcode,
    ]
      .filter(Boolean)
      .join(", ");

    if (propertyName) {
      return {
        name: propertyName,
        reportType: getReportType(
          getInvoiceDescription(invoice)
        ),
      };
    }
  }

  const description =
    getInvoiceDescription(invoice);

  if (!description) {
    return {
      name: "—",
      reportType: "Report",
    };
  }

  const atMatches = [
    ...description.matchAll(/\s+at\s+/gi),
  ];

  const address = atMatches.length
    ? description
        .slice(
          atMatches[atMatches.length - 1].index +
            atMatches[atMatches.length - 1][0].length
        )
        .trim()
    : "";

  return {
    name: address || "—",
    reportType: getReportType(description),
  };
}

function daysBetween(startDate, endDate = getToday()) {
  if (!startDate) return 0;

  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);

  return Math.max(
    0,
    Math.floor((end.getTime() - start.getTime()) / 86400000)
  );
}

function paymentTimingText(invoice) {
  if (invoice.status === "paid") {
    const paidDate = invoice.paid_at
      ? String(invoice.paid_at).slice(0, 10)
      : "";

    return paidDate
      ? `Paid ${formatDate(paidDate)}`
      : "Paid";
  }

  if (invoice.status === "cancelled") {
    return "Cancelled";
  }

  if (invoice.status === "draft") {
    return "Draft";
  }

  const days = daysBetween(invoice.issue_date);

  if (days === 0) return "Unpaid today";
  if (days === 1) return "Unpaid for 1 day";

  return `Unpaid for ${days} days`;
}

function statusClasses(status) {
  switch (status) {
    case "paid":
      return "bg-green-100 text-green-700";

    case "overdue":
      return "bg-red-100 text-red-700";

    case "partially_paid":
      return "bg-purple-100 text-purple-700";

    case "cancelled":
      return "bg-slate-200 text-slate-600";

    case "draft":
      return "bg-blue-100 text-blue-700";

    default:
      return "bg-amber-100 text-amber-700";
  }
}

function displayStatus(invoice) {
  if (
    invoice.due_date &&
    !["paid", "cancelled", "draft"].includes(invoice.status) &&
    Number(invoice.balance_due) > 0 &&
    invoice.due_date < getToday()
  ) {
    return "overdue";
  }

  return invoice.status;
}

const initialForm = {
  client_id: "",
  property_id: "",
  issue_date: getToday(),
  use_due_date: false,
  due_date: "",
  status: "unpaid",
};

export default function InvoicesPage() {
  const [business, setBusiness] = useState(null);
  const [clients, setClients] = useState([]);
  const [properties, setProperties] = useState([]);
  const [invoices, setInvoices] = useState([]);

  const [form, setForm] = useState(initialForm);
  const [items, setItems] = useState([emptyItem()]);

  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [invoiceToDelete, setInvoiceToDelete] = useState(null);
  const [deleteStep, setDeleteStep] = useState(1);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    initialisePage();
  }, []);

  async function initialisePage() {
    setLoading(true);
    setMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must sign in before viewing invoices.");
      }

      const { data: businessData, error: businessError } =
        await supabase
          .from("businesses")
          .select(
            `
              id,
              business_name,
              default_payment_days,
              default_vat_rate,
              invoice_prefix
            `
          )
          .eq("owner_user_id", user.id)
          .single();

      if (businessError) {
        throw businessError;
      }

      setBusiness(businessData);

      setItems([
        {
          ...emptyItem(),
          vat_rate: String(
            businessData.default_vat_rate || 0
          ),
        },
      ]);

      await Promise.all([
        loadClients(businessData.id),
        loadProperties(businessData.id),
        loadInvoices(businessData.id),
      ]);
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message || "Could not load invoices."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadClients(businessId) {
    const { data, error } = await supabase
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
          payment_terms_days,
          client_type
        `
      )
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    setClients(data || []);
  }

  async function loadProperties(businessId) {
    const { data, error } = await supabase
      .from("properties")
      .select(
        `
          id,
          property_name,
          address_line_1,
          address_line_2,
          city,
          postcode,
          agent_client_id,
          landlord_client_id
        `
      )
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("address_line_1", { ascending: true });

    if (error) {
      throw error;
    }

    setProperties(data || []);
  }

  async function loadInvoices(businessId = business?.id) {
    if (!businessId) return;

    const { data, error } = await supabase
      .from("invoices")
      .select(
        `
          id,
          invoice_number,
          issue_date,
          due_date,
          paid_at,
          status,
          subtotal,
          vat_total,
          total,
          amount_paid,
          balance_due,
          customer_name,
          customer_email,
          created_at,
          deleted_at,
          deletion_reason,
          client:clients(
            id,
            name,
            company_name
          ),
          property:properties(
            id,
            property_name,
            address_line_1,
            postcode
          ),
          invoice_items(
            id,
            description,
            quantity,
            unit_price,
            vat_rate,
            line_total
          )
        `
      )
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const sortedInvoices = [...(data || [])].sort(
      (a, b) =>
        invoiceNumberValue(b.invoice_number) -
        invoiceNumberValue(a.invoice_number)
    );

    setInvoices(sortedInvoices);
  }

  function resetForm() {
    const defaultVat =
      business?.default_vat_rate || 0;

    setForm({
      client_id: "",
      property_id: "",
      issue_date: getToday(),
      use_due_date: false,
      due_date: "",
      status: "unpaid",
    });

    setItems([
      {
        ...emptyItem(),
        vat_rate: String(defaultVat),
      },
    ]);

    setShowForm(false);
    setMessage("");
  }

  function openForm() {
    resetForm();
    setShowForm(true);
  }

  function updateFormField(event) {
    const { name, value, type, checked } =
      event.target;

    setForm((current) => {
      if (name === "use_due_date") {
        return {
          ...current,
          use_due_date: checked,
          due_date: checked
            ? current.due_date ||
              addDays(current.issue_date, 14)
            : "",
        };
      }

      const updated = {
        ...current,
        [name]:
          type === "checkbox"
            ? checked
            : value,
      };

      if (
        name === "issue_date" &&
        current.use_due_date
      ) {
        updated.due_date = addDays(
          value,
          14
        );
      }

      return updated;
    });
  }

  function selectClient(event) {
    setForm((current) => ({
      ...current,
      client_id: event.target.value,
    }));
  }

  function updateItem(index, field, value) {
    setItems((currentItems) =>
      currentItems.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
    );
  }

  function addItem() {
    setItems((current) => [
      ...current,
      {
        ...emptyItem(),
        vat_rate: String(
          business?.default_vat_rate || 0
        ),
      },
    ]);
  }

  function removeItem(index) {
    if (items.length === 1) return;

    setItems((current) =>
      current.filter(
        (_, itemIndex) => itemIndex !== index
      )
    );
  }

  const calculatedItems = useMemo(() => {
    return items.map((item) => {
      const quantity = Number(
        item.quantity || 0
      );

      const unitPrice = Number(
        item.unit_price || 0
      );

      const vatRate = Number(
        item.vat_rate || 0
      );

      const lineSubtotal =
        quantity * unitPrice;

      const lineVat =
        lineSubtotal * (vatRate / 100);

      const lineTotal =
        lineSubtotal + lineVat;

      return {
        ...item,
        quantity,
        unitPrice,
        vatRate,
        lineSubtotal,
        lineVat,
        lineTotal,
      };
    });
  }, [items]);

  const totals = useMemo(() => {
    return calculatedItems.reduce(
      (currentTotals, item) => ({
        subtotal:
          currentTotals.subtotal +
          item.lineSubtotal,

        vat:
          currentTotals.vat +
          item.lineVat,

        total:
          currentTotals.total +
          item.lineTotal,
      }),
      {
        subtotal: 0,
        vat: 0,
        total: 0,
      }
    );
  }, [calculatedItems]);

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

  async function saveInvoice(event) {
    event.preventDefault();

    if (!business?.id) {
      setMessage(
        "Your business could not be identified."
      );

      return;
    }

    if (!form.client_id) {
      setMessage("Select a client.");
      return;
    }

    const invalidItem = calculatedItems.some(
      (item) =>
        !item.description.trim() ||
        item.quantity <= 0 ||
        item.unitPrice < 0
    );

    if (invalidItem) {
      setMessage(
        "Every invoice item needs a description, quantity and valid price."
      );

      return;
    }

    if (totals.total <= 0) {
      setMessage(
        "The invoice total must be greater than £0."
      );

      return;
    }

    setSaving(true);
    setMessage("");

    let createdInvoiceId = null;

    try {
      const selectedClient = clients.find(
        (client) =>
          client.id === form.client_id
      );

      if (!selectedClient) {
        throw new Error(
          "The selected client could not be found."
        );
      }

      const invoicePayload = {
        business_id: business.id,
        client_id: form.client_id,
        property_id:
          form.property_id || null,

        issue_date: form.issue_date,
        supply_date: null,
        due_date:
          form.use_due_date && form.due_date
            ? form.due_date
            : null,
        status: form.status,
        currency: "GBP",

        subtotal: Number(
          totals.subtotal.toFixed(2)
        ),

        vat_total: Number(
          totals.vat.toFixed(2)
        ),

        total: Number(
          totals.total.toFixed(2)
        ),

        // Manually-created invoices default to no outside-company commission.
        internal_amount: Number(
          totals.total.toFixed(2)
        ),
        agency_commission: 0,

        amount_paid:
          form.status === "paid"
            ? Number(
                totals.total.toFixed(2)
              )
            : 0,

        balance_due:
          form.status === "paid"
            ? 0
            : Number(
                totals.total.toFixed(2)
              ),

        customer_name:
          selectedClient.company_name ||
          selectedClient.name,

        customer_email:
          selectedClient.email || null,

        customer_address:
          buildClientAddress(
            selectedClient
          ) || null,
        notes: null,
        payment_terms:
          form.use_due_date && form.due_date
            ? `Payment due by ${form.due_date}`
            : null,

        paid_at:
          form.status === "paid"
            ? new Date().toISOString()
            : null,
      };

      const {
        data: createdInvoice,
        error: invoiceError,
      } = await supabase
        .from("invoices")
        .insert(invoicePayload)
        .select("id, invoice_number")
        .single();

      if (invoiceError) {
        throw invoiceError;
      }

      createdInvoiceId =
        createdInvoice.id;

      const itemPayloads =
        calculatedItems.map(
          (item, index) => ({
            invoice_id:
              createdInvoice.id,

            description:
              item.description.trim(),

            quantity: Number(
              item.quantity.toFixed(2)
            ),

            unit_price: Number(
              item.unitPrice.toFixed(2)
            ),

            vat_rate: Number(
              item.vatRate.toFixed(2)
            ),

            line_subtotal: Number(
              item.lineSubtotal.toFixed(2)
            ),

            line_vat: Number(
              item.lineVat.toFixed(2)
            ),

            line_total: Number(
              item.lineTotal.toFixed(2)
            ),

            sort_order: index,
          })
        );

      const { error: itemsError } =
        await supabase
          .from("invoice_items")
          .insert(itemPayloads);

      if (itemsError) {
        throw itemsError;
      }

      await loadInvoices(business.id);

      const invoiceNumber =
        createdInvoice.invoice_number;

      resetForm();

      setMessage(
        `${invoiceNumber} created successfully.`
      );
    } catch (error) {
      console.error(error);

      if (createdInvoiceId) {
        await supabase
          .from("invoices")
          .delete()
          .eq("id", createdInvoiceId);
      }

      setMessage(
        error?.message ||
          "The invoice could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  async function markAsPaid(invoice) {
    const confirmed = window.confirm(
      `Mark ${invoice.invoice_number} as paid?`
    );

    if (!confirmed) return;

    setMessage("");

    try {
      const { error } = await supabase
        .from("invoices")
        .update({
          status: "paid",
          amount_paid:
            Number(invoice.total),

          balance_due: 0,
          paid_at:
            new Date().toISOString(),
        })
        .eq("id", invoice.id)
        .eq(
          "business_id",
          business.id
        );

      if (error) {
        throw error;
      }

      await loadInvoices(business.id);

      setMessage(
        `${invoice.invoice_number} marked as paid.`
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "Could not update the invoice."
      );
    }
  }

  async function markAsUnpaid(invoice) {
    const confirmed = window.confirm(
      `Mark ${invoice.invoice_number} as unpaid?`
    );

    if (!confirmed) return;

    setMessage("");

    try {
      const newStatus =
        invoice.due_date &&
        invoice.due_date < getToday()
          ? "overdue"
          : "unpaid";

      const { error } = await supabase
        .from("invoices")
        .update({
          status: newStatus,
          amount_paid: 0,

          balance_due:
            Number(invoice.total),

          paid_at: null,
        })
        .eq("id", invoice.id)
        .eq(
          "business_id",
          business.id
        );

      if (error) {
        throw error;
      }

      await loadInvoices(business.id);

      setMessage(
        `${invoice.invoice_number} marked as unpaid.`
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "Could not update the invoice."
      );
    }
  }

  async function cancelInvoice(invoice) {
    const confirmed = window.confirm(
      `Cancel ${invoice.invoice_number}? The invoice will remain in your records.`
    );

    if (!confirmed) return;

    setMessage("");

    try {
      const { error } = await supabase
        .from("invoices")
        .update({
          status: "cancelled",
          balance_due: 0,
        })
        .eq("id", invoice.id)
        .eq(
          "business_id",
          business.id
        );

      if (error) {
        throw error;
      }

      await loadInvoices(business.id);

      setMessage(
        `${invoice.invoice_number} cancelled.`
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "Could not cancel the invoice."
      );
    }
  }

  function openDeleteInvoice(invoice) {
    setInvoiceToDelete(invoice);
    setDeleteStep(1);
    setDeleteConfirmation("");
    setDeletionReason("");
    setMessage("");
  }

  function closeDeleteInvoice() {
    if (deleting) return;

    setInvoiceToDelete(null);
    setDeleteStep(1);
    setDeleteConfirmation("");
    setDeletionReason("");
  }

  function continueDeleteInvoice() {
    setDeleteStep(2);
    setDeleteConfirmation("");
  }

  async function deleteInvoice() {
    if (!invoiceToDelete || !business?.id) return;

    if (deleteConfirmation.trim() !== invoiceToDelete.invoice_number) {
      setMessage(`Type ${invoiceToDelete.invoice_number} exactly to confirm deletion.`);
      return;
    }

    setDeleting(true);
    setMessage("");

    try {
      const { error } = await supabase
        .from("invoices")
        .update({
          deleted_at: new Date().toISOString(),
          deletion_reason: deletionReason.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoiceToDelete.id)
        .eq("business_id", business.id)
        .is("deleted_at", null);

      if (error) throw error;

      const deletedInvoiceNumber = invoiceToDelete.invoice_number;

      setInvoiceToDelete(null);
      setDeleteStep(1);
      setDeleteConfirmation("");
      setDeletionReason("");

      await loadInvoices(business.id);
      setMessage(`${deletedInvoiceNumber} was moved to Deleted Invoices.`);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "The invoice could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  const filteredInvoices = useMemo(() => {
    const searchText =
      search.trim().toLowerCase();

    return invoices.filter((invoice) => {
      const currentStatus =
        displayStatus(invoice);

      const matchesStatus =
        statusFilter === "all" ||
        currentStatus === statusFilter;

      const searchableText = [
        invoice.invoice_number,
        invoice.customer_name,
        invoice.customer_email,
        invoice.client?.name,
        invoice.client?.company_name,
        invoice.property?.property_name,
        invoice.property?.address_line_1,
        invoice.property?.postcode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !searchText ||
        searchableText.includes(
          searchText
        );

      return (
        matchesStatus &&
        matchesSearch
      );
    });
  }, [
    invoices,
    search,
    statusFilter,
  ]);

  if (loading) {
    return (
      <p className="text-slate-500">
        Loading invoices...
      </p>
    );
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden">
      <>
      <header className="flex min-w-0 flex-col justify-between gap-4 xl:flex-row xl:items-center">
        <div>
          <h1 className="text-3xl font-bold">
            Invoices
          </h1>

          <p className="mt-2 text-slate-500">
            Create invoices, view the property and report type,
            and track whether they have been paid.
          </p>
        </div>

        <div className="flex w-full flex-wrap gap-3 xl:w-auto xl:justify-end">
          <Link
            href="/invoices/deleted"
            className="min-w-0 flex-1 rounded-lg border border-red-300 px-4 py-3 text-center font-semibold text-red-700 hover:bg-red-50 sm:flex-none"
          >
            Deleted invoices
          </Link>

          <Link
            href="/invoices/import"
            className="min-w-0 flex-1 rounded-lg border border-blue-600 px-4 py-3 text-center font-semibold text-blue-600 hover:bg-blue-50 sm:flex-none"
          >
            Import spreadsheet
          </Link>

          <button
            type="button"
            onClick={
              showForm
                ? resetForm
                : openForm
            }
            className="min-w-0 flex-1 rounded-lg bg-blue-600 px-4 py-3 text-center font-semibold text-white hover:bg-blue-700 sm:flex-none"
          >
            {showForm
              ? "Close form"
              : "+ Create invoice"}
          </button>
        </div>
      </header>

      {message && (
        <div className="mt-6 rounded-lg bg-white p-4 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      )}

      {showForm && (
        <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            Create invoice
          </h2>

          <form
            onSubmit={saveInvoice}
            className="mt-6 space-y-7"
          >
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Invoice client
                </label>

                <select
                  name="client_id"
                  value={form.client_id}
                  onChange={selectClient}
                  required
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                >
                  <option value="">
                    Select a client
                  </option>

                  {clients.map((client) => (
                    <option
                      key={client.id}
                      value={client.id}
                    >
                      {client.company_name
                        ? `${client.company_name} — ${client.name}`
                        : client.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Property
                </label>

                <select
                  name="property_id"
                  value={form.property_id}
                  onChange={
                    updateFormField
                  }
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                >
                  <option value="">
                    No property selected
                  </option>

                  {properties.map(
                    (property) => (
                      <option
                        key={property.id}
                        value={property.id}
                      >
                        {[
                          property.property_name,
                          property.address_line_1,
                          property.postcode,
                        ]
                          .filter(Boolean)
                          .join(" — ")}
                      </option>
                    )
                  )}
                </select>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Invoice date
                </label>

                <input
                  type="date"
                  name="issue_date"
                  value={form.issue_date}
                  onChange={updateFormField}
                  required
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Status
                </label>

                <select
                  name="status"
                  value={form.status}
                  onChange={updateFormField}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                >
                  <option value="unpaid">
                    Unpaid
                  </option>

                  <option value="draft">
                    Draft
                  </option>

                  <option value="paid">
                    Paid
                  </option>
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  name="use_due_date"
                  checked={form.use_due_date}
                  onChange={updateFormField}
                  className="h-5 w-5 rounded border-slate-300"
                />

                <span className="font-semibold">
                  Add a due date
                </span>
              </label>

              <p className="mt-1 text-sm text-slate-500">
                Leave this unticked when the client has no fixed payment date.
              </p>

              {form.use_due_date && (
                <div className="mt-4 max-w-sm">
                  <label className="mb-2 block text-sm font-semibold">
                    Due date
                  </label>

                  <input
                    type="date"
                    name="due_date"
                    value={form.due_date}
                    onChange={updateFormField}
                    required={form.use_due_date}
                    className="w-full rounded-lg border border-slate-300 px-4 py-3"
                  />
                </div>
              )}
            </div>

            <div>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">
                    Invoice items
                  </h3>

                  <p className="text-sm text-slate-500">
                    Add each service or
                    charge.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={addItem}
                  className="rounded-lg border border-blue-600 px-4 py-2 font-semibold text-blue-600"
                >
                  + Add item
                </button>
              </div>

              <div className="space-y-4">
                {items.map(
                  (item, index) => {
                    const calculated =
                      calculatedItems[
                        index
                      ];

                    return (
                      <div
                        key={index}
                        className="rounded-xl border border-slate-200 p-4"
                      >
                        <div className="grid gap-4 lg:grid-cols-[0.6fr_0.8fr_0.6fr_0.8fr_auto] lg:items-end">
                          <div className="lg:col-span-5">
                            <label className="mb-2 block text-sm font-semibold">
                              Description
                            </label>

                            <textarea
                              rows={7}
                              value={
                                item.description
                              }
                              onChange={(
                                event
                              ) =>
                                updateItem(
                                  index,
                                  "description",
                                  event
                                    .target
                                    .value
                                )
                              }
                              required
                              placeholder="Enter the complete report type, report date and full property address..."
                              className="min-h-44 w-full resize-y rounded-lg border border-slate-300 px-4 py-3"
                            />
                          </div>

                          <div>
                            <label className="mb-2 block text-sm font-semibold">
                              Quantity
                            </label>

                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={
                                item.quantity
                              }
                              onChange={(
                                event
                              ) =>
                                updateItem(
                                  index,
                                  "quantity",
                                  event
                                    .target
                                    .value
                                )
                              }
                              required
                              className="w-full rounded-lg border border-slate-300 px-4 py-3"
                            />
                          </div>

                          <div>
                            <label className="mb-2 block text-sm font-semibold">
                              Price
                            </label>

                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={
                                item.unit_price
                              }
                              onChange={(
                                event
                              ) =>
                                updateItem(
                                  index,
                                  "unit_price",
                                  event
                                    .target
                                    .value
                                )
                              }
                              required
                              placeholder="120.00"
                              className="w-full rounded-lg border border-slate-300 px-4 py-3"
                            />
                          </div>

                          <div>
                            <label className="mb-2 block text-sm font-semibold">
                              VAT
                            </label>

                            <select
                              value={
                                item.vat_rate
                              }
                              onChange={(
                                event
                              ) =>
                                updateItem(
                                  index,
                                  "vat_rate",
                                  event
                                    .target
                                    .value
                                )
                              }
                              className="w-full rounded-lg border border-slate-300 px-4 py-3"
                            >
                              <option value="0">
                                0%
                              </option>

                              <option value="5">
                                5%
                              </option>

                              <option value="20">
                                20%
                              </option>
                            </select>
                          </div>

                          <div>
                            <p className="mb-2 text-sm font-semibold">
                              Line total
                            </p>

                            <div className="rounded-lg bg-slate-100 px-4 py-3 font-bold">
                              {formatMoney(
                                calculated?.lineTotal
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              removeItem(
                                index
                              )
                            }
                            disabled={
                              items.length ===
                              1
                            }
                            className="rounded-lg px-3 py-3 font-semibold text-red-600 disabled:cursor-not-allowed disabled:text-slate-300"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <div className="w-full max-w-sm rounded-xl bg-slate-50 p-5">
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">
                    Subtotal
                  </span>

                  <strong>
                    {formatMoney(
                      totals.subtotal
                    )}
                  </strong>
                </div>

                <div className="flex justify-between border-b border-slate-200 py-2">
                  <span className="text-slate-500">
                    VAT
                  </span>

                  <strong>
                    {formatMoney(
                      totals.vat
                    )}
                  </strong>
                </div>

                <div className="flex justify-between pt-4 text-xl">
                  <span className="font-bold">
                    Total
                  </span>

                  <strong>
                    {formatMoney(
                      totals.total
                    )}
                  </strong>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving
                  ? "Creating invoice..."
                  : "Create invoice"}
              </button>

              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-300 px-6 py-3 font-semibold"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-8 w-full max-w-full overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="grid gap-4 border-b border-slate-200 p-4 sm:p-5 lg:grid-cols-2">
          <input
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value
              )
            }
            placeholder="Search invoice, client, property or postcode..."
            className="rounded-lg border border-slate-300 px-4 py-3"
          />

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value
              )
            }
            className="rounded-lg border border-slate-300 px-4 py-3"
          >
            <option value="all">
              All statuses
            </option>

            <option value="draft">
              Draft
            </option>

            <option value="unpaid">
              Unpaid
            </option>

            <option value="overdue">
              Overdue
            </option>

            <option value="paid">
              Paid
            </option>

            <option value="partially_paid">
              Partially paid
            </option>

            <option value="cancelled">
              Cancelled
            </option>
          </select>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            No invoices found. Press
            “Create invoice” to make the
            first one.
          </div>
        ) : (
          <>
            <div className="hidden w-full max-w-full overflow-x-auto lg:block">
            <table className="w-full min-w-[1180px] table-fixed text-left">
              <thead className="bg-slate-50 text-sm text-slate-500">
                <tr>
                  <th className="w-[8%] whitespace-nowrap px-2 py-4 xl:px-3">
                    Invoice
                  </th>

                  <th className="w-[13%] px-2 py-4 xl:px-3">
                    Client
                  </th>

                  <th className="w-[23%] px-2 py-4 xl:px-3">
                    Property
                  </th>

                  <th className="w-[8%] px-2 py-4 xl:px-3">
                    Issued
                  </th>

                  <th className="hidden w-[10%] px-2 py-4 xl:table-cell xl:px-3">
                    Payment
                  </th>

                  <th className="w-[9%] px-2 py-4 xl:px-3">
                    Invoice total
                  </th>

                  <th className="w-[9%] px-2 py-4 xl:px-3">
                    My money
                  </th>

                  <th className="w-[9%] px-2 py-4 xl:px-3">
                    Other company
                  </th>

                  <th className="w-[8%] px-2 py-4 xl:px-3">
                    Status
                  </th>

                  <th className="w-[12%] px-2 py-4 xl:px-3">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredInvoices.map(
                  (invoice) => {
                    const currentStatus =
                      displayStatus(
                        invoice
                      );

                    return (
                      <tr
                        key={invoice.id}
                        className="border-t border-slate-100"
                      >
                        <td className="whitespace-nowrap px-3 py-4 font-bold xl:px-4">
                          {
                            invoice.invoice_number
                          }
                        </td>

                        <td className="break-words px-3 py-4 xl:px-4">
                          {invoice.customer_name ||
                            "—"}
                        </td>

                        <td className="min-w-0 break-words px-3 py-4 xl:px-4">
                          {(() => {
                            const property =
                              getPropertyDisplay(
                                invoice
                              );

                            return (
                              <div>
                                <p className="break-words font-semibold leading-snug text-slate-900">
                                  {property.name}
                                </p>

                                <p className="mt-1 text-sm text-slate-500">
                                  {
                                    property.reportType
                                  }
                                </p>
                              </div>
                            );
                          })()}
                        </td>

                        <td className="px-3 py-4 xl:px-4">
                          {formatDate(
                            invoice.issue_date
                          )}
                        </td>

                        <td className="hidden px-3 py-4 xl:table-cell xl:px-4">
                          <div className="font-medium">
                            {paymentTimingText(invoice)}
                          </div>

                          {invoice.due_date &&
                            invoice.status !== "paid" &&
                            !["cancelled", "draft"].includes(invoice.status) && (
                              <div className="mt-1 text-xs text-slate-500">
                                Due {formatDate(invoice.due_date)}
                              </div>
                            )}
                        </td>

                        <td className="px-3 py-4 font-semibold xl:px-4">
                          {formatMoney(invoice.total)}
                        </td>

                        <td className="px-3 py-4 font-semibold text-green-700 xl:px-4">
                          {formatMoney(
                            invoice.internal_amount ??
                              invoice.total
                          )}
                        </td>

                        <td className="px-2 py-4 font-semibold text-purple-700 xl:px-3">
                          {formatMoney(
                            Math.max(
                              0,
                              Number(invoice.total || 0) -
                                Number(
                                  invoice.internal_amount ??
                                    invoice.total ??
                                    0
                                )
                            )
                          )}
                        </td>

                        <td className="px-3 py-4 xl:px-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusClasses(
                              currentStatus
                            )}`}
                          >
                            {currentStatus.replace(
                              "_",
                              " "
                            )}
                          </span>
                        </td>

                        <td className="px-3 py-4 xl:px-4">
                          <div className="flex flex-col items-start gap-2 xl:flex-row xl:flex-wrap xl:gap-x-3 xl:gap-y-2">
                            <Link
                              href={`/invoices/${invoice.id}`}
                              className="font-semibold text-blue-600 hover:text-blue-800"
                            >
                              PDF
                            </Link>

                            <Link
                              href={`/invoices/${invoice.id}/email`}
                              className="font-semibold text-purple-600 hover:text-purple-800"
                            >
                              Email
                            </Link>

                            <Link
                              href={`/invoices/${invoice.id}/edit`}
                              className="font-semibold text-amber-600 hover:text-amber-800"
                            >
                              Edit
                            </Link>

                            <button
                              type="button"
                              onClick={() => openDeleteInvoice(invoice)}
                              className="font-semibold text-red-600 hover:text-red-800"
                            >
                              Delete
                            </button>

                            {currentStatus !==
                              "paid" &&
                              currentStatus !==
                                "cancelled" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    markAsPaid(
                                      invoice
                                    )
                                  }
                                  className="font-semibold text-green-600 hover:text-green-800"
                                >
                                  Mark paid
                                </button>
                              )}

                            {currentStatus ===
                              "paid" && (
                              <button
                                type="button"
                                onClick={() =>
                                  markAsUnpaid(
                                    invoice
                                  )
                                }
                                className="font-semibold text-amber-600 hover:text-amber-800"
                              >
                                Mark unpaid
                              </button>
                            )}

                            {currentStatus !==
                              "cancelled" && (
                              <button
                                type="button"
                                onClick={() =>
                                  cancelInvoice(
                                    invoice
                                  )
                                }
                                className="font-semibold text-red-600 hover:text-red-800"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-200 lg:hidden">
            {filteredInvoices.map((invoice) => {
              const currentStatus =
                displayStatus(invoice);

              const property =
                getPropertyDisplay(invoice);

              return (
                <article
                  key={invoice.id}
                  className="p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="whitespace-nowrap text-lg font-bold">
                        {invoice.invoice_number}
                      </p>

                      <p className="mt-1 break-words font-medium text-slate-800">
                        {invoice.customer_name || "—"}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusClasses(
                        currentStatus
                      )}`}
                    >
                      {currentStatus.replace("_", " ")}
                    </span>
                  </div>

                  <div className="mt-4 rounded-lg bg-slate-50 p-3">
                    <p className="break-words font-semibold leading-snug text-slate-900">
                      {property.name}
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      {property.reportType}
                    </p>
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-slate-500">
                        Issued
                      </dt>
                      <dd className="mt-1 font-medium">
                        {formatDate(invoice.issue_date)}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-slate-500">
                        Payment
                      </dt>
                      <dd className="mt-1 font-medium">
                        {paymentTimingText(invoice)}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-slate-500">
                        Invoice total
                      </dt>
                      <dd className="mt-1 font-bold">
                        {formatMoney(invoice.total)}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-slate-500">
                        My money
                      </dt>
                      <dd className="mt-1 font-bold text-green-700">
                        {formatMoney(
                          invoice.internal_amount ?? invoice.total
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-slate-500">
                        Other company
                      </dt>
                      <dd className="mt-1 font-bold text-purple-700">
                        {formatMoney(
                          Math.max(
                            0,
                            Number(invoice.total || 0) -
                              Number(
                                invoice.internal_amount ??
                                  invoice.total ??
                                  0
                              )
                          )
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-slate-500">
                        Balance
                      </dt>
                      <dd className="mt-1 font-bold">
                        {formatMoney(invoice.balance_due)}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex flex-wrap gap-x-4 gap-y-3 border-t border-slate-200 pt-4">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-semibold text-blue-600"
                    >
                      PDF
                    </Link>

                    <Link
                      href={`/invoices/${invoice.id}/email`}
                      className="font-semibold text-purple-600"
                    >
                      Email
                    </Link>

                    <Link
                      href={`/invoices/${invoice.id}/edit`}
                      className="font-semibold text-amber-600"
                    >
                      Edit
                    </Link>

                    <button
                      type="button"
                      onClick={() =>
                        openDeleteInvoice(invoice)
                      }
                      className="font-semibold text-red-600"
                    >
                      Delete
                    </button>

                    {currentStatus !== "paid" &&
                      currentStatus !== "cancelled" && (
                        <button
                          type="button"
                          onClick={() =>
                            markAsPaid(invoice)
                          }
                          className="font-semibold text-green-600"
                        >
                          Mark paid
                        </button>
                      )}

                    {currentStatus === "paid" && (
                      <button
                        type="button"
                        onClick={() =>
                          markAsUnpaid(invoice)
                        }
                        className="font-semibold text-amber-600"
                      >
                        Mark unpaid
                      </button>
                    )}

                    {currentStatus !== "cancelled" && (
                      <button
                        type="button"
                        onClick={() =>
                          cancelInvoice(invoice)
                        }
                        className="font-semibold text-red-600"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          </>
        )}
      </section>


      {invoiceToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            {deleteStep === 1 ? (
              <>
                <h2 className="text-2xl font-bold text-slate-900">Delete invoice?</h2>
                <p className="mt-4 text-slate-600">
                  You are about to delete <strong>{invoiceToDelete.invoice_number}</strong>.
                </p>
                <p className="mt-3 text-slate-600">
                  The invoice will be moved to Deleted Invoices and can be restored later. It will not be permanently destroyed.
                </p>
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={closeDeleteInvoice} className="rounded-lg border border-slate-300 px-5 py-3 font-semibold">
                    Cancel
                  </button>
                  <button type="button" onClick={continueDeleteInvoice} className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700">
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-red-700">Confirm deletion</h2>
                <p className="mt-4 text-slate-600">Type the invoice number exactly:</p>
                <p className="mt-2 rounded-lg bg-slate-100 p-3 font-bold">{invoiceToDelete.invoice_number}</p>
                <input
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  placeholder={invoiceToDelete.invoice_number}
                  disabled={deleting}
                  className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3"
                />
                <label className="mt-5 block text-sm font-semibold">Reason for deletion (optional)</label>
                <textarea
                  value={deletionReason}
                  onChange={(event) => setDeletionReason(event.target.value)}
                  rows={3}
                  disabled={deleting}
                  placeholder="For example: wrong invoice created"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3"
                />
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={closeDeleteInvoice} disabled={deleting} className="rounded-lg border border-slate-300 px-5 py-3 font-semibold disabled:opacity-50">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={deleteInvoice}
                    disabled={deleting || deleteConfirmation.trim() !== invoiceToDelete.invoice_number}
                    className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {deleting ? "Deleting..." : "Delete invoice"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      </>
    </div>
  );
}