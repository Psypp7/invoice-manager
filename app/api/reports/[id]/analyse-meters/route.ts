import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================
// HELPERS
// ============================================================

function safeText(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function safeNumber(value: unknown): number {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function parseObject(value: unknown): any {
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

// ============================================================
// STRUCTURED OUTPUT
// ============================================================

const meterSchema: any = {
  type: "object",

  properties: {
    meters: {
      type: "array",

      items: {
        type: "object",

        properties: {
          meter_type: {
            type: "string",
            enum: [
              "Electric",
              "Gas",
              "Water",
            ],
          },

          primary_photo_record_id: {
            type: "string",
          },

          supporting_photo_record_ids: {
            type: "array",
            items: {
              type: "string",
            },
          },

          reading: {
            type: "string",
          },

          unit: {
            type: "string",
          },

          serial_number: {
            type: "string",
          },

          balance: {
            type: "string",
          },

          rate_1: {
            type: "string",
          },

          rate_2: {
            type: "string",
          },

          confidence: {
            type: "integer",
          },

          review_required: {
            type: "boolean",
          },

          review_reason: {
            type: "string",
          },
        },

        required: [
          "meter_type",
          "primary_photo_record_id",
          "supporting_photo_record_ids",
          "reading",
          "unit",
          "serial_number",
          "balance",
          "rate_1",
          "rate_2",
          "confidence",
          "review_required",
          "review_reason",
        ],

        additionalProperties: false,
      },
    },
  },

  required: [
    "meters",
  ],

  additionalProperties: false,
};

// ============================================================
// BUILD PHOTO MAP
// ============================================================

function buildPhotoMap(
  photos: any[]
) {
  return photos.map(
    (photo) => {
      const analysis =
        parseObject(
          photo.ai_analysis
        );

      return {
        photo_record_id:
          photo.id,

        page:
          safeNumber(
            analysis.page_number
          ),

        photo_index_on_page:
          safeNumber(
            analysis.photo_index_on_page
          ),

        current_caption:
          safeText(
            photo.ai_comment
          ),

        current_meter_type:
          safeText(
            analysis.meter_type
          ),

        current_reading:
          safeText(
            analysis.meter_reading
          ),

        current_serial:
          safeText(
            analysis.meter_serial_number
          ),
      };
    }
  );
}

// ============================================================
// PROMPT
// ============================================================

function buildPrompt(
  meterPhotos: any[]
) {
  return `
You are performing a dedicated professional meter-reading pass for a UK Right Inventories property inventory report.

The COMPLETE original inventory PDF is attached.

These are the photograph records belonging to the Meter readings section:

${JSON.stringify(
  buildPhotoMap(
    meterPhotos
  ),
  null,
  2
)}

==================================================
YOUR JOB
==================================================

Use ALL relevant meter photographs together.

A meter may have:

one photograph showing the reading
another photograph showing the serial number
another photograph showing the whole meter
another photograph showing balance or credit

Combine information ONLY when you are certain the photographs show the SAME meter.

Return ONE meter result per actual meter.

==================================================
METER TYPES
==================================================

meter_type must be exactly one of:

Electric
Gas
Water

==================================================
READING
==================================================

Read every digit exactly as physically visible.

Never guess.

If any important reading digit is unclear:

reading = ""

review_required = true

If a unit is clearly visible, store it separately in:

unit

Examples:

kWh
m3

Do not invent a unit if it is not visible.

==================================================
MULTIPLE RATES
==================================================

Some electricity meters contain more than one rate.

If clearly shown:

rate_1 = exact first rate
rate_2 = exact second rate

If there is only one standard reading:

rate_1 = ""
rate_2 = ""

Never duplicate the standard reading into rate_1.

==================================================
SERIAL NUMBER
==================================================

Read the serial number exactly.

Preserve letters and numbers exactly.

Never guess characters.

If an important character is unclear:

serial_number = ""

review_required = true

==================================================
BALANCE / CREDIT
==================================================

If the display clearly shows monetary balance or credit, return only the visible amount.

Example:

5.83

Do not include the £ symbol in the balance field.

If no balance or credit is visible:

balance = ""

Never invent £0.00.

==================================================
PHOTO IDENTIFICATION
==================================================

primary_photo_record_id should be the photograph that most clearly represents the meter / primary reading.

supporting_photo_record_ids should contain other supplied photograph IDs showing that SAME meter.

Never put photographs of a different meter into supporting_photo_record_ids.

==================================================
STRICT NO-GUESS RULE
==================================================

Do not infer hidden digits.

Do not assume a blurred digit.

Do not use a previous AI value unless the photograph independently confirms it.

Do not turn:

8 into 6
0 into O
1 into I
5 into S

unless the actual image clearly proves the character.

==================================================
REVIEW REQUIRED
==================================================

review_required must be true if:

reading is unclear
serial number is unclear
meter identity is uncertain
photographs might show different meters
multiple rates are ambiguous
balance is ambiguous

review_reason should be a short internal explanation.

Examples:

"Reading display unclear."
"Serial number partially obscured."
"Rate 1 and Rate 2 cannot be distinguished."

If everything important is clearly readable:

review_required = false
review_reason = ""

==================================================
CONFIDENCE
==================================================

95-100:
all important information exceptionally clear

85-94:
clear enough to use confidently

75-84:
usable but slightly limited

below 75:
review_required must be true

==================================================
FINAL REPORT FORMAT TARGET
==================================================

The stored data will later be formatted like:

Electric meter
Reading. 12345 kWh
SN. T08H106686
Balance £5.83

or, for multiple rates:

Electric meter
Reading rate 1. 12345 kWh
Reading rate 2. 67890 kWh
SN. T08H106686

Do NOT return those formatted lines yourself.

Return only structured JSON matching the schema.

==================================================
FINAL RULE
==================================================

Read the actual meter displays.

Never guess any digit.

Return only JSON.
`;
}

// ============================================================
// API
// ============================================================

export async function POST(
  _request: Request,

  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const params =
      await context.params;

    const reportId =
      params.id;

    if (!reportId) {
      return NextResponse.json(
        {
          error:
            "Report ID is missing.",
        },
        {
          status: 400,
        }
      );
    }

    // --------------------------------------------------------
    // AUTH
    // --------------------------------------------------------

    const supabase =
      await createClient();

    const {
      data: { user },
      error: userError,
    } =
      await supabase.auth.getUser();

    if (
      userError ||
      !user
    ) {
      return NextResponse.json(
        {
          error:
            "You are not logged in.",
        },
        {
          status: 401,
        }
      );
    }

    // --------------------------------------------------------
    // REPORT
    // --------------------------------------------------------

    const {
      data: report,
      error: reportError,
    } =
      await supabase
        .from(
          "ai_reports"
        )
        .select(
          `
          id,
          created_by,
          source_pdf_path,
          overview
          `
        )
        .eq(
          "id",
          reportId
        )
        .eq(
          "created_by",
          user.id
        )
        .single();

    if (
      reportError ||
      !report
    ) {
      return NextResponse.json(
        {
          error:
            "Report could not be found.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      !report.source_pdf_path
    ) {
      throw new Error(
        "Source PDF is missing."
      );
    }

    // --------------------------------------------------------
    // FIND METER SECTIONS
    // --------------------------------------------------------

    const {
      data: sections,
      error: sectionError,
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
      throw new Error(
        `Could not load meter sections: ${sectionError.message}`
      );
    }

    const meterSectionIds =
      (sections || [])
        .filter(
          (section: any) => {
            const room =
              safeText(
                section.room_name
              ).toLowerCase();

            const name =
              safeText(
                section.section_name
              ).toLowerCase();

            return (
              room.includes(
                "meter"
              ) ||
              name.includes(
                "meter"
              )
            );
          }
        )
        .map(
          (section: any) =>
            section.id
        );

    if (
      meterSectionIds.length ===
      0
    ) {
      throw new Error(
        "No meter-reading section was found."
      );
    }

    // --------------------------------------------------------
    // LOAD PHOTOS
    // --------------------------------------------------------

    const {
      data: allPhotos,
      error: photoError,
    } =
      await supabase
        .from(
          "ai_report_photos"
        )
        .select(
          `
          id,
          report_id,
          section_id,
          sort_order,
          ai_comment,
          ai_label,
          ai_analysis,
          review_required,
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
            ascending: true,
          }
        );

    if (
      photoError
    ) {
      throw new Error(
        `Could not load meter photographs: ${photoError.message}`
      );
    }

    const meterPhotos =
      (allPhotos || [])
        .filter(
          (photo: any) =>
            meterSectionIds.includes(
              photo.section_id
            )
        );

    if (
      meterPhotos.length ===
      0
    ) {
      throw new Error(
        "No meter photographs were found."
      );
    }

    console.log(
      "Meter photographs:",
      meterPhotos.length
    );

    // --------------------------------------------------------
    // PDF
    // --------------------------------------------------------

    const {
      data: pdfBlob,
      error: downloadError,
    } =
      await supabase.storage
        .from(
          "inventory-report-files"
        )
        .download(
          report.source_pdf_path
        );

    if (
      downloadError ||
      !pdfBlob
    ) {
      throw new Error(
        `Could not download source PDF: ${
          downloadError?.message ||
          "Unknown error"
        }`
      );
    }

    const pdfBuffer =
      await pdfBlob.arrayBuffer();

    const pdfBase64 =
      Buffer.from(
        pdfBuffer
      ).toString(
        "base64"
      );

    // --------------------------------------------------------
    // GEMINI
    // --------------------------------------------------------

    if (
      !process.env
        .GEMINI_API_KEY
    ) {
      throw new Error(
        "GEMINI_API_KEY is missing."
      );
    }

    const ai =
      new GoogleGenAI({});

    console.log(
      "Running dedicated meter analysis..."
    );

    const interaction =
      await ai.interactions.create({
        model:
          "gemini-3.1-flash-lite",

        input: [
          {
            type: "text",
            text:
              buildPrompt(
                meterPhotos
              ),
          },

          {
            type:
              "document",

            data:
              pdfBase64,

            mime_type:
              "application/pdf",
          },
        ],

        response_format: {
          type: "text",

          mime_type:
            "application/json",

          schema:
            meterSchema,
        },

        generation_config: {
          thinking_level:
            "high",

          max_output_tokens:
            8000,
        },

        store: false,
      });

    const raw =
      interaction.output_text;

    if (
      !raw ||
      !raw.trim()
    ) {
      throw new Error(
        "Gemini returned an empty meter analysis."
      );
    }

    let parsed: any;

    try {
      parsed =
        JSON.parse(
          raw.trim()
        );
    } catch {
      console.error(
        raw
      );

      throw new Error(
        "Gemini returned invalid meter JSON."
      );
    }

    if (
      !parsed ||
      !Array.isArray(
        parsed.meters
      )
    ) {
      throw new Error(
        "Gemini did not return a meters array."
      );
    }

    // --------------------------------------------------------
    // VERIFY IDS
    // --------------------------------------------------------

    const allowedIds =
      new Set(
        meterPhotos.map(
          (photo: any) =>
            photo.id
        )
      );

    for (
      const meter of
      parsed.meters
    ) {
      if (
        !allowedIds.has(
          meter.primary_photo_record_id
        )
      ) {
        throw new Error(
          `Gemini returned an unknown primary meter photo ID: ${meter.primary_photo_record_id}`
        );
      }

      meter.supporting_photo_record_ids =
        (
          meter.supporting_photo_record_ids ||
          []
        ).filter(
          (id: string) =>
            allowedIds.has(
              id
            )
        );
    }

    // --------------------------------------------------------
    // SAVE EACH METER
    // --------------------------------------------------------

    for (
      const meter of
      parsed.meters
    ) {
      const primary =
        meterPhotos.find(
          (photo: any) =>
            photo.id ===
            meter.primary_photo_record_id
        );

      if (!primary) {
        continue;
      }

      const oldAnalysis =
        parseObject(
          primary.ai_analysis
        );

      const reviewRequired =
        Boolean(
          meter.review_required
        ) ||
        safeNumber(
          meter.confidence
        ) < 75;

      const meterDetails = {
        analysed_at:
          new Date().toISOString(),

        dedicated_meter_analysis:
          true,

        meter_type:
          safeText(
            meter.meter_type
          ),

        reading:
          safeText(
            meter.reading
          ),

        unit:
          safeText(
            meter.unit
          ),

        serial_number:
          safeText(
            meter.serial_number
          ),

        balance:
          safeText(
            meter.balance
          ),

        rate_1:
          safeText(
            meter.rate_1
          ),

        rate_2:
          safeText(
            meter.rate_2
          ),

        confidence:
          safeNumber(
            meter.confidence
          ),

        review_required:
          reviewRequired,

        review_reason:
          safeText(
            meter.review_reason
          ),

        primary_photo_record_id:
          meter.primary_photo_record_id,

        supporting_photo_record_ids:
          meter.supporting_photo_record_ids,
      };

      const newAnalysis = {
        ...oldAnalysis,

        meter_type:
          meterDetails.meter_type,

        meter_reading:
          meterDetails.reading,

        meter_unit:
          meterDetails.unit,

        meter_serial_number:
          meterDetails.serial_number,

        meter_balance:
          meterDetails.balance,

        meter_rate_1:
          meterDetails.rate_1,

        meter_rate_2:
          meterDetails.rate_2,

        meter_details:
          meterDetails,

        confidence:
          meterDetails.confidence,
      };

      const {
        error: updateError,
      } =
        await supabase
          .from(
            "ai_report_photos"
          )
          .update({
            ai_label:
              "meter",

            ai_analysis:
              newAnalysis,

            review_required:
              reviewRequired,
          })
          .eq(
            "id",
            primary.id
          )
          .eq(
            "report_id",
            reportId
          );

      if (
        updateError
      ) {
        throw new Error(
          `Could not save meter ${meter.meter_type}: ${updateError.message}`
        );
      }

      // ------------------------------------------------------
      // MARK SUPPORTING PHOTOS
      // ------------------------------------------------------

      for (
        const supportId of
        meter.supporting_photo_record_ids
      ) {
        if (
          supportId ===
          primary.id
        ) {
          continue;
        }

        const support =
          meterPhotos.find(
            (photo: any) =>
              photo.id ===
              supportId
          );

        if (!support) {
          continue;
        }

        const supportAnalysis =
          parseObject(
            support.ai_analysis
          );

        const newSupportAnalysis = {
          ...supportAnalysis,

          meter_type:
            meterDetails.meter_type,

          meter_role:
            "supporting",

          meter_primary_photo_id:
            primary.id,

          meter_details:
            meterDetails,
        };

        const {
          error:
            supportError,
        } =
          await supabase
            .from(
              "ai_report_photos"
            )
            .update({
              ai_analysis:
                newSupportAnalysis,
            })
            .eq(
              "id",
              support.id
            )
            .eq(
              "report_id",
              reportId
            );

        if (
          supportError
        ) {
          throw new Error(
            `Could not save supporting meter photograph: ${supportError.message}`
          );
        }
      }
    }

    // --------------------------------------------------------
    // SAVE REPORT LEVEL METER DATA
    // --------------------------------------------------------

    const oldOverview =
      report.overview &&
      typeof report.overview ===
        "object" &&
      !Array.isArray(
        report.overview
      )
        ? report.overview
        : {};

    const {
      error:
        reportUpdateError,
    } =
      await supabase
        .from(
          "ai_reports"
        )
        .update({
          overview: {
            ...oldOverview,

            meters:
              parsed.meters.map(
                (meter: any) => ({
                  meter_type:
                    safeText(
                      meter.meter_type
                    ),

                  reading:
                    safeText(
                      meter.reading
                    ),

                  unit:
                    safeText(
                      meter.unit
                    ),

                  serial_number:
                    safeText(
                      meter.serial_number
                    ),

                  balance:
                    safeText(
                      meter.balance
                    ),

                  rate_1:
                    safeText(
                      meter.rate_1
                    ),

                  rate_2:
                    safeText(
                      meter.rate_2
                    ),

                  confidence:
                    safeNumber(
                      meter.confidence
                    ),

                  review_required:
                    Boolean(
                      meter.review_required
                    ),

                  review_reason:
                    safeText(
                      meter.review_reason
                    ),

                  primary_photo_record_id:
                    safeText(
                      meter.primary_photo_record_id
                    ),
                })
              ),

            meter_analysis: {
              completed:
                true,

              analysed_at:
                new Date().toISOString(),

              meter_count:
                parsed.meters.length,
            },
          },

          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          reportId
        )
        .eq(
          "created_by",
          user.id
        );

    if (
      reportUpdateError
    ) {
      throw new Error(
        `Could not save report meter data: ${reportUpdateError.message}`
      );
    }

    console.log(
      "Dedicated meter analysis complete."
    );

    console.log(
      JSON.stringify(
        parsed.meters,
        null,
        2
      )
    );

    return NextResponse.json({
      ok: true,

      meter_count:
        parsed.meters.length,

      meters:
        parsed.meters,
    });
  } catch (error) {
    console.error(
      "Dedicated meter analysis error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown meter analysis error.",
      },
      {
        status: 500,
      }
    );
  }
}