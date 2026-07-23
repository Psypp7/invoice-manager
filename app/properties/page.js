"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const emptyForm = {
  property_name: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  county: "",
  postcode: "",
  agent_client_id: "",
  landlord_client_id: "",
  access_notes: "",
  general_notes: "",
};

export default function PropertiesPage() {
  const [businessId, setBusinessId] = useState(null);
  const [properties, setProperties] = useState([]);
  const [clients, setClients] = useState([]);

  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

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
        throw new Error("You must sign in before viewing properties.");
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

      await Promise.all([
        loadClients(business.id),
        loadProperties(business.id),
      ]);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "Could not load the properties page.");
    } finally {
      setLoading(false);
    }
  }

  async function loadClients(currentBusinessId = businessId) {
    if (!currentBusinessId) return;

    const { data, error } = await supabase
      .from("clients")
      .select("id, name, company_name, client_type")
      .eq("business_id", currentBusinessId)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    setClients(data || []);
  }

  async function loadProperties(currentBusinessId = businessId) {
    if (!currentBusinessId) return;

    const { data, error } = await supabase
      .from("properties")
      .select(`
        *,
        agent:clients!properties_agent_client_id_fkey(
          id,
          name,
          company_name
        ),
        landlord:clients!properties_landlord_client_id_fkey(
          id,
          name,
          company_name
        )
      `)
      .eq("business_id", currentBusinessId)
      .order("address_line_1", { ascending: true });

    if (error) {
      throw error;
    }

    setProperties(data || []);
  }

  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function openNewPropertyForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
    setMessage("");
  }

  function closeForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setMessage("");
  }

  function startEditing(property) {
    setForm({
      property_name: property.property_name || "",
      address_line_1: property.address_line_1 || "",
      address_line_2: property.address_line_2 || "",
      city: property.city || "",
      county: property.county || "",
      postcode: property.postcode || "",
      agent_client_id: property.agent_client_id || "",
      landlord_client_id: property.landlord_client_id || "",
      access_notes: property.access_notes || "",
      general_notes: property.general_notes || "",
    });

    setEditingId(property.id);
    setShowForm(true);
    setMessage("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function saveProperty(event) {
    event.preventDefault();

    if (!businessId) {
      setMessage("Your business could not be identified.");
      return;
    }

    setSaving(true);
    setMessage("");

    const payload = {
      business_id: businessId,
      property_name: form.property_name.trim() || null,
      address_line_1: form.address_line_1.trim(),
      address_line_2: form.address_line_2.trim() || null,
      city: form.city.trim() || null,
      county: form.county.trim() || null,
      postcode: form.postcode.trim().toUpperCase(),
      agent_client_id: form.agent_client_id || null,
      landlord_client_id: form.landlord_client_id || null,
      access_notes: form.access_notes.trim() || null,
      general_notes: form.general_notes.trim() || null,
    };

    try {
      if (editingId) {
        const { error } = await supabase
          .from("properties")
          .update(payload)
          .eq("id", editingId)
          .eq("business_id", businessId);

        if (error) {
          throw error;
        }

        setMessage("Property updated successfully.");
      } else {
        const { error } = await supabase
          .from("properties")
          .insert(payload);

        if (error) {
          throw error;
        }

        setMessage("Property saved successfully.");
      }

      await loadProperties(businessId);

      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "The property could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProperty(property) {
    const propertyLabel =
      property.property_name || property.address_line_1;

    const confirmed = window.confirm(
      `Delete ${propertyLabel}? This cannot be undone.`
    );

    if (!confirmed) return;

    setMessage("");

    try {
      const { error } = await supabase
        .from("properties")
        .delete()
        .eq("id", property.id)
        .eq("business_id", businessId);

      if (error) {
        throw error;
      }

      await loadProperties(businessId);
      setMessage("Property deleted.");
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "The property could not be deleted.");
    }
  }

  function clientDisplayName(client) {
    if (!client) return "—";

    return client.company_name
      ? `${client.name} — ${client.company_name}`
      : client.name;
  }

  const agents = clients.filter(
    (client) =>
      client.client_type === "agent" ||
      client.client_type === "company"
  );

  const landlords = clients.filter(
    (client) => client.client_type === "landlord"
  );

  const filteredProperties = useMemo(() => {
    const searchText = search.trim().toLowerCase();

    if (!searchText) return properties;

    return properties.filter((property) => {
      const searchableText = [
        property.property_name,
        property.address_line_1,
        property.address_line_2,
        property.city,
        property.county,
        property.postcode,
        property.agent?.name,
        property.agent?.company_name,
        property.landlord?.name,
        property.landlord?.company_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchText);
    });
  }, [properties, search]);

  if (loading) {
    return <p className="text-slate-500">Loading properties...</p>;
  }

  return (
    <>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold">Properties</h1>

          <p className="mt-2 text-slate-500">
            Save addresses and link them to agents and landlords.
          </p>
        </div>

        <button
          type="button"
          onClick={
            showForm
              ? closeForm
              : openNewPropertyForm
          }
          className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? "Close form" : "+ Add property"}
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
            {editingId ? "Edit property" : "Add property"}
          </h2>

          <form
            onSubmit={saveProperty}
            className="mt-6 space-y-5"
          >
            <div>
              <label className="mb-2 block text-sm font-semibold">
                Property name
              </label>

              <input
                name="property_name"
                value={form.property_name}
                onChange={updateField}
                placeholder="Example: Flat 4 or Smith House"
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold">
                Address line 1
              </label>

              <input
                name="address_line_1"
                value={form.address_line_1}
                onChange={updateField}
                required
                placeholder="12 High Street"
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
                placeholder="Optional"
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
                  required
                  placeholder="SW1A 1AA"
                  className="w-full rounded-lg border border-slate-300 px-4 py-3 uppercase"
                />
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Agent
                </label>

                <select
                  name="agent_client_id"
                  value={form.agent_client_id}
                  onChange={updateField}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                >
                  <option value="">No agent selected</option>

                  {agents.map((agent) => (
                    <option
                      key={agent.id}
                      value={agent.id}
                    >
                      {clientDisplayName(agent)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Landlord
                </label>

                <select
                  name="landlord_client_id"
                  value={form.landlord_client_id}
                  onChange={updateField}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3"
                >
                  <option value="">
                    No landlord selected
                  </option>

                  {landlords.map((landlord) => (
                    <option
                      key={landlord.id}
                      value={landlord.id}
                    >
                      {clientDisplayName(landlord)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {clients.length === 0 && (
              <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
                You have not saved any clients yet. You can still save
                the property and link an agent or landlord later.
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-semibold">
                Access notes
              </label>

              <textarea
                name="access_notes"
                value={form.access_notes}
                onChange={updateField}
                rows="3"
                placeholder="Keys, concierge, alarm instructions..."
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold">
                General notes
              </label>

              <textarea
                name="general_notes"
                value={form.general_notes}
                onChange={updateField}
                rows="4"
                placeholder="Any additional property information..."
                className="w-full rounded-lg border border-slate-300 px-4 py-3"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update property"
                    : "Save property"}
              </button>

              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg border border-slate-300 px-6 py-3 font-semibold"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-8 overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <input
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search address, postcode, agent or landlord..."
            className="w-full rounded-lg border border-slate-300 px-4 py-3"
          />
        </div>

        {filteredProperties.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            No properties found. Press “Add property” to create
            the first one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left">
              <thead className="bg-slate-50 text-sm text-slate-500">
                <tr>
                  <th className="px-5 py-4">Property</th>
                  <th className="px-5 py-4">Address</th>
                  <th className="px-5 py-4">Postcode</th>
                  <th className="px-5 py-4">Agent</th>
                  <th className="px-5 py-4">Landlord</th>
                  <th className="px-5 py-4">Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredProperties.map((property) => (
                  <tr
                    key={property.id}
                    className="border-t border-slate-100"
                  >
                    <td className="px-5 py-4 font-semibold">
                      {property.property_name || "—"}
                    </td>

                    <td className="px-5 py-4">
                      <div>{property.address_line_1}</div>

                      {(property.address_line_2 ||
                        property.city) && (
                        <div className="text-sm text-slate-500">
                          {[
                            property.address_line_2,
                            property.city,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      {property.postcode}
                    </td>

                    <td className="px-5 py-4">
                      {clientDisplayName(property.agent)}
                    </td>

                    <td className="px-5 py-4">
                      {clientDisplayName(property.landlord)}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            startEditing(property)
                          }
                          className="font-semibold text-blue-600"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            deleteProperty(property)
                          }
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