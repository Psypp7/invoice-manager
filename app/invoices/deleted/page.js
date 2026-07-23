"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

function formatMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function formatDate(value, includeTime = false) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
        }
      : {}),
  }).format(date);
}

export default function DeletedInvoicesPage() {
  const [business, setBusiness] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [message, setMessage] = useState("");

  const [invoiceToDelete, setInvoiceToDelete] =
    useState(null);
  const [deleteConfirmation, setDeleteConfirmation] =
    useState("");

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
        throw new Error(
          "You must sign in before viewing deleted invoices."
        );
      }

      const {
        data: businessData,
        error: businessError,
      } = await supabase
        .from("businesses")
        .select("id, business_name")
        .eq("owner_user_id", user.id)
        .single();

      if (businessError) {
        throw businessError;
      }

      setBusiness(businessData);
      await loadDeletedInvoices(businessData.id);
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "Deleted invoices could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadDeletedInvoices(
    businessId = business?.id
  ) {
    if (!businessId) return;

    const { data, error } = await supabase
      .from("invoices")
      .select(
        `
          id,
          invoice_number,
          issue_date,
          total,
          customer_name,
          customer_email,
          deleted_at,
          deletion_reason,
          property:properties(
            id,
            property_name,
            address_line_1,
            postcode
          ),
          invoice_items(
            id,
            description
          )
        `
      )
      .eq("business_id", businessId)
      .not("deleted_at", "is", null)
      .order("deleted_at", {
        ascending: false,
      });

    if (error) {
      throw error;
    }

    setInvoices(data || []);
  }

  const filteredInvoices = useMemo(() => {
    const text = search.trim().toLowerCase();

    if (!text) {
      return invoices;
    }

    return invoices.filter((invoice) => {
      const description = (
        invoice.invoice_items || []
      )
        .map((item) => item.description)
        .filter(Boolean)
        .join(" ");

      const searchable = [
        invoice.invoice_number,
        invoice.customer_name,
        invoice.customer_email,
        invoice.property?.property_name,
        invoice.property?.address_line_1,
        invoice.property?.postcode,
        invoice.deletion_reason,
        description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(text);
    });
  }, [invoices, search]);

  async function restoreInvoice(invoice) {
    if (!business?.id) return;

    const confirmed = window.confirm(
      `Restore ${invoice.invoice_number} to active invoices?`
    );

    if (!confirmed) return;

    setWorkingId(invoice.id);
    setMessage("");

    try {
      const { error } = await supabase
        .from("invoices")
        .update({
          deleted_at: null,
          deletion_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoice.id)
        .eq("business_id", business.id)
        .not("deleted_at", "is", null);

      if (error) {
        throw error;
      }

      await loadDeletedInvoices(business.id);

      setMessage(
        `${invoice.invoice_number} was restored successfully.`
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "The invoice could not be restored."
      );
    } finally {
      setWorkingId("");
    }
  }

  function openPermanentDelete(invoice) {
    setInvoiceToDelete(invoice);
    setDeleteConfirmation("");
    setMessage("");
  }

  function closePermanentDelete() {
    if (workingId) return;

    setInvoiceToDelete(null);
    setDeleteConfirmation("");
  }

  async function permanentlyDeleteInvoice() {
    if (
      !invoiceToDelete ||
      !business?.id
    ) {
      return;
    }

    if (
      deleteConfirmation.trim() !==
      invoiceToDelete.invoice_number
    ) {
      setMessage(
        `Type ${invoiceToDelete.invoice_number} exactly to confirm permanent deletion.`
      );
      return;
    }

    setWorkingId(invoiceToDelete.id);
    setMessage("");

    try {
      const { error: itemsError } =
        await supabase
          .from("invoice_items")
          .delete()
          .eq(
            "invoice_id",
            invoiceToDelete.id
          );

      if (itemsError) {
        throw itemsError;
      }

      const { error: invoiceError } =
        await supabase
          .from("invoices")
          .delete()
          .eq("id", invoiceToDelete.id)
          .eq("business_id", business.id)
          .not("deleted_at", "is", null);

      if (invoiceError) {
        throw invoiceError;
      }

      const deletedNumber =
        invoiceToDelete.invoice_number;

      setInvoiceToDelete(null);
      setDeleteConfirmation("");

      await loadDeletedInvoices(business.id);

      setMessage(
        `${deletedNumber} was permanently deleted.`
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "The invoice could not be permanently deleted."
      );
    } finally {
      setWorkingId("");
    }
  }

  if (loading) {
    return (
      <p className="text-slate-500">
        Loading deleted invoices...
      </p>
    );
  }

  return (
    <>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-red-600">
            Recycle bin
          </p>

          <h1 className="mt-1 text-3xl font-bold">
            Deleted invoices
          </h1>

          <p className="mt-2 text-slate-500">
            Restore invoices or permanently remove them.
          </p>
        </div>

        <Link
          href="/invoices"
          className="rounded-lg border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-50"
        >
          Back to invoices
        </Link>
      </header>

      {message && (
        <div className="mt-6 rounded-lg bg-white p-4 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      )}

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <input
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
          placeholder="Search deleted invoice, client, property, postcode or reason..."
          className="w-full rounded-lg border border-slate-300 px-4 py-3"
        />
      </section>

      <section className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm">
        {filteredInvoices.length === 0 ? (
          <div className="p-12 text-center">
            <h2 className="text-xl font-bold">
              No deleted invoices
            </h2>

            <p className="mt-2 text-slate-500">
              Deleted invoices will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left">
              <thead className="bg-slate-50 text-sm text-slate-500">
                <tr>
                  <th className="px-5 py-4">
                    Invoice
                  </th>
                  <th className="px-5 py-4">
                    Client
                  </th>
                  <th className="px-5 py-4">
                    Property / description
                  </th>
                  <th className="px-5 py-4">
                    Invoice date
                  </th>
                  <th className="px-5 py-4">
                    Total
                  </th>
                  <th className="px-5 py-4">
                    Deleted
                  </th>
                  <th className="px-5 py-4">
                    Reason
                  </th>
                  <th className="px-5 py-4">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredInvoices.map(
                  (invoice) => {
                    const firstDescription =
                      invoice.invoice_items?.[0]
                        ?.description || "—";

                    const propertyText =
                      invoice.property
                        ? [
                            invoice.property
                              .property_name,
                            invoice.property
                              .address_line_1,
                            invoice.property
                              .postcode,
                          ]
                            .filter(Boolean)
                            .join(" — ")
                        : firstDescription;

                    const isWorking =
                      workingId === invoice.id;

                    return (
                      <tr
                        key={invoice.id}
                        className="border-t border-slate-100 align-top"
                      >
                        <td className="px-5 py-4 font-bold">
                          {
                            invoice.invoice_number
                          }
                        </td>

                        <td className="px-5 py-4">
                          {invoice.customer_name ||
                            "—"}
                        </td>

                        <td className="max-w-md px-5 py-4">
                          <p className="line-clamp-3">
                            {propertyText}
                          </p>
                        </td>

                        <td className="px-5 py-4">
                          {formatDate(
                            invoice.issue_date
                          )}
                        </td>

                        <td className="px-5 py-4 font-semibold">
                          {formatMoney(
                            invoice.total
                          )}
                        </td>

                        <td className="px-5 py-4">
                          {formatDate(
                            invoice.deleted_at,
                            true
                          )}
                        </td>

                        <td className="max-w-xs px-5 py-4">
                          {invoice.deletion_reason ||
                            "No reason provided"}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                restoreInvoice(
                                  invoice
                                )
                              }
                              disabled={
                                isWorking
                              }
                              className="font-semibold text-green-600 hover:text-green-800 disabled:opacity-50"
                            >
                              {isWorking
                                ? "Working..."
                                : "Restore"}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                openPermanentDelete(
                                  invoice
                                )
                              }
                              disabled={
                                isWorking
                              }
                              className="font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                            >
                              Permanently delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {invoiceToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-2xl font-bold text-red-700">
              Permanently delete invoice?
            </h2>

            <p className="mt-4 text-slate-600">
              This will permanently remove{" "}
              <strong>
                {
                  invoiceToDelete.invoice_number
                }
              </strong>{" "}
              and its invoice items. This cannot be undone.
            </p>

            <p className="mt-4 text-slate-600">
              Type the invoice number exactly:
            </p>

            <p className="mt-2 rounded-lg bg-slate-100 p-3 font-bold">
              {
                invoiceToDelete.invoice_number
              }
            </p>

            <input
              value={deleteConfirmation}
              onChange={(event) =>
                setDeleteConfirmation(
                  event.target.value
                )
              }
              disabled={Boolean(workingId)}
              placeholder={
                invoiceToDelete.invoice_number
              }
              className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3"
            />

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closePermanentDelete}
                disabled={Boolean(workingId)}
                className="rounded-lg border border-slate-300 px-5 py-3 font-semibold disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  permanentlyDeleteInvoice
                }
                disabled={
                  Boolean(workingId) ||
                  deleteConfirmation.trim() !==
                    invoiceToDelete.invoice_number
                }
                className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {workingId
                  ? "Deleting..."
                  : "Permanently delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
