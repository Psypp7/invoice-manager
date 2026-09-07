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
} from "../../../lib/supabase";

// ============================================================
// SMALL UI COMPONENTS
// ============================================================

function SummaryBox({
  label,
  value,
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-2 text-2xl font-bold text-slate-900">
        {value}
      </div>
    </div>
  );
}

function StatusRow({
  label,
  complete,
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <span className="text-sm font-medium text-slate-700">
        {label}
      </span>

      <span
        className={
          complete
            ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"
            : "rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500"
        }
      >
        {complete
          ? "Complete"
          : "Pending"}
      </span>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  colour = "blue",
}) {
  const colourClasses = {
    blue:
      "bg-blue-600 hover:bg-blue-700",

    violet:
      "bg-violet-600 hover:bg-violet-700",

    amber:
      "bg-amber-500 hover:bg-amber-600",

    emerald:
      "bg-emerald-600 hover:bg-emerald-700",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={Boolean(
        disabled
      )}
      className={`rounded-lg px-5 py-3 font-semibold text-white transition ${
        colourClasses[
          colour
        ] ||
        colourClasses.blue
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

// ============================================================
// HELPERS
// ============================================================

function formatFileSize(
  bytes
) {
  const number =
    Number(bytes);

  if (
    !Number.isFinite(
      number
    ) ||
    number <= 0
  ) {
    return "—";
  }

  if (
    number <
    1024 * 1024
  ) {
    return `${(
      number / 1024
    ).toFixed(1)} KB`;
  }

  return `${(
    number /
    1024 /
    1024
  ).toFixed(2)} MB`;
}

function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return fallback;
  }

  return number;
}

function safeObject(
  value
) {
  if (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  ) {
    return value;
  }

  return {};
}

// ============================================================
// PAGE
// ============================================================

export default function AIReportPage() {
  const params =
    useParams();

  const router =
    useRouter();

  const reportId =
    typeof params?.id ===
    "string"
      ? params.id
      : "";

  // ----------------------------------------------------------
  // DATA
  // ----------------------------------------------------------

  const [
    report,
    setReport,
  ] =
    useState(null);

  const [
    sections,
    setSections,
  ] =
    useState([]);

  // ----------------------------------------------------------
  // PAGE STATE
  // ----------------------------------------------------------

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    analysingStructure,
    setAnalysingStructure,
  ] =
    useState(false);

  const [
    analysingImages,
    setAnalysingImages,
  ] =
    useState(false);

  const [
    auditingCondition,
    setAuditingCondition,
  ] =
    useState(false);

  const [
    validatingReport,
    setValidatingReport,
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

  // ==========================================================
  // LOAD REPORT
  // ==========================================================

  const loadReport =
    useCallback(
      async () => {
        if (
          !reportId
        ) {
          return;
        }

        try {
          setError("");

          // --------------------------------------------------
          // REPORT
          // --------------------------------------------------

          const {
            data:
              reportData,
            error:
              reportError,
          } =
            await supabase
              .from(
                "ai_reports"
              )
              .select(
                `
                id,
                report_type,
                property_address,
                property_postcode,
                status,
                overall_condition,
                overall_cleanliness,
                additional_comments,
                overview,
                source_pdf_path,
                source_pdf_name,
                source_pdf_size,
                source_pdf_uploaded_at,
                created_at,
                updated_at
                `
              )
              .eq(
                "id",
                reportId
              )
              .single();

          if (
            reportError
          ) {
            throw reportError;
          }

          // --------------------------------------------------
          // SECTIONS
          // --------------------------------------------------

          const {
            data:
              sectionData,
            error:
              sectionError,
          } =
            await supabase
              .from(
                "ai_report_sections"
              )
              .select(
                `
                id,
                report_id,
                room_name,
                section_name,
                sort_order,
                condition,
                cleanliness,
                ai_summary
                `
              )
              .eq(
                "report_id",
                reportId
              )
              .order(
                "sort_order",
                {
                  ascending:
                    true,
                }
              );

          if (
            sectionError
          ) {
            throw sectionError;
          }

          setReport(
            reportData
          );

          setSections(
            sectionData ||
              []
          );
        } catch (
          loadError
        ) {
          console.error(
            "Could not load AI report:",
            loadError
          );

          setError(
            loadError?.message ||
              "The AI report could not be loaded."
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [reportId]
    );

  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {
    if (
      reportId
    ) {
      loadReport();
    }
  }, [
    reportId,
    loadReport,
  ]);

  // ==========================================================
  // STAGE 1 — STRUCTURE
  // ==========================================================

  async function analyseStructure() {
    if (
      !reportId ||
      analysingStructure
    ) {
      return;
    }

    try {
      setAnalysingStructure(
        true
      );

      setError("");

      setMessage(
        "AI is reading the report structure..."
      );

      const response =
        await fetch(
          `/api/reports/${reportId}/analyse-full`,
          {
            method:
              "POST",
          }
        );

      const data =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          data?.error ||
            "Report structure analysis failed."
        );
      }

      setMessage(
        `Report structure extracted successfully${
          data?.section_count
            ? ` — ${data.section_count} sections found.`
            : "."
        }`
      );

      await loadReport();
    } catch (
      analyseError
    ) {
      console.error(
        "Structure analysis error:",
        analyseError
      );

      setError(
        analyseError?.message ||
          "Report structure analysis failed."
      );
    } finally {
      setAnalysingStructure(
        false
      );
    }
  }

  // ==========================================================
  // STAGE 2 — PHOTOGRAPH ANALYSIS
  // ==========================================================

  async function analyseImages() {
    if (
      !reportId ||
      analysingImages
    ) {
      return;
    }

    try {
      setAnalysingImages(
        true
      );

      setError("");

      setMessage(
        "AI is analysing the photographs in the report. This may take several minutes..."
      );

      const response =
        await fetch(
          `/api/reports/${reportId}/analyse-images`,
          {
            method:
              "POST",
          }
        );

      const data =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          data?.error ||
            "Photograph analysis failed."
        );
      }

      const detected =
        safeNumber(
          data?.detected_photo_count ??
            data?.photo_count
        );

      setMessage(
        detected > 0
          ? `Photograph analysis complete — ${detected} photographs detected.`
          : "Photograph analysis complete."
      );

      await loadReport();
    } catch (
      analyseError
    ) {
      console.error(
        "Photograph analysis error:",
        analyseError
      );

      setError(
        analyseError?.message ||
          "Photograph analysis failed."
      );
    } finally {
      setAnalysingImages(
        false
      );
    }
  }

  // ==========================================================
  // STAGE 2.5 — CONDITION & DAMAGE AUDIT
  //
  // Backend processes the next 5-page checkpoint.
  // Successful batches are permanently saved.
  //
  // 429 = stop safely.
  // No automatic quota retry.
  // ==========================================================

  async function auditCondition() {
    if (
      !reportId ||
      auditingCondition
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
      setAuditingCondition(
        true
      );

      setError("");

      let keepRunning =
        true;

      while (
        keepRunning
      ) {
        setMessage(
          "Running the next Condition & Damage Audit batch..."
        );

        const response =
          await fetch(
            `/api/reports/${reportId}/audit-condition`,
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
            "The condition audit returned an invalid server response."
          );
        }

        // ----------------------------------------------------
        // QUOTA
        // ----------------------------------------------------

        if (
          response.status ===
            429 &&
          data?.quota_limited
        ) {
          const completed =
            safeNumber(
              data?.completed_photo_count
            );

          const total =
            safeNumber(
              data?.total_photo_count,
              479
            );

          const retrySeconds =
            safeNumber(
              data?.retry_after_seconds,
              60
            );

          setMessage(
            `Gemini quota reached. Progress is safe: ${completed} / ${total} photographs audited. Wait at least ${retrySeconds} seconds and press Audit Condition & Damage again later to resume.`
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
              data?.message ||
              "Condition audit failed."
          );
        }

        // ----------------------------------------------------
        // FINISHED
        // ----------------------------------------------------

        if (
          data?.done ===
          true
        ) {
          const completed =
            safeNumber(
              data?.completed_photo_count
            );

          const total =
            safeNumber(
              data?.total_photo_count,
              completed
            );

          setMessage(
            `Condition & Damage Audit complete ✓ — ${completed} / ${total} photographs audited.`
          );

          keepRunning =
            false;

          await loadReport();

          break;
        }

        // ----------------------------------------------------
        // BATCH SAVED
        // ----------------------------------------------------

        const completed =
          safeNumber(
            data?.completed_photo_count
          );

        const total =
          safeNumber(
            data?.total_photo_count
          );

        const remaining =
          safeNumber(
            data?.remaining_photo_count
          );

        const progress =
          safeNumber(
            data?.progress_percent
          );

        const startPage =
          data
            ?.batch_completed
            ?.start_page ??
          "?";

        const endPage =
          data
            ?.batch_completed
            ?.end_page ??
          "?";

        setMessage(
          `Pages ${startPage}-${endPage} audited and SAVED ✓ — ${completed} / ${total} photographs complete (${progress}%). ${remaining} remaining.`
        );

        await loadReport();

        // Leave a gap between successful requests.
        await wait(
          15000
        );
      }
    } catch (
      auditError
    ) {
      console.error(
        "Condition audit error:",
        auditError
      );

      setError(
        auditError?.message ||
          "Condition audit failed."
      );

      setMessage(
        "Audit stopped. Any previously completed batches remain saved. Press Audit Condition & Damage later to resume."
      );
    } finally {
      setAuditingCondition(
        false
      );
    }
  }

  // ==========================================================
  // STAGE 3 — FINAL REPORT QUALITY VALIDATION
  //
  // Checks every non-meter photograph against the source PDF.
  //
  // Does NOT rewrite everything.
  // Keeps correct results.
  // Corrects material errors.
  //
  // Uses 5-page checkpoints.
  // ==========================================================

  async function validateFullReport() {
    if (
      !reportId ||
      validatingReport
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
      setValidatingReport(
        true
      );

      setError("");

      let keepRunning =
        true;

      while (
        keepRunning
      ) {
        setMessage(
          "Validating the next report-quality batch..."
        );

        const response =
          await fetch(
            `/api/reports/${reportId}/validate-report`,
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
            "Report validation returned an invalid server response."
          );
        }

        // ----------------------------------------------------
        // GEMINI QUOTA
        // ----------------------------------------------------

        if (
          response.status ===
            429 &&
          data?.quota_limited
        ) {
          const completed =
            safeNumber(
              data?.completed_photo_count
            );

          const total =
            safeNumber(
              data?.total_photo_count
            );

          const retrySeconds =
            safeNumber(
              data?.retry_after_seconds,
              60
            );

          setMessage(
            `Gemini quota reached. Validation progress is safe: ${completed} / ${total} photographs. Wait at least ${retrySeconds} seconds and press Validate Full Report again later to resume.`
          );

          keepRunning =
            false;

          await loadReport();

          break;
        }

        // ----------------------------------------------------
        // NORMAL ERROR
        // ----------------------------------------------------

        if (
          !response.ok
        ) {
          throw new Error(
            data?.error ||
              data?.message ||
              "Report validation failed."
          );
        }

        // ----------------------------------------------------
        // FINISHED
        // ----------------------------------------------------

        if (
          data?.done ===
          true
        ) {
          const completed =
            safeNumber(
              data?.completed_photo_count
            );

          const total =
            safeNumber(
              data?.total_photo_count,
              completed
            );

          const corrections =
            safeNumber(
              data?.correction_count
            );

          const reviews =
            safeNumber(
              data?.review_required_count
            );

          const damage =
            safeNumber(
              data?.visible_damage_count
            );

          setMessage(
            `Full report validation complete ✓ — ${completed} / ${total} photographs checked. ${corrections} corrections, ${damage} damage findings and ${reviews} requiring review.`
          );

          keepRunning =
            false;

          await loadReport();

          break;
        }

        // ----------------------------------------------------
        // CHECKPOINT SAVED
        // ----------------------------------------------------

        const completed =
          safeNumber(
            data?.completed_photo_count
          );

        const total =
          safeNumber(
            data?.total_photo_count
          );

        const remaining =
          safeNumber(
            data?.remaining_photo_count
          );

        const progress =
          safeNumber(
            data?.progress_percent
          );

        const corrections =
          safeNumber(
            data?.correction_count
          );

        const reviews =
          safeNumber(
            data?.review_required_count
          );

        const damage =
          safeNumber(
            data?.visible_damage_count
          );

        const startPage =
          data
            ?.batch_completed
            ?.start_page ??
          "?";

        const endPage =
          data
            ?.batch_completed
            ?.end_page ??
          "?";

        setMessage(
          `Pages ${startPage}-${endPage} validated and SAVED ✓ — ${completed} / ${total} (${progress}%). ${remaining} remaining. Corrections: ${corrections}. Damage: ${damage}. Review: ${reviews}.`
        );

        await loadReport();

        await wait(
          15000
        );
      }
    } catch (
      validationError
    ) {
      console.error(
        "Report validation error:",
        validationError
      );

      setError(
        validationError?.message ||
          "Report validation failed."
      );

      setMessage(
        "Validation stopped. Completed batches remain saved. Press Validate Full Report later to resume."
      );
    } finally {
      setValidatingReport(
        false
      );
    }
  }

  // ==========================================================
  // DERIVED REPORT INFORMATION
  // ==========================================================

  const overview =
    safeObject(
      report?.overview
    );

  const sourceStructure =
    safeObject(
      overview
        ?.source_structure
    );

  const photoAnalysis =
    safeObject(
      overview
        ?.photo_analysis
    );

  const conditionAudit =
    safeObject(
      overview
        ?.condition_audit
    );

  const meterAnalysis =
    safeObject(
      overview
        ?.meter_analysis
    );

  const reportValidation =
    safeObject(
      overview
        ?.report_validation
    );

  // ==========================================================
  // STAGE 1 STATUS
  // ==========================================================

  const sectionsExtracted =
    sections.length > 0 ||
    [
      "sections_extracted",
      "images_analysed",
      "auditing_condition",
      "condition_audited",
    ].includes(
      report?.status
    );

  // ==========================================================
  // STAGE 2 STATUS
  // ==========================================================

  const detectedPhotos =
    safeNumber(
      photoAnalysis
        ?.detected_photo_count ??
        photoAnalysis
          ?.photo_count ??
        photoAnalysis
          ?.unique_photo_count
    );

  const imagesAnalysed =
    detectedPhotos > 0 ||
    [
      "images_analysed",
      "auditing_condition",
      "condition_audited",
    ].includes(
      report?.status
    );

  // ==========================================================
  // STAGE 2.5 STATUS
  // ==========================================================

  const auditedPhotos =
    safeNumber(
      conditionAudit
        ?.completed_photo_count ??
        conditionAudit
          ?.audited_photo_count
    );

  const totalAuditPhotos =
    safeNumber(
      conditionAudit
        ?.total_photo_count,
      imagesAnalysed
        ? detectedPhotos
        : 0
    );

  const auditProgress =
    safeNumber(
      conditionAudit
        ?.progress_percent,
      totalAuditPhotos >
        0
        ? Math.round(
            (
              auditedPhotos /
              totalAuditPhotos
            ) *
              100
          )
        : 0
    );

  const conditionAudited =
    report?.status ===
      "condition_audited" ||
    conditionAudit
      ?.completed ===
      true ||
    (
      totalAuditPhotos >
        0 &&
      auditedPhotos ===
        totalAuditPhotos
    );

  // ==========================================================
  // METER STATUS
  // ==========================================================

  const metersCompleted =
    meterAnalysis
      ?.completed ===
      true;

  const meterCount =
    safeNumber(
      meterAnalysis
        ?.meter_count
    );

  // ==========================================================
  // STAGE 3 STATUS
  // ==========================================================

  const validationCompleted =
    reportValidation
      ?.completed ===
      true;

  const validatedPhotos =
    safeNumber(
      reportValidation
        ?.completed_photo_count
    );

  const validationTotal =
    safeNumber(
      reportValidation
        ?.total_photo_count
    );

  const validationProgress =
    safeNumber(
      reportValidation
        ?.progress_percent,
      validationTotal >
        0
        ? Math.round(
            (
              validatedPhotos /
              validationTotal
            ) *
              100
          )
        : 0
    );

  const validationCorrections =
    safeNumber(
      reportValidation
        ?.correction_count
    );

  const validationReview =
    safeNumber(
      reportValidation
        ?.review_required_count
    );

  const validationDamage =
    safeNumber(
      reportValidation
        ?.visible_damage_count
    );

  // ==========================================================
  // FUTURE OVERVIEW STATUS
  // ==========================================================

  const overviewPrepared =
    Boolean(
      overview
        ?.final_overview ||
      report
        ?.overall_condition
    );

  // ==========================================================
  // GROUP SECTIONS BY ROOM
  // ==========================================================

  const rooms =
    [];

  for (
    const section of
    sections
  ) {
    const roomName =
      section.room_name ||
      "Other";

    let room =
      rooms.find(
        (
          item
        ) =>
          item.name ===
          roomName
      );

    if (!room) {
      room = {
        name:
          roomName,

        sections:
          [],
      };

      rooms.push(
        room
      );
    }

    room.sections.push(
      section
    );
  }

  // ==========================================================
  // LOADING
  // ==========================================================

  if (
    loading
  ) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-slate-600">
            Loading AI inventory report...
          </p>
        </div>
      </div>
    );
  }

  // ==========================================================
  // REPORT NOT FOUND
  // ==========================================================

  if (
    !report
  ) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
          {error ||
            "The AI inventory report could not be found."}
        </div>
      </div>
    );
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-violet-600">
            AI Inventory
          </div>

          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            {report
              .property_address ||
              report
                .source_pdf_name ||
              "Inventory Report"}
          </h1>

          {report
            .property_postcode && (
            <p className="mt-1 text-slate-600">
              {
                report
                  .property_postcode
              }
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {report
                .report_type ||
                "Inventory"}
            </span>

            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
              Status:{" "}
              {report
                .status ||
                "draft"}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() =>
              router.push(
                `/reports/${reportId}/review`
              )
            }
            className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Review Issues
          </button>

          <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <div>
              <strong>
                Report ID:
              </strong>
            </div>

            <div className="mt-1 max-w-[280px] break-all font-mono text-xs">
              {
                report.id
              }
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================
          MESSAGE
      ===================================================== */}

      {message && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-800">
          {message}
        </div>
      )}

      {/* =====================================================
          ERROR
      ===================================================== */}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {/* =====================================================
          MAIN GRID
      ===================================================== */}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        {/* ===================================================
            LEFT COLUMN
        =================================================== */}

        <div className="space-y-6">
          {/* ===============================================
              IMPORTED PDF
          =============================================== */}

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">
              Imported report
            </h2>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">
                  PDF
                </div>

                <div className="mt-1 break-words font-medium text-slate-900">
                  {report
                    .source_pdf_name ||
                    "—"}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">
                  File size
                </div>

                <div className="mt-1 font-medium text-slate-900">
                  {formatFileSize(
                    report
                      .source_pdf_size
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">
                  Report type
                </div>

                <div className="mt-1 font-medium text-slate-900">
                  {report
                    .report_type ||
                    "—"}
                </div>
              </div>
            </div>
          </section>

          {/* ===============================================
              STAGE 1
          =============================================== */}

          <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-blue-700">
                  Stage 1
                </div>

                <h2 className="mt-1 text-xl font-bold text-slate-900">
                  Report Structure
                </h2>

                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Reads the original PDF and identifies rooms,
                  subsections, meter pages and the declaration
                  section.
                </p>
              </div>

              <ActionButton
                onClick={
                  analyseStructure
                }
                disabled={
                  analysingStructure ||
                  analysingImages ||
                  auditingCondition ||
                  validatingReport
                }
                colour="blue"
              >
                {analysingStructure
                  ? "Analysing Structure..."
                  : sectionsExtracted
                    ? "Re-analyse Structure"
                    : "Analyse Structure"}
              </ActionButton>
            </div>

            {sectionsExtracted && (
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <SummaryBox
                  label="Sections"
                  value={
                    sections.length
                  }
                />

                <SummaryBox
                  label="Report pages"
                  value={
                    sourceStructure
                      ?.total_pages ??
                    "—"
                  }
                />

                <SummaryBox
                  label="Declaration starts"
                  value={
                    sourceStructure
                      ?.declaration_start_page
                      ? `Page ${sourceStructure.declaration_start_page}`
                      : "—"
                  }
                />
              </div>
            )}
          </section>

          {/* ===============================================
              STAGE 2
          =============================================== */}

          <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-violet-700">
                  Stage 2
                </div>

                <h2 className="mt-1 text-xl font-bold text-slate-900">
                  Photograph Analysis
                </h2>

                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Maps inspection photographs to the correct
                  room and subsection and creates the first-pass
                  Right Inventories captions.
                </p>
              </div>

              <ActionButton
                onClick={
                  analyseImages
                }
                disabled={
                  !sectionsExtracted ||
                  analysingImages ||
                  analysingStructure ||
                  auditingCondition ||
                  validatingReport
                }
                colour="violet"
              >
                {analysingImages
                  ? "Analysing Photographs..."
                  : imagesAnalysed
                    ? "Re-analyse Photographs"
                    : "Analyse Photographs"}
              </ActionButton>
            </div>

            {imagesAnalysed && (
              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                <SummaryBox
                  label="Photos detected"
                  value={
                    detectedPhotos ||
                    photoAnalysis
                      ?.expected_photo_count ||
                    "—"
                  }
                />

                <SummaryBox
                  label="Needs review"
                  value={
                    photoAnalysis
                      ?.review_required_count ??
                    photoAnalysis
                      ?.needs_review_count ??
                    0
                  }
                />

                <SummaryBox
                  label="Visible damage"
                  value={
                    photoAnalysis
                      ?.visible_damage_count ??
                    photoAnalysis
                      ?.damage_count ??
                    0
                  }
                />

                <SummaryBox
                  label="Meter photos"
                  value={
                    photoAnalysis
                      ?.meter_photo_count ??
                    0
                  }
                />
              </div>
            )}
          </section>

          {/* ===============================================
              STAGE 2.5
          =============================================== */}

          <section className="rounded-xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-amber-700">
                  Stage 2.5
                </div>

                <h2 className="mt-1 text-xl font-bold text-slate-900">
                  Condition & Damage Audit
                </h2>

                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Performs a stricter second visual pass for
                  scuffs, marks, chips, wear, cleaning issues,
                  meter uncertainty and photographs that need
                  clerk review.
                </p>

                <p className="mt-2 max-w-3xl text-sm font-medium text-amber-800">
                  Progress is checkpointed after every successful
                  five-page batch.
                </p>
              </div>

              <ActionButton
                onClick={
                  auditCondition
                }
                disabled={
                  !imagesAnalysed ||
                  analysingStructure ||
                  analysingImages ||
                  auditingCondition ||
                  validatingReport ||
                  conditionAudited
                }
                colour="amber"
              >
                {auditingCondition
                  ? "Auditing Condition & Damage..."
                  : conditionAudited
                    ? "Audit Complete"
                    : auditedPhotos > 0
                      ? "Resume Condition & Damage Audit"
                      : "Audit Condition & Damage"}
              </ActionButton>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <SummaryBox
                label="Photos audited"
                value={`${auditedPhotos} / ${
                  totalAuditPhotos ||
                  detectedPhotos ||
                  0
                }`}
              />

              <SummaryBox
                label="Progress"
                value={`${auditProgress}%`}
              />

              <SummaryBox
                label="Visible defects"
                value={
                  conditionAudit
                    ?.visible_defect_count ??
                  0
                }
              />

              <SummaryBox
                label="Cleaning issues"
                value={
                  conditionAudit
                    ?.cleaning_issue_count ??
                  0
                }
              />

              <SummaryBox
                label="Needs review"
                value={
                  conditionAudit
                    ?.review_required_count ??
                  0
                }
              />
            </div>

            {safeNumber(
              conditionAudit
                ?.meter_review_count
            ) > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-white p-4 text-sm text-amber-900">
                Meter photographs requiring review:{" "}
                <strong>
                  {
                    conditionAudit
                      .meter_review_count
                  }
                </strong>
              </div>
            )}
          </section>

          {/* ===============================================
              DEDICATED METER ANALYSIS
          =============================================== */}

          <section className="rounded-xl border border-purple-300 bg-purple-50 p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-purple-700">
                  Dedicated meter pass
                </div>

                <h2 className="mt-1 text-xl font-bold text-slate-900">
                  Meter Reading Validation
                </h2>

                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Dedicated meter analysis handles current readings,
                  units, serial numbers, balance or credit and
                  multi-rate values separately from normal room
                  photographs.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/reports/${reportId}/review`
                  )
                }
                className="rounded-lg bg-purple-600 px-5 py-3 font-semibold text-white hover:bg-purple-700"
              >
                {metersCompleted
                  ? "Review Meters"
                  : "Open Meter Review"}
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <SummaryBox
                label="Meter analysis"
                value={
                  metersCompleted
                    ? "Complete"
                    : "Pending"
                }
              />

              <SummaryBox
                label="Meters found"
                value={
                  meterCount ||
                  0
                }
              />
            </div>
          </section>

          {/* ===============================================
              STAGE 3 — FINAL REPORT QUALITY VALIDATION
          =============================================== */}

          <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-emerald-700">
                  Stage 3
                </div>

                <h2 className="mt-1 text-xl font-bold text-slate-900">
                  Final Report Quality Validation
                </h2>

                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Rechecks every non-meter photograph against the
                  original PDF to confirm the visible item,
                  caption, condition, cleanliness, defects and
                  supporting-image classification.
                </p>

                <p className="mt-2 max-w-3xl text-sm font-medium text-emerald-800">
                  Correct results are kept. Only material mistakes
                  are corrected.
                </p>

                {!metersCompleted && (
                  <p className="mt-3 text-sm font-semibold text-amber-700">
                    Complete the dedicated meter analysis before
                    running final validation.
                  </p>
                )}
              </div>

              <ActionButton
                onClick={
                  validateFullReport
                }
                disabled={
                  !conditionAudited ||
                  !metersCompleted ||
                  analysingStructure ||
                  analysingImages ||
                  auditingCondition ||
                  validatingReport ||
                  validationCompleted
                }
                colour="emerald"
              >
                {validatingReport
                  ? "Validating Full Report..."
                  : validationCompleted
                    ? "Validation Complete"
                    : validatedPhotos > 0
                      ? "Resume Full Report Validation"
                      : "Validate Full Report"}
              </ActionButton>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <SummaryBox
                label="Validated"
                value={`${validatedPhotos} / ${validationTotal}`}
              />

              <SummaryBox
                label="Progress"
                value={`${validationProgress}%`}
              />

              <SummaryBox
                label="Corrections"
                value={
                  validationCorrections
                }
              />

              <SummaryBox
                label="Damage found"
                value={
                  validationDamage
                }
              />

              <SummaryBox
                label="Needs review"
                value={
                  validationReview
                }
              />
            </div>

            {validationCompleted && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-4 text-sm text-emerald-900">
                Final visual validation is complete. The next stage
                is to review any remaining flagged items and then
                generate the report Overview.
              </div>
            )}
          </section>

          {/* ===============================================
              EXTRACTED STRUCTURE
          =============================================== */}

          {rooms.length >
            0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    Rooms & Subsections
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Structure extracted from the imported PDF.
                  </p>
                </div>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                  {
                    sections.length
                  }{" "}
                  sections
                </span>
              </div>

              <div className="mt-6 space-y-4">
                {rooms.map(
                  (
                    room
                  ) => (
                    <div
                      key={
                        room.name
                      }
                      className="rounded-xl border border-slate-200"
                    >
                      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                        <h3 className="font-bold text-slate-900">
                          {
                            room.name
                          }
                        </h3>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {room.sections.map(
                          (
                            section
                          ) => (
                            <div
                              key={
                                section.id
                              }
                              className="flex items-center justify-between gap-4 px-5 py-3"
                            >
                              <span className="text-sm font-medium text-slate-700">
                                {section
                                  .section_name ||
                                  "General"}
                              </span>

                              <span className="text-xs text-slate-400">
                                #
                                {
                                  section
                                    .sort_order
                                }
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            </section>
          )}
        </div>

        {/* ===================================================
            RIGHT SIDEBAR
        =================================================== */}

        <aside className="space-y-6">
          {/* ===============================================
              STATUS
          =============================================== */}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">
              AI Report Progress
            </h2>

            <div className="mt-3">
              <StatusRow
                label="PDF imported"
                complete={Boolean(
                  report
                    .source_pdf_path
                )}
              />

              <StatusRow
                label="Sections extracted"
                complete={
                  sectionsExtracted
                }
              />

              <StatusRow
                label="Images analysed"
                complete={
                  imagesAnalysed
                }
              />

              <StatusRow
                label="Condition audited"
                complete={
                  conditionAudited
                }
              />

              <StatusRow
                label="Meters analysed"
                complete={
                  metersCompleted
                }
              />

              <StatusRow
                label="Report validated"
                complete={
                  validationCompleted
                }
              />

              <StatusRow
                label="Overview prepared"
                complete={
                  overviewPrepared
                }
              />
            </div>
          </section>

          {/* ===============================================
              CONDITION PROGRESS
          =============================================== */}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">
              Condition Audit
            </h2>

            <div className="mt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  Progress
                </span>

                <strong className="text-slate-900">
                  {
                    auditProgress
                  }
                  %
                </strong>
              </div>

              <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        0,
                        auditProgress
                      )
                    )}%`,
                  }}
                />
              </div>

              <div className="mt-3 text-xs text-slate-500">
                {
                  auditedPhotos
                }{" "}
                of{" "}
                {totalAuditPhotos ||
                  detectedPhotos ||
                  0}{" "}
                photographs audited
              </div>
            </div>
          </section>

          {/* ===============================================
              VALIDATION PROGRESS
          =============================================== */}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">
              Final Validation
            </h2>

            <div className="mt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  Progress
                </span>

                <strong className="text-slate-900">
                  {
                    validationProgress
                  }
                  %
                </strong>
              </div>

              <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        0,
                        validationProgress
                      )
                    )}%`,
                  }}
                />
              </div>

              <div className="mt-3 text-xs text-slate-500">
                {
                  validatedPhotos
                }{" "}
                of{" "}
                {
                  validationTotal
                }{" "}
                non-meter photographs validated
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-lg font-bold text-slate-900">
                    {
                      validationCorrections
                    }
                  </div>

                  <div className="text-[10px] uppercase text-slate-500">
                    Corrections
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-lg font-bold text-slate-900">
                    {
                      validationDamage
                    }
                  </div>

                  <div className="text-[10px] uppercase text-slate-500">
                    Damage
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-lg font-bold text-slate-900">
                    {
                      validationReview
                    }
                  </div>

                  <div className="text-[10px] uppercase text-slate-500">
                    Review
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ===============================================
              CURRENT STATUS
          =============================================== */}

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="font-bold text-slate-900">
              Current status
            </h2>

            <p className="mt-2 break-words text-sm text-slate-600">
              {report
                .status ||
                "draft"}
            </p>

            {report
              .updated_at && (
              <p className="mt-3 text-xs text-slate-400">
                Updated:{" "}
                {new Date(
                  report
                    .updated_at
                ).toLocaleString()}
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}