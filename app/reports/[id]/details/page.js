"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  useParams,
  useRouter,
} from "next/navigation";

import {
  supabase,
} from "../../../../lib/supabase";

// ============================================================
// HELPERS
// ============================================================

function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function safeObject(value) {
  if (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }

  return {};
}

function Box({
  label,
  value,
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-2 text-2xl font-bold text-slate-900">
        {value}
      </div>
    </div>
  );
}

// ============================================================
// PAGE
// ============================================================

export default function ReportDetailsPage() {
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
    report,
    setReport,
  ] =
    useState(null);

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

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  // ==========================================================
  // LOAD REPORT
  // ==========================================================

  const loadReport =
    useCallback(
      async () => {
        if (!reportId) {
          return;
        }

        try {
          const {
            data,
            error:
              loadError,
          } =
            await supabase
              .from(
                "ai_reports"
              )
              .select(
                `
                id,
                property_address,
                property_postcode,
                source_pdf_name,
                overview
                `
              )
              .eq(
                "id",
                reportId
              )
              .single();

          if (
            loadError
          ) {
            throw loadError;
          }

          setReport(
            data
          );
        } catch (
          loadError
        ) {
          setError(
            loadError?.message ||
              "Could not load report."
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [reportId]
    );

  useEffect(() => {
    loadReport();
  }, [
    loadReport,
  ]);

  // ==========================================================
  // RUN FULL DETAIL PASS
  // ==========================================================

  async function runDetails() {
    if (
      running ||
      !reportId
    ) {
      return;
    }

    const wait = (
      milliseconds
    ) =>
      new Promise(
        (
          resolve
        ) =>
          setTimeout(
            resolve,
            milliseconds
          )
      );

    try {
      setRunning(
        true
      );

      setError("");

      let keepRunning =
        true;

      while (
        keepRunning
      ) {
        setMessage(
          "AI is adding detailed item descriptions..."
        );

        const response =
          await fetch(
            `/api/reports/${reportId}/enrich-details`,
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
            "Detailed report analysis returned an invalid server response."
          );
        }

        // ----------------------------------------------------
        // QUOTA
        // ----------------------------------------------------

        if (
          response.status ===
            429 &&
          data
            ?.quota_limited
        ) {
          const completed =
            safeNumber(
              data
                ?.completed_photo_count
            );

          const total =
            safeNumber(
              data
                ?.total_photo_count
            );

          const retry =
            safeNumber(
              data
                ?.retry_after_seconds,
              60
            );

          setMessage(
            `Gemini quota reached. Progress is saved: ${completed} / ${total}. Wait at least ${retry} seconds and press Continue Detailed Analysis later.`
          );

          keepRunning =
            false;

          await loadReport();

          break;
        }

        // ----------------------------------------------------
        // ERROR
        // ----------------------------------------------------

        if (
          !response.ok
        ) {
          throw new Error(
            data?.error ||
              "Detailed report analysis failed."
          );
        }

        // ----------------------------------------------------
        // COMPLETE
        // ----------------------------------------------------

        if (
          data?.done ===
          true
        ) {
          setMessage(
            `Detailed report analysis complete ✓ — ${safeNumber(
              data.completed_photo_count
            )} / ${safeNumber(
              data.total_photo_count
            )} photographs. Exact models found: ${safeNumber(
              data.model_found_count
            )}. Photos with count details: ${safeNumber(
              data.count_detail_count
            )}.`
          );

          keepRunning =
            false;

          await loadReport();

          break;
        }

        // ----------------------------------------------------
        // CHECKPOINT
        // ----------------------------------------------------

        const start =
          data
            ?.batch_completed
            ?.start_page ??
          "?";

        const end =
          data
            ?.batch_completed
            ?.end_page ??
          "?";

        setMessage(
          `Pages ${start}-${end} completed and saved ✓ — ${safeNumber(
            data.completed_photo_count
          )} / ${safeNumber(
            data.total_photo_count
          )} (${safeNumber(
            data.progress_percent
          )}%). Models found: ${safeNumber(
            data.model_found_count
          )}. Count details: ${safeNumber(
            data.count_detail_count
          )}.`
        );

        await loadReport();

        // Leave room between free-tier requests.
        await wait(
          15000
        );
      }
    } catch (
      runError
    ) {
      console.error(
        runError
      );

      setError(
        runError?.message ||
          "Detailed report analysis failed."
      );

      setMessage(
        "Stopped. Completed batches remain saved."
      );
    } finally {
      setRunning(
        false
      );
    }
  }

  // ==========================================================
  // VALUES
  // ==========================================================

  const overview =
    safeObject(
      report?.overview
    );

  const details =
    safeObject(
      overview
        ?.detail_enrichment
    );

  const complete =
    details.completed ===
    true;

  const completed =
    safeNumber(
      details
        .completed_photo_count
    );

  const total =
    safeNumber(
      details
        .total_photo_count
    );

  const progress =
    safeNumber(
      details
        .progress_percent
    );

  const models =
    safeNumber(
      details
        .model_found_count
    );

  const counts =
    safeNumber(
      details
        .count_detail_count
    );

  const reviews =
    safeNumber(
      details
        .review_required_count
    );

  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <div className="p-8">
        Loading...
      </div>
    );
  }

  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-violet-600">
              AI Inventory
            </div>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Detailed Report Preparation
            </h1>

            <p className="mt-2 text-slate-600">
              {report
                ?.property_address ||
                report
                  ?.source_pdf_name}
            </p>

            {report
              ?.property_postcode && (
              <p className="text-sm text-slate-500">
                {
                  report
                    .property_postcode
                }
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              router.push(
                `/reports/${reportId}`
              )
            }
            className="rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Report
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-violet-200 bg-violet-50 p-6">
        <h2 className="text-xl font-bold text-slate-900">
          What this pass adds
        </h2>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-white p-4">
            Appliance brand and exact model where readable
          </div>

          <div className="rounded-lg bg-white p-4">
            Fridge/freezer shelf, balcony and drawer counts
          </div>

          <div className="rounded-lg bg-white p-4">
            Cupboard and wardrobe internal shelf / rail details
          </div>

          <div className="rounded-lg bg-white p-4">
            Colours, materials, finishes and item types
          </div>

          <div className="rounded-lg bg-white p-4">
            Oven racks, trays and useful internal details
          </div>

          <div className="rounded-lg bg-white p-4">
            Useful quantities and defining visible features
          </div>
        </div>
      </section>

      {message && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 font-medium text-blue-800">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Box
          label="Detailed"
          value={`${completed} / ${total}`}
        />

        <Box
          label="Progress"
          value={`${progress}%`}
        />

        <Box
          label="Exact models"
          value={
            models
          }
        />

        <Box
          label="Count details"
          value={
            counts
          }
        />

        <Box
          label="Uncertain"
          value={
            reviews
          }
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {complete ? (
          <>
            <div className="text-2xl font-bold text-emerald-700">
              Detailed report data ready ✓
            </div>

            <p className="mt-2 text-slate-600">
              All non-meter photographs have now been prepared
              for the finished Right Inventories report.
            </p>

            <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 font-semibold text-emerald-900">
              Next step: generate the actual finished report preview.
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold text-slate-900">
              Build detailed report data
            </h2>

            <p className="mt-2 text-slate-600">
              This runs automatically in 5-page checkpoints.
              You do not need to approve each photograph.
            </p>

            <button
              type="button"
              onClick={
                runDetails
              }
              disabled={
                running
              }
              className="mt-5 rounded-lg bg-violet-600 px-6 py-3 font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running
                ? "Building Detailed Report..."
                : completed > 0
                  ? "Continue Detailed Analysis"
                  : "Build Detailed Report"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}