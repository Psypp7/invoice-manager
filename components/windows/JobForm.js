"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import WindowsFrame from "./WindowsFrame";
import { supabase } from "../../lib/supabase";
import {
  SURVEY_BUCKET,
  compressImage,
  formatMoney,
  jobTotal,
  loadPriceList,
  roundMoney,
  todayIso,
} from "../../lib/windows";

let tempKey = 0;
const newKey = () => `row-${++tempKey}`;

function sameName(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Price list rows first (in Prices order), then any extra items on the
 * job. A saved job keeps the price it was saved with.
 */
function buildRows(priceList, savedItems = []) {
  const rows = priceList.map((item) => {
    const saved = savedItems.find((s) => sameName(s.name, item.name));
    return {
      key: newKey(),
      name: item.name,
      price: saved ? Number(saved.price) : Number(item.price),
      qty: saved ? Number(saved.qty) : 0,
      extra: false,
    };
  });

  for (const saved of savedItems) {
    if (!priceList.some((item) => sameName(item.name, saved.name))) {
      rows.push({
        key: newKey(),
        name: saved.name,
        price: Number(saved.price),
        qty: Number(saved.qty),
        extra: true,
      });
    }
  }

  return rows;
}

export default function JobForm({ jobId = null }) {
  const router = useRouter();
  const cameraInput = useRef(null);
  const galleryInput = useRef(null);

  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [jobNumber, setJobNumber] = useState("");
  const [jobDate, setJobDate] = useState(todayIso());
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState([]);

  const [photos, setPhotos] = useState([]); // { path, url }
  const [removedPaths, setRemovedPaths] = useState([]);
  const [uploading, setUploading] = useState(0);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);

        const priceList = await loadPriceList(supabase, user.id);

        if (!jobId) {
          setRows(buildRows(priceList));
          return;
        }

        const { data: job, error: jobError } = await supabase
          .from("mp_jobs")
          .select("*")
          .eq("id", jobId)
          .single();

        if (jobError) throw jobError;

        setJobNumber(job.job_number || "");
        setJobDate(job.job_date || todayIso());
        setAddress(job.address || "");
        setNotes(job.notes || "");
        setRows(buildRows(priceList, job.items || []));

        const paths = job.photos || [];
        if (paths.length) {
          const { data: signed } = await supabase.storage
            .from(SURVEY_BUCKET)
            .createSignedUrls(paths, 60 * 60);
          setPhotos(
            paths.map((path, i) => ({
              path,
              url: signed?.[i]?.signedUrl || "",
            }))
          );
        }
      } catch (e) {
        setError(e.message || "This job could not be loaded.");
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  const total = jobTotal(rows);
  const itemCount = rows.reduce((n, r) => n + (Number(r.qty) || 0), 0);

  function setQty(key, qty) {
    const value = Math.max(0, Math.min(999, Math.floor(Number(qty) || 0)));
    setRows((current) =>
      current.map((r) => (r.key === key ? { ...r, qty: value } : r))
    );
  }

  function updateRow(key, field, value) {
    setRows((current) =>
      current.map((r) => (r.key === key ? { ...r, [field]: value } : r))
    );
  }

  function addExtra() {
    setRows((current) => [
      ...current,
      { key: newKey(), name: "", price: "", qty: 1, extra: true },
    ]);
  }

  function removeExtra(key) {
    setRows((current) => current.filter((r) => r.key !== key));
  }

  async function addPhotos(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !userId) return;

    setError("");
    setUploading((n) => n + files.length);

    for (const file of files) {
      try {
        const body = await compressImage(file);
        const ext = body.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "jpg");
        const path = `${userId}/${crypto.randomUUID()}.${ext.toLowerCase()}`;

        const { error: uploadError } = await supabase.storage
          .from(SURVEY_BUCKET)
          .upload(path, body, {
            contentType: body.type || file.type || "image/jpeg",
            upsert: false,
          });
        if (uploadError) throw uploadError;

        const { data: signed } = await supabase.storage
          .from(SURVEY_BUCKET)
          .createSignedUrl(path, 60 * 60);

        setPhotos((current) => [
          ...current,
          { path, url: signed?.signedUrl || URL.createObjectURL(body) },
        ]);
      } catch (e) {
        setError(`A photo could not be uploaded: ${e.message || "try again."}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function removePhoto(path) {
    setPhotos((current) => current.filter((p) => p.path !== path));
    setRemovedPaths((current) => [...current, path]);
    setViewing(null);
  }

  async function save() {
    setError("");

    if (!jobNumber.trim()) {
      setError("Add the job number before saving.");
      return;
    }

    const badExtra = rows.find(
      (r) => r.extra && Number(r.qty) > 0 && (!String(r.name).trim() || r.price === "")
    );
    if (badExtra) {
      setError("Each extra item needs a name and a price.");
      return;
    }

    if (uploading > 0) {
      setError("Wait for the photos to finish uploading.");
      return;
    }

    const items = rows
      .filter((r) => Number(r.qty) > 0)
      .map((r) => ({
        name: String(r.name).trim(),
        price: roundMoney(r.price),
        qty: Number(r.qty),
      }));

    const payload = {
      job_number: jobNumber.trim(),
      job_date: jobDate,
      address: address.trim() || null,
      notes: notes.trim() || null,
      items,
      photos: photos.map((p) => p.path),
      total: jobTotal(items),
      updated_at: new Date().toISOString(),
    };

    setSaving(true);

    try {
      const { error: saveError } = jobId
        ? await supabase.from("mp_jobs").update(payload).eq("id", jobId)
        : await supabase.from("mp_jobs").insert({ ...payload, user_id: userId });

      if (saveError) throw saveError;

      if (removedPaths.length) {
        await supabase.storage.from(SURVEY_BUCKET).remove(removedPaths);
      }

      router.push("/windows");
    } catch (e) {
      setError(e.message || "The job could not be saved.");
      setSaving(false);
    }
  }

  async function deleteJob() {
    if (!jobId) return;
    if (!window.confirm(`Delete job ${jobNumber || ""}? This cannot be undone.`)) return;

    setSaving(true);
    try {
      const { error: deleteError } = await supabase
        .from("mp_jobs")
        .delete()
        .eq("id", jobId);
      if (deleteError) throw deleteError;

      const allPaths = [...photos.map((p) => p.path), ...removedPaths];
      if (allPaths.length) {
        await supabase.storage.from(SURVEY_BUCKET).remove(allPaths);
      }

      router.push("/windows");
    } catch (e) {
      setError(e.message || "The job could not be deleted.");
      setSaving(false);
    }
  }

  const field =
    "w-full rounded-lg border border-[#C9D6D6] bg-white px-3 py-3 text-base focus:border-[#0F766E] focus:outline-none focus:ring-2 focus:ring-[#0F766E]/25";

  if (loading) {
    return (
      <WindowsFrame>
        <p className="mt-8 text-slate-500">Loading…</p>
      </WindowsFrame>
    );
  }

  return (
    <WindowsFrame>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {jobId ? `Job ${jobNumber}` : "New job"}
        </h1>
        <Link href="/windows" className="text-sm font-semibold text-[#0F766E]">
          Back to jobs
        </Link>
      </div>

      {/* Job details */}
      <section className="mt-5 grid grid-cols-2 gap-3">
        <label className="col-span-1">
          <span className="mb-1 block text-sm font-semibold">Job number</span>
          <input
            value={jobNumber}
            onChange={(e) => setJobNumber(e.target.value)}
            placeholder="e.g. 4512"
            className={field}
          />
        </label>
        <label className="col-span-1">
          <span className="mb-1 block text-sm font-semibold">Date</span>
          <input
            type="date"
            value={jobDate}
            onChange={(e) => setJobDate(e.target.value)}
            className={field}
          />
        </label>
        <label className="col-span-2">
          <span className="mb-1 block text-sm font-semibold">Address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="House or customer"
            className={field}
          />
        </label>
      </section>

      {/* Survey photos */}
      <section className="mt-7">
        <h2 className="text-lg font-bold">Survey photos</h2>

        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <button
              key={photo.path}
              type="button"
              onClick={() => setViewing(photo)}
              className="aspect-square overflow-hidden rounded-lg border border-[#C9D6D6] bg-white"
            >
              {photo.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt="Survey photo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-slate-500">Photo</span>
              )}
            </button>
          ))}

          {Array.from({ length: uploading }).map((_, i) => (
            <div
              key={`up-${i}`}
              className="flex aspect-square animate-pulse items-center justify-center rounded-lg bg-[#DCE7E7] text-xs text-slate-600"
            >
              Uploading…
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraInput.current?.click()}
            className="rounded-xl bg-[#13232E] py-3 font-semibold text-white hover:bg-[#1E3442]"
          >
            Take photo
          </button>
          <button
            type="button"
            onClick={() => galleryInput.current?.click()}
            className="rounded-xl border border-[#13232E] bg-white py-3 font-semibold hover:bg-slate-50"
          >
            Choose from phone
          </button>
        </div>

        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={galleryInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
      </section>

      {/* Calculator */}
      <section className="mt-7">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">What you did</h2>
          <Link href="/windows/prices" className="text-sm font-semibold text-[#0F766E]">
            Edit prices
          </Link>
        </div>

        <ul className="mt-3 divide-y divide-[#D5E0E0] overflow-hidden rounded-xl border border-[#D5E0E0] bg-white">
          {rows.map((row) => {
            const line = roundMoney((Number(row.price) || 0) * (Number(row.qty) || 0));
            const active = Number(row.qty) > 0;

            return (
              <li
                key={row.key}
                className={`flex items-center gap-3 p-3 ${active ? "bg-[#F1FAF8]" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  {row.extra ? (
                    <div className="flex gap-2">
                      <input
                        value={row.name}
                        onChange={(e) => updateRow(row.key, "name", e.target.value)}
                        placeholder="Other item"
                        aria-label="Item name"
                        className="min-w-0 flex-1 rounded-md border border-[#C9D6D6] px-2 py-2 text-base"
                      />
                      <label className="flex items-center rounded-md border border-[#C9D6D6]">
                        <span className="pl-2 text-slate-500">£</span>
                        <input
                          value={row.price}
                          onChange={(e) =>
                            updateRow(row.key, "price", e.target.value.replace(/[^0-9.]/g, ""))
                          }
                          inputMode="decimal"
                          placeholder="0"
                          aria-label="Price each"
                          className="w-16 bg-transparent px-1 py-2 text-right text-base tabular-nums focus:outline-none"
                        />
                      </label>
                    </div>
                  ) : (
                    <>
                      <p className="font-semibold">{row.name}</p>
                      <p className="text-sm text-slate-500">
                        {formatMoney(row.price)} each
                      </p>
                    </>
                  )}
                  {active ? (
                    <p className="mt-1 text-sm font-semibold tabular-nums text-[#0F766E]">
                      {formatMoney(line)}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setQty(row.key, Number(row.qty) - 1)}
                    aria-label={`One less ${row.name || "item"}`}
                    className="h-12 w-12 rounded-l-xl border border-[#C9D6D6] text-2xl font-bold text-[#13232E] active:bg-slate-100"
                  >
                    −
                  </button>
                  <input
                    value={row.qty}
                    onChange={(e) => setQty(row.key, e.target.value.replace(/\D/g, ""))}
                    onFocus={(e) => e.target.select()}
                    inputMode="numeric"
                    aria-label={`How many ${row.name || "items"}`}
                    className="h-12 w-12 border-y border-[#C9D6D6] text-center text-lg font-bold tabular-nums focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setQty(row.key, Number(row.qty) + 1)}
                    aria-label={`One more ${row.name || "item"}`}
                    className="h-12 w-12 rounded-r-xl bg-[#0F766E] text-2xl font-bold text-white active:bg-[#0B5F58]"
                  >
                    +
                  </button>
                </div>

                {row.extra ? (
                  <button
                    type="button"
                    onClick={() => removeExtra(row.key)}
                    aria-label="Remove this item"
                    className="px-1 text-red-700"
                  >
                    ✕
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={addExtra}
          className="mt-3 w-full rounded-xl border-2 border-dashed border-[#9FB8B8] py-3 font-semibold text-[#0F766E] hover:bg-white"
        >
          + Other item for this job
        </button>
      </section>

      {/* Notes */}
      <section className="mt-7">
        <label>
          <span className="mb-1 block text-lg font-bold">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything to remember about this job"
            className={field}
          />
        </label>
      </section>

      {jobId ? (
        <button
          type="button"
          onClick={deleteJob}
          disabled={saving}
          className="mt-8 text-sm font-semibold text-red-700 hover:underline"
        >
          Delete this job
        </button>
      ) : null}

      {error ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {/* Running total, always visible */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-[#13232E] text-white shadow-[0_-6px_20px_rgba(19,35,46,0.25)]">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-300">
              {itemCount === 0 ? "Nothing added yet" : `${itemCount} item${itemCount === 1 ? "" : "s"}`}
            </p>
            <p className="text-3xl font-extrabold tabular-nums tracking-tight" aria-live="polite">
              {formatMoney(total)}
            </p>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-[#7FD1C7] px-6 py-4 text-lg font-bold text-[#13232E] hover:bg-[#9BDDD4] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save job"}
          </button>
        </div>
      </div>

      {/* Full-size photo */}
      {viewing ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Survey photo"
          className="fixed inset-0 z-30 flex flex-col bg-black/90"
          onClick={() => setViewing(null)}
        >
          <div className="flex justify-between p-3" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => removePhoto(viewing.path)}
              className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white"
            >
              Delete photo
            </button>
            <button
              type="button"
              onClick={() => setViewing(null)}
              className="rounded-lg bg-white px-4 py-2 font-semibold text-[#13232E]"
            >
              Close
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewing.url} alt="Survey photo" className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      ) : null}
    </WindowsFrame>
  );
}