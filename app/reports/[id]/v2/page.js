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

function parseObject(value) {
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

function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
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

export default function InventoryV2Page() {
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
    loading,
    setLoading,
  ] =
    useState(true);

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
          setError("");

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

          setReport(data);
        } catch (
          loadError
        ) {
          setError(
            loadError?.message ||
              "Could not load report."
          );
        } finally {
          setLoading(false);
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
  // RUN V2
  // ==========================================================

  async function runV2() {
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
        (resolve) =>
          setTimeout(
            resolve,
            milliseconds
          )
      );

    try {
      setRunning(true);

      setError("");

      let keepRunning =
        true;

      while (
        keepRunning
      ) {
        setMessage(
          "V2 is analysing the next photograph batch..."
        );

        const response =
          await fetch(
            `/api/reports/${reportId}/analyse-inventory-v2`,
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
            "V2 returned an invalid server response."
          );
        }

        // ====================================================
        // EXTRACTION NOT COMPLETE
        // ====================================================

        if (
          response.status ===
            409 &&
          data
            ?.extraction_required
        ) {
          setError(
            `Photo extraction is not finished: ${safeNumber(
              data.extracted
            )} / ${safeNumber(
              data.total
            )}. Finish extraction first.`
          );

          setMessage("");

          keepRunning =
            false;

          break;
        }

        // ====================================================
        // FREE-TIER QUOTA
        // ====================================================

        if (
          response.status ===
            429 &&
          data
            ?.quota_limited
        ) {
          setMessage(
            `Gemini free-tier limit reached. Everything is saved: ${safeNumber(
              data.completed_photos
            )} / ${safeNumber(
              data.total_real_photos
            )}. Wait about ${safeNumber(
              data.retry_after_seconds,
              60
            )} seconds and press Continue V2 later.`
          );

          keepRunning =
            false;

          await loadReport();

          break;
        }

        // ====================================================
        // ERROR
        // ====================================================

        if (
          !response.ok
        ) {
          throw new Error(
            data?.error ||
              "V2 analysis failed."
          );
        }

        // ====================================================
        // COMPLETE
        // ====================================================

        if (
          data?.done ===
          true
        ) {
          setMessage(
            `V2 COMPLETE ✓ — ${safeNumber(
              data.completed_photos
            )} / ${safeNumber(
              data.total_real_photos
            )} real photographs analysed. Damage photos: ${safeNumber(
              data.damage_photo_count
            )}. Cleaning issues: ${safeNumber(
              data.cleaning_issue_photo_count
            )}. Exact models: ${safeNumber(
              data.exact_model_count
            )}.`
          );

          keepRunning =
            false;

          await loadReport();

          break;
        }

        // ====================================================
        // BATCH SAVED
        // ====================================================

        setMessage(
          `Batch SAVED ✓ — ${safeNumber(
            data.completed_photos
          )} / ${safeNumber(
            data.total_real_photos
          )} (${safeNumber(
            data.progress_percent
          )}%). Damage: ${safeNumber(
            data.damage_photo_count
          )}. Cleaning: ${safeNumber(
            data.cleaning_issue_photo_count
          )}. Models: ${safeNumber(
            data.exact_model_count
          )}.`
        );

        await loadReport();

        // Only a short delay.
        await wait(2000);
      }
    } catch (
      runError
    ) {
      console.error(
        "V2 runner error:",
        runError
      );

      setError(
        runError?.message ||
          "V2 stopped."
      );

      setMessage(
        "Completed V2 batches remain saved. Press Continue V2 to resume."
      );
    } finally {
      setRunning(false);
    }
  }

  // ==========================================================
  // SUMMARY
  // ==========================================================

  const overview =
    parseObject(
      report?.overview
    );

  const extraction =
    parseObject(
      overview
        .photo_extraction
    );

  const v2 =
    parseObject(
      overview
        .inventory_v2
    );

  const extractionComplete =
    extraction
      .completed ===
      true;

  const total =
    safeNumber(
      v2.total_real_photos
    );

  const completed =
    safeNumber(
      v2.completed_photos
    );

  const progress =
    safeNumber(
      v2.progress_percent
    );

  const damage =
    safeNumber(
      v2.damage_photo_count
    );

  const cleaning =
    safeNumber(
      v2.cleaning_issue_photo_count
    );

  const models =
    safeNumber(
      v2.exact_model_count
    );

  const additional =
    safeNumber(
      v2.additional_image_count
    );

  const meters =
    Array.isArray(
      v2.meters
    )
      ? v2.meters
      : [];

  const complete =
    v2.completed ===
    true;

  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <div className="p-8">
        Loading Inventory V2...
      </div>
    );
  }

  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-violet-600">
              Right Inventories AI V2
            </div>

            <h1 className="mt-2 text-3xl font-bold text-slate-900">
              Final Inventory Analysis
            </h1>

            <p className="mt-2 text-slate-600">
              {report
                ?.property_address ||
                report
                  ?.source_pdf_name}
            </p>

            {report
              ?.property_postcode && (
              <p className="text-slate-500">
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
            className="rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold"
          >
            Back to Report
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-violet-200 bg-violet-50 p-6">
        <h2 className="text-xl font-bold text-slate-900">
          One-pass V2
        </h2>

        <p className="mt-2 text-slate-700">
          Each real source photograph is analysed once for its
          description, condition, cleanliness, damage,
          appliance details, counts and meter information.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-white p-4">
            General = General view only
          </div>

          <div className="rounded-lg bg-white p-4">
            Most photos genuinely described
          </div>

          <div className="rounded-lg bg-white p-4">
            Damage + cleaning checked once
          </div>

          <div className="rounded-lg bg-white p-4">
            Strict meter reading / SN
          </div>
        </div>
      </section>

      {!extractionComplete && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 font-semibold text-amber-900">
          Finish source photo extraction before starting V2.
          V2 will not analyse incomplete image data.
        </div>
      )}

      {message && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 font-medium text-blue-800">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Box
          label="Analysed"
          value={`${completed} / ${total}`}
        />

        <Box
          label="Progress"
          value={`${progress}%`}
        />

        <Box
          label="Damage photos"
          value={damage}
        />

        <Box
          label="Cleaning issues"
          value={cleaning}
        />

        <Box
          label="Exact models"
          value={models}
        />

        <Box
          label="Additional images"
          value={additional}
        />

        <Box
          label="Meters"
          value={meters.length}
        />

        <Box
          label="Model"
          value={
            v2.model ||
            "Gemini 3.5 Flash"
          }
        />
      </div>

      {meters.length > 0 && (
        <section className="rounded-xl border border-purple-200 bg-purple-50 p-6">
          <h2 className="text-xl font-bold text-purple-950">
            Meter results
          </h2>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {meters.map(
              (
                meter,
                index
              ) => (
                <div
                  key={
                    index
                  }
                  className="rounded-xl bg-white p-5"
                >
                  <div className="text-lg font-bold">
                    {meter.meter_type} meter
                  </div>

                  {meter.reading && (
                    <div className="mt-2">
                      Reading.{" "}
                      {meter.reading}
                      {meter.unit
                        ? ` ${meter.unit}`
                        : ""}
                    </div>
                  )}

                  {meter.serial_number && (
                    <div>
                      SN.{" "}
                      {
                        meter.serial_number
                      }
                    </div>
                  )}

                  {meter.balance && (
                    <div>
                      Balance £
                      {
                        meter.balance
                      }
                    </div>
                  )}

                  {meter.rate_1 && (
                    <div>
                      Reading rate 1.{" "}
                      {
                        meter.rate_1
                      }
                    </div>
                  )}

                  {meter.rate_2 && (
                    <div>
                      Reading rate 2.{" "}
                      {
                        meter.rate_2
                      }
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
        {complete ? (
          <>
            <div className="text-2xl font-bold text-emerald-700">
              V2 analysis complete ✓
            </div>

            <p className="mt-2 text-slate-600">
              The final Right Inventories data is now ready for
              the report renderer.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold text-slate-900">
              Run final AI analysis
            </h2>

            <p className="mt-2 text-slate-600">
              No manual photo approval. It runs automatically
              and checkpoints every batch.
            </p>

            <button
              type="button"
              disabled={
                running ||
                !extractionComplete
              }
              onClick={runV2}
              className="mt-5 rounded-xl bg-violet-600 px-7 py-4 text-lg font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running
                ? "V2 Analysing Report..."
                : completed > 0
                  ? "Continue V2"
                  : "Run AI V2"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}