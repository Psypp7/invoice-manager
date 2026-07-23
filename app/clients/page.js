"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const emptyForm = {
  client_type: "agent",
  name: "",
  company_name: "",
  email: "",
  phone: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  county: "",
  postcode: "",
  payment_terms_days: "14",
  notes: "",
};

export default function ClientsPage() {
  const [businessId, setBusinessId] = useState(null);
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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
        throw new Error("You must sign in before viewing clients.");
      }

      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("id")
        .eq("owner_user_id", user.id)
        .single();

      if (businessError) {
        throw businessError;
      }

      setBusinessId(business.id);
      await loadClients(business.id);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "Could not load the clients page.");
    } finally {
      setLoading(false);
    }
  }

  async function loadClients(currentBusinessId = businessId) {
    if (!currentBusinessId) {
      return;
    }

    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("business_id", currentBusinessId)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    setClients(data || []);
  }

  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setMessage("");
  }

  function startEditing(client) {
    setForm({
      client_type: client.client_type || "agent",
      name: client.name || "",
      company_name: client.company_name || "",
      email: client.email || "",
      phone: client.phone || "",
      address_line_1: client.address_line_1 || "",
      address_line_2: client.address_line_2 || "",
      city: client.city || "",
      county: client.county || "",
      postcode: client.postcode || "",
      payment_terms_days:
        client.payment_terms_days === null
          ? "14"
          : String(client.payment_terms_days),
      notes: client.notes || "",
    });

    setEditingId(client.id);
    setShowForm(true);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveClient(event) {
    event.preventDefault();

    if (!businessId) {
      setMessage("Your business could not be identified.");
      return;
    }

    setSaving(true);
    setMessage("");

    const payload = {
      business_id: businessId,
      client_type: form.client_type,
      name: form.name.trim(),
      company_name: form.company_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address_line_1: form.address_line_1.trim() || null,
      address_line_2: form.address_line_2.trim() || null,
      city: form.city.trim() || null,
      county: form.county.trim() || null,
      postcode: form.postcode.trim().toUpperCase() || null,
      payment_terms_days: Number(form.payment_terms_days),
      notes: form.notes.trim() || null,
    };

    try {
      if (editingId) {
        const { error } = await supabase
          .from("clients")
          .update(payload)
          .eq("id", editingId)
          .eq("business_id", businessId);

        if (error) {
          throw error;
        }

        setMessage("Client updated successfully.");
      } else {
        const { error } = await supabase
          .from("clients")
          .insert(payload);

        if (error) {
          throw error;
        }

        setMessage("Client saved successfully.");
      }

      await loadClients(businessId);

      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "The client could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteClient(client) {
    const confirmed = window.confirm(
      `Delete ${client.name}? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setMessage("");

    try {
      const { error } = await supabase
        .from("clients")
        .delete()
        .eq("id", client.id)
        .eq("business_id", businessId);

      if (error) {
        throw error;
      }

      await loadClients(businessId);
      setMessage("Client deleted.");
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "The client could not be deleted.");
    }
  }

  const filteredClients = useMemo(() => {
    const searchText = search.trim().toLowerCase();

    return clients.filter((client) => {
      const matchesType =
        typeFilter === "all" || client.client_type === typeFilter;

      const searchableText = [
        client.name,
        client.company_name,
        client.email,
        client.phone,
        client.postcode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        searchText === "" || searchableText.includes(searchText);

      return matchesType && matchesSearch;
    });
  }, [clients, search, typeFilter]);

  if (loading) {
    return <p className="text-slate-500">Loading clients...</p>;
  }

  return (
    <>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold">Clients</h1>

          <p className="mt-2 text-slate-500">
            Save agents, landlords and companies.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setForm(emptyForm);
            setEditingId(null);
            setShowForm((current) => !current);
            setMessage("");
          }}
          className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? "Close form" : "+ Add client"}
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
            {editingId ? "Edit client" : "Add client"}
          </h2>

          <form onSubmit={saveClient} className="mt-6 space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Client type
                </label>

                <select
                  name="client_type"
                  value={form.client_type}
                  onChange={updateField}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                >
                  <option value="agent">Agent</option>
                  <option value="landlord">Landlord</option>
                  <option value="company">Company</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Name
                </label>

                <input
                  name="name"
                  value={form.name}
                  onChange={updateField}
                  required
                  placeholder="ABC Lettings"
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Company name
                </label>

                <input
                  name="company_name"
                  value={form.company_name}
                  onChange={updateField}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Email
                </label>

                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={updateField}
                  placeholder="accounts@example.com"
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Phone
                </label>

                <input
                  name="phone"
                  value={form.phone}
                  onChange={updateField}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Payment terms
                </label>

                <input
                  type="number"
                  min="0"
                  name="payment_terms_days"
                  value={form.payment_terms_days}
                  onChange={updateField}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold">
                Address line 1
              </label>

              <input
                name="address_line_1"
                value={form.address_line_1}
                onChange={updateField}
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold">
                Address line 2
              </label>

              <input
                name="address_line_2"
                value={form.address_line_2}
                onChange={updateField}
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              />
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-semibold">
                  City
                </label>

                <input
                  name="city"
                  value={form.city}
                  onChange={updateField}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  County
                </label>

                <input
                  name="county"
                  value={form.county}
                  onChange={updateField}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Postcode
                </label>

                <input
                  name="postcode"
                  value={form.postcode}
                  onChange={updateField}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold">
                Notes
              </label>

              <textarea
                name="notes"
                value={form.notes}
                onChange={updateField}
                rows="4"
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update client"
                    : "Save client"}
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

      <section className="mt-8 overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="grid gap-4 border-b border-slate-200 p-5 md:grid-cols-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, phone or postcode..."
            className="rounded-lg border border-slate-300 px-4 py-3"
          />

          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="rounded-lg border border-slate-300 px-4 py-3"
          >
            <option value="all">All client types</option>
            <option value="agent">Agents</option>
            <option value="landlord">Landlords</option>
            <option value="company">Companies</option>
            <option value="other">Other</option>
          </select>
        </div>

        {filteredClients.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            No clients found. Press “Add client” to create the first one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left">
              <thead className="bg-slate-50 text-sm text-slate-500">
                <tr>
                  <th className="px-5 py-4">Name</th>
                  <th className="px-5 py-4">Type</th>
                  <th className="px-5 py-4">Email</th>
                  <th className="px-5 py-4">Phone</th>
                  <th className="px-5 py-4">Postcode</th>
                  <th className="px-5 py-4">Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredClients.map((client) => (
                  <tr
                    key={client.id}
                    className="border-t border-slate-100"
                  >
                    <td className="px-5 py-4 font-semibold">
                      {client.name}
                    </td>

                    <td className="px-5 py-4 capitalize">
                      {client.client_type}
                    </td>

                    <td className="px-5 py-4">
                      {client.email || "—"}
                    </td>

                    <td className="px-5 py-4">
                      {client.phone || "—"}
                    </td>

                    <td className="px-5 py-4">
                      {client.postcode || "—"}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => startEditing(client)}
                          className="font-semibold text-blue-600"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteClient(client)}
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
    </>
  );
}