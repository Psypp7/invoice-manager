"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

const JOB_TYPES = [
  "Inventory",
  "Check In",
  "Check Out",
  "Mid Term",
  "Inspection",
  "Smoke Alarm",
  "Legionella",
  "Other",
];

const JOB_STATUSES = [
  { value: "enquiry", label: "Enquiry" },
  { value: "booked", label: "Booked" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function emptyForm(defaultVatRate = 0) {
  const date = today();
  return {
    client_id: "",
    property_id: "",
    title: "Inventory",
    description: "",
    job_type: "Inventory",
    scheduled_start: `${date}T09:00`,
    scheduled_end: `${date}T10:00`,
    agreed_price: "",
    vat_rate: String(defaultVatRate || 0),
    status: "booked",
    notes: "",
  };
}

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status) {
  return (
    JOB_STATUSES.find((item) => item.value === status)?.label ||
    String(status || "Unknown").replaceAll("_", " ")
  );
}

function statusClasses(status) {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-700";
    case "in_progress":
      return "bg-purple-100 text-purple-700";
    case "cancelled":
      return "bg-slate-200 text-slate-600";
    case "enquiry":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-blue-100 text-blue-700";
  }
}

function clientAddress(client) {
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

export default function JobsPage() {
  const router = useRouter();

  const [business, setBusiness] = useState(null);
  const [clients, setClients] = useState([]);
  const [properties, setProperties] = useState([]);
  const [jobs, setJobs] = useState([]);

  const [form, setForm] = useState(emptyForm());
  const [editingJobId, setEditingJobId] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingInvoiceId, setCreatingInvoiceId] = useState(null);
  const [message, setMessage] = useState("");

  const [jobToDelete, setJobToDelete] = useState(null);
  const [deleteStep, setDeleteStep] = useState(1);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    initialise();
  }, []);

  async function initialise() {
    setLoading(true);
    setMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must sign in before viewing jobs.");
      }

      const { data: businessData, error: businessError } = await supabase
        .from("businesses")
        .select("id, business_name, default_payment_days, default_vat_rate")
        .eq("owner_user_id", user.id)
        .single();

      if (businessError) throw businessError;

      setBusiness(businessData);
      setForm(emptyForm(businessData.default_vat_rate));

      await Promise.all([
        loadClients(businessData.id),
        loadProperties(businessData.id),
        loadJobs(businessData.id),
      ]);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "Could not load jobs.");
    } finally {
      setLoading(false);
    }
  }

  async function loadClients(businessId) {
    const { data, error } = await supabase
      .from("clients")
      .select(`
        id,
        name,
        company_name,
        email,
        address_line_1,
        address_line_2,
        city,
        county,
        postcode,
        payment_terms_days
      `)
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;
    setClients(data || []);
  }

  async function loadProperties(businessId) {
    const { data, error } = await supabase
      .from("properties")
      .select(`
        id,
        property_name,
        address_line_1,
        address_line_2,
        city,
        county,
        postcode,
        agent_client_id,
        landlord_client_id
      `)
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("address_line_1", { ascending: true });

    if (error) throw error;
    setProperties(data || []);
  }

  async function loadJobs(businessId = business?.id) {
    if (!businessId) return;

    const { data, error } = await supabase
      .from("jobs")
      .select(`
        id,
        job_number,
        business_id,
        property_id,
        client_id,
        title,
        description,
        job_type,
        scheduled_start,
        scheduled_end,
        completed_at,
        agreed_price,
        vat_rate,
        status,
        invoiced,
        notes,
        created_at,
        updated_at,
        deleted_at,
        deletion_reason,
        client:clients(id, name, company_name, email),
        property:properties(
          id,
          property_name,
          address_line_1,
          address_line_2,
          city,
          county,
          postcode
        )
      `)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("scheduled_start", { ascending: true, nullsFirst: false });

    if (error) throw error;
    setJobs(data || []);
  }

  const availableProperties = useMemo(() => {
    if (!form.client_id) return properties;

    const matched = properties.filter(
      (property) =>
        property.agent_client_id === form.client_id ||
        property.landlord_client_id === form.client_id
    );

    return matched.length > 0 ? matched : properties;
  }, [properties, form.client_id]);

  const filteredJobs = useMemo(() => {
    const text = search.trim().toLowerCase();

    return jobs.filter((job) => {
      const statusMatches =
        statusFilter === "all" || job.status === statusFilter;

      const searchable = [
        job.job_number,
        job.title,
        job.job_type,
        job.client?.name,
        job.client?.company_name,
        job.property?.property_name,
        job.property?.address_line_1,
        job.property?.postcode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return statusMatches && (!text || searchable.includes(text));
    });
  }, [jobs, search, statusFilter]);

  function closeForm() {
    setEditingJobId(null);
    setForm(emptyForm(business?.default_vat_rate));
    setShowForm(false);
  }

  function openCreateForm() {
    setEditingJobId(null);
    setForm(emptyForm(business?.default_vat_rate));
    setShowForm(true);
    setMessage("");
  }

  function openEditForm(job) {
    setEditingJobId(job.id);
    setForm({
      client_id: job.client_id || "",
      property_id: job.property_id || "",
      title: job.title || "",
      description: job.description || "",
      job_type: job.job_type || "Inventory",
      scheduled_start: localDateTime(job.scheduled_start),
      scheduled_end: localDateTime(job.scheduled_end),
      agreed_price:
        job.agreed_price === null || job.agreed_price === undefined
          ? ""
          : String(job.agreed_price),
      vat_rate: String(job.vat_rate ?? 0),
      status: job.status || "booked",
      notes: job.notes || "",
    });
    setShowForm(true);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => {
      const updated = { ...current, [name]: value };

      if (name === "job_type" && !editingJobId) {
        updated.title = value;
      }

      if (name === "scheduled_start" && value) {
        const start = new Date(value);
        const end = current.scheduled_end ? new Date(current.scheduled_end) : null;

        if (!end || end <= start) {
          const nextEnd = new Date(start.getTime() + 60 * 60 * 1000);
          const localEnd = new Date(
            nextEnd.getTime() - nextEnd.getTimezoneOffset() * 60000
          );
          updated.scheduled_end = localEnd.toISOString().slice(0, 16);
        }
      }

      return updated;
    });
  }

  async function saveJob(event) {
    event.preventDefault();

    if (!business?.id) return setMessage("Business not found.");
    if (!form.client_id) return setMessage("Select a client.");
    if (!form.property_id) return setMessage("Select a property.");
    if (!form.title.trim()) return setMessage("Enter a job title.");
    if (!form.scheduled_start) return setMessage("Choose a start time.");

    if (
      form.scheduled_end &&
      new Date(form.scheduled_end) <= new Date(form.scheduled_start)
    ) {
      return setMessage("The end time must be after the start time.");
    }

    const price = form.agreed_price === "" ? null : Number(form.agreed_price);
    if (price !== null && (Number.isNaN(price) || price < 0)) {
      return setMessage("Enter a valid agreed price.");
    }

    setSaving(true);
    setMessage("");

    try {
      const now = new Date().toISOString();
      const previous = editingJobId
        ? jobs.find((job) => job.id === editingJobId)
        : null;

      const payload = {
        business_id: business.id,
        client_id: form.client_id,
        property_id: form.property_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        job_type: form.job_type || null,
        scheduled_start: toIso(form.scheduled_start),
        scheduled_end: toIso(form.scheduled_end),
        agreed_price: price,
        vat_rate: Number(form.vat_rate || 0),
        status: form.status,
        notes: form.notes.trim() || null,
        completed_at:
          form.status === "completed" ? previous?.completed_at || now : null,
        updated_at: now,
      };

      if (editingJobId) {
        const { error } = await supabase
          .from("jobs")
          .update(payload)
          .eq("id", editingJobId)
          .eq("business_id", business.id)
          .is("deleted_at", null);

        if (error) throw error;
        await loadJobs(business.id);
        closeForm();
        setMessage(`${previous?.job_number || "Job"} updated successfully.`);
      } else {
        const { data, error } = await supabase
          .from("jobs")
          .insert(payload)
          .select("id, job_number")
          .single();

        if (error) throw error;
        await loadJobs(business.id);
        closeForm();
        setMessage(`${data.job_number} created successfully.`);
      }
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "The job could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function updateJobStatus(job, status) {
    const labels = {
      in_progress: "start",
      completed: "complete",
      cancelled: "cancel",
    };

    if (!window.confirm(`${labels[status] || "Update"} ${job.job_number}?`)) {
      return;
    }

    setMessage("");

    try {
      const { error } = await supabase
        .from("jobs")
        .update({
          status,
          completed_at:
            status === "completed" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("business_id", business.id)
        .is("deleted_at", null);

      if (error) throw error;
      await loadJobs(business.id);
      setMessage(`${job.job_number} changed to ${statusLabel(status)}.`);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "Could not update the job.");
    }
  }

  async function generateInvoice(job) {
    if (job.invoiced) return setMessage("This job has already been invoiced.");
    if (job.status !== "completed") {
      return setMessage("Complete the job before generating an invoice.");
    }
    if (job.agreed_price === null || Number(job.agreed_price) <= 0) {
      return setMessage("Add a valid agreed price first.");
    }

    const client = clients.find((item) => item.id === job.client_id);
    if (!client) return setMessage("The linked client could not be found.");

    if (
      !window.confirm(
        `Generate an invoice for ${job.job_number} for ${formatMoney(
          job.agreed_price
        )} plus VAT?`
      )
    ) {
      return;
    }

    setCreatingInvoiceId(job.id);
    setMessage("");
    let invoiceId = null;

    try {
      const subtotal = Number(job.agreed_price);
      const vatRate = Number(job.vat_rate || 0);
      const vatTotal = subtotal * (vatRate / 100);
      const total = subtotal + vatTotal;
      const issueDate = today();
      const paymentDays =
        client.payment_terms_days ?? business.default_payment_days ?? 14;

      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          business_id: business.id,
          client_id: job.client_id,
          property_id: job.property_id,
          job_id: job.id,
          issue_date: issueDate,
          supply_date: job.completed_at
            ? new Date(job.completed_at).toISOString().slice(0, 10)
            : issueDate,
          due_date: addDays(issueDate, paymentDays),
          status: "unpaid",
          currency: "GBP",
          subtotal: Number(subtotal.toFixed(2)),
          vat_total: Number(vatTotal.toFixed(2)),
          total: Number(total.toFixed(2)),
          amount_paid: 0,
          balance_due: Number(total.toFixed(2)),
          customer_name: client.company_name || client.name,
          customer_email: client.email || null,
          customer_address: clientAddress(client) || null,
          notes: job.notes || job.description || null,
          payment_terms: `Payment due within ${paymentDays} days`,
        })
        .select("id, invoice_number")
        .single();

      if (invoiceError) throw invoiceError;
      invoiceId = invoice.id;

      const { error: itemError } = await supabase
        .from("invoice_items")
        .insert({
          invoice_id: invoice.id,
          description: job.title || job.job_type || "Property inspection",
          quantity: 1,
          unit_price: Number(subtotal.toFixed(2)),
          vat_rate: Number(vatRate.toFixed(2)),
          line_subtotal: Number(subtotal.toFixed(2)),
          line_vat: Number(vatTotal.toFixed(2)),
          line_total: Number(total.toFixed(2)),
          sort_order: 0,
        });

      if (itemError) throw itemError;

      const { error: jobError } = await supabase
        .from("jobs")
        .update({ invoiced: true, updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("business_id", business.id);

      if (jobError) throw jobError;

      router.push(`/invoices/${invoice.id}`);
    } catch (error) {
      console.error(error);
      if (invoiceId) {
        await supabase.from("invoices").delete().eq("id", invoiceId);
      }
      setMessage(error?.message || "The invoice could not be generated.");
    } finally {
      setCreatingInvoiceId(null);
    }
  }

  function openDelete(job) {
    setJobToDelete(job);
    setDeleteStep(1);
    setDeleteConfirmation("");
    setDeletionReason("");
    setMessage("");
  }

  function closeDelete() {
    if (deleting) return;
    setJobToDelete(null);
    setDeleteStep(1);
    setDeleteConfirmation("");
    setDeletionReason("");
  }

  async function deleteJob() {
    if (!jobToDelete || !business?.id) return;
    if (deleteConfirmation.trim() !== jobToDelete.job_number) {
      return setMessage(`Type ${jobToDelete.job_number} exactly.`);
    }

    setDeleting(true);
    setMessage("");

    try {
      const { error } = await supabase
        .from("jobs")
        .update({
          deleted_at: new Date().toISOString(),
          deletion_reason: deletionReason.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobToDelete.id)
        .eq("business_id", business.id)
        .is("deleted_at", null);

      if (error) throw error;

      const number = jobToDelete.job_number;
      closeDelete();
      await loadJobs(business.id);
      setMessage(`${number} moved to Deleted Jobs.`);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "The job could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <p className="text-slate-500">Loading jobs...</p>;
  }

  return (
    <>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold">Jobs</h1>
          <p className="mt-2 text-slate-500">
            Schedule inspections, track progress and generate invoices.
          </p>
        </div>

        <button
          type="button"
          onClick={showForm ? closeForm : openCreateForm}
          className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? "Close form" : "+ New job"}
        </button>
      </header>

      {message && (
        <div className="mt-6 rounded-lg bg-white p-4 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      )}

      {showForm && (
        <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            {editingJobId ? "Edit job" : "Create job"}
          </h2>

          <form onSubmit={saveJob} className="mt-6 space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Client">
                <select
                  name="client_id"
                  value={form.client_id}
                  onChange={updateField}
                  required
                  className="input"
                >
                  <option value="">Select a client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.company_name
                        ? `${client.company_name} — ${client.name}`
                        : client.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Property">
                <select
                  name="property_id"
                  value={form.property_id}
                  onChange={updateField}
                  required
                  className="input"
                >
                  <option value="">Select a property</option>
                  {availableProperties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {[
                        property.property_name,
                        property.address_line_1,
                        property.postcode,
                      ]
                        .filter(Boolean)
                        .join(" — ")}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Inspection type">
                <select
                  name="job_type"
                  value={form.job_type}
                  onChange={updateField}
                  className="input"
                >
                  {JOB_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Job title">
                <input
                  name="title"
                  value={form.title}
                  onChange={updateField}
                  required
                  className="input"
                />
              </Field>
            </div>

            <Field label="Description">
              <textarea
                name="description"
                value={form.description}
                onChange={updateField}
                rows={3}
                className="input"
              />
            </Field>

            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Start date and time">
                <input
                  type="datetime-local"
                  name="scheduled_start"
                  value={form.scheduled_start}
                  onChange={updateField}
                  required
                  className="input"
                />
              </Field>

              <Field label="End date and time">
                <input
                  type="datetime-local"
                  name="scheduled_end"
                  value={form.scheduled_end}
                  onChange={updateField}
                  className="input"
                />
              </Field>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <Field label="Agreed price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  name="agreed_price"
                  value={form.agreed_price}
                  onChange={updateField}
                  placeholder="120.00"
                  className="input"
                />
              </Field>

              <Field label="VAT rate">
                <select
                  name="vat_rate"
                  value={form.vat_rate}
                  onChange={updateField}
                  className="input"
                >
                  <option value="0">0%</option>
                  <option value="5">5%</option>
                  <option value="20">20%</option>
                </select>
              </Field>

              <Field label="Status">
                <select
                  name="status"
                  value={form.status}
                  onChange={updateField}
                  className="input"
                >
                  {JOB_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Internal notes">
              <textarea
                name="notes"
                value={form.notes}
                onChange={updateField}
                rows={4}
                placeholder="Keys, access details, tenant information..."
                className="input"
              />
            </Field>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving
                  ? "Saving..."
                  : editingJobId
                  ? "Save changes"
                  : "Create job"}
              </button>

              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-lg border border-slate-300 px-6 py-3 font-semibold"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-8 overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="grid gap-4 border-b border-slate-200 p-5 md:grid-cols-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search job, client, property or postcode..."
            className="input"
          />

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="input"
          >
            <option value="all">All statuses</option>
            {JOB_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </div>

        {filteredJobs.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            No jobs found. Press “New job” to create the first one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left">
              <thead className="bg-slate-50 text-sm text-slate-500">
                <tr>
                  <th className="px-5 py-4">Job</th>
                  <th className="px-5 py-4">Appointment</th>
                  <th className="px-5 py-4">Client</th>
                  <th className="px-5 py-4">Property</th>
                  <th className="px-5 py-4">Type</th>
                  <th className="px-5 py-4">Price</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Invoice</th>
                  <th className="px-5 py-4">Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredJobs.map((job) => (
                  <tr key={job.id} className="border-t border-slate-100">
                    <td className="px-5 py-4">
                      <div className="font-bold">{job.job_number}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {job.title}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {formatDateTime(job.scheduled_start)}
                    </td>
                    <td className="px-5 py-4">
                      {job.client?.company_name || job.client?.name || "—"}
                    </td>
                    <td className="px-5 py-4">
                      {job.property
                        ? [
                            job.property.property_name,
                            job.property.address_line_1,
                            job.property.postcode,
                          ]
                            .filter(Boolean)
                            .join(" — ")
                        : "—"}
                    </td>
                    <td className="px-5 py-4">{job.job_type || "—"}</td>
                    <td className="px-5 py-4 font-semibold">
                      {job.agreed_price === null
                        ? "—"
                        : formatMoney(job.agreed_price)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses(
                          job.status
                        )}`}
                      >
                        {statusLabel(job.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {job.invoiced ? "Created" : "Not created"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => openEditForm(job)}
                          className="font-semibold text-amber-600"
                        >
                          Edit
                        </button>

                        {job.status === "booked" && (
                          <button
                            type="button"
                            onClick={() => updateJobStatus(job, "in_progress")}
                            className="font-semibold text-purple-600"
                          >
                            Start
                          </button>
                        )}

                        {!["completed", "cancelled"].includes(job.status) && (
                          <button
                            type="button"
                            onClick={() => updateJobStatus(job, "completed")}
                            className="font-semibold text-green-600"
                          >
                            Complete
                          </button>
                        )}

                        {job.status === "completed" && !job.invoiced && (
                          <button
                            type="button"
                            onClick={() => generateInvoice(job)}
                            disabled={creatingInvoiceId === job.id}
                            className="font-semibold text-blue-600 disabled:opacity-50"
                          >
                            {creatingInvoiceId === job.id
                              ? "Creating..."
                              : "Generate invoice"}
                          </button>
                        )}

                        {job.status !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => updateJobStatus(job, "cancelled")}
                            className="font-semibold text-slate-600"
                          >
                            Cancel
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => openDelete(job)}
                          className="font-semibold text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {jobToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            {deleteStep === 1 ? (
              <>
                <h2 className="text-2xl font-bold">Delete job?</h2>
                <p className="mt-4 text-slate-600">
                  You are about to delete <strong>{jobToDelete.job_number}</strong>.
                </p>
                <p className="mt-3 text-slate-600">
                  It will be hidden, not permanently destroyed.
                </p>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeDelete}
                    className="rounded-lg border border-slate-300 px-5 py-3 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteStep(2)}
                    className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-red-700">
                  Confirm deletion
                </h2>
                <p className="mt-4 text-slate-600">
                  Type the job number exactly:
                </p>
                <p className="mt-2 rounded-lg bg-slate-100 p-3 font-bold">
                  {jobToDelete.job_number}
                </p>
                <input
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  className="input mt-4"
                />
                <label className="mt-5 block text-sm font-semibold">
                  Reason (optional)
                </label>
                <textarea
                  value={deletionReason}
                  onChange={(event) => setDeletionReason(event.target.value)}
                  rows={3}
                  className="input mt-2"
                />
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeDelete}
                    disabled={deleting}
                    className="rounded-lg border border-slate-300 px-5 py-3 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={deleteJob}
                    disabled={
                      deleting ||
                      deleteConfirmation.trim() !== jobToDelete.job_number
                    }
                    className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white disabled:bg-slate-400"
                  >
                    {deleting ? "Deleting..." : "Delete job"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(203 213 225);
          padding: 0.75rem 1rem;
          background: white;
        }
      `}</style>
    </>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold">{label}</label>
      {children}
    </div>
  );
}
