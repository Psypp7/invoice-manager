import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const PAGE_BATCH_SIZE = 5;

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

function safeBoolean(
  value: unknown,
  fallback = false
): boolean {
  return typeof value === "boolean"
    ? value
    : fallback;
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

function isRateLimitError(error: any): boolean {
  const status =
    error?.statusCode ||
    error?.status ||
    error?.cause?.statusCode;

  const message = String(
    error?.message ||
      error?.error?.message ||
      error?.cause?.message ||
      ""
  );

  return (
    status === 429 ||
    message.includes("429") ||
    message.includes(
      "RESOURCE_EXHAUSTED"
    ) ||
    message.includes(
      "too_many_requests"
    )
  );
}

function getRetrySeconds(error: any): number {
  const message = String(
    error?.message ||
      error?.error?.message ||
      error?.cause?.message ||
      ""
  );

  const match =
    message.match(
      /retry in\s+([\d.]+)s/i
    );

  if (!match) {
    return 60;
  }

  const seconds =
    Number(match[1]);

  return Number.isFinite(seconds)
    ? Math.max(
        15,
        Math.ceil(seconds) + 8
      )
    : 60;
}

function isValidated(photo: any): boolean {
  const analysis =
    parseObject(
      photo.ai_analysis
    );

  return (
    analysis
      ?.report_validation
      ?.completed === true
  );
}

// ============================================================
// OUTPUT SCHEMA
// ============================================================

const validationSchema: any = {
  type: "object",

  properties: {
    results: {
      type: "array",

      items: {
        type: "object",

        properties: {
          photo_record_id: {
            type: "string",
          },

          action: {
            type: "string",

            enum: [
              "keep",
              "correct",
            ],
          },

          caption_type: {
            type: "string",

            enum: [
              "full_description",
              "additional_image",
              "as_above",
              "internal_view",
              "specific_defect",
              "alarm",
              "key",
            ],
          },

          caption: {
            type: "string",
          },

          condition: {
            type: "string",
          },

          cleanliness: {
            type: "string",
          },

          damage_visible: {
            type: "boolean",
          },

          damage_details: {
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
          "photo_record_id",
          "action",
          "caption_type",
          "caption",
          "condition",
          "cleanliness",
          "damage_visible",
          "damage_details",
          "confidence",
          "review_required",
          "review_reason",
        ],

        additionalProperties: false,
      },
    },
  },

  required: [
    "results",
  ],

  additionalProperties: false,
};

// ============================================================
// COMPACT INPUT DATA
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
        id:
          photo.id,

        page:
          safeNumber(
            analysis.page_number
          ),

        photo:
          safeNumber(
            analysis.photo_index_on_page
          ),

        room:
          safeText(
            analysis.room_name
          ),

        section:
          safeText(
            analysis.section_name
          ),

        current_type:
          safeText(
            photo.ai_label
          ),

        current_caption:
          safeText(
            photo.ai_comment
          ),

        current_condition:
          safeText(
            analysis.condition
          ),

        current_cleanliness:
          safeText(
            analysis.cleanliness
          ),

        current_damage:
          safeBoolean(
            analysis.damage_visible
          ),

        current_damage_details:
          safeText(
            analysis.damage_details
          ),
      };
    }
  );
}

// ============================================================
// PROMPT
// ============================================================

function buildPrompt(
  startPage: number,
  endPage: number,
  photos: any[]
) {
  return `
You are performing the FINAL VISUAL QUALITY VALIDATION for a professional UK property inventory report created by Right Inventories.

The original unfinished PDF is attached.

Analyse ONLY physical PDF pages:

${startPage} TO ${endPage}

The photograph records that must be checked are:

${JSON.stringify(
  buildPhotoMap(photos),
  null,
  2
)}

Return exactly ONE result for EVERY supplied photo id.

==================================================
PURPOSE
==================================================

Previous AI passes already:

1. identified photographs;
2. created captions;
3. audited condition and cleanliness.

Your job is NOT to rewrite everything.

Your job is to independently compare the CURRENT DATA with the ACTUAL PHOTOGRAPH and identify mistakes.

If the current result is already correct:

action = "keep"

and preserve the correct caption, condition and cleanliness.

If something is materially wrong:

action = "correct"

and return the corrected values.

==================================================
RIGHT INVENTORIES STYLE
==================================================

Descriptions must be short inventory-clerk wording.

A main descriptive photograph should identify the visible item accurately.

Examples:

White painted walls

White painted timber skirting boards

Wood effect laminate flooring

White painted timber door

Double glazed window with white uPVC frame

White ceiling

Chrome ceiling light fitting

White radiator

White plastic sockets and switches

Built-in oven

White laminate kitchen units

Grey laminate worktop

Do not use long prose.

==================================================
DESCRIPTION ORDER
==================================================

When useful:

colour / finish
then material
then item type
then defining feature

Examples:

White painted timber door

Grey tiled flooring

White uPVC double glazed window

Chrome mixer tap

==================================================
CONDITION
==================================================

Do NOT automatically use:

Good condition

Look at the photograph.

Appropriate wording includes:

Good condition
Good condition overall
Fair condition
Aged
Light signs of general use
Signs of general use
Light wear
Moderate wear
Heavy wear
Scuffs in places
Marks consistent with age
Old chips painted over

If visible scuffs, chips, marks or wear exist, do not hide them behind generic Good condition wording.

==================================================
VISIBLE DAMAGE
==================================================

Look carefully for:

scuffs
rub marks
marks
scratches
chips
dents
cracks
holes
fixing holes
stains
discolouration
paint loss
paint touch-ups
water staining
mould
rust
damaged sealant
damaged grout
peeling
swelling
worn edges
damaged laminate
damaged worktops
broken items
missing parts

Pay attention to:

low level
corners
edges
around handles
around sockets
around switches
door frames
window frames
skirting

Do NOT invent defects from:

shadows
reflections
material grain
perspective
normal joints

==================================================
CLEANLINESS
==================================================

Use visible evidence only.

Examples:

Good and clean condition
Clean condition
Needs light cleaning
Needs further cleaning
Dust present
Debris present
Limescale present
Grease residue present
Marks requiring cleaning

Do not claim dirty if there is no visible evidence.

==================================================
ADDITIONAL IMAGE
==================================================

"Additional image" is CORRECT when the photograph merely supports an already adequately described item and adds no new material information.

Do NOT replace every Additional image with a long description.

However, if an Additional image reveals:

a different item
a unique feature
a separate defect
different condition
useful cleanliness evidence

then correct it.

==================================================
AS ABOVE
==================================================

Use:

As above

only when the photograph clearly repeats the same previously documented issue or condition.

==================================================
INTERNAL VIEW
==================================================

For cupboard, wardrobe, drawer or appliance interiors where the external item is already described:

Internal view

is appropriate.

==================================================
APPLIANCES
==================================================

Use brand first when visibly identifiable.

Do not invent model numbers.

Never state:

working
tested
operational
functioning

from a static photograph.

==================================================
METERS
==================================================

Dedicated meter analysis has already been performed separately.

DO NOT alter meter photographs in this validation.

Meter photographs are excluded from the supplied list.

==================================================
CONFIDENCE
==================================================

95-100:
very clear

85-94:
clear

75-84:
reasonable conclusion

below 75:
review_required = true

Do not use 95 automatically.

==================================================
REVIEW REQUIRED
==================================================

Set review_required = true when:

the photograph is unclear;
the item cannot be confidently identified;
damage may be shadow/reflection;
condition is ambiguous;
a correction is uncertain;
important visible evidence cannot be resolved.

Give a short review_reason.

==================================================
IMPORTANT
==================================================

The goal is NOT maximum wording.

The goal is an accurate, concise professional inventory report.

A correct simple caption is better than unnecessary description.

Do not invent information.

Return exactly one result for every supplied photo_record_id.

Return JSON only.
`;
}

// ============================================================
// CALCULATE PROGRESS
// ============================================================

function calculateProgress(
  photos: any[]
) {
  let completed = 0;
  let corrections = 0;
  let reviews = 0;
  let damage = 0;

  for (
    const photo of photos
  ) {
    const analysis =
      parseObject(
        photo.ai_analysis
      );

    const validation =
      parseObject(
        analysis.report_validation
      );

    if (
      validation.completed ===
      true
    ) {
      completed++;

      if (
        validation.action ===
        "correct"
      ) {
        corrections++;
      }

      if (
        validation.review_required ===
        true
      ) {
        reviews++;
      }

      if (
        validation.damage_visible ===
        true
      ) {
        damage++;
      }
    }
  }

  const total =
    photos.length;

  return {
    total_photo_count:
      total,

    completed_photo_count:
      completed,

    remaining_photo_count:
      Math.max(
        0,
        total - completed
      ),

    correction_count:
      corrections,

    review_required_count:
      reviews,

    visible_damage_count:
      damage,

    progress_percent:
      total
        ? Math.round(
            (
              completed /
              total
            ) * 100
          )
        : 0,

    completed:
      total > 0 &&
      completed === total,
  };
}

// ============================================================
// ROUTE
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
          overview,
          status
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

    // --------------------------------------------------------
    // LOAD PHOTOS
    // --------------------------------------------------------

    const {
      data: photoData,
      error: photoError,
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
          reviewed
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
        `Could not load photographs: ${photoError.message}`
      );
    }

    if (
      !photoData ||
      photoData.length ===
        0
    ) {
      throw new Error(
        "No analysed photographs were found."
      );
    }

    // --------------------------------------------------------
    // EXCLUDE METER PHOTOGRAPHS
    // --------------------------------------------------------

    const photos =
      photoData.filter(
        (photo: any) => {
          const analysis =
            parseObject(
              photo.ai_analysis
            );

          return !safeText(
            analysis.meter_type
          );
        }
      );

    const progressBefore =
      calculateProgress(
        photos
      );

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "REPORT QUALITY VALIDATION"
    );

    console.log(
      "=========================================="
    );

    console.log(
      "Photos to validate:",
      progressBefore
        .total_photo_count
    );

    console.log(
      "Already validated:",
      progressBefore
        .completed_photo_count
    );

    console.log(
      "Remaining:",
      progressBefore
        .remaining_photo_count
    );

    // --------------------------------------------------------
    // ALREADY DONE
    // --------------------------------------------------------

    if (
      progressBefore.completed
    ) {
      return NextResponse.json({
        ok: true,
        done: true,
        ...progressBefore,
      });
    }

    // --------------------------------------------------------
    // NEXT PENDING PHOTO
    // --------------------------------------------------------

    const pending =
      photos.filter(
        (photo: any) =>
          !isValidated(
            photo
          )
      );

    const first =
      pending[0];

    if (!first) {
      throw new Error(
        "No pending validation photograph could be found."
      );
    }

    const firstAnalysis =
      parseObject(
        first.ai_analysis
      );

    const startPage =
      safeNumber(
        firstAnalysis.page_number
      );

    if (
      startPage <= 0
    ) {
      throw new Error(
        "Next validation photograph has no valid page number."
      );
    }

    const endPage =
      startPage +
      PAGE_BATCH_SIZE -
      1;

    const batchPhotos =
      pending.filter(
        (photo: any) => {
          const analysis =
            parseObject(
              photo.ai_analysis
            );

          const page =
            safeNumber(
              analysis.page_number
            );

          return (
            page >= startPage &&
            page <= endPage
          );
        }
      );

    if (
      batchPhotos.length ===
      0
    ) {
      throw new Error(
        "No photographs found in the next validation batch."
      );
    }

    const actualEndPage =
      Math.max(
        ...batchPhotos.map(
          (photo: any) =>
            safeNumber(
              parseObject(
                photo.ai_analysis
              ).page_number
            )
        )
      );

    console.log(
      `Validating pages ${startPage}-${actualEndPage}`
    );

    console.log(
      "Photos:",
      batchPhotos.length
    );

    // --------------------------------------------------------
    // PDF
    // --------------------------------------------------------

    if (
      !report.source_pdf_path
    ) {
      throw new Error(
        "Source PDF is missing."
      );
    }

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

    const buffer =
      await pdfBlob.arrayBuffer();

    const pdfBase64 =
      Buffer.from(
        buffer
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

    let interaction: any;

    try {
      interaction =
        await ai.interactions.create({
          model:
            "gemini-3.1-flash-lite",

          input: [
            {
              type: "text",

              text:
                buildPrompt(
                  startPage,
                  actualEndPage,
                  batchPhotos
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
              validationSchema,
          },

          generation_config: {
            thinking_level:
              "high",

            max_output_tokens:
              24000,
          },

          store: false,
        });
    } catch (error: any) {
      if (
        isRateLimitError(
          error
        )
      ) {
        return NextResponse.json(
          {
            ok: false,

            quota_limited:
              true,

            retry_after_seconds:
              getRetrySeconds(
                error
              ),

            ...progressBefore,
          },
          {
            status: 429,
          }
        );
      }

      throw error;
    }

    const raw =
      interaction.output_text;

    if (
      !raw ||
      !raw.trim()
    ) {
      throw new Error(
        "Gemini returned an empty validation result."
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
        raw.slice(
          -3000
        )
      );

      throw new Error(
        "Gemini returned invalid validation JSON. This batch was not saved."
      );
    }

    if (
      !parsed ||
      !Array.isArray(
        parsed.results
      )
    ) {
      throw new Error(
        "Validation results array is missing."
      );
    }

    // --------------------------------------------------------
    // VERIFY EXACT IDS
    // --------------------------------------------------------

    const allowedIds =
      new Set(
        batchPhotos.map(
          (photo: any) =>
            photo.id
        )
      );

    const resultMap =
      new Map();

    for (
      const result of
      parsed.results
    ) {
      if (
        allowedIds.has(
          result
            .photo_record_id
        )
      ) {
        resultMap.set(
          result
            .photo_record_id,
          result
        );
      }
    }

    const missing =
      batchPhotos.filter(
        (photo: any) =>
          !resultMap.has(
            photo.id
          )
      );

    if (
      missing.length > 0
    ) {
      throw new Error(
        `Gemini omitted ${missing.length} validation result(s). This batch was not saved.`
      );
    }

    // --------------------------------------------------------
    // SAVE CHECKPOINT
    // --------------------------------------------------------

    for (
      const photo of
      batchPhotos
    ) {
      const result =
        resultMap.get(
          photo.id
        );

      if (!result) {
        continue;
      }

      const oldAnalysis =
        parseObject(
          photo.ai_analysis
        );

      const action =
        safeText(
          result.action
        );

      const confidence =
        Math.min(
          100,
          Math.max(
            0,
            safeNumber(
              result.confidence
            )
          )
        );

      const reviewRequired =
        safeBoolean(
          result.review_required
        ) ||
        confidence < 75;

      let finalCaption =
        safeText(
          photo.ai_comment
        );

      let finalLabel =
        safeText(
          photo.ai_label
        );

      let finalCondition =
        safeText(
          oldAnalysis.condition
        );

      let finalCleanliness =
        safeText(
          oldAnalysis.cleanliness
        );

      let damageVisible =
        safeBoolean(
          oldAnalysis.damage_visible
        );

      let damageDetails =
        safeText(
          oldAnalysis.damage_details
        );

      if (
        action ===
        "correct"
      ) {
        finalCaption =
          safeText(
            result.caption
          ) ||
          finalCaption;

        finalLabel =
          safeText(
            result.caption_type
          ) ||
          finalLabel;

        finalCondition =
          safeText(
            result.condition
          ) ||
          finalCondition;

        finalCleanliness =
          safeText(
            result.cleanliness
          );

        damageVisible =
          safeBoolean(
            result.damage_visible
          );

        damageDetails =
          safeText(
            result.damage_details
          );
      }

      if (
        finalLabel ===
        "additional_image"
      ) {
        finalCaption =
          "Additional image";
      }

      if (
        finalLabel ===
        "as_above"
      ) {
        finalCaption =
          "As above";
      }

      if (
        finalLabel ===
          "internal_view" &&
        !finalCaption
      ) {
        finalCaption =
          "Internal view";
      }

      const newAnalysis = {
        ...oldAnalysis,

        condition:
          finalCondition,

        cleanliness:
          finalCleanliness,

        damage_visible:
          damageVisible,

        damage_details:
          damageDetails,

        confidence,

        report_validation: {
          completed:
            true,

          validated_at:
            new Date()
              .toISOString(),

          batch_start_page:
            startPage,

          batch_end_page:
            actualEndPage,

          action,

          original_caption:
            safeText(
              photo.ai_comment
            ),

          validated_caption:
            finalCaption,

          original_condition:
            safeText(
              oldAnalysis.condition
            ),

          validated_condition:
            finalCondition,

          original_cleanliness:
            safeText(
              oldAnalysis.cleanliness
            ),

          validated_cleanliness:
            finalCleanliness,

          damage_visible:
            damageVisible,

          damage_details:
            damageDetails,

          confidence,

          review_required:
            reviewRequired,

          review_reason:
            safeText(
              result.review_reason
            ),
        },
      };

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
              finalCaption,

            ai_label:
              finalLabel,

            ai_analysis:
              newAnalysis,

            review_required:
              reviewRequired,
          })
          .eq(
            "id",
            photo.id
          )
          .eq(
            "report_id",
            reportId
          );

      if (
        saveError
      ) {
        throw new Error(
          `Could not save validation result: ${saveError.message}`
        );
      }
    }

    // --------------------------------------------------------
    // RELOAD FOR ACCURATE PROGRESS
    // --------------------------------------------------------

    const {
      data: refreshed,
      error:
        refreshedError,
    } =
      await supabase
        .from(
          "ai_report_photos"
        )
        .select(
          `
          id,
          ai_analysis,
          ai_label,
          review_required
          `
        )
        .eq(
          "report_id",
          reportId
        )
        .like(
          "storage_path",
          "pdf:%"
        );

    if (
      refreshedError
    ) {
      throw new Error(
        refreshedError.message
      );
    }

    const refreshedNonMeters =
      (
        refreshed ||
        []
      ).filter(
        (photo: any) => {
          const analysis =
            parseObject(
              photo.ai_analysis
            );

          return !safeText(
            analysis.meter_type
          );
        }
      );

    const progressAfter =
      calculateProgress(
        refreshedNonMeters
      );

    // --------------------------------------------------------
    // REPORT SUMMARY
    // --------------------------------------------------------

    const oldOverview =
      parseObject(
        report.overview
      );

    const {
      error:
        reportSaveError,
    } =
      await supabase
        .from(
          "ai_reports"
        )
        .update({
          overview: {
            ...oldOverview,

            report_validation: {
              ...progressAfter,

              batch_size_pages:
                PAGE_BATCH_SIZE,

              model:
                "gemini-3.1-flash-lite",

              updated_at:
                new Date()
                  .toISOString(),
            },
          },

          updated_at:
            new Date()
              .toISOString(),
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
      reportSaveError
    ) {
      throw new Error(
        reportSaveError.message
      );
    }

    console.log(
      `Pages ${startPage}-${actualEndPage} validated ✓`
    );

    console.log(
      `Progress: ${progressAfter.completed_photo_count}/${progressAfter.total_photo_count}`
    );

    console.log(
      "Corrections:",
      progressAfter.correction_count
    );

    console.log(
      "Needs review:",
      progressAfter.review_required_count
    );

    console.log(
      "Damage found:",
      progressAfter.visible_damage_count
    );

    return NextResponse.json({
      ok: true,

      done:
        progressAfter.completed,

      batch_completed: {
        start_page:
          startPage,

        end_page:
          actualEndPage,

        photo_count:
          batchPhotos.length,
      },

      ...progressAfter,
    });
  } catch (error) {
    console.error(
      "Report validation error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown report validation error.",
      },
      {
        status: 500,
      }
    );
  }
}