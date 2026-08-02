"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

const DEFAULT_BODY = `{{greeting}}

Please find attached an invoice for the above report.

Best regards

Magda Rac-Paczesny
right inventories ltd
m: 07866611413
e: info@rightinventories.co.uk
w: www.rightinventories.co.uk`;

function cleanText(value) {
  return String(value ?? "").trim();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    cleanText(value)
  );
}

function getLondonHour() {
  const hourText = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }
  ).format(new Date());

  return Number(hourText);
}

function getGreeting() {
  const hour = getLondonHour();

  if (hour >= 5 && hour < 12) {
    return "Good morning";
  }

  if (hour >= 12 && hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

function contactName(client) {
  return (
    cleanText(client?.company_name) ||
    cleanText(client?.name) ||
    "Unnamed contact"
  );
}

function contactTypeLabel(type) {
  switch (type) {
    case "agent":
      return "Agent";
    case "landlord":
      return "Landlord";
    case "company":
      return "Company";
    default:
      return "Other";
  }
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
    .map(cleanText)
    .filter(Boolean)
    .join(", ");
}

function getFirstDescription(invoice) {
  return cleanText(
    invoice?.invoice_items?.[0]?.description
  );
}

function extractPropertyFromDescription(description) {
  const text = cleanText(description);

  if (!text) {
    return "";
  }

  const matches = [
    ...text.matchAll(/\s+at\s+/gi),
  ];

  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1];

    return text
      .slice(lastMatch.index + lastMatch[0].length)
      .trim();
  }

  return text
    .replace(
      /^(check[- ]?in|check[- ]?out|inventory|midterm inspection|midterm)\s+report\s+(from|for)\s+\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}\s*/i,
      ""
    )
    .trim();
}

function invoicePropertyAddress(invoice) {
  return (
    extractPropertyFromDescription(
      getFirstDescription(invoice)
    ) ||
    buildPropertyAddress(invoice?.property) ||
    cleanText(invoice?.customer_address) ||
    "Property address"
  );
}

function replaceVariables(template, values) {
  return String(template || "")
    .replaceAll(
      "{{property_address}}",
      values.propertyAddress
    )
    .replaceAll(
      "{{invoice_number}}",
      values.invoiceNumber
    )
    .replaceAll(
      "{{client_name}}",
      values.clientName
    )
    .replaceAll(
      "{{greeting}}",
      getGreeting()
    );
}

export default function InvoiceEmailPage() {
  const params = useParams();
  const invoiceId = params.id;

  const [invoice, setInvoice] = useState(null);
  const [business, setBusiness] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [selectedContactId, setSelectedContactId] =
    useState("");
  const [contactTypeFilter, setContactTypeFilter] =
    useState("all");

  const [form, setForm] = useState({
    to: "",
    subject: "",
    body: "",
  });

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingEmail, setSavingEmail] =
    useState(false);
  const [message, setMessage] = useState("");
  const [successMessage, setSuccessMessage] =
    useState("");

  useEffect(() => {
    if (invoiceId) {
      loadPage();
    }
  }, [invoiceId]);

  async function loadPage() {
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
            invoice_email_reply_to
          `
        )
        .eq("owner_user_id", user.id)
        .single();

      if (businessError || !businessData) {
        throw (
          businessError ||
          new Error("Business could not be found.")
        );
      }

      const [
        invoiceResult,
        contactsResult,
      ] = await Promise.all([
        supabase
          .from("invoices")
          .select(
            `
              id,
              business_id,
              client_id,
              invoice_number,
              issue_date,
              customer_name,
              customer_email,
              customer_address,
              subtotal,
              total,
              status,
              client:clients(
                id,
                client_type,
                name,
                company_name,
                email
              ),
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
          .single(),

        supabase
          .from("clients")
          .select(
            `
              id,
              client_type,
              name,
              company_name,
              email,
              is_active
            `
          )
          .eq("business_id", businessData.id)
          .eq("is_active", true)
          .order("company_name", {
            ascending: true,
            nullsFirst: false,
          })
          .order("name", {
            ascending: true,
          }),
      ]);

      if (invoiceResult.error) {
        throw invoiceResult.error;
      }

      if (contactsResult.error) {
        throw contactsResult.error;
      }

      const sortedItems = [
        ...(invoiceResult.data.invoice_items ||
          []),
      ].sort(
        (first, second) =>
          Number(first.sort_order || 0) -
          Number(second.sort_order || 0)
      );

      const preparedInvoice = {
        ...invoiceResult.data,
        invoice_items: sortedItems,
      };

      const propertyAddress =
        invoicePropertyAddress(
          preparedInvoice
        );

      const linkedClient =
        preparedInvoice.client || null;

      const initialContactId =
        preparedInvoice.client_id ||
        linkedClient?.id ||
        "";

      const initialEmail =
        cleanText(preparedInvoice.customer_email) ||
        cleanText(linkedClient?.email);

      const body = replaceVariables(
        DEFAULT_BODY,
        {
          propertyAddress,
          invoiceNumber:
            preparedInvoice.invoice_number ||
            "",
          clientName:
            contactName(linkedClient) ||
            preparedInvoice.customer_name ||
            "",
        }
      );

      setBusiness(businessData);
      setInvoice(preparedInvoice);
      setContacts(contactsResult.data || []);
      setSelectedContactId(initialContactId);

      setForm({
        to: initialEmail,
        subject: `Invoice for ${propertyAddress}`,
        body,
      });
    } catch (error) {
      console.error(
        "Load invoice email error:",
        error
      );

      setMessage(
        error?.message ||
          "The invoice email could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  const filteredContacts = useMemo(() => {
    if (contactTypeFilter === "all") {
      return contacts;
    }

    return contacts.filter(
      (contact) =>
        contact.client_type ===
        contactTypeFilter
    );
  }, [contacts, contactTypeFilter]);

  const selectedContact = useMemo(
    () =>
      contacts.find(
        (contact) =>
          contact.id === selectedContactId
      ) || null,
    [contacts, selectedContactId]
  );

  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    setMessage("");
    setSuccessMessage("");
  }

  function chooseContact(event) {
    const contactId = event.target.value;

    setSelectedContactId(contactId);
    setMessage("");
    setSuccessMessage("");

    if (!contactId) {
      return;
    }

    const contact = contacts.find(
      (item) => item.id === contactId
    );

    if (!contact) {
      return;
    }

    setForm((current) => ({
      ...current,
      to: cleanText(contact.email),
    }));
  }

  async function saveRecipientEmail({
    showSuccess = true,
  } = {}) {
    const email = cleanText(form.to);

    if (!selectedContactId) {
      if (showSuccess) {
        setMessage(
          "Choose an agent, landlord or company before saving the email address."
        );
      }

      return false;
    }

    if (!validEmail(email)) {
      if (showSuccess) {
        setMessage(
          "Enter a valid email address before saving it."
        );
      }

      return false;
    }

    setSavingEmail(true);

    try {
      const {
        error: contactError,
      } = await supabase
        .from("clients")
        .update({
          email,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", selectedContactId)
        .eq("business_id", business.id);

      if (contactError) {
        throw contactError;
      }

      if (
        invoice.client_id ===
        selectedContactId
      ) {
        const {
          error: invoiceError,
        } = await supabase
          .from("invoices")
          .update({
            customer_email: email,
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", invoice.id)
          .eq(
            "business_id",
            business.id
          );

        if (invoiceError) {
          throw invoiceError;
        }
      }

      setContacts((current) =>
        current.map((contact) =>
          contact.id === selectedContactId
            ? {
                ...contact,
                email,
              }
            : contact
        )
      );

      setInvoice((current) => ({
        ...current,
        customer_email:
          current.client_id ===
          selectedContactId
            ? email
            : current.customer_email,
        client:
          current.client?.id ===
          selectedContactId
            ? {
                ...current.client,
                email,
              }
            : current.client,
      }));

      if (showSuccess) {
        setSuccessMessage(
          `Email saved for ${contactName(
            selectedContact
          )}.`
        );
      }

      return true;
    } catch (error) {
      console.error(
        "Save recipient email error:",
        error
      );

      setMessage(
        error?.message ||
          "The recipient email could not be saved."
      );

      return false;
    } finally {
      setSavingEmail(false);
    }
  }

  function validateEmail() {
    if (!validEmail(form.to)) {
      setMessage(
        "Enter a valid recipient email address."
      );
      return false;
    }

    if (!cleanText(form.subject)) {
      setMessage("Enter the email subject.");
      return false;
    }

    if (!cleanText(form.body)) {
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
      if (selectedContactId) {
        const saved =
          await saveRecipientEmail({
            showSuccess: false,
          });

        if (!saved) {
          throw new Error(
            "The selected contact email could not be saved."
          );
        }
      }

      const response = await fetch(
        "/api/send-invoice",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            to: cleanText(form.to),
            subject: cleanText(
              form.subject
            ),
            message: form.body,
            invoice: {
              ...invoice,
              customer_email:
                cleanText(form.to),
            },
            business,
          }),
        }
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error ||
            "The invoice email could not be sent."
        );
      }

      setInvoice((current) => ({
        ...current,
        sent_at:
          result.sentAt ||
          new Date().toISOString(),
        customer_email:
          cleanText(form.to),
      }));

      setSuccessMessage(
        `${invoice.invoice_number} was sent successfully to ${cleanText(
          form.to
        )}.`
      );
    } catch (error) {
      console.error(
        "Send invoice error:",
        error
      );

      setMessage(
        error?.message ||
          "An unexpected error occurred while sending the invoice."
      );
    } finally {
      setSending(false);
    }
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
            Choose a saved contact or type any
            recipient address, then review and send
            the attached invoice.
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

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_430px]">
        <section className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            Email details
          </h2>

          <div className="mt-6 grid gap-4 md:grid-cols-[190px_1fr]">
            <div>
              <label
                htmlFor="contactType"
                className="mb-2 block text-sm font-semibold"
              >
                Contact type
              </label>

              <select
                id="contactType"
                value={contactTypeFilter}
                onChange={(event) =>
                  setContactTypeFilter(
                    event.target.value
                  )
                }
                disabled={sending}
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              >
                <option value="all">
                  All contacts
                </option>
                <option value="agent">
                  Agents
                </option>
                <option value="landlord">
                  Landlords
                </option>
                <option value="company">
                  Companies
                </option>
                <option value="other">
                  Other
                </option>
              </select>
            </div>

            <div>
              <label
                htmlFor="savedContact"
                className="mb-2 block text-sm font-semibold"
              >
                Choose agent, landlord or company
              </label>

              <select
                id="savedContact"
                value={selectedContactId}
                onChange={chooseContact}
                disabled={sending}
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              >
                <option value="">
                  Type an email manually
                </option>

                {filteredContacts.map(
                  (contact) => (
                    <option
                      key={contact.id}
                      value={contact.id}
                    >
                      {contactName(contact)} —{" "}
                      {contactTypeLabel(
                        contact.client_type
                      )}
                      {contact.email
                        ? ` — ${contact.email}`
                        : " — no email saved"}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>

          <div className="mt-5">
            <label
              htmlFor="to"
              className="mb-2 block text-sm font-semibold"
            >
              Recipient email
            </label>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="to"
                type="email"
                name="to"
                value={form.to}
                onChange={updateField}
                placeholder="accounts@example.com"
                disabled={sending}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-3 disabled:bg-slate-100"
              />

              <button
                type="button"
                onClick={() =>
                  saveRecipientEmail()
                }
                disabled={
                  sending ||
                  savingEmail ||
                  !selectedContactId
                }
                className="rounded-lg border border-blue-600 px-4 py-3 font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
              >
                {savingEmail
                  ? "Saving..."
                  : "Save to contact"}
              </button>
            </div>

            <p className="mt-2 text-sm text-slate-500">
              When a saved contact is selected, any
              changed email address is remembered when
              you press “Save to contact” or send the
              invoice.
            </p>
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

            <p className="mt-2 text-sm text-slate-500">
              Automatically created from the property
              address on this invoice.
            </p>
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
              rows={15}
              disabled={sending}
              className="w-full rounded-lg border border-slate-300 px-4 py-3 leading-7 disabled:bg-slate-100"
            />

            <p className="mt-2 text-sm text-slate-500">
              The greeting is generated automatically using the current London time:
              Good morning from 05:00, Good afternoon from 12:00, and Good evening from 18:00.
            </p>
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
          </div>
        </section>

        <section className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            Email preview
          </h2>

          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                From
              </p>

              <p className="mt-1 font-semibold">
                Right Inventories London
              </p>

              <p className="mt-1 text-sm text-slate-500">
                invoices@rightinventories.co.uk
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
              The invoice PDF is attached
              automatically.
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
