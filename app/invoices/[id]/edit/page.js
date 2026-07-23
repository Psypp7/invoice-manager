"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../lib/supabase";

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

export default function EditInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [business, setBusiness] = useState(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [clients, setClients] = useState([]);
  const [properties, setProperties] = useState([]);
  const [originalItems, setOriginalItems] = useState([]);

  const [form, setForm] = useState({
    client_id: "",
    property_id: "",
    issue_date: "",
    use_due_date: false,
    due_date: "",
    status: "unpaid",
  });

  const [items, setItems] = useState([emptyItem()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (invoiceId) {
      initialisePage();
    }
  }, [invoiceId]);

  async function initialisePage() {
    setLoading(true);
    setMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must sign in before editing an invoice.");
      }

      const { data: businessData, error: businessError } = await supabase
        .from("businesses")
        .select(
          `
            id,
            business_name,
            default_payment_days,
            default_vat_rate
          `
        )
        .eq("owner_user_id", user.id)
        .single();

      if (businessError) {
        throw businessError;
      }

      const [clientsResult, propertiesResult, invoiceResult] =
        await Promise.all([
          supabase
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
                client_type,
                is_active
              `
            )
            .eq("business_id", businessData.id)
            .order("name", { ascending: true }),

          supabase
            .from("properties")
            .select(
              `
                id,
                property_name,
                address_line_1,
                address_line_2,
                city,
                postcode,
                is_active
              `
            )
            .eq("business_id", businessData.id)
            .order("address_line_1", { ascending: true }),

          supabase
            .from("invoices")
            .select(
              `
                id,
                invoice_number,
                business_id,
                client_id,
                property_id,
                issue_date,
                supply_date,
                due_date,
                status,
                notes,
                amount_paid,
                paid_at,
                deleted_at,
                invoice_items(
                  id,
                  description,
                  quantity,
                  unit_price,
                  vat_rate,
                  line_subtotal,
                  line_vat,
                  line_total,
                  sort_order
                )
              `
            )
            .eq("id", invoiceId)
            .eq("business_id", businessData.id)
            .is("deleted_at", null)
            .single(),
        ]);

      if (clientsResult.error) throw clientsResult.error;
      if (propertiesResult.error) throw propertiesResult.error;
      if (invoiceResult.error) throw invoiceResult.error;

      const invoice = invoiceResult.data;
      const orderedItems = [...(invoice.invoice_items || [])].sort(
        (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)
      );

      setBusiness(businessData);
      setClients(clientsResult.data || []);
      setProperties(propertiesResult.data || []);
      setInvoiceNumber(invoice.invoice_number || "Invoice");

      setForm({
        client_id: invoice.client_id || "",
        property_id: invoice.property_id || "",
        issue_date: invoice.issue_date || "",
        use_due_date: Boolean(invoice.due_date),
        due_date: invoice.due_date || "",
        status: invoice.status || "unpaid",
      });

      const editableItems =
        orderedItems.length > 0
          ? orderedItems.map((item) => ({
              description: item.description || "",
              quantity: String(item.quantity ?? 1),
              unit_price: String(item.unit_price ?? 0),
              vat_rate: String(item.vat_rate ?? 0),
            }))
          : [
              {
                ...emptyItem(),
                vat_rate: String(businessData.default_vat_rate || 0),
              },
            ];

      setItems(editableItems);
      setOriginalItems(orderedItems);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "The invoice could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function updateFormField(event) {
    const { name, value, type, checked } = event.target;

    setForm((current) => {
      if (name === "use_due_date") {
        return {
          ...current,
          use_due_date: checked,
          due_date: checked ? current.due_date : "",
        };
      }

      return {
        ...current,
        [name]: type === "checkbox" ? checked : value,
      };
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
        vat_rate: String(business?.default_vat_rate || 0),
      },
    ]);
  }

  function removeItem(index) {
    if (items.length === 1) return;

    setItems((current) =>
      current.filter((_, itemIndex) => itemIndex !== index)
    );
  }

  const calculatedItems = useMemo(() => {
    return items.map((item) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const vatRate = Number(item.vat_rate || 0);
      const lineSubtotal = quantity * unitPrice;
      const lineVat = lineSubtotal * (vatRate / 100);
      const lineTotal = lineSubtotal + lineVat;

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
        subtotal: currentTotals.subtotal + item.lineSubtotal,
        vat: currentTotals.vat + item.lineVat,
        total: currentTotals.total + item.lineTotal,
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

  async function restoreOriginalItems() {
    if (!originalItems.length) return;

    const rollbackPayload = originalItems.map((item) => ({
      invoice_id: invoiceId,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      vat_rate: item.vat_rate,
      line_subtotal: item.line_subtotal,
      line_vat: item.line_vat,
      line_total: item.line_total,
      sort_order: item.sort_order,
    }));

    await supabase.from("invoice_items").insert(rollbackPayload);
  }

  async function saveChanges(event) {
    event.preventDefault();

    if (!business?.id || !invoiceId) {
      setMessage("The invoice or business could not be identified.");
      return;
    }

    if (!form.client_id) {
      setMessage("Select a client.");
      return;
    }

    const invalidItem = calculatedItems.some(
      (item) =>
        !item.description.trim() || item.quantity <= 0 || item.unitPrice < 0
    );

    if (invalidItem) {
      setMessage(
        "Every invoice item needs a description, quantity and valid price."
      );
      return;
    }

    if (totals.total <= 0) {
      setMessage("The invoice total must be greater than £0.");
      return;
    }

    setSaving(true);
    setMessage("");

    let oldItemsDeleted = false;

    try {
      const selectedClient = clients.find(
        (client) => client.id === form.client_id
      );

      if (!selectedClient) {
        throw new Error("The selected client could not be found.");
      }

      const roundedSubtotal = Number(totals.subtotal.toFixed(2));
      const roundedVat = Number(totals.vat.toFixed(2));
      const roundedTotal = Number(totals.total.toFixed(2));
      const isPaid = form.status === "paid";
      const isCancelled = form.status === "cancelled";

      const invoicePayload = {
        client_id: form.client_id,
        property_id: form.property_id || null,
        issue_date: form.issue_date,
        supply_date: null,
        due_date:
          form.use_due_date && form.due_date
            ? form.due_date
            : null,
        status: form.status,
        currency: "GBP",
        subtotal: roundedSubtotal,
        vat_total: roundedVat,
        total: roundedTotal,
        amount_paid: isPaid ? roundedTotal : 0,
        balance_due: isPaid || isCancelled ? 0 : roundedTotal,
        customer_name: selectedClient.company_name || selectedClient.name,
        customer_email: selectedClient.email || null,
        customer_address: buildClientAddress(selectedClient) || null,
        notes: null,
        payment_terms:
          form.use_due_date && form.due_date
            ? `Payment due by ${form.due_date}`
            : null,
        paid_at: isPaid ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };

      const { error: invoiceError } = await supabase
        .from("invoices")
        .update(invoicePayload)
        .eq("id", invoiceId)
        .eq("business_id", business.id)
        .is("deleted_at", null);

      if (invoiceError) {
        throw invoiceError;
      }

      const { error: deleteItemsError } = await supabase
        .from("invoice_items")
        .delete()
        .eq("invoice_id", invoiceId);

      if (deleteItemsError) {
        throw deleteItemsError;
      }

      oldItemsDeleted = true;

      const itemPayloads = calculatedItems.map((item, index) => ({
        invoice_id: invoiceId,
        description: item.description.trim(),
        quantity: Number(item.quantity.toFixed(2)),
        unit_price: Number(item.unitPrice.toFixed(2)),
        vat_rate: Number(item.vatRate.toFixed(2)),
        line_subtotal: Number(item.lineSubtotal.toFixed(2)),
        line_vat: Number(item.lineVat.toFixed(2)),
        line_total: Number(item.lineTotal.toFixed(2)),
        sort_order: index,
        updated_at: new Date().toISOString(),
      }));

      const { error: insertItemsError } = await supabase
        .from("invoice_items")
        .insert(itemPayloads);

      if (insertItemsError) {
        throw insertItemsError;
      }

      router.push(`/invoices/${invoiceId}`);
      router.refresh();
    } catch (error) {
      console.error(error);

      if (oldItemsDeleted) {
        const { error: cleanupError } = await supabase
          .from("invoice_items")
          .delete()
          .eq("invoice_id", invoiceId);

        if (!cleanupError) {
          await restoreOriginalItems();
        }
      }

      setMessage(error?.message || "The invoice could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-slate-500">Loading invoice...</p>;
  }

  return (
    <>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">
            Edit invoice
          </p>

          <h1 className="mt-1 text-3xl font-bold">{invoiceNumber}</h1>

          <p className="mt-2 text-slate-500">
            Update the client, property, invoice date, services, prices and VAT.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/invoices/${invoiceId}`}
            className="rounded-lg border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-50"
          >
            View invoice
          </Link>

          <Link
            href="/invoices"
            className="rounded-lg border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-50"
          >
            Back to invoices
          </Link>
        </div>
      </header>

      {message && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
        </div>
      )}

      <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <form onSubmit={saveChanges} className="space-y-7">
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
                disabled={saving}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
              >
                <option value="">Select a client</option>

                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.company_name
                      ? `${client.company_name} — ${client.name}`
                      : client.name}
                    {!client.is_active ? " — inactive" : ""}
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
                onChange={updateFormField}
                disabled={saving}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
              >
                <option value="">No property selected</option>

                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {[
                      property.property_name,
                      property.address_line_1,
                      property.postcode,
                    ]
                      .filter(Boolean)
                      .join(" — ")}
                    {!property.is_active ? " — inactive" : ""}
                  </option>
                ))}
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
                disabled={saving}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
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
                disabled={saving}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
              >
                <option value="draft">Draft</option>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
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
                disabled={saving}
                className="h-5 w-5 rounded border-slate-300"
              />

              <span className="font-semibold">
                Add a due date
              </span>
            </label>

            <p className="mt-1 text-sm text-slate-500">
              Leave this unticked when there is no fixed payment deadline.
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
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                />
              </div>
            )}
          </div>

          <div>
            <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-xl font-bold">Invoice items</h2>
                <p className="text-sm text-slate-500">
                  Edit, remove or add services and charges.
                </p>
              </div>

              <button
                type="button"
                onClick={addItem}
                disabled={saving}
                className="rounded-lg border border-blue-600 px-4 py-2 font-semibold text-blue-600 disabled:opacity-50"
              >
                + Add item
              </button>
            </div>

            <div className="space-y-4">
              {items.map((item, index) => {
                const calculated = calculatedItems[index];

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
                          value={item.description}
                          onChange={(event) =>
                            updateItem(index, "description", event.target.value)
                          }
                          required
                          disabled={saving}
                          placeholder="Enter the complete report type, report date and full property address..."
                          className="min-h-44 w-full resize-y rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
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
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(index, "quantity", event.target.value)
                          }
                          required
                          disabled={saving}
                          className="w-full rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
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
                          value={item.unit_price}
                          onChange={(event) =>
                            updateItem(index, "unit_price", event.target.value)
                          }
                          required
                          disabled={saving}
                          placeholder="120.00"
                          className="w-full rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-semibold">
                          VAT
                        </label>

                        <select
                          value={item.vat_rate}
                          onChange={(event) =>
                            updateItem(index, "vat_rate", event.target.value)
                          }
                          disabled={saving}
                          className="w-full rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                        >
                          <option value="0">0%</option>
                          <option value="5">5%</option>
                          <option value="20">20%</option>
                        </select>
                      </div>

                      <div>
                        <p className="mb-2 text-sm font-semibold">Line total</p>

                        <div className="rounded-lg bg-slate-100 px-4 py-3 font-bold">
                          {formatMoney(calculated?.lineTotal)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        disabled={items.length === 1 || saving}
                        className="rounded-lg px-3 py-3 font-semibold text-red-600 disabled:cursor-not-allowed disabled:text-slate-300"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <div className="w-full max-w-sm rounded-xl bg-slate-50 p-5">
              <div className="flex justify-between py-2">
                <span className="text-slate-500">Subtotal</span>
                <strong>{formatMoney(totals.subtotal)}</strong>
              </div>

              <div className="flex justify-between border-b border-slate-200 py-2">
                <span className="text-slate-500">VAT</span>
                <strong>{formatMoney(totals.vat)}</strong>
              </div>

              <div className="flex justify-between pt-4 text-xl">
                <span className="font-bold">Total</span>
                <strong>{formatMoney(totals.total)}</strong>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-6">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving changes..." : "Save changes"}
            </button>

            <Link
              href={`/invoices/${invoiceId}`}
              className="rounded-lg border border-slate-300 px-6 py-3 font-semibold hover:bg-slate-50"
            >
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </>
  );
}
