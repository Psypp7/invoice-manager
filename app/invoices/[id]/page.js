"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  PDFDownloadLink,
  PDFViewer,
} from "@react-pdf/renderer";
import InvoicePdf from "../../../components/InvoicePdf";
import { supabase } from "../../../lib/supabase";

export default function InvoiceDocumentPage() {
  const params = useParams();
  const router = useRouter();

  const invoiceId = params.id;

  const [invoice, setInvoice] = useState(null);
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadInvoice();
  }, [invoiceId]);

  async function loadInvoice() {
    setLoading(true);
    setMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/login");
        return;
      }

      const {
        data: invoiceData,
        error: invoiceError,
      } = await supabase
        .from("invoices")
        .select(`
          *,
          invoice_items (
            id,
            description,
            quantity,
            unit_price,
            vat_rate,
            line_subtotal,
            line_vat,
            line_total,
            sort_order
          ),
          property:properties (
            id,
            property_name,
            address_line_1,
            address_line_2,
            city,
            postcode
          )
        `)
        .eq("id", invoiceId)
        .single();

      if (invoiceError) {
        throw invoiceError;
      }

      const {
        data: businessData,
        error: businessError,
      } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", invoiceData.business_id)
        .single();

      if (businessError) {
        throw businessError;
      }

      invoiceData.invoice_items = (
        invoiceData.invoice_items || []
      ).sort(
        (first, second) =>
          Number(first.sort_order) -
          Number(second.sort_order)
      );

      setInvoice(invoiceData);
      setBusiness(businessData);
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "The invoice could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <p className="text-slate-500">
        Loading invoice...
      </p>
    );
  }

  if (message || !invoice) {
    return (
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">
          Invoice unavailable
        </h1>

        <p className="mt-3 text-red-600">
          {message || "Invoice not found."}
        </p>

        <button
          type="button"
          onClick={() => router.push("/invoices")}
          className="mt-6 rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white"
        >
          Back to invoices
        </button>
      </div>
    );
  }

  const fileName = `${invoice.invoice_number}.pdf`;

  return (
    <>
      <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold">
            {invoice.invoice_number}
          </h1>

          <p className="mt-2 text-slate-500">
            Preview and download the invoice PDF.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => router.push("/invoices")}
            className="rounded-lg border border-slate-300 px-5 py-3 font-semibold"
          >
            Back
          </button>

          <PDFDownloadLink
            document={
              <InvoicePdf
                invoice={invoice}
                business={business}
              />
            }
            fileName={fileName}
            className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
          >
            {({ loading: preparingPdf }) =>
              preparingPdf
                ? "Preparing PDF..."
                : "Download PDF"
            }
          </PDFDownloadLink>
        </div>
      </header>

      <section className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="h-[calc(100vh-210px)] min-h-[700px]">
          <PDFViewer
            width="100%"
            height="100%"
            showToolbar
          >
            <InvoicePdf
              invoice={invoice}
              business={business}
            />
          </PDFViewer>
        </div>
      </section>
    </>
  );
}