"use client";

import {
  useState,
} from "react";

import {
  useParams,
  useRouter,
} from "next/navigation";

export default function PolishV2Page() {
  const params =
    useParams();

  const router =
    useRouter();

  const reportId =
    typeof params?.id ===
    "string"
      ? params.id
      : "";

  const [
    running,
    setRunning,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    error,
    setError,
  ] =
    useState("");

  async function runRefinement() {
    if (
      running ||
      !reportId
    ) {
      return;
    }

    try {
      setRunning(true);
      setError("");

      let finished =
        false;

      while (!finished) {
        setMessage(
          "Rechecking important report photographs and applying Right Inventories wording..."
        );

        const response =
          await fetch(
            `/api/reports/${reportId}/polish-v2`,
            {
              method:
                "POST",
            }
          );

        let data;

        try {
          data =
            await response.json();
        } catch {
          throw new Error(
            "Invalid refinement response."
          );
        }

        if (
          response.status ===
            429 &&
          data
            ?.quota_limited
        ) {
          setMessage(
            "Everything completed so far has been saved."
          );

          setError(
            `Gemini free-tier limit reached. Wait approximately ${
              data
                .retry_after_seconds ||
              60
            } seconds and press Continue Refinement.`
          );

          return;
        }

        if (
          !response.ok
        ) {
          throw new Error(
            data?.error ||
              "Report refinement failed."
          );
        }

        if (
          data.done ===
          false
        ) {
          setMessage(
            `Batch saved ✓ — ${data.remaining} important photographs remaining.`
          );

          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                1500
              )
          );

          continue;
        }

        finished = true;

        setMessage(
          "Photographic wording corrected ✓. Rebuilding final meters and Overview..."
        );
      }

      // ======================================================
      // REBUILD FINAL METERS + OVERVIEW
      // ======================================================

      const finalResponse =
        await fetch(
          `/api/reports/${reportId}/finalise-v2`,
          {
            method:
              "POST",
          }
        );

      let finalData;

      try {
        finalData =
          await finalResponse.json();
      } catch {
        throw new Error(
          "Invalid final report response."
        );
      }

      if (
        finalResponse.status ===
          429 &&
        finalData
          ?.quota_limited
      ) {
        setMessage(
          "All photograph corrections are already saved ✓."
        );

        setError(
          `Only the final meter/Overview call hit the Gemini limit. Wait approximately ${
            finalData
              .retry_after_seconds ||
            60
          } seconds and press Continue Refinement again.`
        );

        return;
      }

      if (
        !finalResponse.ok
      ) {
        throw new Error(
          finalData?.error ||
            "Could not rebuild final report."
        );
      }

      setMessage(
        "Corrected report ready ✓"
      );

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            700
          )
      );

      router.push(
        `/reports/${reportId}/final-v2`
      );
    } catch (
      runError
    ) {
      console.error(
        runError
      );

      setError(
        runError?.message ||
          "Refinement stopped."
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-sm font-bold uppercase tracking-wide text-violet-600">
          Right Inventories
        </div>

        <h1 className="mt-2 text-3xl font-bold text-slate-900">
          Final Report Refinement
        </h1>

        <p className="mt-3 max-w-3xl text-slate-600">
          This keeps the completed V2 analysis and only
          visually rechecks the sections that need stronger
          Right Inventories wording.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4">
            Model labels → model only
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            Appliance details de-duplicated
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            Fridge shelves consolidated
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            Appliance lights checked
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            Oven vents/details checked
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            Meter cupboard contents recognised
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            Cabinets simplified
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            Wall-mounted fittings retained
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            Conditions written once
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            Repeated photographs → Additional image
          </div>
        </div>

        {message && (
          <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 font-medium text-blue-800">
            {message}
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 font-medium text-red-700">
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={
            running
          }
          onClick={
            runRefinement
          }
          className="mt-7 rounded-xl bg-violet-600 px-8 py-4 text-lg font-bold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {running
            ? "Refining Report..."
            : "Refine & Rebuild Report"}
        </button>
      </section>
    </div>
  );
}