"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

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
  }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`));
}

function getClientName(invoice) {
  return (
    invoice.client?.company_name ||
    invoice.client?.name ||
    invoice.customer_name ||
    "—"
  );
}

function getPropertyName(invoice) {
  const property = invoice.property;

  if (!property) return "—";

  return [
    property.property_name,
    property.address_line_1,
    property.postcode,
  ]
    .filter(Boolean)
    .join(", ");
}

function getDescription(invoice) {
  return invoice.invoice_items?.[0]?.description || "—";
}

function paymentLabel(invoice) {
  if (invoice.status === "paid") {
    return invoice.paid_at
      ? `Paid ${formatDate(invoice.paid_at)}`
      : "Paid";
  }

  if (invoice.status === "cancelled") {
    return "Cancelled";
  }

  return "Unpaid";
}

function paymentClass(invoice) {
  if (invoice.status === "paid") {
    return "bg-green-100 text-green-800";
  }

  if (invoice.status === "cancelled") {
    return "bg-slate-200 text-slate-700";
  }

  return "bg-red-100 text-red-800";
}

function sentLabel(invoice) {
  return invoice.sent_at
    ? `Sent ${formatDate(invoice.sent_at)}`
    : "Not sent";
}

function sentClass(invoice) {
  return invoice.sent_at
    ? "bg-cyan-100 text-cyan-800"
    : "bg-amber-100 text-amber-800";
}

export default function InvoiceRegisterPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sentFilter, setSentFilter] = useState("all");

  useEffect(() => {
    loadInvoices();
  }, []);

  async function loadInvoices() {
    setLoading(true);
    setMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        window.location.href = "/login";
        return;
      }

      const {
        data: business,
        error: businessError,
      } = await supabase
        .from("businesses")
        .select("id")
        .eq("owner_user_id", user.id)
        .single();

      if (businessError) {
        throw businessError;
      }

      const {
        data,
        error,
      } = await supabase
        .from("invoices")
        .select(
          `
            id,
            invoice_number,
            issue_date,
            paid_at,
            sent_at,
            status,
            total,
            internal_amount,
            agency_commission,
            customer_name,
            customer_email,
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
              sort_order
            )
          `
        )
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("issue_date", { ascending: false })
        .order("invoice_number", { ascending: false });

      if (error) {
        throw error;
      }

      const prepared = (data || [])
        .map((invoice) => ({
          ...invoice,
          invoice_items: [...(invoice.invoice_items || [])].sort(
            (a, b) =>
              Number(a.sort_order || 0) -
              Number(b.sort_order || 0)
          ),
        }))
        .sort((first, second) => {
          const dateDifference =
            new Date(second.issue_date).getTime() -
            new Date(first.issue_date).getTime();

          if (dateDifference !== 0) {
            return dateDifference;
          }

          const firstNumber = Number(
            String(first.invoice_number || "").replace(/\D/g, "")
          );
          const secondNumber = Number(
            String(second.invoice_number || "").replace(/\D/g, "")
          );

          return secondNumber - firstNumber;
        });

      setInvoices(prepared);
    } catch (error) {
      console.error(error);
      setMessage(
        error?.message ||
          "The invoice register could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  const filteredInvoices = useMemo(() => {
    const term = search.trim().toLowerCase();

    return invoices.filter((invoice) => {
      const matchesSearch =
        !term ||
        [
          invoice.invoice_number,
          getClientName(invoice),
          getPropertyName(invoice),
          getDescription(invoice),
        ]
          .join(" ")
          .toLowerCase()
          .includes(term);

      const matchesPayment =
        paymentFilter === "all" ||
        (paymentFilter === "paid" &&
          invoice.status === "paid") ||
        (paymentFilter === "unpaid" &&
          invoice.status !== "paid" &&
          invoice.status !== "cancelled");

      const matchesSent =
        sentFilter === "all" ||
        (sentFilter === "sent" && invoice.sent_at) ||
        (sentFilter === "not_sent" && !invoice.sent_at);

      return (
        matchesSearch &&
        matchesPayment &&
        matchesSent
      );
    });
  }, [invoices, paymentFilter, search, sentFilter]);

  const totals = useMemo(() => {
    return filteredInvoices.reduce(
      (result, invoice) => {
        result.invoiceTotal += Number(invoice.total || 0);
        result.myMoney += Number(
          invoice.internal_amount ??
            invoice.total ??
            0
        );
        result.otherCompany += Math.max(
          0,
          Number(invoice.total || 0) -
            Number(
              invoice.internal_amount ??
                invoice.total ??
                0
            )
        );

        return result;
      },
      {
        invoiceTotal: 0,
        myMoney: 0,
        otherCompany: 0,
      }
    );
  }, [filteredInvoices]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          Invoice Register
        </h1>
        <p className="mt-2 text-slate-600">
          A compact, read-only overview of every invoice,
          payment status and sent status.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Visible invoices
          </div>
          <div className="mt-1 text-2xl font-bold">
            {filteredInvoices.length}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Invoice total
          </div>
          <div className="mt-1 text-2xl font-bold">
            {formatMoney(totals.invoiceTotal)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            My money
          </div>
          <div className="mt-1 text-2xl font-bold text-green-700">
            {formatMoney(totals.myMoney)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Other company
          </div>
          <div className="mt-1 text-2xl font-bold text-purple-700">
            {formatMoney(totals.otherCompany)}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-3">
          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search invoice, client or property..."
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
          />

          <select
            value={paymentFilter}
            onChange={(event) =>
              setPaymentFilter(event.target.value)
            }
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
          >
            <option value="all">All payment statuses</option>
            <option value="paid">Paid only</option>
            <option value="unpaid">Unpaid only</option>
          </select>

          <select
            value={sentFilter}
            onChange={(event) =>
              setSentFilter(event.target.value)
            }
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
          >
            <option value="all">All sent statuses</option>
            <option value="sent">Sent only</option>
            <option value="not_sent">Not sent only</option>
          </select>
        </div>

        {message && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {message}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="w-[7%] border-b border-r border-slate-200 px-2 py-2">
                  Invoice
                </th>
                <th className="w-[9%] border-b border-r border-slate-200 px-2 py-2">
                  Issued
                </th>
                <th className="w-[16%] border-b border-r border-slate-200 px-2 py-2">
                  Client
                </th>
                <th className="w-[30%] border-b border-r border-slate-200 px-2 py-2">
                  Description
                </th>
                <th className="w-[12%] border-b border-r border-slate-200 px-2 py-2">
                  Payment
                </th>
                <th className="w-[11%] border-b border-r border-slate-200 px-2 py-2">
                  Sent
                </th>
                <th className="w-[9%] border-b border-r border-slate-200 px-2 py-2 text-right">
                  Invoice total
                </th>
                <th className="w-[9%] border-b border-r border-slate-200 px-2 py-2 text-right">
                  My money
                </th>
                <th className="w-[9%] border-b border-slate-200 px-2 py-2 text-right">
                  Other company
                </th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan="9"
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Loading invoice register...
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td
                    colSpan="9"
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    No invoices match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((invoice, index) => {
                  const myMoney = Number(
                    invoice.internal_amount ??
                      invoice.total ??
                      0
                  );

                  const otherCompany = Math.max(
                    0,
                    Number(invoice.total || 0) -
                      myMoney
                  );

                  return (
                    <tr
                      key={invoice.id}
                      className={
                        index % 2 === 0
                          ? "bg-white"
                          : "bg-slate-50/70"
                      }
                    >
                      <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2 font-bold">
                        {invoice.invoice_number}
                      </td>

                      <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2">
                        {formatDate(invoice.issue_date)}
                      </td>

                      <td className="border-b border-r border-slate-200 px-2 py-2 font-medium break-words">
                        {getClientName(invoice)}
                      </td>

                      <td className="border-b border-r border-slate-200 px-2 py-2 text-slate-700 break-words">
                        {getDescription(invoice)}
                      </td>

                      <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2">
                        <span
                          className={`inline-flex rounded px-2 py-1 text-xs font-bold ${paymentClass(
                            invoice
                          )}`}
                        >
                          {paymentLabel(invoice)}
                        </span>
                      </td>

                      <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2">
                        <span
                          className={`inline-flex rounded px-2 py-1 text-xs font-bold ${sentClass(
                            invoice
                          )}`}
                        >
                          {sentLabel(invoice)}
                        </span>
                      </td>

                      <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2 text-right font-bold">
                        {formatMoney(invoice.total)}
                      </td>

                      <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2 text-right font-bold text-green-700">
                        {formatMoney(myMoney)}
                      </td>

                      <td className="whitespace-nowrap border-b border-slate-200 px-2 py-2 text-right font-bold text-purple-700">
                        {formatMoney(otherCompany)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {!loading && filteredInvoices.length > 0 && (
              <tfoot className="bg-slate-100 font-bold">
                <tr>
                  <td
                    colSpan="6"
                    className="border-t border-r border-slate-300 px-2 py-2 text-right"
                  >
                    Totals
                  </td>
                  <td className="border-t border-r border-slate-300 px-2 py-2 text-right">
                    {formatMoney(totals.invoiceTotal)}
                  </td>
                  <td className="border-t border-r border-slate-300 px-2 py-2 text-right text-green-700">
                    {formatMoney(totals.myMoney)}
                  </td>
                  <td className="border-t border-slate-300 px-2 py-2 text-right text-purple-700">
                    {formatMoney(totals.otherCompany)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
