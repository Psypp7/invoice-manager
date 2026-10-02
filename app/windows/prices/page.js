"use client";

import { useEffect, useState } from "react";
import WindowsFrame from "../../../components/windows/WindowsFrame";
import { supabase } from "../../../lib/supabase";
import { loadPriceList, roundMoney } from "../../../lib/windows";

let tempKey = 0;
const newKey = () => `new-${++tempKey}`;

export default function WindowsPricesPage() {
  const [userId, setUserId] = useState(null);
  const [rows, setRows] = useState([]);
  const [removedIds, setRemovedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        setUserId(user.id);
        const list = await loadPriceList(supabase, user.id);
        setRows(
          list.map((item) => ({
            key: item.id,
            id: item.id,
            name: item.name,
            price: String(item.price),
          }))
        );
      } catch (error) {
        setMessage({
          tone: "error",
          text: error.message || "The price list could not be loaded.",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function update(key, field, value) {
    setMessage(null);
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, [field]: value } : row
      )
    );
  }

  function addRow() {
    setMessage(null);
    setRows((current) => [
      ...current,
      { key: newKey(), id: null, name: "", price: "" },
    ]);
  }

  function removeRow(row) {
    setMessage(null);
    if (row.id) setRemovedIds((current) => [...current, row.id]);
    setRows((current) => current.filter((r) => r.key !== row.key));
  }

  function move(index, direction) {
    setRows((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    const cleaned = rows.map((row) => ({
      ...row,
      name: row.name.trim(),
    }));

    const missing = cleaned.find(
      (row) => !row.name || row.price === "" || Number(row.price) < 0
    );

    if (missing) {
      setMessage({
        tone: "error",
        text: "Every item needs a name and a price.",
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      if (removedIds.length) {
        const { error } = await supabase
          .from("mp_price_items")
          .delete()
          .in("id", removedIds);
        if (error) throw error;
      }

      const existing = cleaned
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.id);

      for (const { row, index } of existing) {
        const { error } = await supabase
          .from("mp_price_items")
          .update({
            name: row.name,
            price: roundMoney(row.price),
            sort_order: index,
          })
          .eq("id", row.id);
        if (error) throw error;
      }

      const added = cleaned
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !row.id);

      let inserted = [];
      if (added.length) {
        const { data, error } = await supabase
          .from("mp_price_items")
          .insert(
            added.map(({ row, index }) => ({
              user_id: userId,
              name: row.name,
              price: roundMoney(row.price),
              sort_order: index,
            }))
          )
          .select("id, sort_order");
        if (error) throw error;
        inserted = data;
      }

      setRows(
        cleaned.map((row, index) => {
          if (row.id) return row;
          const match = inserted.find((item) => item.sort_order === index);
          return match ? { ...row, id: match.id, key: match.id } : row;
        })
      );
      setRemovedIds([]);
      setMessage({ tone: "ok", text: "Prices saved." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error.message || "The prices could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <WindowsFrame>
      <h1 className="text-2xl font-bold tracking-tight">Prices</h1>
      <p className="mt-1 text-sm text-slate-600">
        What each job item pays. Changing a price here only affects new
        jobs; jobs you have already saved keep the price they had.
      </p>

      {loading ? (
        <p className="mt-8 text-slate-500">Loading prices…</p>
      ) : (
        <>
          <ul className="mt-6 divide-y divide-[#D5E0E0] overflow-hidden rounded-xl border border-[#D5E0E0] bg-white">
            {rows.map((row, index) => (
              <li key={row.key} className="flex items-center gap-2 p-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${row.name || "item"} up`}
                    className="rounded px-2 text-slate-500 hover:bg-slate-100 disabled:opacity-25"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === rows.length - 1}
                    aria-label={`Move ${row.name || "item"} down`}
                    className="rounded px-2 text-slate-500 hover:bg-slate-100 disabled:opacity-25"
                  >
                    ▼
                  </button>
                </div>

                <input
                  value={row.name}
                  onChange={(e) => update(row.key, "name", e.target.value)}
                  placeholder="Item, e.g. Bay window"
                  aria-label="Item name"
                  className="min-w-0 flex-1 rounded-lg border border-[#C9D6D6] px-3 py-3 text-base focus:border-[#0F766E] focus:outline-none focus:ring-2 focus:ring-[#0F766E]/25"
                />

                <label className="flex items-center rounded-lg border border-[#C9D6D6] focus-within:border-[#0F766E] focus-within:ring-2 focus-within:ring-[#0F766E]/25">
                  <span className="pl-3 text-slate-500">£</span>
                  <input
                    value={row.price}
                    onChange={(e) =>
                      update(
                        row.key,
                        "price",
                        e.target.value.replace(/[^0-9.]/g, "")
                      )
                    }
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`Price for ${row.name || "item"}`}
                    className="w-20 rounded-lg bg-transparent px-2 py-3 text-right text-base tabular-nums focus:outline-none"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => removeRow(row)}
                  aria-label={`Remove ${row.name || "item"}`}
                  className="rounded-lg px-3 py-3 text-red-700 hover:bg-red-50"
                >
                  ✕
                </button>
              </li>
            ))}

            {rows.length === 0 ? (
              <li className="p-5 text-center text-slate-500">
                No items yet. Add your first one below.
              </li>
            ) : null}
          </ul>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 w-full rounded-xl border-2 border-dashed border-[#9FB8B8] py-3 font-semibold text-[#0F766E] hover:bg-white"
          >
            + Add item
          </button>

          {message ? (
            <p
              role="status"
              className={`mt-4 rounded-lg px-4 py-3 text-sm ${
                message.tone === "error"
                  ? "bg-red-50 text-red-800"
                  : "bg-emerald-50 text-emerald-800"
              }`}
            >
              {message.text}
            </p>
          ) : null}

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="mt-4 w-full rounded-xl bg-[#0F766E] py-4 text-lg font-bold text-white hover:bg-[#0B5F58] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save prices"}
          </button>
        </>
      )}
    </WindowsFrame>
  );
}