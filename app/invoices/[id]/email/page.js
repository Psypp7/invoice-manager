"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

const fallbackSubject = "Invoice for {{property_address}}";

const fallbackBody = `PLEASE NOTE THE NEW ACCOUNT NUMBER FROM JULY

{{greeting}}

Please find attached an invoice for the above report.

Best regards

Magda Rac-Paczesny
right inventories ltd
m: 07866611413
e: info@rightinventories.co.uk
w: www.rightinventories.co.uk`;

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

function buildPropertyAddress(property) {
  if (!property) {
    return "";
  }

  return [
    property.property_name,
    property.address_line_1,
    property.address_line_2,
    property.city,
    property.postcode,
  ]
    .filter(Boolean)
    .join(", ");
}

function replaceTemplateVariables(text, values) {
  return String(text || "")
    .replaceAll(
      "{{property_address}}",
      values.propertyAddress || "Property address"
    )
    .replaceAll(
      "{{invoice_number}}",
      values.invoiceNumber || ""
    )
    .replaceAll(
      "{{client_name}}",
      values.clientName || ""
    )
    .replaceAll("{{greeting}}", getGreeting());
}

export default function InvoiceEmailPage() {
  const params = useParams();
  const invoiceId = params.id;

  const [invoice, setInvoice] = useState(null);
  const [business, setBusiness] = useState(null);

  const [form, setForm] = useState({
    to: "",
    subject: "",
    body: "",
  });

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [successMessage, setSuccessMessage] =
    useState("");

  useEffect(() => {
    if (invoiceId) {
      loadInvoice();
    }
  }, [invoiceId]);

  async function loadInvoice() {
    setLoading(true);
    setMessage("");
    setSuccessMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must sign in first.");
      }

const {
  data: businessData,
  error: businessError,
} = await supabase
  .from("businesses")
  .select(
    `
      id,
      business_name,
      invoice_email_sender_name,
      invoice_email_reply_to,
      invoice_email_subject,
      invoice_email_body
    `
  )
  .eq("owner_user_id", user.id)
  .single();

      if (businessError) {
        throw businessError;
      }

      const {
        data: invoiceData,
        error: invoiceError,
      } = await supabase
        .from("invoices")
        .select(
          `
            id,
            invoice_number,
            issue_date,
            customer_name,
            customer_email,
            customer_address,
            subtotal,
            total,
            status,
            property:properties(
              id,
              property_name,
              address_line_1,
              address_line_2,
              city,
              postcode
            ),
            invoice_items(
              id,
              description,
              quantity,
              unit_price,
              line_total,
              sort_order
            )
          `
        )
        .eq("id", invoiceId)
        .eq("business_id", businessData.id)
        .single();

      if (invoiceError) {
        throw invoiceError;
      }

      const propertyAddress = buildPropertyAddress(
        invoiceData.property
      );

      const templateValues = {
        propertyAddress,
        invoiceNumber: invoiceData.invoice_number,
        clientName: invoiceData.customer_name,
      };

      const subjectTemplate =
        businessData.invoice_email_subject ||
        fallbackSubject;

      const bodyTemplate =
        businessData.invoice_email_body ||
        fallbackBody;

      const sortedItems = [
        ...(invoiceData.invoice_items || []),
      ].sort(
        (firstItem, secondItem) =>
          Number(firstItem.sort_order || 0) -
          Number(secondItem.sort_order || 0)
      );

      const preparedInvoice = {
        ...invoiceData,
        invoice_items: sortedItems,
      };

      setBusiness(businessData);
      setInvoice(preparedInvoice);

      setForm({
        to: invoiceData.customer_email || "",
        subject: replaceTemplateVariables(
          subjectTemplate,
          templateValues
        ),
        body: replaceTemplateVariables(
          bodyTemplate,
          templateValues
        ),
      });
    } catch (error) {
      console.error("Load invoice error:", error);

      setMessage(
        error?.message ||
          "The invoice email could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    setMessage("");
    setSuccessMessage("");
  }

  const mailtoLink = useMemo(() => {
    const recipient = encodeURIComponent(
      form.to.trim()
    );
    const subject = encodeURIComponent(form.subject);
    const body = encodeURIComponent(form.body);

    return `mailto:${recipient}?subject=${subject}&body=${body}`;
  }, [form]);

  const gmailLink = useMemo(() => {
    const recipient = encodeURIComponent(
      form.to.trim()
    );
    const subject = encodeURIComponent(form.subject);
    const body = encodeURIComponent(form.body);

    return `https://mail.google.com/mail/?view=cm&fs=1&to=${recipient}&su=${subject}&body=${body}`;
  }, [form]);

  function validateEmail() {
    if (!form.to.trim()) {
      setMessage(
        "Enter the recipient email address."
      );
      return false;
    }

    if (!form.to.includes("@")) {
      setMessage(
        "Enter a valid recipient email address."
      );
      return false;
    }

    if (!form.subject.trim()) {
      setMessage("Enter the email subject.");
      return false;
    }

    if (!form.body.trim()) {
      setMessage("Enter the email message.");
      return false;
    }

    setMessage("");
    return true;
  }

  async function sendInvoiceEmail() {
    if (!validateEmail()) {
      return;
    }

    setSending(true);
    setMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(
        "/api/send-invoice",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: form.to.trim(),
            subject: form.subject.trim(),
            message: form.body,
            invoice,
            business,
          }),
        }
      );

      let result;

      try {
        result = await response.json();
      } catch {
        throw new Error(
          "The server returned an invalid response."
        );
      }

      if (!response.ok) {
        throw new Error(
          result.error ||
            "The invoice email could not be sent."
        );
      }

      setSuccessMessage(
        `Invoice ${invoice.invoice_number} was sent successfully to ${form.to.trim()}.`
      );
    } catch (error) {
      console.error("Send invoice error:", error);

      setMessage(
        error?.message ||
          "An unexpected error occurred while sending the invoice."
      );
    } finally {
      setSending(false);
    }
  }

  function openGmail(event) {
    event.preventDefault();

    if (!validateEmail()) {
      return;
    }

    window.open(
      gmailLink,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function openEmailApp(event) {
    event.preventDefault();

    if (!validateEmail()) {
      return;
    }

    window.location.href = mailtoLink;
  }

  if (loading) {
    return (
      <p className="text-slate-500">
        Loading invoice email...
      </p>
    );
  }

  if (!invoice) {
    return (
      <div>
        <p className="text-red-600">
          {message || "Invoice not found."}
        </p>

        <Link
          href="/invoices"
          className="mt-4 inline-block font-semibold text-blue-600"
        >
          Return to invoices
        </Link>
      </div>
    );
  }

  return (
    <>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold">
            Email {invoice.invoice_number}
          </h1>

          <p className="mt-2 text-slate-500">
            Review the email and send the invoice PDF
            directly to the recipient.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/invoices/${invoice.id}`}
            className="rounded-lg border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-50"
          >
            View PDF
          </Link>

          <Link
            href="/invoices"
            className="rounded-lg border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-50"
          >
            Back
          </Link>
        </div>
      </header>

      {message && (
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm font-semibold text-red-700 shadow-sm">
          {message}
        </div>
      )}

      {successMessage && (
        <div className="mt-6 rounded-lg bg-green-50 p-4 text-sm font-semibold text-green-700 shadow-sm">
          {successMessage}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_420px]">
        <section className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            Email details
          </h2>

          <div className="mt-6">
            <label
              htmlFor="to"
              className="mb-2 block text-sm font-semibold"
            >
              To
            </label>

            <input
              id="to"
              type="email"
              name="to"
              value={form.to}
              onChange={updateField}
              placeholder="client@example.com"
              disabled={sending}
              className="w-full rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
            />
          </div>

          <div className="mt-5">
            <label
              htmlFor="subject"
              className="mb-2 block text-sm font-semibold"
            >
              Subject
            </label>

            <input
              id="subject"
              name="subject"
              value={form.subject}
              onChange={updateField}
              disabled={sending}
              className="w-full rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
            />
          </div>

          <div className="mt-5">
            <label
              htmlFor="body"
              className="mb-2 block text-sm font-semibold"
            >
              Message
            </label>

            <textarea
              id="body"
              name="body"
              value={form.body}
              onChange={updateField}
              rows={18}
              disabled={sending}
              className="w-full rounded-lg border border-slate-300 px-4 py-3 leading-7 disabled:bg-slate-100"
            />
          </div>

          <div className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            During testing, send only to the email
            address used for your Resend account. The
            invoice PDF will be attached automatically.
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={sendInvoiceEmail}
              disabled={sending}
              className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {sending
                ? "Sending..."
                : "Send invoice"}
            </button>

            <button
              type="button"
              onClick={openGmail}
              disabled={sending}
              className="rounded-lg border border-slate-300 px-6 py-3 font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open in Gmail
            </button>

            <button
              type="button"
              onClick={openEmailApp}
              disabled={sending}
              className="rounded-lg border border-slate-300 px-6 py-3 font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open email application
            </button>
          </div>
        </section>

        <section className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            Preview
          </h2>

          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                From
              </p>

              <p className="mt-1 font-semibold">
                {business?.invoice_email_sender_name ||
                  "Right Inventories"}
              </p>

              <p className="mt-4 text-xs uppercase tracking-wide text-slate-500">
                To
              </p>

              <p className="mt-1 break-all">
                {form.to || "No recipient"}
              </p>

              <p className="mt-4 text-xs uppercase tracking-wide text-slate-500">
                Subject
              </p>

              <p className="mt-1 font-semibold">
                {form.subject || "No subject"}
              </p>
            </div>

            <div className="p-5">
              <p className="whitespace-pre-wrap leading-7 text-slate-700">
                {form.body || "No message"}
              </p>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Attachment:{" "}
              {invoice.invoice_number || "Invoice"}.pdf
            </div>
          </div>
        </section>
      </div>
    </>
  );
}