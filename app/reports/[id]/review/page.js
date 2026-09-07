"use client";

import {
  useCallback,
  useEffect,
  useMemo,
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
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return {};
}

function safeText(value) {
  return typeof value === "string"
    ? value
    : "";
}

function safeNumber(value) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function issueInfo(photo) {
  const analysis =
    parseObject(
      photo?.ai_analysis
    );

  const audit =
    parseObject(
      analysis.condition_audit
    );

  const validation =
    parseObject(
      analysis.report_validation
    );

  const meterDetails =
    parseObject(
      analysis.meter_details
    );

  const meterType =
    safeText(
      meterDetails.meter_type ||
      analysis.meter_type
    );

  return {
    analysis,
    audit,
    validation,
    meterDetails,

    page:
      safeNumber(
        analysis.page_number
      ),

    photoIndex:
      safeNumber(
        analysis.photo_index_on_page
      ),

    condition:
      safeText(
        analysis.condition
      ),

    cleanliness:
      safeText(
        analysis.cleanliness
      ),

    damage:
      analysis.damage_visible ===
      true,

    damageDetails:
      safeText(
        analysis.damage_details
      ),

    cleaningIssue:
      audit.cleanliness_issue ===
      true,

    cleaningDetails:
      safeText(
        audit.cleanliness_details
      ),

    confidence:
      safeNumber(
        validation.confidence ??
        meterDetails.confidence ??
        analysis.confidence
      ),

    // --------------------------------------------------------
    // FINAL VALIDATION
    // --------------------------------------------------------

    validationCompleted:
      validation.completed ===
      true,

    validationCorrection:
      validation.action ===
      "correct",

    validationAction:
      safeText(
        validation.action
      ),

    validationReviewRequired:
      validation.review_required ===
      true,

    validationReviewReason:
      safeText(
        validation.review_reason
      ),

    validationDamage:
      validation.damage_visible ===
      true,

    validationDamageDetails:
      safeText(
        validation.damage_details
      ),

    validationReviewed:
      validation.manual_reviewed ===
      true,

    beforeCaption:
      safeText(
        validation.original_caption
      ),

    afterCaption:
      safeText(
        validation.validated_caption
      ),

    beforeCondition:
      safeText(
        validation.original_condition
      ),

    afterCondition:
      safeText(
        validation.validated_condition
      ),

    beforeCleanliness:
      safeText(
        validation.original_cleanliness
      ),

    afterCleanliness:
      safeText(
        validation.validated_cleanliness
      ),

    // --------------------------------------------------------
    // METER
    // --------------------------------------------------------

    meterType,

    meterReading:
      safeText(
        meterDetails.reading ||
        analysis.meter_reading
      ),

    meterUnit:
      safeText(
        meterDetails.unit ||
        analysis.meter_unit
      ),

    meterSerial:
      safeText(
        meterDetails.serial_number ||
        analysis.meter_serial_number
      ),

    meterBalance:
      safeText(
        meterDetails.balance ||
        analysis.meter_balance
      ),

    meterRate1:
      safeText(
        meterDetails.rate_1 ||
        analysis.meter_rate_1
      ),

    meterRate2:
      safeText(
        meterDetails.rate_2 ||
        analysis.meter_rate_2
      ),

    meterReviewReason:
      safeText(
        meterDetails.review_reason
      ),

    meterPrimaryPhotoId:
      safeText(
        meterDetails.primary_photo_record_id
      ),

    meterDedicated:
      meterDetails
        .dedicated_meter_analysis ===
      true,
  };
}

function isPrimaryMeter(photo) {
  const info =
    issueInfo(photo);

  return (
    photo?.ai_label ===
      "meter" ||
    (
      info.meterPrimaryPhotoId &&
      info.meterPrimaryPhotoId ===
        photo?.id
    )
  );
}

// ============================================================
// WHAT SHOULD APPEAR ON FINAL REVIEW
// ============================================================

function isFlagged(photo) {
  const info =
    issueInfo(photo);

  return (
    info.validationCorrection ||
    info.validationDamage ||
    info.validationReviewRequired ||
    info.cleaningIssue ||
    info.damage ||
    photo?.review_required ===
      true ||
    isPrimaryMeter(photo)
  );
}

// ============================================================
// PENDING LOGIC
//
// Stage-3 corrections use validation.manual_reviewed.
// Older meter/cleaning review uses photo.reviewed.
// ============================================================

function isPending(photo) {
  const info =
    issueInfo(photo);

  const hasValidationIssue =
    info.validationCorrection ||
    info.validationDamage ||
    info.validationReviewRequired;

  if (
    hasValidationIssue &&
    !info.validationReviewed
  ) {
    return true;
  }

  const hasOlderIssue =
    info.cleaningIssue ||
    info.damage ||
    photo?.review_required ===
      true ||
    isPrimaryMeter(photo);

  if (
    hasOlderIssue &&
    photo?.reviewed !==
      true
  ) {
    return true;
  }

  return false;
}

// ============================================================
// UI
// ============================================================

function Tag({
  children,
  type = "normal",
}) {
  const styles = {
    normal:
      "bg-slate-100 text-slate-700",

    review:
      "bg-amber-100 text-amber-800",

    cleaning:
      "bg-blue-100 text-blue-800",

    damage:
      "bg-red-100 text-red-800",

    correction:
      "bg-emerald-100 text-emerald-800",

    meter:
      "bg-purple-100 text-purple-800",

    complete:
      "bg-green-100 text-green-800",
  };

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        styles[type] ||
        styles.normal
      }`}
    >
      {children}
    </span>
  );
}

function CountBox({
  label,
  value,
}) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-2 text-2xl font-bold text-slate-900">
        {value}
      </div>
    </div>
  );
}

function BeforeAfter({
  label,
  before,
  after,
}) {
  const changed =
    safeText(before) !==
    safeText(after);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-red-50 p-3">
          <div className="text-xs font-bold uppercase text-red-700">
            Before
          </div>

          <div className="mt-2 whitespace-pre-line text-sm text-slate-800">
            {before ||
              "—"}
          </div>
        </div>

        <div
          className={`rounded-lg p-3 ${
            changed
              ? "bg-emerald-50"
              : "bg-slate-50"
          }`}
        >
          <div
            className={`text-xs font-bold uppercase ${
              changed
                ? "text-emerald-700"
                : "text-slate-600"
            }`}
          >
            AI validated
          </div>

          <div className="mt-2 whitespace-pre-line text-sm text-slate-800">
            {after ||
              "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PAGE
// ============================================================

export default function FinalReviewPage() {
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
    photos,
    setPhotos,
  ] =
    useState([]);

  const [
    sections,
    setSections,
  ] =
    useState({});

  const [
    pdfUrl,
    setPdfUrl,
  ] =
    useState("");

  const [
    selectedId,
    setSelectedId,
  ] =
    useState("");

  const [
    filter,
    setFilter,
  ] =
    useState("pending");

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    message,
    setMessage,
  ] =
    useState("");

  // ==========================================================
  // EDITABLE FINAL VALUES
  // ==========================================================

  const [
    caption,
    setCaption,
  ] =
    useState("");

  const [
    condition,
    setCondition,
  ] =
    useState("");

  const [
    cleanliness,
    setCleanliness,
  ] =
    useState("");

  const [
    includeInReport,
    setIncludeInReport,
  ] =
    useState(true);

  const [
    meterReading,
    setMeterReading,
  ] =
    useState("");

  const [
    meterUnit,
    setMeterUnit,
  ] =
    useState("");

  const [
    meterSerial,
    setMeterSerial,
  ] =
    useState("");

  const [
    meterBalance,
    setMeterBalance,
  ] =
    useState("");

  const [
    meterRate1,
    setMeterRate1,
  ] =
    useState("");

  const [
    meterRate2,
    setMeterRate2,
  ] =
    useState("");

  // ==========================================================
  // LOAD DATA
  // ==========================================================

  const loadData =
    useCallback(
      async () => {
        if (!reportId) {
          return;
        }

        try {
          setError("");

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
                overview,
                source_pdf_path,
                source_pdf_name,
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

          setReport(
            reportData
          );

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
                room_name,
                section_name,
                sort_order
                `
              )
              .eq(
                "report_id",
                reportId
              );

          if (
            sectionError
          ) {
            throw sectionError;
          }

          const sectionMap =
            {};

          for (
            const section of
            sectionData ||
            []
          ) {
            sectionMap[
              section.id
            ] =
              section;
          }

          setSections(
            sectionMap
          );

          // --------------------------------------------------
          // PHOTOS
          // --------------------------------------------------

          const {
            data:
              photoData,
            error:
              photoError,
          } =
            await supabase
              .from(
                "ai_report_photos"
              )
              .select(
                `
                id,
                section_id,
                sort_order,
                ai_comment,
                ai_label,
                ai_analysis,
                review_required,
                include_in_report,
                reviewed,
                reviewed_at,
                manual_comment
                `
              )
              .eq(
                "report_id",
                reportId
              )
              .like(
                "storage_path",
                "pdf:%"
              )
              .order(
                "sort_order",
                {
                  ascending:
                    true,
                }
              );

          if (
            photoError
          ) {
            throw photoError;
          }

          const flagged =
            (
              photoData ||
              []
            ).filter(
              isFlagged
            );

          setPhotos(
            flagged
          );

          // --------------------------------------------------
          // PRIVATE PDF
          // --------------------------------------------------

          if (
            reportData
              ?.source_pdf_path
          ) {
            const {
              data:
                signedData,
              error:
                signedError,
            } =
              await supabase
                .storage
                .from(
                  "inventory-report-files"
                )
                .createSignedUrl(
                  reportData
                    .source_pdf_path,
                  60 * 60
                );

            if (
              !signedError &&
              signedData
                ?.signedUrl
            ) {
              setPdfUrl(
                signedData
                  .signedUrl
              );
            }
          }

          // --------------------------------------------------
          // SELECT FIRST PENDING
          // --------------------------------------------------

          setSelectedId(
            (
              current
            ) => {
              if (
                current &&
                flagged.some(
                  (
                    photo
                  ) =>
                    photo.id ===
                    current
                )
              ) {
                return current;
              }

              const next =
                flagged.find(
                  isPending
                );

              return (
                next?.id ||
                flagged[0]?.id ||
                ""
              );
            }
          );
        } catch (
          loadError
        ) {
          console.error(
            "Final review load error:",
            loadError
          );

          setError(
            loadError?.message ||
              "Could not load final review."
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
    loadData();
  }, [
    loadData,
  ]);

  // ==========================================================
  // FILTER COUNTS
  // ==========================================================

  const pendingCount =
    photos.filter(
      isPending
    ).length;

  const correctionCount =
    photos.filter(
      (
        photo
      ) =>
        issueInfo(
          photo
        )
          .validationCorrection
    ).length;

  const validationDamageCount =
    photos.filter(
      (
        photo
      ) =>
        issueInfo(
          photo
        )
          .validationDamage
    ).length;

  const cleaningCount =
    photos.filter(
      (
        photo
      ) =>
        issueInfo(
          photo
        ).cleaningIssue
    ).length;

  const meterCount =
    photos.filter(
      isPrimaryMeter
    ).length;

  const reviewRequiredCount =
    photos.filter(
      (
        photo
      ) => {
        const info =
          issueInfo(
            photo
          );

        return (
          photo
            .review_required ===
            true ||
          info
            .validationReviewRequired
        );
      }
    ).length;

  // ==========================================================
  // FILTER
  // ==========================================================

  const filteredPhotos =
    useMemo(
      () =>
        photos.filter(
          (
            photo
          ) => {
            const info =
              issueInfo(
                photo
              );

            if (
              filter ===
              "all"
            ) {
              return true;
            }

            if (
              filter ===
              "pending"
            ) {
              return isPending(
                photo
              );
            }

            if (
              filter ===
              "corrections"
            ) {
              return (
                info
                  .validationCorrection
              );
            }

            if (
              filter ===
              "damage"
            ) {
              return (
                info
                  .validationDamage ||
                info.damage
              );
            }

            if (
              filter ===
              "cleaning"
            ) {
              return (
                info
                  .cleaningIssue
              );
            }

            if (
              filter ===
              "meters"
            ) {
              return isPrimaryMeter(
                photo
              );
            }

            if (
              filter ===
              "review"
            ) {
              return (
                photo
                  .review_required ===
                  true ||
                info
                  .validationReviewRequired
              );
            }

            return true;
          }
        ),
      [
        photos,
        filter,
      ]
    );

  // ==========================================================
  // SELECTION
  // ==========================================================

  const selectedPhoto =
    photos.find(
      (
        photo
      ) =>
        photo.id ===
        selectedId
    ) ||
    filteredPhotos[0] ||
    null;

  const selectedInfo =
    selectedPhoto
      ? issueInfo(
          selectedPhoto
        )
      : null;

  const selectedSection =
    selectedPhoto
      ? sections[
          selectedPhoto
            .section_id
        ] ||
        null
      : null;

  const selectedIsMeter =
    selectedPhoto
      ? isPrimaryMeter(
          selectedPhoto
        )
      : false;

  useEffect(() => {
    if (
      !selectedPhoto
    ) {
      return;
    }

    const info =
      issueInfo(
        selectedPhoto
      );

    setCaption(
      selectedPhoto
        .manual_comment ||
        selectedPhoto
          .ai_comment ||
        ""
    );

    setCondition(
      info.condition
    );

    setCleanliness(
      info.cleanliness
    );

    setIncludeInReport(
      selectedPhoto
        .include_in_report !==
        false
    );

    setMeterReading(
      info.meterReading
    );

    setMeterUnit(
      info.meterUnit
    );

    setMeterSerial(
      info.meterSerial
    );

    setMeterBalance(
      info.meterBalance
    );

    setMeterRate1(
      info.meterRate1
    );

    setMeterRate2(
      info.meterRate2
    );

    setError("");
    setMessage("");
  }, [
    selectedPhoto,
  ]);

  useEffect(() => {
    if (
      filteredPhotos.length ===
      0
    ) {
      return;
    }

    const visible =
      filteredPhotos.some(
        (
          photo
        ) =>
          photo.id ===
          selectedId
      );

    if (!visible) {
      setSelectedId(
        filteredPhotos[0]
          .id
      );
    }
  }, [
    filteredPhotos,
    selectedId,
  ]);

  // ==========================================================
  // UPDATE REPORT LEVEL METER
  // ==========================================================

  async function updateMeterOverview(
    meterInfo
  ) {
    if (
      !selectedPhoto ||
      !selectedIsMeter
    ) {
      return;
    }

    const overview =
      parseObject(
        report?.overview
      );

    const meters =
      Array.isArray(
        overview.meters
      )
        ? [
            ...overview.meters,
          ]
        : [];

    const meterType =
      meterInfo.meter_type;

    const index =
      meters.findIndex(
        (
          meter
        ) =>
          meter
            ?.primary_photo_record_id ===
            selectedPhoto.id ||
          (
            meterType &&
            meter
              ?.meter_type ===
              meterType
          )
      );

    if (
      index >= 0
    ) {
      meters[
        index
      ] = {
        ...meters[
          index
        ],
        ...meterInfo,
      };
    } else {
      meters.push(
        meterInfo
      );
    }

    const newOverview = {
      ...overview,
      meters,
    };

    const {
      error:
        updateError,
    } =
      await supabase
        .from(
          "ai_reports"
        )
        .update({
          overview:
            newOverview,

          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          reportId
        );

    if (
      updateError
    ) {
      throw updateError;
    }

    setReport(
      (
        current
      ) => ({
        ...current,
        overview:
          newOverview,
      })
    );
  }

  // ==========================================================
  // SAVE / APPROVE
  // ==========================================================

  async function saveSelected({
    approve = false,
  } = {}) {
    if (
      !selectedPhoto ||
      saving
    ) {
      return;
    }

    try {
      setSaving(
        true
      );

      setError("");
      setMessage("");

      const oldAnalysis =
        parseObject(
          selectedPhoto
            .ai_analysis
        );

      const oldAudit =
        parseObject(
          oldAnalysis
            .condition_audit
        );

      const oldValidation =
        parseObject(
          oldAnalysis
            .report_validation
        );

      const oldMeter =
        parseObject(
          oldAnalysis
            .meter_details
        );

      const now =
        new Date()
          .toISOString();

      const cleanedBalance =
        meterBalance
          .trim()
          .replace(
            /^£/,
            ""
          );

      // ------------------------------------------------------
      // CONDITION AUDIT MANUAL VALUES
      // ------------------------------------------------------

      const newAudit = {
        ...oldAudit,

        manual_caption:
          caption.trim(),

        manual_condition:
          condition.trim(),

        manual_cleanliness:
          cleanliness.trim(),

        manual_reviewed:
          approve
            ? true
            : oldAudit
                .manual_reviewed,

        manual_reviewed_at:
          approve
            ? now
            : oldAudit
                .manual_reviewed_at,
      };

      // ------------------------------------------------------
      // STAGE-3 VALIDATION MANUAL APPROVAL
      // ------------------------------------------------------

      const newValidation = {
        ...oldValidation,

        manual_caption:
          caption.trim(),

        manual_condition:
          condition.trim(),

        manual_cleanliness:
          cleanliness.trim(),

        validated_caption:
          caption.trim(),

        validated_condition:
          condition.trim(),

        validated_cleanliness:
          cleanliness.trim(),

        manual_reviewed:
          approve
            ? true
            : oldValidation
                .manual_reviewed,

        manual_reviewed_at:
          approve
            ? now
            : oldValidation
                .manual_reviewed_at,
      };

      // ------------------------------------------------------
      // NEW AI ANALYSIS
      // ------------------------------------------------------

      const newAnalysis = {
        ...oldAnalysis,

        condition:
          condition.trim(),

        cleanliness:
          cleanliness.trim(),

        condition_audit:
          newAudit,

        report_validation:
          newValidation,
      };

      // ------------------------------------------------------
      // METER
      // ------------------------------------------------------

      if (
        selectedIsMeter
      ) {
        const newMeter = {
          ...oldMeter,

          meter_type:
            selectedInfo
              ?.meterType ||
            oldMeter
              .meter_type ||
            "",

          reading:
            meterReading.trim(),

          unit:
            meterUnit.trim(),

          serial_number:
            meterSerial.trim(),

          balance:
            cleanedBalance,

          rate_1:
            meterRate1.trim(),

          rate_2:
            meterRate2.trim(),

          review_required:
            approve
              ? false
              : selectedPhoto
                  .review_required,

          manually_reviewed:
            approve,

          manually_reviewed_at:
            approve
              ? now
              : oldMeter
                  .manually_reviewed_at,

          primary_photo_record_id:
            selectedPhoto.id,
        };

        newAnalysis.meter_type =
          newMeter
            .meter_type;

        newAnalysis.meter_reading =
          newMeter
            .reading;

        newAnalysis.meter_unit =
          newMeter
            .unit;

        newAnalysis.meter_serial_number =
          newMeter
            .serial_number;

        newAnalysis.meter_balance =
          newMeter
            .balance;

        newAnalysis.meter_rate_1 =
          newMeter
            .rate_1;

        newAnalysis.meter_rate_2 =
          newMeter
            .rate_2;

        newAnalysis.meter_details =
          newMeter;

        await updateMeterOverview({
          meter_type:
            newMeter
              .meter_type,

          reading:
            newMeter
              .reading,

          unit:
            newMeter
              .unit,

          serial_number:
            newMeter
              .serial_number,

          balance:
            newMeter
              .balance,

          rate_1:
            newMeter
              .rate_1,

          rate_2:
            newMeter
              .rate_2,

          primary_photo_record_id:
            selectedPhoto.id,

          review_required:
            approve
              ? false
              : selectedPhoto
                  .review_required,

          manually_reviewed:
            approve,

          manually_reviewed_at:
            approve
              ? now
              : null,
        });
      }

      // ------------------------------------------------------
      // SAVE PHOTO
      // ------------------------------------------------------

      const {
        error:
          saveError,
      } =
        await supabase
          .from(
            "ai_report_photos"
          )
          .update({
            ai_comment:
              caption.trim(),

            manual_comment:
              caption.trim(),

            ai_analysis:
              newAnalysis,

            include_in_report:
              includeInReport,

            reviewed:
              approve
                ? true
                : selectedPhoto
                    .reviewed,

            reviewed_at:
              approve
                ? now
                : selectedPhoto
                    .reviewed_at,

            review_required:
              approve
                ? false
                : selectedPhoto
                    .review_required,
          })
          .eq(
            "id",
            selectedPhoto.id
          )
          .eq(
            "report_id",
            reportId
          );

      if (
        saveError
      ) {
        throw saveError;
      }

      // ------------------------------------------------------
      // LOCAL UPDATE
      // ------------------------------------------------------

      const updated =
        photos.map(
          (
            photo
          ) => {
            if (
              photo.id !==
              selectedPhoto.id
            ) {
              return photo;
            }

            return {
              ...photo,

              ai_comment:
                caption.trim(),

              manual_comment:
                caption.trim(),

              ai_analysis:
                newAnalysis,

              include_in_report:
                includeInReport,

              reviewed:
                approve
                  ? true
                  : photo.reviewed,

              reviewed_at:
                approve
                  ? now
                  : photo.reviewed_at,

              review_required:
                approve
                  ? false
                  : photo
                      .review_required,
            };
          }
        );

      setPhotos(
        updated
      );

      setMessage(
        approve
          ? "Approved and saved ✓"
          : "Changes saved ✓"
      );

      // ------------------------------------------------------
      // NEXT PENDING
      // ------------------------------------------------------

      if (approve) {
        const currentIndex =
          updated.findIndex(
            (
              photo
            ) =>
              photo.id ===
              selectedPhoto.id
          );

        const after =
          updated
            .slice(
              currentIndex +
                1
            )
            .find(
              isPending
            );

        const first =
          updated.find(
            isPending
          );

        const next =
          after ||
          first;

        if (next) {
          setSelectedId(
            next.id
          );
        }
      }
    } catch (
      saveError
    ) {
      console.error(
        "Final review save error:",
        saveError
      );

      setError(
        saveError?.message ||
          "Could not save final review."
      );
    } finally {
      setSaving(
        false
      );
    }
  }

  // ==========================================================
  // SOURCE PDF
  // ==========================================================

  const currentPage =
    selectedInfo
      ?.page ||
    1;

  const pdfPageUrl =
    pdfUrl
      ? `${pdfUrl}#page=${currentPage}`
      : "";

  // ==========================================================
  // LOADING
  // ==========================================================

  if (
    loading
  ) {
    return (
      <div className="p-8">
        Loading final review...
      </div>
    );
  }

  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <div className="mx-auto max-w-[1750px] space-y-5">
      {/* =====================================================
          HEADER
      ===================================================== */}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-violet-600">
              AI Inventory
            </div>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Final Review
            </h1>

            <p className="mt-1 text-slate-600">
              {report
                ?.property_address ||
                report
                  ?.source_pdf_name ||
                "Inventory report"}
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

      {/* =====================================================
          COUNTS
      ===================================================== */}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <CountBox
          label="Pending"
          value={
            pendingCount
          }
        />

        <CountBox
          label="Corrections"
          value={
            correctionCount
          }
        />

        <CountBox
          label="Damage"
          value={
            validationDamageCount
          }
        />

        <CountBox
          label="Cleaning"
          value={
            cleaningCount
          }
        />

        <CountBox
          label="Meters"
          value={
            meterCount
          }
        />

        <CountBox
          label="Needs review"
          value={
            reviewRequiredCount
          }
        />
      </div>

      {/* =====================================================
          FILTERS
      ===================================================== */}

      <div className="flex flex-wrap gap-2">
        {[
          [
            "pending",
            `Pending (${pendingCount})`,
          ],

          [
            "corrections",
            `Validation Corrections (${correctionCount})`,
          ],

          [
            "damage",
            `Damage (${validationDamageCount})`,
          ],

          [
            "cleaning",
            `Cleaning (${cleaningCount})`,
          ],

          [
            "meters",
            `Meters (${meterCount})`,
          ],

          [
            "review",
            `Needs Review (${reviewRequiredCount})`,
          ],

          [
            "all",
            `All (${photos.length})`,
          ],
        ].map(
          ([
            value,
            label,
          ]) => (
            <button
              key={
                value
              }
              type="button"
              onClick={() =>
                setFilter(
                  value
                )
              }
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                filter ===
                value
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 bg-white text-slate-700"
              }`}
            >
              {label}
            </button>
          )
        )}
      </div>

      {/* =====================================================
          ALERTS
      ===================================================== */}

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-medium text-emerald-800">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 font-medium text-red-700">
          {error}
        </div>
      )}

      {/* =====================================================
          FINISHED
      ===================================================== */}

      {pendingCount ===
        0 && (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-6">
          <h2 className="text-xl font-bold text-emerald-900">
            Final review complete ✓
          </h2>

          <p className="mt-2 text-emerald-800">
            All AI corrections, damage findings, cleaning issues
            and required meter checks have been reviewed.
          </p>

          <p className="mt-1 font-semibold text-emerald-900">
            The report is ready for Overview generation.
          </p>
        </section>
      )}

      {/* =====================================================
          REVIEW GRID
      ===================================================== */}

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(450px,1fr)_540px]">
        {/* ===================================================
            LEFT
        =================================================== */}

        <div className="max-h-[850px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          {filteredPhotos.length ===
          0 ? (
            <div className="p-6 text-slate-500">
              No items in this filter.
            </div>
          ) : (
            filteredPhotos.map(
              (
                photo
              ) => {
                const info =
                  issueInfo(
                    photo
                  );

                const section =
                  sections[
                    photo
                      .section_id
                  ];

                const active =
                  selectedPhoto
                    ?.id ===
                  photo.id;

                const pending =
                  isPending(
                    photo
                  );

                return (
                  <button
                    key={
                      photo.id
                    }
                    type="button"
                    onClick={() =>
                      setSelectedId(
                        photo.id
                      )
                    }
                    className={`block w-full border-b border-slate-100 p-4 text-left ${
                      active
                        ? "bg-violet-50"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-bold text-slate-900">
                          {section
                            ?.room_name ||
                            "Report"}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          {section
                            ?.section_name ||
                            "General"}
                        </div>
                      </div>

                      {!pending && (
                        <Tag type="complete">
                          Reviewed
                        </Tag>
                      )}
                    </div>

                    <div className="mt-2 text-xs text-slate-500">
                      Page{" "}
                      {
                        info.page
                      }{" "}
                      · Photo{" "}
                      {
                        info.photoIndex
                      }
                    </div>

                    <div className="mt-2 text-sm text-slate-700">
                      {photo
                        .ai_comment ||
                        "No caption"}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1">
                      {info
                        .validationCorrection && (
                        <Tag type="correction">
                          Corrected
                        </Tag>
                      )}

                      {info
                        .validationDamage && (
                        <Tag type="damage">
                          Damage
                        </Tag>
                      )}

                      {info
                        .cleaningIssue && (
                        <Tag type="cleaning">
                          Cleaning
                        </Tag>
                      )}

                      {isPrimaryMeter(
                        photo
                      ) && (
                        <Tag type="meter">
                          {info
                            .meterType ||
                            "Meter"}
                        </Tag>
                      )}

                      {(
                        photo
                          .review_required ||
                        info
                          .validationReviewRequired
                      ) && (
                        <Tag type="review">
                          Review
                        </Tag>
                      )}
                    </div>
                  </button>
                );
              }
            )
          )}
        </div>

        {/* ===================================================
            PDF
        =================================================== */}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <div>
              <div className="font-bold">
                Source PDF
              </div>

              <div className="text-xs text-slate-500">
                Page{" "}
                {
                  currentPage
                }
              </div>
            </div>

            {pdfPageUrl && (
              <a
                href={
                  pdfPageUrl
                }
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
              >
                Open Page
              </a>
            )}
          </div>

          {pdfPageUrl ? (
            <iframe
              key={
                currentPage
              }
              src={
                pdfPageUrl
              }
              title="Inventory source PDF"
              className="h-[790px] w-full"
            />
          ) : (
            <div className="p-8 text-slate-500">
              PDF preview unavailable.
            </div>
          )}
        </div>

        {/* ===================================================
            RIGHT
        =================================================== */}

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {!selectedPhoto ||
          !selectedInfo ? (
            <div className="text-slate-500">
              Select an item.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {selectedSection
                      ?.room_name ||
                      "Report"}
                  </h2>

                  <p className="text-sm text-slate-500">
                    {selectedSection
                      ?.section_name ||
                      "General"}
                  </p>

                  <p className="mt-1 text-xs text-slate-400">
                    Page{" "}
                    {
                      selectedInfo.page
                    }{" "}
                    · Photo{" "}
                    {
                      selectedInfo.photoIndex
                    }
                  </p>
                </div>

                {isPending(
                  selectedPhoto
                ) ? (
                  <Tag type="review">
                    Pending
                  </Tag>
                ) : (
                  <Tag type="complete">
                    Reviewed
                  </Tag>
                )}
              </div>

              {/* =============================================
                  STAGE 3 BEFORE / AFTER
              ============================================= */}

              {selectedInfo
                .validationCorrection && (
                <div className="mt-5 space-y-3">
                  <div className="text-sm font-bold uppercase tracking-wide text-emerald-700">
                    Stage 3 correction
                  </div>

                  <BeforeAfter
                    label="Caption"
                    before={
                      selectedInfo
                        .beforeCaption
                    }
                    after={
                      selectedInfo
                        .afterCaption
                    }
                  />

                  <BeforeAfter
                    label="Condition"
                    before={
                      selectedInfo
                        .beforeCondition
                    }
                    after={
                      selectedInfo
                        .afterCondition
                    }
                  />

                  <BeforeAfter
                    label="Cleanliness"
                    before={
                      selectedInfo
                        .beforeCleanliness
                    }
                    after={
                      selectedInfo
                        .afterCleanliness
                    }
                  />
                </div>
              )}

              {/* =============================================
                  FLAGS
              ============================================= */}

              <div className="mt-5 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
                <div>
                  <strong>
                    Confidence:
                  </strong>{" "}
                  {
                    selectedInfo.confidence
                  }
                  %
                </div>

                {selectedInfo
                  .validationDamage && (
                  <div className="text-red-700">
                    <strong>
                      Validation damage:
                    </strong>{" "}
                    {selectedInfo
                      .validationDamageDetails ||
                      "Visible defect detected"}
                  </div>
                )}

                {selectedInfo
                  .cleaningIssue && (
                  <div className="text-blue-700">
                    <strong>
                      Cleaning:
                    </strong>{" "}
                    {selectedInfo
                      .cleaningDetails ||
                      "Cleaning issue detected"}
                  </div>
                )}

                {selectedInfo
                  .validationReviewReason && (
                  <div className="text-amber-700">
                    <strong>
                      Review reason:
                    </strong>{" "}
                    {
                      selectedInfo
                        .validationReviewReason
                    }
                  </div>
                )}

                {selectedInfo
                  .meterReviewReason && (
                  <div className="text-purple-700">
                    <strong>
                      Meter review:
                    </strong>{" "}
                    {
                      selectedInfo
                        .meterReviewReason
                    }
                  </div>
                )}
              </div>

              {/* =============================================
                  FINAL VALUES
              ============================================= */}

              <label className="mt-5 block">
                <span className="text-sm font-semibold">
                  Final caption
                </span>

                <textarea
                  value={
                    caption
                  }
                  onChange={(
                    event
                  ) =>
                    setCaption(
                      event
                        .target
                        .value
                    )
                  }
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-slate-300 p-3"
                />
              </label>

              <label className="mt-4 block">
                <span className="text-sm font-semibold">
                  Final condition
                </span>

                <input
                  value={
                    condition
                  }
                  onChange={(
                    event
                  ) =>
                    setCondition(
                      event
                        .target
                        .value
                    )
                  }
                  className="mt-2 w-full rounded-lg border border-slate-300 p-3"
                />
              </label>

              <label className="mt-4 block">
                <span className="text-sm font-semibold">
                  Final cleanliness
                </span>

                <input
                  value={
                    cleanliness
                  }
                  onChange={(
                    event
                  ) =>
                    setCleanliness(
                      event
                        .target
                        .value
                    )
                  }
                  className="mt-2 w-full rounded-lg border border-slate-300 p-3"
                />
              </label>

              {/* =============================================
                  METER
              ============================================= */}

              {selectedIsMeter && (
                <div className="mt-5 rounded-xl border border-purple-200 bg-purple-50 p-4">
                  <h3 className="font-bold text-purple-900">
                    {selectedInfo
                      .meterType ||
                      "Meter"}{" "}
                    meter
                  </h3>

                  <label className="mt-3 block">
                    <span className="text-sm font-semibold">
                      Reading
                    </span>

                    <input
                      value={
                        meterReading
                      }
                      onChange={(
                        event
                      ) =>
                        setMeterReading(
                          event
                            .target
                            .value
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-purple-200 bg-white p-3"
                    />
                  </label>

                  <label className="mt-3 block">
                    <span className="text-sm font-semibold">
                      Unit
                    </span>

                    <input
                      value={
                        meterUnit
                      }
                      onChange={(
                        event
                      ) =>
                        setMeterUnit(
                          event
                            .target
                            .value
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-purple-200 bg-white p-3"
                    />
                  </label>

                  <label className="mt-3 block">
                    <span className="text-sm font-semibold">
                      Serial number
                    </span>

                    <input
                      value={
                        meterSerial
                      }
                      onChange={(
                        event
                      ) =>
                        setMeterSerial(
                          event
                            .target
                            .value
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-purple-200 bg-white p-3"
                    />
                  </label>

                  <label className="mt-3 block">
                    <span className="text-sm font-semibold">
                      Balance / credit
                    </span>

                    <div className="mt-2 flex rounded-lg border border-purple-200 bg-white">
                      <span className="border-r border-purple-200 px-3 py-3">
                        £
                      </span>

                      <input
                        value={
                          meterBalance
                        }
                        onChange={(
                          event
                        ) =>
                          setMeterBalance(
                            event
                              .target
                              .value
                              .replace(
                                /^£/,
                                ""
                              )
                          )
                        }
                        className="w-full p-3 outline-none"
                      />
                    </div>
                  </label>

                  <label className="mt-3 block">
                    <span className="text-sm font-semibold">
                      Rate 1
                    </span>

                    <input
                      value={
                        meterRate1
                      }
                      onChange={(
                        event
                      ) =>
                        setMeterRate1(
                          event
                            .target
                            .value
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-purple-200 bg-white p-3"
                    />
                  </label>

                  <label className="mt-3 block">
                    <span className="text-sm font-semibold">
                      Rate 2
                    </span>

                    <input
                      value={
                        meterRate2
                      }
                      onChange={(
                        event
                      ) =>
                        setMeterRate2(
                          event
                            .target
                            .value
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-purple-200 bg-white p-3"
                    />
                  </label>
                </div>
              )}

              {/* =============================================
                  INCLUDE
              ============================================= */}

              <label className="mt-5 flex items-center gap-3 rounded-lg border border-slate-200 p-4">
                <input
                  type="checkbox"
                  checked={
                    includeInReport
                  }
                  onChange={(
                    event
                  ) =>
                    setIncludeInReport(
                      event
                        .target
                        .checked
                    )
                  }
                />

                <span className="font-semibold">
                  Include photograph in final report
                </span>
              </label>

              {/* =============================================
                  ACTIONS
              ============================================= */}

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={
                    saving
                  }
                  onClick={() =>
                    saveSelected({
                      approve:
                        false,
                    })
                  }
                  className="rounded-lg border border-slate-300 px-4 py-3 font-semibold disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : "Save Changes"}
                </button>

                <button
                  type="button"
                  disabled={
                    saving
                  }
                  onClick={() =>
                    saveSelected({
                      approve:
                        true,
                    })
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : "Approve & Next"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}