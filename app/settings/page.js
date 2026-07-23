"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const DEFAULT_SETTINGS = {
  company: {
    legal_name: "Right Inventories London Ltd",
    trading_name: "Right Inventories",
    company_number: "",
    vat_number: "",
    email: "",
    phone: "",
    website: "",
    address_line_1: "",
    address_line_2: "",
    city: "",
    postcode: "",
    logo_url: "",
  },
  invoice: {
    prefix: "RL",
    next_number: 1045,
    default_status: "unpaid",
    default_currency: "GBP",
    payment_terms_days: 0,
    default_description: "",
    footer_note:
      "Thank you for your business.",
    show_company_number: true,
    show_vat_number: false,
    show_payment_details: true,
  },
  payment: {
    account_name:
      "Right Inventories London Ltd",
    bank_name: "HSBC",
    sort_code: "40-46-09",
    account_number: "92210193",
    payment_reference:
      "Please use the invoice number as the payment reference.",
  },
  email: {
    sender_name:
      "Right Inventories London Ltd",
    reply_to_email: "",
    default_subject:
      "{{invoice_number}} from Right Inventories London Ltd",
    default_message:
      "Please find invoice {{invoice_number}} attached.",
    signature:
      "Kind regards,\nRight Inventories London Ltd",
    cc_email: "",
    bcc_email: "",
  },
  preferences: {
    date_format: "DD/MM/YYYY",
    filename_date_format: "DD.MM.YYYY",
    dashboard_currency: "GBP",
    compact_tables: true,
    show_deleted_shortcut: true,
  },
};

const TABS = [
  { id: "company", label: "Company" },
  { id: "invoice", label: "Invoices" },
  { id: "payment", label: "Payment" },
  { id: "email", label: "Email" },
  { id: "preferences", label: "Preferences" },
];

function cloneDefaults() {
  return JSON.parse(
    JSON.stringify(DEFAULT_SETTINGS)
  );
}

function mergeSettings(saved) {
  const defaults = cloneDefaults();

  return {
    company: {
      ...defaults.company,
      ...(saved?.company || {}),
    },
    invoice: {
      ...defaults.invoice,
      ...(saved?.invoice || {}),
    },
    payment: {
      ...defaults.payment,
      ...(saved?.payment || {}),
    },
    email: {
      ...defaults.email,
      ...(saved?.email || {}),
    },
    preferences: {
      ...defaults.preferences,
      ...(saved?.preferences || {}),
    },
  };
}

function Field({
  label,
  hint,
  children,
  required = false,
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1 text-sm font-semibold text-slate-700">
        {label}
        {required && (
          <span className="text-red-500">
            *
          </span>
        )}
      </span>

      {hint && (
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {hint}
        </span>
      )}

      <div className="mt-2">
        {children}
      </div>
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder = "",
  type = "text",
  disabled = false,
}) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(event) =>
        onChange(event.target.value)
      }
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder = "",
  rows = 4,
}) {
  return (
    <textarea
      value={value ?? ""}
      onChange={(event) =>
        onChange(event.target.value)
      }
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
    />
  );
}

function SelectInput({
  value,
  onChange,
  children,
}) {
  return (
    <select
      value={value}
      onChange={(event) =>
        onChange(event.target.value)
      }
      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
    >
      {children}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-5 rounded-xl border border-slate-200 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
    >
      <span>
        <span className="block font-semibold text-slate-900">
          {label}
        </span>

        {description && (
          <span className="mt-1 block text-sm leading-5 text-slate-500">
            {description}
          </span>
        )}
      </span>

      <span
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition ${
          checked
            ? "bg-blue-600"
            : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${
            checked
              ? "left-6"
              : "left-1"
          }`}
        />
      </span>
    </button>
  );
}

function Section({
  title,
  description,
  children,
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
        <h2 className="text-lg font-bold text-slate-900">
          {title}
        </h2>

        {description && (
          <p className="mt-1 text-sm leading-6 text-slate-500">
            {description}
          </p>
        )}
      </div>

      <div className="p-5 sm:p-6">
        {children}
      </div>
    </section>
  );
}

function PreviewCard({ settings }) {
  const filename = [
    "RL1045",
    settings.company.trading_name ||
      settings.company.legal_name ||
      "Client",
    settings.preferences
      .filename_date_format === "DD.MM.YYYY"
      ? "21.07.2026"
      : "21-07-2026",
  ].join(" ");

  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">
        Live preview
      </h2>

      <p className="mt-1 text-sm text-slate-500">
        This shows how the saved settings will appear in normal use.
      </p>

      <div className="mt-5 space-y-4">
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Company
          </p>

          <p className="mt-2 font-bold text-slate-900">
            {settings.company.legal_name ||
              "Company name"}
          </p>

          <p className="mt-1 text-sm text-slate-600">
            {[
              settings.company.address_line_1,
              settings.company.address_line_2,
              settings.company.city,
              settings.company.postcode,
            ]
              .filter(Boolean)
              .join(", ") ||
              "Company address"}
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Bank details
          </p>

          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">
                Account
              </dt>
              <dd className="text-right font-semibold">
                {settings.payment.account_name ||
                  "—"}
              </dd>
            </div>

            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">
                Sort code
              </dt>
              <dd className="font-semibold">
                {settings.payment.sort_code ||
                  "—"}
              </dd>
            </div>

            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">
                Account no.
              </dt>
              <dd className="font-semibold">
                {settings.payment.account_number ||
                  "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            PDF filename
          </p>

          <p className="mt-2 break-all text-sm font-semibold text-slate-800">
            {filename}.pdf
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Email subject
          </p>

          <p className="mt-2 break-words text-sm font-semibold text-slate-800">
            {settings.email.default_subject.replaceAll(
              "{{invoice_number}}",
              "RL1045"
            )}
          </p>
        </div>
      </div>
    </aside>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] =
    useState("company");
  const [settings, setSettings] =
    useState(cloneDefaults());
  const [business, setBusiness] =
    useState(null);
  const [loading, setLoading] =
    useState(true);
  const [saving, setSaving] =
    useState(false);
  const [message, setMessage] =
    useState("");
  const [messageType, setMessageType] =
    useState("success");
  const [hasChanges, setHasChanges] =
    useState(false);

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
        throw new Error(
          "You must sign in before viewing settings."
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

      const {
        data: settingsData,
        error: settingsError,
      } = await supabase
        .from("business_settings")
        .select("settings")
        .eq(
          "business_id",
          businessData.id
        )
        .maybeSingle();

      if (settingsError) {
        throw settingsError;
      }

      const nextSettings =
        mergeSettings(
          settingsData?.settings
        );

      if (
        !settingsData?.settings &&
        businessData.business_name
      ) {
        nextSettings.company.legal_name =
          businessData.business_name;
      }

      setSettings(nextSettings);
      setHasChanges(false);
    } catch (error) {
      console.error(error);
      setMessageType("error");
      setMessage(
        error?.message ||
          "The settings could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  function updateSection(
    section,
    field,
    value
  ) {
    setSettings((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value,
      },
    }));

    setHasChanges(true);
    setMessage("");
  }

  async function saveSettings() {
    if (!business?.id) {
      setMessageType("error");
      setMessage(
        "Business information is missing."
      );
      return;
    }

    const legalName =
      settings.company.legal_name.trim();

    if (!legalName) {
      setMessageType("error");
      setMessage(
        "Company legal name is required."
      );
      setActiveTab("company");
      return;
    }

    const nextNumber =
      Number(settings.invoice.next_number);

    if (
      !Number.isInteger(nextNumber) ||
      nextNumber < 1
    ) {
      setMessageType("error");
      setMessage(
        "Next invoice number must be a whole number greater than zero."
      );
      setActiveTab("invoice");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const {
        error: settingsError,
      } = await supabase
        .from("business_settings")
        .upsert(
          {
            business_id: business.id,
            settings: {
              ...settings,
              invoice: {
                ...settings.invoice,
                next_number: nextNumber,
                payment_terms_days: Number(
                  settings.invoice
                    .payment_terms_days || 0
                ),
              },
            },
            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict: "business_id",
          }
        );

      if (settingsError) {
        throw settingsError;
      }

      setSettings((current) => ({
        ...current,
        invoice: {
          ...current.invoice,
          next_number: nextNumber,
          payment_terms_days: Number(
            current.invoice
              .payment_terms_days || 0
          ),
        },
      }));

      setHasChanges(false);
      setMessageType("success");
      setMessage(
        "Settings saved successfully."
      );
    } catch (error) {
      console.error(error);
      setMessageType("error");
      setMessage(
        error?.message ||
          "The settings could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  function resetCurrentSection() {
    const defaults = cloneDefaults();

    setSettings((current) => ({
      ...current,
      [activeTab]: defaults[activeTab],
    }));

    setHasChanges(true);
    setMessageType("success");
    setMessage(
      `${
        TABS.find(
          (tab) =>
            tab.id === activeTab
        )?.label || "Section"
      } reset to defaults. Save changes to confirm.`
    );
  }

  const tabLabel = useMemo(
    () =>
      TABS.find(
        (tab) =>
          tab.id === activeTab
      )?.label || "Settings",
    [activeTab]
  );

  if (loading) {
    return (
      <div className="min-w-0 max-w-full">
        <p className="text-slate-500">
          Loading settings...
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden pb-28">
      <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">
            Right Inventories
          </p>

          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Settings
          </h1>

          <p className="mt-2 max-w-3xl text-slate-500">
            Manage company details, invoice defaults, bank information and email preferences.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={resetCurrentSection}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reset {tabLabel}
          </button>

          <button
            type="button"
            onClick={saveSettings}
            disabled={
              saving || !hasChanges
            }
            className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving
              ? "Saving..."
              : hasChanges
              ? "Save changes"
              : "Saved"}
          </button>
        </div>
      </header>

      {message && (
        <div
          className={`rounded-xl border p-4 text-sm font-medium ${
            messageType === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {message}
        </div>
      )}

      <nav className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex min-w-max gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() =>
                setActiveTab(tab.id)
              }
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === tab.id
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-6">
          {activeTab === "company" && (
            <>
              <Section
                title="Company identity"
                description="These details can be used on invoices, reports and outgoing emails."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <Field
                    label="Legal company name"
                    required
                  >
                    <TextInput
                      value={
                        settings.company
                          .legal_name
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "legal_name",
                          value
                        )
                      }
                      placeholder="Right Inventories London Ltd"
                    />
                  </Field>

                  <Field label="Trading name">
                    <TextInput
                      value={
                        settings.company
                          .trading_name
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "trading_name",
                          value
                        )
                      }
                      placeholder="Right Inventories"
                    />
                  </Field>

                  <Field label="Company number">
                    <TextInput
                      value={
                        settings.company
                          .company_number
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "company_number",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="VAT number">
                    <TextInput
                      value={
                        settings.company
                          .vat_number
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "vat_number",
                          value
                        )
                      }
                    />
                  </Field>
                </div>
              </Section>

              <Section
                title="Contact information"
                description="The contact details customers should use."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Email address">
                    <TextInput
                      type="email"
                      value={
                        settings.company.email
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "email",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Telephone">
                    <TextInput
                      value={
                        settings.company.phone
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "phone",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Website">
                    <TextInput
                      value={
                        settings.company.website
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "website",
                          value
                        )
                      }
                      placeholder="https://..."
                    />
                  </Field>

                  <Field
                    label="Logo URL"
                    hint="Optional. Use a publicly accessible image URL."
                  >
                    <TextInput
                      value={
                        settings.company.logo_url
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "logo_url",
                          value
                        )
                      }
                      placeholder="https://..."
                    />
                  </Field>
                </div>
              </Section>

              <Section
                title="Registered address"
                description="Used when an invoice or report needs the company address."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Address line 1">
                    <TextInput
                      value={
                        settings.company
                          .address_line_1
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "address_line_1",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Address line 2">
                    <TextInput
                      value={
                        settings.company
                          .address_line_2
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "address_line_2",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="City">
                    <TextInput
                      value={
                        settings.company.city
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "city",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Postcode">
                    <TextInput
                      value={
                        settings.company
                          .postcode
                      }
                      onChange={(value) =>
                        updateSection(
                          "company",
                          "postcode",
                          value.toUpperCase()
                        )
                      }
                    />
                  </Field>
                </div>
              </Section>
            </>
          )}

          {activeTab === "invoice" && (
            <>
              <Section
                title="Invoice numbering"
                description="Control the default RL invoice sequence used when creating invoices."
              >
                <div className="grid gap-5 md:grid-cols-3">
                  <Field label="Prefix">
                    <TextInput
                      value={
                        settings.invoice.prefix
                      }
                      onChange={(value) =>
                        updateSection(
                          "invoice",
                          "prefix",
                          value
                            .toUpperCase()
                            .replace(
                              /[^A-Z]/g,
                              ""
                            )
                        )
                      }
                      placeholder="RL"
                    />
                  </Field>

                  <Field
                    label="Next number"
                    hint="This is a display preference. Your existing invoice sequence remains the source of truth unless you connect it separately."
                  >
                    <TextInput
                      type="number"
                      value={
                        settings.invoice
                          .next_number
                      }
                      onChange={(value) =>
                        updateSection(
                          "invoice",
                          "next_number",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Default status">
                    <SelectInput
                      value={
                        settings.invoice
                          .default_status
                      }
                      onChange={(value) =>
                        updateSection(
                          "invoice",
                          "default_status",
                          value
                        )
                      }
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
                    </SelectInput>
                  </Field>
                </div>
              </Section>

              <Section
                title="Invoice defaults"
                description="Values automatically offered when a new invoice is created."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Currency">
                    <SelectInput
                      value={
                        settings.invoice
                          .default_currency
                      }
                      onChange={(value) =>
                        updateSection(
                          "invoice",
                          "default_currency",
                          value
                        )
                      }
                    >
                      <option value="GBP">
                        GBP — British pound
                      </option>
                    </SelectInput>
                  </Field>

                  <Field
                    label="Payment terms"
                    hint="Use 0 for payment immediately."
                  >
                    <SelectInput
                      value={String(
                        settings.invoice
                          .payment_terms_days
                      )}
                      onChange={(value) =>
                        updateSection(
                          "invoice",
                          "payment_terms_days",
                          Number(value)
                        )
                      }
                    >
                      <option value="0">
                        Payment immediately
                      </option>
                      <option value="7">
                        7 days
                      </option>
                      <option value="14">
                        14 days
                      </option>
                      <option value="30">
                        30 days
                      </option>
                    </SelectInput>
                  </Field>

                  <div className="md:col-span-2">
                    <Field label="Default description">
                      <TextArea
                        value={
                          settings.invoice
                            .default_description
                        }
                        onChange={(value) =>
                          updateSection(
                            "invoice",
                            "default_description",
                            value
                          )
                        }
                        placeholder="Optional standard invoice description"
                        rows={3}
                      />
                    </Field>
                  </div>

                  <div className="md:col-span-2">
                    <Field label="Invoice footer">
                      <TextArea
                        value={
                          settings.invoice
                            .footer_note
                        }
                        onChange={(value) =>
                          updateSection(
                            "invoice",
                            "footer_note",
                            value
                          )
                        }
                        rows={3}
                      />
                    </Field>
                  </div>
                </div>
              </Section>

              <Section
                title="Invoice visibility"
                description="Choose which company details should be shown on generated invoices."
              >
                <div className="grid gap-3">
                  <Toggle
                    checked={
                      settings.invoice
                        .show_company_number
                    }
                    onChange={(value) =>
                      updateSection(
                        "invoice",
                        "show_company_number",
                        value
                      )
                    }
                    label="Show company number"
                    description="Display the registered company number on invoices."
                  />

                  <Toggle
                    checked={
                      settings.invoice
                        .show_vat_number
                    }
                    onChange={(value) =>
                      updateSection(
                        "invoice",
                        "show_vat_number",
                        value
                      )
                    }
                    label="Show VAT number"
                    description="Only enable this if the business is VAT registered and the invoice template supports it."
                  />

                  <Toggle
                    checked={
                      settings.invoice
                        .show_payment_details
                    }
                    onChange={(value) =>
                      updateSection(
                        "invoice",
                        "show_payment_details",
                        value
                      )
                    }
                    label="Show payment details"
                    description="Display bank account information on invoice PDFs."
                  />
                </div>
              </Section>
            </>
          )}

          {activeTab === "payment" && (
            <>
              <Section
                title="Bank details"
                description="The account customers should use when paying Right Inventories London Ltd."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Account name">
                    <TextInput
                      value={
                        settings.payment
                          .account_name
                      }
                      onChange={(value) =>
                        updateSection(
                          "payment",
                          "account_name",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Bank name">
                    <TextInput
                      value={
                        settings.payment
                          .bank_name
                      }
                      onChange={(value) =>
                        updateSection(
                          "payment",
                          "bank_name",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Sort code">
                    <TextInput
                      value={
                        settings.payment
                          .sort_code
                      }
                      onChange={(value) =>
                        updateSection(
                          "payment",
                          "sort_code",
                          value
                        )
                      }
                      placeholder="40-46-09"
                    />
                  </Field>

                  <Field label="Account number">
                    <TextInput
                      value={
                        settings.payment
                          .account_number
                      }
                      onChange={(value) =>
                        updateSection(
                          "payment",
                          "account_number",
                          value.replace(
                            /\D/g,
                            ""
                          )
                        )
                      }
                      placeholder="92210193"
                    />
                  </Field>

                  <div className="md:col-span-2">
                    <Field label="Payment instruction">
                      <TextArea
                        value={
                          settings.payment
                            .payment_reference
                        }
                        onChange={(value) =>
                          updateSection(
                            "payment",
                            "payment_reference",
                            value
                          )
                        }
                        rows={3}
                      />
                    </Field>
                  </div>
                </div>
              </Section>

              <Section
                title="Security reminder"
                description="Bank details are stored in your Supabase database."
              >
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                  Confirm bank details carefully before saving. Never store online banking passwords, card PINs, security answers or Resend API keys on this page.
                </div>
              </Section>
            </>
          )}

          {activeTab === "email" && (
            <>
              <Section
                title="Sender details"
                description="The visible identity used in invoice emails. The actual sending address remains controlled by RESEND_FROM_EMAIL on the server."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Sender name">
                    <TextInput
                      value={
                        settings.email
                          .sender_name
                      }
                      onChange={(value) =>
                        updateSection(
                          "email",
                          "sender_name",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Reply-to email">
                    <TextInput
                      type="email"
                      value={
                        settings.email
                          .reply_to_email
                      }
                      onChange={(value) =>
                        updateSection(
                          "email",
                          "reply_to_email",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Default CC">
                    <TextInput
                      type="email"
                      value={
                        settings.email
                          .cc_email
                      }
                      onChange={(value) =>
                        updateSection(
                          "email",
                          "cc_email",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Default BCC">
                    <TextInput
                      type="email"
                      value={
                        settings.email
                          .bcc_email
                      }
                      onChange={(value) =>
                        updateSection(
                          "email",
                          "bcc_email",
                          value
                        )
                      }
                    />
                  </Field>
                </div>
              </Section>

              <Section
                title="Invoice email template"
                description="Use {{invoice_number}} where the RL invoice number should appear."
              >
                <div className="grid gap-5">
                  <Field label="Default subject">
                    <TextInput
                      value={
                        settings.email
                          .default_subject
                      }
                      onChange={(value) =>
                        updateSection(
                          "email",
                          "default_subject",
                          value
                        )
                      }
                    />
                  </Field>

                  <Field label="Default message">
                    <TextArea
                      value={
                        settings.email
                          .default_message
                      }
                      onChange={(value) =>
                        updateSection(
                          "email",
                          "default_message",
                          value
                        )
                      }
                      rows={5}
                    />
                  </Field>

                  <Field label="Email signature">
                    <TextArea
                      value={
                        settings.email
                          .signature
                      }
                      onChange={(value) =>
                        updateSection(
                          "email",
                          "signature",
                          value
                        )
                      }
                      rows={4}
                    />
                  </Field>
                </div>
              </Section>

              <Section
                title="Server configuration"
                description="Sensitive sending credentials are intentionally not editable from the browser."
              >
                <div className="grid gap-3">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="font-semibold text-slate-900">
                      RESEND_API_KEY
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Keep this in .env.local only.
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="font-semibold text-slate-900">
                      RESEND_FROM_EMAIL
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Controls the verified sender address used by the API route.
                    </p>
                  </div>
                </div>
              </Section>
            </>
          )}

          {activeTab === "preferences" && (
            <>
              <Section
                title="Date and currency"
                description="General display preferences for the application."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Displayed date format">
                    <SelectInput
                      value={
                        settings.preferences
                          .date_format
                      }
                      onChange={(value) =>
                        updateSection(
                          "preferences",
                          "date_format",
                          value
                        )
                      }
                    >
                      <option value="DD/MM/YYYY">
                        DD/MM/YYYY
                      </option>
                      <option value="DD MMM YYYY">
                        DD MMM YYYY
                      </option>
                    </SelectInput>
                  </Field>

                  <Field label="PDF filename date">
                    <SelectInput
                      value={
                        settings.preferences
                          .filename_date_format
                      }
                      onChange={(value) =>
                        updateSection(
                          "preferences",
                          "filename_date_format",
                          value
                        )
                      }
                    >
                      <option value="DD.MM.YYYY">
                        DD.MM.YYYY
                      </option>
                      <option value="DD-MM-YYYY">
                        DD-MM-YYYY
                      </option>
                    </SelectInput>
                  </Field>

                  <Field label="Dashboard currency">
                    <SelectInput
                      value={
                        settings.preferences
                          .dashboard_currency
                      }
                      onChange={(value) =>
                        updateSection(
                          "preferences",
                          "dashboard_currency",
                          value
                        )
                      }
                    >
                      <option value="GBP">
                        GBP — British pound
                      </option>
                    </SelectInput>
                  </Field>
                </div>
              </Section>

              <Section
                title="Interface"
                description="Control common layout and navigation preferences."
              >
                <div className="grid gap-3">
                  <Toggle
                    checked={
                      settings.preferences
                        .compact_tables
                    }
                    onChange={(value) =>
                      updateSection(
                        "preferences",
                        "compact_tables",
                        value
                      )
                    }
                    label="Compact desktop tables"
                    description="Use tighter spacing so more invoices fit on laptop screens."
                  />

                  <Toggle
                    checked={
                      settings.preferences
                        .show_deleted_shortcut
                    }
                    onChange={(value) =>
                      updateSection(
                        "preferences",
                        "show_deleted_shortcut",
                        value
                      )
                    }
                    label="Show deleted invoices shortcut"
                    description="Keep quick access to deleted invoices in settings and dashboard navigation."
                  />
                </div>
              </Section>

              <Section
                title="Data"
                description="Safe data-management actions."
              >
                <button
                  type="button"
                  onClick={loadSettings}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Reload saved settings
                </button>
              </Section>
            </>
          )}
        </main>

        <div className="min-w-0">
          <div className="sticky top-5">
            <PreviewCard
              settings={settings}
            />
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {hasChanges
                ? "Unsaved changes"
                : "Settings saved"}
            </p>

            <p className="truncate text-xs text-slate-500">
              {tabLabel}
            </p>
          </div>

          <button
            type="button"
            onClick={saveSettings}
            disabled={
              saving || !hasChanges
            }
            className="shrink-0 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:bg-slate-300"
          >
            {saving
              ? "Saving..."
              : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
