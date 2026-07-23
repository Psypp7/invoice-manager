"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

const defaultSubject = "Invoice for {{property_address}}";

const defaultBody = `PLEASE NOTE THE NEW ACCOUNT NUMBER FROM JULY

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

function replaceTemplateVariables(text) {
  return String(text || "")
    .replaceAll(
      "{{property_address}}",
      "Flat 1, 204 Rye Lane, Peckham, SE15 4NF"
    )
    .replaceAll("{{invoice_number}}", "RL1030")
    .replaceAll("{{client_name}}", "Example Client")
    .replaceAll("{{greeting}}", getGreeting());
}

export default function InvoiceEmailSettingsPage() {
  const [businessId, setBusinessId] = useState(null);

  const [form, setForm] = useState({
    invoice_email_sender_name: "Right Inventories",
    invoice_email_reply_to: "info@rightinventories.co.uk",
    invoice_email_subject: defaultSubject,
    invoice_email_body: defaultBody,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    setMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must sign in first.");
      }

      const { data, error } = await supabase
        .from("businesses")
        .select(`
          id,
          invoice_email_sender_name,
          invoice_email_reply_to,
          invoice_email_subject,
          invoice_email_body
        `)
        .eq("owner_user_id", user.id)
        .single();

      if (error) {
        throw error;
      }

      setBusinessId(data.id);

      setForm({
        invoice_email_sender_name:
          data.invoice_email_sender_name ||
          "Right Inventories",

        invoice_email_reply_to:
          data.invoice_email_reply_to ||
          "info@rightinventories.co.uk",

        invoice_email_subject:
          data.invoice_email_subject ||
          defaultSubject,

        invoice_email_body:
          data.invoice_email_body ||
          defaultBody,
      });
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "The email settings could not be loaded."
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
  }

  async function saveSettings(event) {
    event.preventDefault();

    if (!businessId) {
      setMessage("Your business could not be identified.");
      return;
    }

    if (!form.invoice_email_subject.trim()) {
      setMessage("Enter an email subject.");
      return;
    }

    if (!form.invoice_email_body.trim()) {
      setMessage("Enter an email message.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const { error } = await supabase
        .from("businesses")
        .update({
          invoice_email_sender_name:
            form.invoice_email_sender_name.trim(),

          invoice_email_reply_to:
            form.invoice_email_reply_to.trim(),

          invoice_email_subject:
            form.invoice_email_subject.trim(),

          invoice_email_body:
            form.invoice_email_body.trim(),
        })
        .eq("id", businessId);

      if (error) {
        throw error;
      }

      setMessage("Invoice email template saved successfully.");
    } catch (error) {
      console.error(error);

      setMessage(
        error?.message ||
          "The email template could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  function restoreDefault() {
    const confirmed = window.confirm(
      "Restore the original Right Inventories email template?"
    );

    if (!confirmed) return;

    setForm({
      invoice_email_sender_name: "Right Inventories",
      invoice_email_reply_to: "info@rightinventories.co.uk",
      invoice_email_subject: defaultSubject,
      invoice_email_body: defaultBody,
    });

    setMessage(
      "The original template has been restored. Press Save changes to keep it."
    );
  }

  const previewSubject = useMemo(() => {
    return replaceTemplateVariables(
      form.invoice_email_subject
    );
  }, [form.invoice_email_subject]);

  const previewBody = useMemo(() => {
    return replaceTemplateVariables(
      form.invoice_email_body
    );
  }, [form.invoice_email_body]);

  if (loading) {
    return (
      <p className="text-slate-500">
        Loading email settings...
      </p>
    );
  }

  return (
    <>
      <header>
        <h1 className="text-3xl font-bold">
          Invoice email
        </h1>

        <p className="mt-2 text-slate-500">
          Edit the standard message used when sending an
          invoice.
        </p>
      </header>

      {message && (
        <div className="mt-6 rounded-lg bg-white p-4 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <form
          onSubmit={saveSettings}
          className="rounded-xl bg-white p-6 shadow-sm"
        >
          <h2 className="text-xl font-bold">
            Email template
          </h2>

          <div className="mt-6">
            <label className="mb-2 block text-sm font-semibold">
              Sender name
            </label>

            <input
              name="invoice_email_sender_name"
              value={form.invoice_email_sender_name}
              onChange={updateField}
              placeholder="Right Inventories"
              className="w-full rounded-lg border border-slate-300 px-4 py-3"
            />
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-semibold">
              Reply-to email
            </label>

            <input
              type="email"
              name="invoice_email_reply_to"
              value={form.invoice_email_reply_to}
              onChange={updateField}
              placeholder="info@rightinventories.co.uk"
              className="w-full rounded-lg border border-slate-300 px-4 py-3"
            />
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-semibold">
              Subject
            </label>

            <input
              name="invoice_email_subject"
              value={form.invoice_email_subject}
              onChange={updateField}
              required
              className="w-full rounded-lg border border-slate-300 px-4 py-3"
            />
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-semibold">
              Email message
            </label>

            <textarea
              name="invoice_email_body"
              value={form.invoice_email_body}
              onChange={updateField}
              required
              rows="17"
              className="w-full rounded-lg border border-slate-300 px-4 py-3 font-mono text-sm"
            />
          </div>

          <div className="mt-5 rounded-lg bg-slate-50 p-4">
            <p className="text-sm font-semibold">
              Available automatic fields
            </p>

            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <code className="rounded bg-white px-2 py-1">
                {"{{property_address}}"}
              </code>

              <code className="rounded bg-white px-2 py-1">
                {"{{invoice_number}}"}
              </code>

              <code className="rounded bg-white px-2 py-1">
                {"{{client_name}}"}
              </code>

              <code className="rounded bg-white px-2 py-1">
                {"{{greeting}}"}
              </code>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving
                ? "Saving..."
                : "Save changes"}
            </button>

            <button
              type="button"
              onClick={restoreDefault}
              className="rounded-lg border border-slate-300 px-6 py-3 font-semibold"
            >
              Restore original
            </button>
          </div>
        </form>

        <section className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            Email preview
          </h2>

          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 p-4">
              <p className="text-sm text-slate-500">
                From
              </p>

              <p className="mt-1 font-semibold">
                {form.invoice_email_sender_name ||
                  "Right Inventories"}
              </p>

              <p className="mt-4 text-sm text-slate-500">
                Subject
              </p>

              <p className="mt-1 font-semibold">
                {previewSubject}
              </p>
            </div>

            <div className="p-5">
              <p className="whitespace-pre-wrap leading-7 text-slate-700">
                {previewBody}
              </p>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Attachment: RL1030.pdf
            </div>
          </div>
        </section>
      </div>
    </>
  );
}