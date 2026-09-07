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

function text(value) {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}

function numberValue(
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

function objectValue(value) {
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

function textArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) =>
      text(item)
    )
    .filter(Boolean);
}

function uniqueLines(lines) {
  const seen =
    new Set();

  const output =
    [];

  for (
    const value of
    lines
  ) {
    const cleaned =
      text(value);

    if (!cleaned) {
      continue;
    }

    const key =
      cleaned
        .toLowerCase();

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    output.push(cleaned);
  }

  return output;
}

function isGeneral(section) {
  return text(
    section?.section_name
  )
    .toLowerCase()
    .startsWith(
      "general"
    );
}

function isMeterRoom(
  roomName
) {
  return text(roomName)
    .toLowerCase()
    .includes(
      "meter reading"
    );
}

function isMeterSection(
  section
) {
  const value =
    `${text(
      section?.room_name
    )} ${text(
      section?.section_name
    )}`
      .toLowerCase();

  return (
    value.includes(
      "meter reading"
    ) ||
    value.includes(
      "electricity"
    ) ||
    value.includes(
      "gas meter"
    ) ||
    value.includes(
      "water meter"
    )
  );
}

function getAnalysis(photo) {
  return objectValue(
    photo?.ai_analysis
  );
}

function getV2(photo) {
  return objectValue(
    getAnalysis(
      photo
    ).inventory_v2
  );
}

function getExtraction(
  photo
) {
  return objectValue(
    getAnalysis(
      photo
    ).image_extraction
  );
}

function formatDate(
  value
) {
  if (!value) {
    return "";
  }

  if (
    /^\d{2}\/\d{2}\/\d{4}$/.test(
      value
    )
  ) {
    return value;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date
    .toLocaleDateString(
      "en-GB"
    );
}

function overviewValue(
  value
) {
  return text(value) ||
    "N/A";
}

// ============================================================
// BUILD FINAL PHOTO WORDING
// ============================================================

function buildPhotoLines(
  photo,
  section
) {
  const v2 =
    getV2(photo);

  if (
    isGeneral(section)
  ) {
    return [
      "General view",
    ];
  }

  let lines = [];

  const captionType =
    text(
      v2.caption_type
    );

  if (
    captionType ===
    "additional_image"
  ) {
    return [
      "Additional image",
    ];
  }

  if (
    captionType ===
    "as_above"
  ) {
    return [
      "As above",
    ];
  }

  lines.push(
    ...textArray(
      v2.description_lines
    )
  );

  const model =
    text(
      v2.model_number ||
      v2.model
    );

  if (
    model &&
    !lines.some(
      (line) =>
        line
          .toLowerCase()
          .includes(
            model
              .toLowerCase()
          )
    )
  ) {
    const brand =
      text(
        v2.brand
      );

    lines.push(
      brand
        ? `${brand} ${model}`
        : model
    );
  }

  for (
    const count of
    textArray(
      v2.count_details
    )
  ) {
    if (
      !lines.some(
        (line) =>
          line
            .toLowerCase()
            .includes(
              count
                .toLowerCase()
            )
      )
    ) {
      lines.push(
        count
      );
    }
  }

  lines.push(
    ...textArray(
      v2.condition_lines
    )
  );

  lines.push(
    ...textArray(
      v2.cleanliness_lines
    )
  );

  lines.push(
    ...textArray(
      v2.damage_lines
    )
  );

  return uniqueLines(
    lines
  );
}

// ============================================================
// UI COMPONENTS
// ============================================================

function ReportHeader({
  report,
  reportDate,
}) {
  return (
    <div className="ri-page-header">
      <span>
        {text(
          report
            ?.property_address
        )}
        {report
          ?.property_postcode
          ? `, ${report.property_postcode}`
          : ""}
        {" - "}
        {text(
          report
            ?.report_type
        ) ||
          "Inventory and Check-in"}
        {reportDate
          ? ` - ${reportDate}`
          : ""}
      </span>

      <span className="ri-brand-small">
        right inventories
      </span>
    </div>
  );
}

function ReportFooter({
  pageLabel,
}) {
  return (
    <div className="ri-page-footer">
      <span>
        right inventories
      </span>

      <span>
        {pageLabel}
      </span>
    </div>
  );
}

function SourcePage({
  pdfUrl,
  page,
}) {
  if (!pdfUrl) {
    return null;
  }

  return (
    <div className="ri-source-wrapper">
      <iframe
        title={`Original report page ${page}`}
        src={`${pdfUrl}#page=${page}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
        className="ri-source-frame"
      />
    </div>
  );
}

function PhotoCard({
  photo,
  section,
  imageUrl,
  customLines,
}) {
  const lines =
    customLines ||
    buildPhotoLines(
      photo,
      section
    );

  return (
    <div className="ri-photo-card">
      <div className="ri-image-wrap">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="ri-photo-image"
          />
        ) : (
          <div className="ri-photo-missing">
            Photograph unavailable
          </div>
        )}
      </div>

      <div className="ri-photo-text">
        {lines.length >
        0 ? (
          lines.map(
            (
              line,
              index
            ) => (
              <div
                key={`${photo.id}-${index}`}
                className={
                  index === 0
                    ? "ri-first-line"
                    : ""
                }
              >
                {line}
              </div>
            )
          )
        ) : (
          <div>
            Additional image
          </div>
        )}
      </div>
    </div>
  );
}

function MeterBlock({
  meter,
  photos,
  section,
  imageUrlFor,
}) {
  const lines = [];

  if (
    meter?.meter_type
  ) {
    lines.push(
      `${meter.meter_type} meter`
    );
  }

  if (
    meter?.rate_1 ||
    meter?.rate_2
  ) {
    if (
      meter.rate_1
    ) {
      lines.push(
        `Reading rate 1. ${meter.rate_1}${
          meter.unit
            ? ` ${meter.unit}`
            : ""
        }`
      );
    }

    if (
      meter.rate_2
    ) {
      lines.push(
        `Reading rate 2. ${meter.rate_2}${
          meter.unit
            ? ` ${meter.unit}`
            : ""
        }`
      );
    }
  } else if (
    meter?.reading
  ) {
    lines.push(
      `Reading. ${meter.reading}${
        meter.unit
          ? ` ${meter.unit}`
          : ""
      }`
    );
  }

  if (
    meter
      ?.serial_number
  ) {
    lines.push(
      `SN. ${meter.serial_number}`
    );
  }

  if (
    meter?.balance
  ) {
    lines.push(
      `Balance £${String(
        meter.balance
      ).replace(
        /^£/,
        ""
      )}`
    );
  }

  return (
    <div className="ri-photo-grid">
      {photos.map(
        (
          photo,
          index
        ) => (
          <PhotoCard
            key={
              photo.id
            }
            photo={
              photo
            }
            section={
              section
            }
            imageUrl={imageUrlFor(
              photo
            )}
            customLines={
              index === 0
                ? lines
                : [
                    "Additional image",
                  ]
            }
          />
        )
      )}
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function FinalV2ReportPage() {
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
    sections,
    setSections,
  ] =
    useState([]);

  const [
    photos,
    setPhotos,
  ] =
    useState([]);

  const [
    imageUrls,
    setImageUrls,
  ] =
    useState({});

  const [
    sourcePdfUrl,
    setSourcePdfUrl,
  ] =
    useState("");

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    generating,
    setGenerating,
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
  // SIGN PHOTOS
  // ==========================================================

  async function signImages(
    paths
  ) {
    const uniquePaths =
      [
        ...new Set(
          paths.filter(
            Boolean
          )
        ),
      ];

    const result =
      {};

    for (
      let start = 0;
      start <
      uniquePaths.length;
      start += 100
    ) {
      const batch =
        uniquePaths.slice(
          start,
          start + 100
        );

      const {
        data,
        error:
          signedError,
      } =
        await supabase.storage
          .from(
            "inventory-photos"
          )
          .createSignedUrls(
            batch,
            60 * 60
          );

      if (
        signedError
      ) {
        throw signedError;
      }

      for (
        let index = 0;
        index <
        batch.length;
        index++
      ) {
        const item =
          data?.[index];

        if (
          item?.signedUrl
        ) {
          result[
            batch[index]
          ] =
            item.signedUrl;
        }
      }
    }

    return result;
  }

  // ==========================================================
  // LOAD REPORT
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

          setSections(
            sectionData ||
              []
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
                ai_analysis,
                include_in_report
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

          const finalPhotos =
            (
              photoData ||
              []
            ).filter(
              (
                photo
              ) => {
                const analysis =
                  objectValue(
                    photo
                      .ai_analysis
                  );

                const extraction =
                  objectValue(
                    analysis
                      .image_extraction
                  );

                const v2 =
                  objectValue(
                    analysis
                      .inventory_v2
                  );

                return (
                  photo
                    .include_in_report !==
                    false &&
                  extraction
                    .status ===
                    "extracted" &&
                  Boolean(
                    text(
                      extraction
                        .storage_path
                    )
                  ) &&
                  v2
                    .completed ===
                    true
                );
              }
            );

          setPhotos(
            finalPhotos
          );

          // --------------------------------------------------
          // SIGN REAL PHOTOS
          // --------------------------------------------------

          const paths =
            finalPhotos.map(
              (
                photo
              ) =>
                text(
                  getExtraction(
                    photo
                  )
                    .storage_path
                )
            );

          if (
            paths.length >
            0
          ) {
            const urls =
              await signImages(
                paths
              );

            setImageUrls(
              urls
            );
          }

          // --------------------------------------------------
          // SIGN ORIGINAL PDF
          // --------------------------------------------------

          if (
            reportData
              .source_pdf_path
          ) {
            const {
              data:
                signedPdf,
              error:
                pdfError,
            } =
              await supabase.storage
                .from(
                  "inventory-report-files"
                )
                .createSignedUrl(
                  reportData
                    .source_pdf_path,
                  60 * 60
                );

            if (
              !pdfError &&
              signedPdf
                ?.signedUrl
            ) {
              setSourcePdfUrl(
                signedPdf
                  .signedUrl
              );
            }
          }
        } catch (
          loadError
        ) {
          console.error(
            "Final V2 load error:",
            loadError
          );

          setError(
            loadError?.message ||
              "Could not load final report."
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
  // GENERATE FINAL REPORT DATA
  // ==========================================================

  async function generateFinalReport() {
    if (
      generating ||
      !reportId
    ) {
      return;
    }

    try {
      setGenerating(
        true
      );

      setError("");
      setMessage(
        "Creating final meter readings and Overview..."
      );

      const response =
        await fetch(
          `/api/reports/${reportId}/finalise-v2`,
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
          "Final report generator returned an invalid server response."
        );
      }

      if (
        response.status ===
          429 &&
        data
          ?.quota_limited
      ) {
        setMessage("");

        setError(
          `Gemini free-tier quota reached. Wait approximately ${
            data
              .retry_after_seconds ||
            60
          } seconds and press Generate Final Report again.`
        );

        return;
      }

      if (
        !response.ok
      ) {
        throw new Error(
          data?.error ||
            "Final report generation failed."
        );
      }

      setMessage(
        "Final report data created ✓"
      );

      await loadData();
    } catch (
      generateError
    ) {
      console.error(
        generateError
      );

      setError(
        generateError?.message ||
          "Could not generate final report."
      );
    } finally {
      setGenerating(
        false
      );
    }
  }

  // ==========================================================
  // DATA
  // ==========================================================

  const overview =
    objectValue(
      report?.overview
    );

  const sourceStructure =
    objectValue(
      overview
        .source_structure
    );

  const finalData =
    objectValue(
      overview
        .inventory_v2_final
    );

  const finalOverview =
    objectValue(
      finalData.overview
    );

  const meters =
    Array.isArray(
      finalData.meters
    )
      ? finalData.meters
      : [];

  const finalised =
    finalData.completed ===
    true;

  const reportDate =
    formatDate(
      sourceStructure
        .report_date
    );

  const declarationPage =
    numberValue(
      sourceStructure
        .declaration_start_page,
      58
    );

  // ==========================================================
  // SECTION LOOKUP
  // ==========================================================

  const sectionMap =
    useMemo(
      () => {
        const result =
          {};

        for (
          const section of
          sections
        ) {
          result[
            section.id
          ] =
            section;
        }

        return result;
      },
      [
        sections,
      ]
    );

  // ==========================================================
  // GROUP BY ROOM
  // ==========================================================

  const rooms =
    useMemo(
      () => {
        const output =
          [];

        for (
          const section of
          sections
        ) {
          const sectionPhotos =
            photos.filter(
              (
                photo
              ) =>
                photo
                  .section_id ===
                section.id
            );

          if (
            sectionPhotos.length ===
            0
          ) {
            continue;
          }

          const roomName =
            text(
              section
                .room_name
            ) ||
            "Other";

          let room =
            output.find(
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

            output.push(
              room
            );
          }

          room.sections.push({
            ...section,

            photos:
              sectionPhotos,
          });
        }

        return output;
      },
      [
        sections,
        photos,
      ]
    );

  // ==========================================================
  // IMAGE URL
  // ==========================================================

  function imageUrlFor(
    photo
  ) {
    const storagePath =
      text(
        getExtraction(
          photo
        ).storage_path
      );

    return (
      imageUrls[
        storagePath
      ] ||
      ""
    );
  }

  // ==========================================================
  // FIND FINAL METER FOR SECTION
  // ==========================================================

  function meterForSection(
    section
  ) {
    const value =
      `${text(
        section.room_name
      )} ${text(
        section.section_name
      )}`
        .toLowerCase();

    if (
      value.includes(
        "electric"
      )
    ) {
      return (
        meters.find(
          (
            meter
          ) =>
            text(
              meter
                .meter_type
            )
              .toLowerCase()
              .includes(
                "electric"
              )
        ) ||
        null
      );
    }

    if (
      value.includes(
        "gas"
      )
    ) {
      return (
        meters.find(
          (
            meter
          ) =>
            text(
              meter
                .meter_type
            )
              .toLowerCase()
              .includes(
                "gas"
              )
        ) ||
        null
      );
    }

    if (
      value.includes(
        "water"
      )
    ) {
      return (
        meters.find(
          (
            meter
          ) =>
            text(
              meter
                .meter_type
            )
              .toLowerCase()
              .includes(
                "water"
              )
        ) ||
        null
      );
    }

    return null;
  }

  // ==========================================================
  // CONTENTS
  // ==========================================================

  const roomNames =
    rooms.map(
      (
        room
      ) =>
        room.name
    );

  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <div className="p-8">
        Loading final V2 report...
      </div>
    );
  }

  // ==========================================================
  // BEFORE FINALISATION
  // ==========================================================

  if (
    !finalised
  ) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <section className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="text-sm font-bold uppercase tracking-wide text-violet-600">
            Right Inventories AI V2
          </div>

          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            Generate Final Report
          </h1>

          <p className="mt-3 text-slate-600">
            V2 has analysed{" "}
            <strong>
              {photos.length}
            </strong>{" "}
            real photographs. This final step rechecks the
            meters, generates the Overview and opens the
            finished photographic report.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-5">
              <div className="text-xs font-bold uppercase text-slate-500">
                Real photos
              </div>

              <div className="mt-2 text-3xl font-bold">
                {photos.length}
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-5">
              <div className="text-xs font-bold uppercase text-slate-500">
                V2 analysis
              </div>

              <div className="mt-2 text-3xl font-bold text-emerald-700">
                Complete ✓
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-5">
              <div className="text-xs font-bold uppercase text-slate-500">
                Next
              </div>

              <div className="mt-2 text-xl font-bold">
                Build report
              </div>
            </div>
          </div>

          {message && (
            <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-800">
              {message}
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={
              generating
            }
            onClick={
              generateFinalReport
            }
            className="mt-6 rounded-xl bg-violet-600 px-8 py-4 text-lg font-bold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {generating
              ? "Generating Final Report..."
              : "Generate Final Report"}
          </button>
        </section>
      </div>
    );
  }

  // ==========================================================
  // FINAL REPORT
  // ==========================================================

  return (
    <>
      <style>
        {`
        .ri-root {
          background: #dfe3e8;
          min-height: 100vh;
          padding: 24px 0 80px;
          font-family: Arial, Helvetica, sans-serif;
          color: #111827;
        }

        .ri-toolbar {
          max-width: 820px;
          margin: 0 auto 20px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .ri-toolbar button,
        .ri-toolbar a {
          background: white;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 11px 18px;
          font-weight: 700;
          text-decoration: none;
          color: #1f2937;
          cursor: pointer;
        }

        .ri-toolbar .ri-primary {
          background: #111827;
          color: white;
          border-color: #111827;
        }

        .ri-document {
          width: 794px;
          margin: 0 auto;
        }

        .ri-page,
        .ri-source-wrapper {
          position: relative;
          box-sizing: border-box;
          width: 794px;
          min-height: 1123px;
          background: white;
          margin: 0 auto 24px;
          padding: 42px 42px 60px;
          box-shadow: 0 2px 14px rgba(0,0,0,.13);
          break-after: page;
          overflow: hidden;
        }

        .ri-source-wrapper {
          padding: 0;
        }

        .ri-source-frame {
          border: 0;
          width: 100%;
          height: 1123px;
          display: block;
          background: white;
        }

        .ri-page-header {
          font-size: 10px;
          border-bottom: 1px solid #222;
          padding-bottom: 7px;
          margin-bottom: 16px;
          display: flex;
          justify-content: space-between;
          gap: 20px;
          color: #333;
        }

        .ri-brand-small {
          font-weight: 700;
          white-space: nowrap;
        }

        .ri-page-footer {
          position: absolute;
          bottom: 24px;
          left: 42px;
          right: 42px;
          display: flex;
          justify-content: space-between;
          font-size: 9px;
          color: #555;
        }

        .ri-heading {
          font-size: 21px;
          font-weight: 700;
          margin: 5px 0 22px;
        }

        .ri-room {
          margin-top: 24px;
        }

        .ri-room-title {
          font-size: 20px;
          font-weight: 700;
          margin: 0 0 16px;
          padding-bottom: 5px;
          border-bottom: 2px solid #222;
        }

        .ri-section {
          margin-bottom: 22px;
          break-inside: auto;
        }

        .ri-section-title {
          font-size: 14px;
          font-weight: 700;
          margin-bottom: 9px;
          break-after: avoid;
        }

        .ri-photo-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          align-items: start;
        }

        .ri-photo-card {
          border: 1px solid #d1d5db;
          background: white;
          break-inside: avoid;
          margin-bottom: 2px;
        }

        .ri-image-wrap {
          height: 235px;
          background: #f3f4f6;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .ri-photo-image {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .ri-photo-missing {
          font-size: 12px;
          color: #9ca3af;
        }

        .ri-photo-text {
          min-height: 54px;
          padding: 9px 10px 11px;
          font-size: 11px;
          line-height: 1.35;
        }

        .ri-photo-text > div + div {
          margin-top: 2px;
        }

        .ri-first-line {
          font-weight: 500;
        }

        .ri-overview-title {
          font-size: 22px;
          font-weight: 700;
          margin-bottom: 8px;
        }

        .ri-overview-intro {
          font-size: 10px;
          line-height: 1.45;
          margin-bottom: 22px;
        }

        .ri-overview-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-top: 1px solid #aaa;
          border-left: 1px solid #aaa;
        }

        .ri-overview-row {
          display: grid;
          grid-template-columns: 145px 1fr;
          border-right: 1px solid #aaa;
          border-bottom: 1px solid #aaa;
          min-height: 34px;
        }

        .ri-overview-label {
          padding: 8px;
          font-size: 10px;
          font-weight: 700;
          background: #f3f4f6;
        }

        .ri-overview-value {
          padding: 8px;
          font-size: 10px;
        }

        .ri-comments {
          margin-top: 20px;
          border: 1px solid #aaa;
        }

        .ri-comments-title {
          background: #f3f4f6;
          border-bottom: 1px solid #aaa;
          padding: 8px;
          font-size: 10px;
          font-weight: 700;
        }

        .ri-comments-body {
          min-height: 65px;
          padding: 10px;
          font-size: 10px;
          line-height: 1.4;
        }

        .ri-actions {
          margin-top: 18px;
          width: 100%;
          border-collapse: collapse;
          font-size: 10px;
        }

        .ri-actions th,
        .ri-actions td {
          border: 1px solid #aaa;
          padding: 7px;
          text-align: left;
        }

        .ri-actions th {
          background: #f3f4f6;
        }

        .ri-toc-title {
          font-size: 21px;
          font-weight: 700;
          margin-bottom: 25px;
        }

        .ri-toc-line {
          display: flex;
          align-items: flex-end;
          gap: 6px;
          margin-bottom: 9px;
          font-size: 11px;
        }

        .ri-toc-name {
          white-space: nowrap;
        }

        .ri-toc-dots {
          flex: 1;
          border-bottom: 1px dotted #666;
          transform: translateY(-3px);
        }

        .ri-meter-summary {
          border: 1px solid #aaa;
          margin-bottom: 18px;
          padding: 12px;
          font-size: 11px;
          line-height: 1.45;
        }

        @media print {
          nav,
          aside,
          .ri-toolbar {
            display: none !important;
          }

          body {
            margin: 0 !important;
            background: white !important;
          }

          .ri-root {
            background: white !important;
            padding: 0 !important;
          }

          .ri-document {
            width: 100%;
          }

          .ri-page,
          .ri-source-wrapper {
            margin: 0 auto !important;
            box-shadow: none !important;
            break-after: page !important;
          }
        }
        `}
      </style>

      <div className="ri-root">
        {/* ===================================================
            TOOLBAR
        =================================================== */}

        <div className="ri-toolbar">
          <button
            type="button"
            onClick={() =>
              router.push(
                `/reports/${reportId}/v2`
              )
            }
          >
            Back to V2
          </button>

          <button
            type="button"
            className="ri-primary"
            onClick={() =>
              window.print()
            }
          >
            Print / Save as PDF
          </button>

          {sourcePdfUrl && (
            <a
              href={
                sourcePdfUrl
              }
              target="_blank"
              rel="noreferrer"
            >
              Original Report
            </a>
          )}
        </div>

        <div className="ri-document">
          {/* =================================================
              ORIGINAL COVER — EXACT SOURCE TEMPLATE
          ================================================= */}

          {sourcePdfUrl ? (
            <SourcePage
              pdfUrl={
                sourcePdfUrl
              }
              page={1}
            />
          ) : null}

          {/* =================================================
              TABLE OF CONTENTS
          ================================================= */}

          <section className="ri-page">
            <div className="ri-toc-title">
              Table of Contents
            </div>

            {[
              "This Schedule of Condition Report",
              "Landlord and tenant responsibilities",
              "Overview",
              "Photographic Schedule of Conditions",
              ...roomNames,
              "Declaration",
            ].map(
              (
                item,
                index
              ) => (
                <div
                  key={`${item}-${index}`}
                  className="ri-toc-line"
                >
                  <span className="ri-toc-name">
                    {item}
                  </span>

                  <span className="ri-toc-dots" />
                </div>
              )
            )}
          </section>

          {/* =================================================
              ORIGINAL STANDARD WORDING PAGES
          ================================================= */}

          {sourcePdfUrl && (
            <>
              <SourcePage
                pdfUrl={
                  sourcePdfUrl
                }
                page={3}
              />

              <SourcePage
                pdfUrl={
                  sourcePdfUrl
                }
                page={4}
              />
            </>
          )}

          {/* =================================================
              OVERVIEW
          ================================================= */}

          <section className="ri-page">
            <ReportHeader
              report={
                report
              }
              reportDate={
                reportDate
              }
            />

            <div className="ri-overview-title">
              Overview
            </div>

            <div className="ri-overview-intro">
              <strong>
                Cleanliness
              </strong>
              <br />
              The following is an indication of the level of
              cleanliness and general condition attributed to
              the overall property in the view of the inventory
              clerk. For individual room and item conditions,
              please refer to the photographic schedule.
            </div>

            <div className="ri-overview-grid">
              {[
                [
                  "Property",
                  finalOverview.property,
                ],

                [
                  "Garden",
                  finalOverview.garden,
                ],

                [
                  "Doors",
                  finalOverview.doors,
                ],

                [
                  "Skirting",
                  finalOverview.skirting,
                ],

                [
                  "Woodwork",
                  finalOverview.woodwork,
                ],

                [
                  "Paintwork",
                  finalOverview.paintwork,
                ],

                [
                  "Windows",
                  finalOverview.windows,
                ],

                [
                  "Flooring",
                  finalOverview.flooring,
                ],

                [
                  "Carpets",
                  finalOverview.carpets,
                ],

                [
                  "Tiles",
                  finalOverview.tiles,
                ],

                [
                  "Linen",
                  finalOverview.linen,
                ],

                [
                  "Curtains and Blinds",
                  finalOverview
                    .curtains_and_blinds,
                ],

                [
                  "Mattresses",
                  finalOverview.mattresses,
                ],

                [
                  "Kitchen",
                  finalOverview.kitchen,
                ],

                [
                  "Hob",
                  finalOverview.hob,
                ],

                [
                  "Oven",
                  finalOverview.oven,
                ],

                [
                  "Cooker Hood",
                  finalOverview
                    .cooker_hood,
                ],

                [
                  "Dishwasher",
                  finalOverview.dishwasher,
                ],

                [
                  "Fridge Freezer",
                  finalOverview
                    .fridge_freezer,
                ],

                [
                  "Washing Machine",
                  finalOverview
                    .washing_machine,
                ],

                [
                  "Bathroom",
                  finalOverview.bathroom,
                ],

                [
                  "Fireplaces",
                  finalOverview.fireplaces,
                ],
              ].map(
                (
                  [
                    label,
                    value,
                  ]
                ) => (
                  <div
                    key={
                      label
                    }
                    className="ri-overview-row"
                  >
                    <div className="ri-overview-label">
                      {label}
                    </div>

                    <div className="ri-overview-value">
                      {overviewValue(
                        value
                      )}
                    </div>
                  </div>
                )
              )}
            </div>

            <div className="ri-comments">
              <div className="ri-comments-title">
                Additional Comments
              </div>

              <div className="ri-comments-body">
                {text(
                  finalOverview
                    .additional_comments
                ) ||
                  "Refer to the photographic schedule for full details."}
              </div>
            </div>

            {Array.isArray(
              finalOverview
                .room_actions
            ) &&
              finalOverview
                .room_actions
                .length >
                0 && (
                <table className="ri-actions">
                  <thead>
                    <tr>
                      <th>
                        Room
                      </th>

                      <th>
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {finalOverview
                      .room_actions
                      .map(
                        (
                          action,
                          index
                        ) => (
                          <tr
                            key={
                              index
                            }
                          >
                            <td>
                              {action.room}
                            </td>

                            <td>
                              {action.action}
                            </td>
                          </tr>
                        )
                      )}
                  </tbody>
                </table>
              )}

            <ReportFooter
              pageLabel="Overview"
            />
          </section>

          {/* =================================================
              PHOTOGRAPHIC SCHEDULE
          ================================================= */}

          <section className="ri-page">
            <ReportHeader
              report={
                report
              }
              reportDate={
                reportDate
              }
            />

            <div className="ri-heading">
              Photographic Schedule of Conditions
            </div>

            {meters.length >
              0 && (
              <div>
                {meters.map(
                  (
                    meter,
                    index
                  ) => (
                    <div
                      key={
                        index
                      }
                      className="ri-meter-summary"
                    >
                      <strong>
                        {meter
                          .meter_type}{" "}
                        meter
                      </strong>

                      {meter
                        .rate_1 ||
                      meter
                        .rate_2 ? (
                        <>
                          {meter
                            .rate_1 && (
                            <div>
                              Reading
                              rate
                              1.{" "}
                              {
                                meter
                                  .rate_1
                              }
                              {meter
                                .unit
                                ? ` ${meter.unit}`
                                : ""}
                            </div>
                          )}

                          {meter
                            .rate_2 && (
                            <div>
                              Reading
                              rate
                              2.{" "}
                              {
                                meter
                                  .rate_2
                              }
                              {meter
                                .unit
                                ? ` ${meter.unit}`
                                : ""}
                            </div>
                          )}
                        </>
                      ) : (
                        meter
                          .reading && (
                          <div>
                            Reading.{" "}
                            {
                              meter
                                .reading
                            }
                            {meter
                              .unit
                              ? ` ${meter.unit}`
                              : ""}
                          </div>
                        )
                      )}

                      {meter
                        .serial_number && (
                        <div>
                          SN.{" "}
                          {
                            meter
                              .serial_number
                          }
                        </div>
                      )}

                      {meter
                        .balance && (
                        <div>
                          Balance £
                          {String(
                            meter
                              .balance
                          ).replace(
                            /^£/,
                            ""
                          )}
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            )}

            <ReportFooter
              pageLabel="Photographic Schedule"
            />
          </section>

          {/* =================================================
              ROOMS
          ================================================= */}

          {rooms.map(
            (
              room,
              roomIndex
            ) => (
              <section
                className="ri-page"
                key={`${room.name}-${roomIndex}`}
              >
                <ReportHeader
                  report={
                    report
                  }
                  reportDate={
                    reportDate
                  }
                />

                <div className="ri-room">
                  <h2 className="ri-room-title">
                    {room.name}
                  </h2>

                  {room.sections.map(
                    (
                      section
                    ) => {
                      const meterSection =
                        isMeterSection(
                          section
                        );

                      const meter =
                        meterSection
                          ? meterForSection(
                              section
                            )
                          : null;

                      return (
                        <div
                          key={
                            section.id
                          }
                          className="ri-section"
                        >
                          <div className="ri-section-title">
                            {section
                              .section_name ||
                              "General"}
                          </div>

                          {meterSection &&
                          meter ? (
                            <MeterBlock
                              meter={
                                meter
                              }
                              photos={
                                section.photos
                              }
                              section={
                                section
                              }
                              imageUrlFor={
                                imageUrlFor
                              }
                            />
                          ) : (
                            <div className="ri-photo-grid">
                              {section.photos.map(
                                (
                                  photo
                                ) => (
                                  <PhotoCard
                                    key={
                                      photo.id
                                    }
                                    photo={
                                      photo
                                    }
                                    section={
                                      section
                                    }
                                    imageUrl={imageUrlFor(
                                      photo
                                    )}
                                  />
                                )
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }
                  )}
                </div>

                <ReportFooter
                  pageLabel={
                    room.name
                  }
                />
              </section>
            )
          )}

          {/* =================================================
              ORIGINAL DECLARATION
          ================================================= */}

          {sourcePdfUrl && (
            <>
              <SourcePage
                pdfUrl={
                  sourcePdfUrl
                }
                page={
                  declarationPage
                }
              />

              <SourcePage
                pdfUrl={
                  sourcePdfUrl
                }
                page={
                  declarationPage +
                  1
                }
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}