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

function safeText(value) {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
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

function parseObject(value) {
  if (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(
        value
      );
    } catch {
      return {};
    }
  }

  return {};
}

function uniqueLines(lines) {
  const found =
    new Set();

  const result = [];

  for (
    const line of lines
  ) {
    const cleaned =
      safeText(line);

    if (!cleaned) {
      continue;
    }

    const key =
      cleaned.toLowerCase();

    if (
      found.has(key)
    ) {
      continue;
    }

    found.add(key);

    result.push(
      cleaned
    );
  }

  return result;
}

function getPhotoDetails(photo) {
  const analysis =
    parseObject(
      photo.ai_analysis
    );

  const details =
    parseObject(
      analysis
        .detail_enrichment
    );

  const extraction =
    parseObject(
      analysis
        .image_extraction
    );

  const audit =
    parseObject(
      analysis
        .condition_audit
    );

  const validation =
    parseObject(
      analysis
        .report_validation
    );

  return {
    analysis,
    details,
    extraction,
    audit,
    validation,

    page:
      safeNumber(
        analysis
          .page_number
      ),

    photoIndex:
      safeNumber(
        analysis
          .photo_index_on_page
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
      analysis
        .damage_visible ===
      true,

    damageDetails:
      safeText(
        analysis
          .damage_details
      ),

    storagePath:
      safeText(
        extraction
          .storage_path
      ),

    model:
      safeText(
        details.model
      ),

    brand:
      safeText(
        details.brand
      ),

    countDetails:
      Array.isArray(
        details
          .count_details
      )
        ? details.count_details
            .map(
              safeText
            )
            .filter(Boolean)
        : [],

    keyFeatures:
      Array.isArray(
        details
          .key_features
      )
        ? details.key_features
            .map(
              safeText
            )
            .filter(Boolean)
        : [],
  };
}

function buildReportLines(
  photo
) {
  const info =
    getPhotoDetails(
      photo
    );

  const label =
    safeText(
      photo.ai_label
    );

  const caption =
    safeText(
      photo.manual_comment
    ) ||
    safeText(
      photo.ai_comment
    );

  let lines =
    caption
      .split(/\r?\n/)
      .map(
        safeText
      )
      .filter(Boolean);

  // Add exact model if AI found one
  // and it isn't already present.
  if (
    info.model &&
    !lines.some(
      (line) =>
        line
          .toLowerCase()
          .includes(
            info.model.toLowerCase()
          )
    )
  ) {
    lines.push(
      info.model
    );
  }

  // Add useful count details
  // if not already inside caption.
  for (
    const item of
    info.countDetails
  ) {
    if (
      !lines.some(
        (line) =>
          line
            .toLowerCase()
            .includes(
              item.toLowerCase()
            )
      )
    ) {
      lines.push(
        item
      );
    }
  }

  lines =
    uniqueLines(
      lines
    );

  const supportOnly =
    label ===
      "additional_image" ||
    label ===
      "as_above";

  if (
    supportOnly
  ) {
    return lines;
  }

  if (
    info.condition
  ) {
    lines.push(
      info.condition
    );
  }

  if (
    info.cleanliness &&
    info.cleanliness
      .toLowerCase() !==
      info.condition
        .toLowerCase()
  ) {
    lines.push(
      info.cleanliness
    );
  }

  if (
    info.damageDetails &&
    !lines.some(
      (line) =>
        line
          .toLowerCase()
          .includes(
            info
              .damageDetails
              .toLowerCase()
          )
    )
  ) {
    lines.push(
      info.damageDetails
    );
  }

  return uniqueLines(
    lines
  );
}

function ReportPhoto({
  photo,
  imageUrl,
}) {
  const lines =
    buildReportLines(
      photo
    );

  return (
    <div
      className="overflow-hidden border border-slate-300 bg-white"
      style={{
        breakInside:
          "avoid",
      }}
    >
      <div className="bg-slate-100">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="h-[260px] w-full object-contain"
          />
        ) : (
          <div className="flex h-[260px] items-center justify-center text-sm text-slate-400">
            Photograph unavailable
          </div>
        )}
      </div>

      <div className="space-y-1 p-3 text-[13px] leading-5 text-slate-900">
        {lines.map(
          (
            line,
            index
          ) => (
            <div
              key={`${photo.id}-${index}`}
            >
              {line}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ============================================================
// PAGE
// ============================================================

export default function FinishedReportPreview() {
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
    extracting,
    setExtracting,
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
  // SIGN PRIVATE IMAGES IN CHUNKS
  // ==========================================================

  async function signImagePaths(
    paths
  ) {
    const unique =
      [
        ...new Set(
          paths.filter(
            Boolean
          )
        ),
      ];

    const map = {};

    const batchSize =
      100;

    for (
      let index = 0;
      index <
      unique.length;
      index +=
        batchSize
    ) {
      const batch =
        unique.slice(
          index,
          index +
            batchSize
        );

      const {
        data,
        error:
          signedError,
      } =
        await supabase
          .storage
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

      (
        data || []
      ).forEach(
        (
          item,
          itemIndex
        ) => {
          const path =
            batch[
              itemIndex
            ];

          if (
            item
              ?.signedUrl
          ) {
            map[path] =
              item.signedUrl;
          }
        }
      );
    }

    return map;
  }

  // ==========================================================
  // LOAD EVERYTHING
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
                overall_condition,
                overall_cleanliness,
                additional_comments,
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
                include_in_report,
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

          const includedPhotos =
            (
              photoData ||
              []
            ).filter(
              (
                photo
              ) =>
                photo
                  .include_in_report !==
                false
            );

          setPhotos(
            includedPhotos
          );

          // -----------------------------------------------
          // SIGN EXTRACTED IMAGES
          // -----------------------------------------------

          const paths =
            includedPhotos
              .map(
                (
                  photo
                ) =>
                  safeText(
                    parseObject(
                      photo
                        .ai_analysis
                    )
                      ?.image_extraction
                      ?.storage_path
                  )
              )
              .filter(
                Boolean
              );

          if (
            paths.length >
            0
          ) {
            const urls =
              await signImagePaths(
                paths
              );

            setImageUrls(
              urls
            );
          } else {
            setImageUrls(
              {}
            );
          }

          // -----------------------------------------------
          // SIGN ORIGINAL PDF
          // -----------------------------------------------

          if (
            reportData
              ?.source_pdf_path
          ) {
            const {
              data:
                pdfData,
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
              pdfData
                ?.signedUrl
            ) {
              setSourcePdfUrl(
                pdfData
                  .signedUrl
              );
            }
          }
        } catch (
          loadError
        ) {
          console.error(
            "Preview load error:",
            loadError
          );

          setError(
            loadError
              ?.message ||
              "Could not load report preview."
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
  // PHOTO EXTRACTION
  // ==========================================================

  async function extractPhotos() {
    if (
      extracting ||
      !reportId
    ) {
      return;
    }

    try {
      setExtracting(
        true
      );

      setError("");

      let keepRunning =
        true;

      while (
        keepRunning
      ) {
        setMessage(
          "Extracting the next photographs from the original PDF..."
        );

        const response =
          await fetch(
            `/api/reports/${reportId}/extract-photos`,
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
            "Photo extraction returned an invalid server response."
          );
        }

        if (
          !response.ok
        ) {
          throw new Error(
            data?.error ||
              "Photo extraction failed."
          );
        }

        if (
          data?.done ===
          true
        ) {
          setMessage(
            `Photo extraction complete ✓ — ${safeNumber(
              data.extracted_photo_count
            )} / ${safeNumber(
              data.total_photo_count
            )} photographs ready.`
          );

          keepRunning =
            false;

          break;
        }

        setMessage(
          `Photos extracted and saved ✓ — ${safeNumber(
            data.extracted_photo_count
          )} / ${safeNumber(
            data.total_photo_count
          )} (${safeNumber(
            data.progress_percent
          )}%).`
        );
      }

      await loadData();
    } catch (
      extractionError
    ) {
      console.error(
        "Photo extraction error:",
        extractionError
      );

      setError(
        extractionError
          ?.message ||
          "Photo extraction failed."
      );

      setMessage(
        "Extraction stopped. Completed pages remain saved."
      );
    } finally {
      setExtracting(
        false
      );
    }
  }

  // ==========================================================
  // OVERVIEW DATA
  // ==========================================================

  const overview =
    parseObject(
      report?.overview
    );

  const sourceStructure =
    parseObject(
      overview
        ?.source_structure
    );

  const extraction =
    parseObject(
      overview
        ?.photo_extraction
    );

  const meters =
    Array.isArray(
      overview?.meters
    )
      ? overview.meters
      : [];

  const extractionComplete =
    extraction
      ?.completed ===
      true;

  const extractedCount =
    safeNumber(
      extraction
        ?.extracted_photo_count
    );

  const extractionTotal =
    safeNumber(
      extraction
        ?.total_photo_count,
      photos.length
    );

  const reportDate =
    safeText(
      sourceStructure
        ?.report_date
    );

  const declarationPage =
    safeNumber(
      sourceStructure
        ?.declaration_start_page
    );

  // ==========================================================
  // GROUP SECTIONS BY ROOM
  // ==========================================================

  const rooms =
    useMemo(
      () => {
        const result = [];

        for (
          const section of
          sections
        ) {
          const sectionPhotos =
            photos.filter(
              (
                photo
              ) =>
                photo.section_id ===
                section.id
            );

          if (
            sectionPhotos.length ===
            0
          ) {
            continue;
          }

          const roomName =
            section
              .room_name ||
            "Other";

          let room =
            result.find(
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

            result.push(
              room
            );
          }

          room.sections.push({
            ...section,

            photos:
              sectionPhotos,
          });
        }

        return result;
      },
      [
        sections,
        photos,
      ]
    );

  const contentsRooms =
    rooms.map(
      (
        room
      ) =>
        room.name
    );

  // ==========================================================
  // IMAGE URL
  // ==========================================================

  function imageUrlFor(
    photo
  ) {
    const info =
      getPhotoDetails(
        photo
      );

    return (
      imageUrls[
        info.storagePath
      ] ||
      ""
    );
  }

  function primaryMeterPhoto(
    meter
  ) {
    const id =
      safeText(
        meter
          ?.primary_photo_record_id
      );

    if (!id) {
      return null;
    }

    return (
      photos.find(
        (
          photo
        ) =>
          photo.id ===
          id
      ) ||
      null
    );
  }

  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <div className="p-8">
        Loading finished report preview...
      </div>
    );
  }

  // ==========================================================
  // EXTRACTION NOT COMPLETE
  // ==========================================================

  if (
    !extractionComplete
  ) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-wide text-violet-600">
            AI Inventory
          </div>

          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            Build Finished Report Preview
          </h1>

          <p className="mt-3 text-slate-600">
            The AI descriptions are ready. The final step before
            showing the report is extracting the actual inspection
            photographs from the original PDF.
          </p>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
            <div className="font-semibold">
              Photographs extracted
            </div>

            <div className="mt-2 text-3xl font-bold">
              {extractedCount} /{" "}
              {extractionTotal ||
                479}
            </div>
          </div>

          {message && (
            <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-800">
              {message}
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={
              extractPhotos
            }
            disabled={
              extracting
            }
            className="mt-6 rounded-lg bg-violet-600 px-6 py-4 font-bold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {extracting
              ? "Extracting Report Photos..."
              : extractedCount > 0
                ? "Continue Photo Extraction"
                : "Extract Photos & Build Preview"}
          </button>
        </section>
      </div>
    );
  }

  // ==========================================================
  // FINISHED PREVIEW
  // ==========================================================

  return (
    <div className="min-h-screen bg-slate-200 py-8 print:bg-white print:py-0">
      {/* TOOLBAR */}

      <div className="mx-auto mb-6 flex max-w-[900px] flex-wrap gap-3 print:hidden">
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

        <button
          type="button"
          onClick={() =>
            window.print()
          }
          className="rounded-lg bg-violet-600 px-5 py-3 font-semibold text-white"
        >
          Print / Save as PDF
        </button>
      </div>

      <main className="mx-auto max-w-[900px] space-y-8">
        {/* ===================================================
            COVER
        =================================================== */}

        <section
          className="min-h-[1120px] bg-white px-16 py-20 shadow-lg print:min-h-screen print:shadow-none"
          style={{
            breakAfter:
              "page",
          }}
        >
          <div className="border-b-4 border-[#c70078] pb-6">
            <div className="text-lg font-bold uppercase tracking-[0.2em] text-[#c70078]">
              Right Inventories
            </div>
          </div>

          <div className="mt-32">
            <h1 className="text-5xl font-bold leading-tight text-slate-900">
              {report
                ?.report_type ||
                "Inventory and Check-in"}
            </h1>

            <div className="mt-10 text-3xl font-semibold text-slate-800">
              {report
                ?.property_address ||
                "Property"}
            </div>

            {report
              ?.property_postcode && (
              <div className="mt-2 text-2xl text-slate-600">
                {
                  report
                    .property_postcode
                }
              </div>
            )}

            {reportDate && (
              <div className="mt-12 text-xl text-slate-600">
                {reportDate}
              </div>
            )}
          </div>

          <div className="mt-72 text-sm leading-6 text-slate-500">
            Independent photographic inventory and schedule of
            condition.
          </div>
        </section>

        {/* ===================================================
            CONTENTS
        =================================================== */}

        <section
          className="bg-white px-14 py-14 shadow-lg print:shadow-none"
          style={{
            breakAfter:
              "page",
          }}
        >
          <h2 className="border-b-2 border-[#c70078] pb-3 text-3xl font-bold">
            Contents
          </h2>

          <div className="mt-8 space-y-4">
            <div className="border-b border-slate-200 pb-3 text-lg">
              Overview
            </div>

            <div className="border-b border-slate-200 pb-3 text-lg">
              Photographic Schedule of Conditions
            </div>

            {contentsRooms.map(
              (
                room,
                index
              ) => (
                <div
                  key={`${room}-${index}`}
                  className="border-b border-slate-200 pb-3 text-lg"
                >
                  {room}
                </div>
              )
            )}

            <div className="border-b border-slate-200 pb-3 text-lg">
              Declaration
            </div>
          </div>
        </section>

        {/* ===================================================
            OVERVIEW
        =================================================== */}

        <section
          className="bg-white px-14 py-14 shadow-lg print:shadow-none"
          style={{
            breakAfter:
              "page",
          }}
        >
          <h2 className="border-b-2 border-[#c70078] pb-3 text-3xl font-bold">
            Overview
          </h2>

          <div className="mt-8 space-y-6 text-base leading-7">
            <div>
              <strong>
                Overall condition:
              </strong>{" "}
              {report
                ?.overall_condition ||
                "Refer to the photographic schedule for itemised condition."}
            </div>

            <div>
              <strong>
                Overall cleanliness:
              </strong>{" "}
              {report
                ?.overall_cleanliness ||
                "Refer to the photographic schedule for itemised cleanliness."}
            </div>

            {report
              ?.additional_comments && (
              <div>
                {
                  report
                    .additional_comments
                }
              </div>
            )}

            <div>
              <strong>
                Photographs:
              </strong>{" "}
              {photos.length}
            </div>

            <div>
              <strong>
                Cleaning issues identified:
              </strong>{" "}
              {safeNumber(
                overview
                  ?.condition_audit
                  ?.cleaning_issue_count
              )}
            </div>

            <div>
              <strong>
                Visible damage findings:
              </strong>{" "}
              {safeNumber(
                overview
                  ?.report_validation
                  ?.visible_damage_count
              )}
            </div>
          </div>
        </section>

        {/* ===================================================
            METER READINGS
        =================================================== */}

        {meters.length >
          0 && (
          <section className="bg-white px-14 py-14 shadow-lg print:shadow-none">
            <h2 className="border-b-2 border-[#c70078] pb-3 text-3xl font-bold">
              Meter readings
            </h2>

            <div className="mt-8 grid gap-8 md:grid-cols-2">
              {meters.map(
                (
                  meter,
                  index
                ) => {
                  const photo =
                    primaryMeterPhoto(
                      meter
                    );

                  const imageUrl =
                    photo
                      ? imageUrlFor(
                          photo
                        )
                      : "";

                  const unit =
                    safeText(
                      meter.unit
                    );

                  const reading =
                    safeText(
                      meter.reading
                    );

                  const rate1 =
                    safeText(
                      meter.rate_1
                    );

                  const rate2 =
                    safeText(
                      meter.rate_2
                    );

                  const serial =
                    safeText(
                      meter
                        .serial_number
                    );

                  const balance =
                    safeText(
                      meter.balance
                    ).replace(
                      /^£/,
                      ""
                    );

                  return (
                    <div
                      key={`${meter.meter_type}-${index}`}
                      className="overflow-hidden border border-slate-300"
                      style={{
                        breakInside:
                          "avoid",
                      }}
                    >
                      {imageUrl && (
                        <img
                          src={
                            imageUrl
                          }
                          alt=""
                          className="h-[300px] w-full object-contain bg-slate-100"
                        />
                      )}

                      <div className="space-y-1 p-4 text-sm leading-6">
                        <div className="font-semibold">
                          {safeText(
                            meter
                              .meter_type
                          )}{" "}
                          meter
                        </div>

                        {rate1 ||
                        rate2 ? (
                          <>
                            {rate1 && (
                              <div>
                                Reading
                                rate
                                1.{" "}
                                {
                                  rate1
                                }
                                {unit
                                  ? ` ${unit}`
                                  : ""}
                              </div>
                            )}

                            {rate2 && (
                              <div>
                                Reading
                                rate
                                2.{" "}
                                {
                                  rate2
                                }
                                {unit
                                  ? ` ${unit}`
                                  : ""}
                              </div>
                            )}
                          </>
                        ) : (
                          reading && (
                            <div>
                              Reading.{" "}
                              {
                                reading
                              }
                              {unit
                                ? ` ${unit}`
                                : ""}
                            </div>
                          )
                        )}

                        {serial && (
                          <div>
                            SN.{" "}
                            {
                              serial
                            }
                          </div>
                        )}

                        {balance && (
                          <div>
                            Balance £
                            {
                              balance
                            }
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </section>
        )}

        {/* ===================================================
            PHOTOGRAPHIC SCHEDULE
        =================================================== */}

        <section className="bg-white px-14 py-14 shadow-lg print:shadow-none">
          <h2 className="border-b-2 border-[#c70078] pb-3 text-3xl font-bold">
            Photographic Schedule of Conditions
          </h2>

          <div className="mt-10 space-y-14">
            {rooms.map(
              (
                room
              ) => (
                <div
                  key={
                    room.name
                  }
                >
                  <h2
                    className="mb-7 border-b border-slate-400 pb-3 text-2xl font-bold text-slate-900"
                    style={{
                      breakAfter:
                        "avoid",
                    }}
                  >
                    {room.name}
                  </h2>

                  <div className="space-y-10">
                    {room.sections.map(
                      (
                        section
                      ) => (
                        <div
                          key={
                            section.id
                          }
                        >
                          <h3
                            className="mb-4 bg-slate-100 px-4 py-3 text-lg font-bold"
                            style={{
                              breakAfter:
                                "avoid",
                            }}
                          >
                            {section
                              .section_name ||
                              "General"}
                          </h3>

                          <div className="grid grid-cols-2 gap-5">
                            {section.photos.map(
                              (
                                photo
                              ) => (
                                <ReportPhoto
                                  key={
                                    photo.id
                                  }
                                  photo={
                                    photo
                                  }
                                  imageUrl={imageUrlFor(
                                    photo
                                  )}
                                />
                              )
                            )}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </section>

        {/* ===================================================
            DECLARATION
        =================================================== */}

        <section
          className="bg-white px-14 py-14 shadow-lg print:shadow-none"
          style={{
            breakBefore:
              "page",
          }}
        >
          <h2 className="border-b-2 border-[#c70078] pb-3 text-3xl font-bold">
            Declaration
          </h2>

          <p className="mt-8 leading-7 text-slate-700">
            The original declaration and signature section is
            preserved in the imported inspection report.
          </p>

          {sourcePdfUrl &&
            declarationPage >
              0 && (
              <a
                href={`${sourcePdfUrl}#page=${declarationPage}`}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-block rounded-lg bg-[#c70078] px-5 py-3 font-semibold text-white print:hidden"
              >
                Open Original Declaration
              </a>
            )}
        </section>
      </main>
    </div>
  );
}