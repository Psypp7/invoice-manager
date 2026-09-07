import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================
// CONFIG
// ============================================================

const PAGE_BATCH_SIZE = 5;

// ============================================================
// TYPES
// ============================================================

type ExistingPhoto = {
  id: string;
  sort_order: number;
  section_id: string | null;
  ai_comment: string | null;
  ai_label: string | null;
  ai_analysis: any;
  review_required: boolean;
  include_in_report: boolean;
};

type AuditResult = {
  photo_record_id: string;

  visible_defect: boolean;
  defect_details: string;

  cleanliness_issue: boolean;
  cleanliness_details: string;

  corrected_condition: string;
  corrected_cleanliness: string;

  corrected_caption_type:
    | "full_description"
    | "additional_image"
    | "as_above"
    | "internal_view"
    | "specific_defect"
    | "meter"
    | "alarm"
    | "key";

  corrected_caption: string;

  meter_reading: string;
  meter_serial_number: string;

  confidence: number;
  review_required: boolean;
};

// ============================================================
// GEMINI STRUCTURED OUTPUT
//
// Keep this deliberately small.
// We already know room/page/section information from Stage 2.
// ============================================================

const auditSchema: any = {
  type: "object",

  properties: {
    audits: {
      type: "array",

      items: {
        type: "object",

        properties: {
          photo_record_id: {
            type: "string",
          },

          visible_defect: {
            type: "boolean",
          },

          defect_details: {
            type: "string",
          },

          cleanliness_issue: {
            type: "boolean",
          },

          cleanliness_details: {
            type: "string",
          },

          corrected_condition: {
            type: "string",
          },

          corrected_cleanliness: {
            type: "string",
          },

          corrected_caption_type: {
            type: "string",

            enum: [
              "full_description",
              "additional_image",
              "as_above",
              "internal_view",
              "specific_defect",
              "meter",
              "alarm",
              "key",
            ],
          },

          corrected_caption: {
            type: "string",
          },

          meter_reading: {
            type: "string",
          },

          meter_serial_number: {
            type: "string",
          },

          confidence: {
            type: "integer",
          },

          review_required: {
            type: "boolean",
          },
        },

        required: [
          "photo_record_id",
          "visible_defect",
          "defect_details",
          "cleanliness_issue",
          "cleanliness_details",
          "corrected_condition",
          "corrected_cleanliness",
          "corrected_caption_type",
          "corrected_caption",
          "meter_reading",
          "meter_serial_number",
          "confidence",
          "review_required",
        ],

        additionalProperties: false,
      },
    },
  },

  required: ["audits"],

  additionalProperties: false,
};

// ============================================================
// BASIC HELPERS
// ============================================================

function safeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function safeInteger(value: unknown): number {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(
    0,
    Math.round(number)
  );
}

function safeBoolean(
  value: unknown,
  fallback = false
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

function parseJsonObject(value: unknown): any {
  if (!value) {
    return {};
  }

  if (
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
// CHECKPOINT CHECK
// ============================================================

function isAuditComplete(
  photo: ExistingPhoto
): boolean {
  const analysis =
    parseJsonObject(
      photo.ai_analysis
    );

  return (
    analysis
      ?.condition_audit
      ?.completed === true
  );
}

// ============================================================
// QUOTA HELPERS
// ============================================================

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

  if (!Number.isFinite(seconds)) {
    return 60;
  }

  return Math.max(
    15,
    Math.ceil(seconds) + 8
  );
}

// ============================================================
// PARSE GEMINI JSON
// ============================================================

function parseAuditJson(
  rawText: string
): AuditResult[] {
  let text =
    rawText.trim();

  if (
    text.startsWith(
      "```json"
    )
  ) {
    text =
      text.slice(7);
  } else if (
    text.startsWith("```")
  ) {
    text =
      text.slice(3);
  }

  if (
    text.endsWith("```")
  ) {
    text =
      text.slice(
        0,
        -3
      );
  }

  text =
    text.trim();

  let parsed: any;

  try {
    parsed =
      JSON.parse(text);
  } catch {
    console.error(
      "Condition audit returned invalid JSON."
    );

    console.error(
      "Response length:",
      text.length
    );

    console.error(
      "Beginning:",
      text.slice(
        0,
        1500
      )
    );

    console.error(
      "End:",
      text.slice(
        -1500
      )
    );

    throw new Error(
      "Gemini returned invalid condition-audit JSON. This batch was not saved."
    );
  }

  if (
    !parsed ||
    !Array.isArray(
      parsed.audits
    )
  ) {
    throw new Error(
      "Gemini did not return an audits array."
    );
  }

  return parsed.audits.map(
    (audit: any) => {
      const confidence =
        Math.min(
          100,
          Math.max(
            0,
            safeInteger(
              audit?.confidence
            )
          )
        );

      const captionType =
        safeText(
          audit?.corrected_caption_type
        ) ||
        "additional_image";

      return {
        photo_record_id:
          safeText(
            audit?.photo_record_id
          ),

        visible_defect:
          safeBoolean(
            audit?.visible_defect
          ),

        defect_details:
          safeText(
            audit?.defect_details
          ),

        cleanliness_issue:
          safeBoolean(
            audit?.cleanliness_issue
          ),

        cleanliness_details:
          safeText(
            audit?.cleanliness_details
          ),

        corrected_condition:
          safeText(
            audit?.corrected_condition
          ),

        corrected_cleanliness:
          safeText(
            audit?.corrected_cleanliness
          ),

        corrected_caption_type:
          captionType as AuditResult["corrected_caption_type"],

        corrected_caption:
          safeText(
            audit?.corrected_caption
          ),

        meter_reading:
          safeText(
            audit?.meter_reading
          ),

        meter_serial_number:
          safeText(
            audit?.meter_serial_number
          ),

        confidence,

        review_required:
          safeBoolean(
            audit?.review_required
          ) ||
          confidence < 75,
      };
    }
  );
}

// ============================================================
// COMPACT PHOTO MAP
//
// Give Gemini enough context to identify every existing photo,
// but do not waste output tokens asking it to repeat this data.
// ============================================================

function buildPhotoMap(
  photos: ExistingPhoto[]
) {
  return photos.map(
    (photo) => {
      const analysis =
        parseJsonObject(
          photo.ai_analysis
        );

      return {
        id:
          photo.id,

        page:
          safeInteger(
            analysis.page_number
          ),

        photo:
          safeInteger(
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

        meter_type:
          safeText(
            analysis.meter_type
          ),
      };
    }
  );
}

// ============================================================
// BUILD STRICT AUDIT PROMPT
// ============================================================

function buildAuditPrompt(
  startPage: number,
  endPage: number,
  photos: ExistingPhoto[]
): string {
  const photoMap =
    JSON.stringify(
      buildPhotoMap(
        photos
      ),
      null,
      2
    );

  return `
You are performing a STRICT second-pass visual property inventory audit for Right Inventories in the UK.

The COMPLETE unfinished inventory PDF is attached.

For THIS REQUEST analyse ONLY original physical PDF pages:

${startPage} TO ${endPage}

Do not analyse photographs outside that range.

==================================================
EXISTING PHOTOS THAT MUST BE AUDITED
==================================================

${photoMap}

You MUST return exactly ONE audit object for EVERY supplied id.

photo_record_id in your response MUST exactly equal the supplied id.

Do not create additional records.

Do not omit records.

==================================================
VERY IMPORTANT
==================================================

The previous AI results are PRELIMINARY ONLY.

DO NOT automatically agree with:

Good condition
Clean condition
Good and clean condition
95 confidence
Additional image

You are performing an independent visual inspection.

Ignore generic report boilerplate which states that an item should be assumed good, clean, working or undamaged unless otherwise stated.

That wording is NOT visual evidence.

==================================================
VISIBLE DAMAGE / CONDITION AUDIT
==================================================

Inspect every supplied photograph carefully.

Look for:

scuffs
rub marks
scratches
chips
small chips
dents
cracks
hairline cracks
marks
dark marks
stains
discolouration
paint wear
paint loss
paint touch-ups
old painted-over chips
holes
fixing holes
water marks
water staining
mould
mildew
dust
debris
grease
food residue
limescale
soap residue
rust
sealant deterioration
grout discolouration
worn finishes
peeling
swelling
damaged edges
damaged corners
damaged laminate
damaged worktops
broken parts
missing parts
aged fittings
general wear

Pay particular attention to:

low level
mid level
upper level
corners
edges
around handles
around sockets
around switches
door frames
window frames
skirting
junctions between finishes

==================================================
DO NOT INVENT DAMAGE
==================================================

A shadow is not automatically a stain.

A reflection is not automatically damage.

Normal timber or stone grain is not automatically scratching.

A joint is not automatically a crack.

Perspective distortion is not automatically damage.

If genuinely uncertain:

review_required = true

and lower confidence.

==================================================
RIGHT INVENTORIES CONDITION WORDING
==================================================

Use concise clerk-style wording.

Examples:

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

Do not automatically use Good condition.

==================================================
CLEANLINESS
==================================================

Use only visible evidence.

Useful wording:

Good and clean condition
Clean condition
Needs light cleaning
Needs further cleaning
Dust present
Debris present
Limescale present
Grease residue present
Marks requiring cleaning

If cleanliness cannot reasonably be assessed:

corrected_cleanliness = ""

Do not invent cleaning issues.

==================================================
CAPTION RULES
==================================================

If a current caption says:

Additional image

but the photograph shows a NEW defect or materially useful different condition, replace it with a specific caption.

Examples:

Light chip to low level

Marks adjacent to socket

Scuffs to lower edge

Limescale visible around tap base

If it genuinely adds no new information:

corrected_caption_type = "additional_image"
corrected_caption = "Additional image"

If it repeats the SAME defect already documented:

corrected_caption_type = "as_above"
corrected_caption = "As above"

For cupboard / wardrobe / drawer interiors:

corrected_caption_type = "internal_view"

and corrected_caption can be:

Internal view

==================================================
IMPORTANT: DO NOT OVER-DESCRIBE
==================================================

The report must remain concise.

Do not turn every photograph into a full paragraph.

Do not fully describe near-identical duplicate photographs.

Keep useful supporting photographs as Additional image where appropriate.

==================================================
METERS
==================================================

Meter readings are extremely strict.

Never guess digits.

For a PRIMARY meter photograph:

meter_reading must contain the exact clearly visible reading.

meter_serial_number must contain the exact clearly visible serial number.

If any important digit or character is uncertain:

return an empty string for that value

and:

review_required = true

Supporting meter photographs may remain Additional image.

==================================================
STATIC IMAGE RULE
==================================================

A static photograph does not prove that something works.

Never claim:

working
tested
operational
functioning

unless the photograph itself contains explicit evidence.

==================================================
CONFIDENCE
==================================================

Use confidence realistically:

95-100 = exceptionally clear evidence
85-94 = clear evidence
75-84 = reasonable conclusion
60-74 = meaningful uncertainty
below 60 = poor evidence

If confidence is below 75:

review_required = true

Do NOT use 95 automatically.

==================================================
OUTPUT SIZE
==================================================

Be concise.

defect_details should normally be one short phrase.

cleanliness_details should normally be one short phrase.

corrected_condition should normally be one short phrase.

corrected_caption should use concise Right Inventories wording.

Do not provide reasoning or explanations outside the required fields.

==================================================
FINAL RULE
==================================================

Return exactly one audit for every supplied photo id.

Return ONLY JSON matching the provided schema.
`;
}

// ============================================================
// BUILD CURRENT SUMMARY
// ============================================================

function calculateSummary(
  photos: any[]
) {
  let completed = 0;
  let defects = 0;
  let cleaning = 0;
  let review = 0;
  let meterReview = 0;
  let captionChanges = 0;

  for (
    const photo of photos
  ) {
    const analysis =
      parseJsonObject(
        photo.ai_analysis
      );

    const audit =
      parseJsonObject(
        analysis.condition_audit
      );

    if (
      audit.completed === true
    ) {
      completed++;

      if (
        audit.visible_defect ===
        true
      ) {
        defects++;
      }

      if (
        audit.cleanliness_issue ===
        true
      ) {
        cleaning++;
      }

      if (
        audit.caption_changed ===
        true
      ) {
        captionChanges++;
      }
    }

    if (
      photo.review_required ===
      true
    ) {
      review++;
    }

    const isPrimaryMeter =
      safeText(
        photo.ai_label
      ) === "meter";

    if (
      isPrimaryMeter &&
      photo.review_required ===
        true
    ) {
      meterReview++;
    }
  }

  const total =
    photos.length;

  const remaining =
    Math.max(
      0,
      total - completed
    );

  const progress =
    total > 0
      ? Math.round(
          (
            completed /
            total
          ) *
            100
        )
      : 0;

  return {
    audited_photo_count:
      completed,

    total_photo_count:
      total,

    completed_photo_count:
      completed,

    remaining_photo_count:
      remaining,

    progress_percent:
      progress,

    visible_defect_count:
      defects,

    cleaning_issue_count:
      cleaning,

    review_required_count:
      review,

    meter_review_count:
      meterReview,

    caption_change_count:
      captionChanges,

    completed:
      total > 0 &&
      completed === total,
  };
}

// ============================================================
// SAVE SUMMARY TO REPORT
// ============================================================

async function saveSummary({
  supabase,
  reportId,
  userId,
  overview,
  summary,
}: {
  supabase: any;
  reportId: string;
  userId: string;
  overview: any;
  summary: any;
}) {
  const existingOverview =
    overview &&
    typeof overview ===
      "object" &&
    !Array.isArray(
      overview
    )
      ? overview
      : {};

  const {
    error,
  } =
    await supabase
      .from(
        "ai_reports"
      )
      .update({
        status:
          summary.completed
            ? "condition_audited"
            : "auditing_condition",

        overview: {
          ...existingOverview,

          condition_audit: {
            ...summary,

            batch_size_pages:
              PAGE_BATCH_SIZE,

            updated_at:
              new Date().toISOString(),
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
        userId
      );

  if (error) {
    throw new Error(
      `Could not save audit progress: ${error.message}`
    );
  }
}

// ============================================================
// MAIN ROUTE
//
// ONE HTTP CALL = NEXT FIVE PAGES.
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
    // --------------------------------------------------------
    // REPORT ID
    // --------------------------------------------------------

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
    // SUPABASE / USER
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
          source_pdf_name,
          source_pdf_size,
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
            "AI report could not be found.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      !report.source_pdf_path
    ) {
      return NextResponse.json(
        {
          error:
            "Source PDF is missing.",
        },
        {
          status: 400,
        }
      );
    }

    // --------------------------------------------------------
    // LOAD ALL STAGE 2 PHOTO RECORDS
    // --------------------------------------------------------

    const {
      data: photosData,
      error: photosError,
    } =
      await supabase
        .from(
          "ai_report_photos"
        )
        .select(
          `
          id,
          sort_order,
          section_id,
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

    if (photosError) {
      throw new Error(
        `Could not load photograph records: ${photosError.message}`
      );
    }

    if (
      !photosData ||
      photosData.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Run Stage 2 photograph analysis first.",
        },
        {
          status: 400,
        }
      );
    }

    const allPhotos:
      ExistingPhoto[] =
      photosData;

    // --------------------------------------------------------
    // CURRENT PROGRESS
    // --------------------------------------------------------

    const summaryBefore =
      calculateSummary(
        allPhotos
      );

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "CONDITION AUDIT CHECKPOINT"
    );

    console.log(
      "=========================================="
    );

    console.log(
      "Total:",
      summaryBefore.total_photo_count
    );

    console.log(
      "Already audited:",
      summaryBefore.completed_photo_count
    );

    console.log(
      "Remaining:",
      summaryBefore.remaining_photo_count
    );

    // --------------------------------------------------------
    // ALREADY FINISHED
    // --------------------------------------------------------

    if (
      summaryBefore.completed
    ) {
      await saveSummary({
        supabase,
        reportId,
        userId:
          user.id,
        overview:
          report.overview,
        summary:
          summaryBefore,
      });

      return NextResponse.json({
        ok: true,
        done: true,
        ...summaryBefore,
      });
    }

    // --------------------------------------------------------
    // FIND PENDING PHOTOS
    // --------------------------------------------------------

    const pendingPhotos =
      allPhotos.filter(
        (photo) =>
          !isAuditComplete(
            photo
          )
      );

    const firstPending =
      pendingPhotos[0];

    if (!firstPending) {
      throw new Error(
        "Could not locate the next photograph to audit."
      );
    }

    const firstAnalysis =
      parseJsonObject(
        firstPending.ai_analysis
      );

    const startPage =
      safeInteger(
        firstAnalysis.page_number
      );

    if (
      startPage <= 0
    ) {
      throw new Error(
        "The next pending photograph has an invalid PDF page number."
      );
    }

    const endPage =
      startPage +
      PAGE_BATCH_SIZE -
      1;

    // --------------------------------------------------------
    // NEXT FIVE-PAGE BATCH ONLY
    // --------------------------------------------------------

    const batchPhotos =
      pendingPhotos.filter(
        (photo) => {
          const analysis =
            parseJsonObject(
              photo.ai_analysis
            );

          const page =
            safeInteger(
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
        "No pending photographs were found in the next page batch."
      );
    }

    const actualEndPage =
      Math.max(
        ...batchPhotos.map(
          (photo) => {
            const analysis =
              parseJsonObject(
                photo.ai_analysis
              );

            return safeInteger(
              analysis.page_number
            );
          }
        )
      );

    console.log(
      `Auditing pages ${startPage}-${actualEndPage}`
    );

    console.log(
      "Photographs in batch:",
      batchPhotos.length
    );

    // --------------------------------------------------------
    // DOWNLOAD ORIGINAL PRIVATE PDF
    // --------------------------------------------------------

    console.log(
      "Downloading source PDF..."
    );

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
          "Unknown storage error"
        }`
      );
    }

    if (
      pdfBlob.size >
      50 * 1024 * 1024
    ) {
      throw new Error(
        "The source PDF is larger than 50 MB."
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
        "GEMINI_API_KEY is missing from .env.local."
      );
    }

    const ai =
      new GoogleGenAI({});

    const prompt =
      buildAuditPrompt(
        startPage,
        actualEndPage,
        batchPhotos
      );

    let interaction: any;

    try {
      console.log(
        "Sending ONE 5-page audit request to Gemini..."
      );

      interaction =
        await ai.interactions.create({
          model:
  "gemini-3.1-flash-lite",
          input: [
            {
              type: "text",
              text: prompt,
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

          // Current Interactions API format:
          // response_format is ONE object.
          response_format: {
            type: "text",

            mime_type:
              "application/json",

            schema:
              auditSchema,
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
      // ------------------------------------------------------
      // QUOTA = STOP CLEANLY
      //
      // DO NOT endlessly retry.
      // DO NOT destroy previous checkpoints.
      // ------------------------------------------------------

      if (
        isRateLimitError(
          error
        )
      ) {
        const retrySeconds =
          getRetrySeconds(
            error
          );

        console.log(
          "Gemini quota/rate limit reached."
        );

        console.log(
          "Existing progress is safe."
        );

        console.log(
          `Suggested retry: approximately ${retrySeconds} seconds.`
        );

        return NextResponse.json(
          {
            ok: false,

            paused: true,

            quota_limited:
              true,

            retry_after_seconds:
              retrySeconds,

            message:
              "Gemini quota reached. Existing audit progress is saved. Resume later.",

            ...summaryBefore,
          },
          {
            status: 429,
          }
        );
      }

      throw error;
    }

    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    const responseText =
      interaction.output_text;

    if (
      !responseText ||
      !responseText.trim()
    ) {
      throw new Error(
        `Gemini returned an empty response for pages ${startPage}-${actualEndPage}.`
      );
    }

    console.log(
      "Gemini response length:",
      responseText.length
    );

    const audits =
      parseAuditJson(
        responseText
      );

    // --------------------------------------------------------
    // VERIFY EXACT PHOTO IDS
    // --------------------------------------------------------

    const expectedIds =
      new Set(
        batchPhotos.map(
          (photo) =>
            photo.id
        )
      );

    const resultMap =
      new Map<
        string,
        AuditResult
      >();

    for (
      const audit of audits
    ) {
      if (
        expectedIds.has(
          audit.photo_record_id
        )
      ) {
        resultMap.set(
          audit.photo_record_id,
          audit
        );
      }
    }

    const missingPhotos =
      batchPhotos.filter(
        (photo) =>
          !resultMap.has(
            photo.id
          )
      );

    if (
      missingPhotos.length > 0
    ) {
      console.error(
        "Gemini omitted photo records:",
        missingPhotos.map(
          (photo) =>
            photo.id
        )
      );

      throw new Error(
        `Gemini omitted ${missingPhotos.length} photograph(s) from pages ${startPage}-${actualEndPage}. Nothing from this batch has been marked complete. Press Audit again to retry the same batch.`
      );
    }

    // --------------------------------------------------------
    // SAVE THIS FIVE-PAGE BATCH IMMEDIATELY
    // --------------------------------------------------------

    console.log(
      "Saving completed audit batch..."
    );

    for (
      const photo of
      batchPhotos
    ) {
      const audit =
        resultMap.get(
          photo.id
        );

      if (!audit) {
        continue;
      }

      const oldAnalysis =
        parseJsonObject(
          photo.ai_analysis
        );

      const oldCaption =
        safeText(
          photo.ai_comment
        );

      const oldLabel =
        safeText(
          photo.ai_label
        );

      let finalLabel =
        safeText(
          audit.corrected_caption_type
        ) ||
        oldLabel;

      let finalCaption =
        safeText(
          audit.corrected_caption
        ) ||
        oldCaption;

      // ------------------------------------------------------
      // DEFECT MUST NOT STAY AS "Additional image"
      // ------------------------------------------------------

      if (
        audit.visible_defect &&
        finalLabel ===
          "additional_image"
      ) {
        finalLabel =
          "specific_defect";

        if (
          audit.defect_details
        ) {
          finalCaption =
            audit.defect_details;
        }
      }

      // ------------------------------------------------------
      // ENFORCE EXACT SIMPLE LABELS
      // ------------------------------------------------------

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

      // ------------------------------------------------------
      // STRICT METER REVIEW
      // ------------------------------------------------------

      const primaryMeter =
        oldLabel ===
          "meter" ||
        finalLabel ===
          "meter";

      let reviewRequired =
        audit.review_required ||
        audit.confidence <
          75;

      if (
        primaryMeter &&
        (
          !audit.meter_reading ||
          !audit.meter_serial_number
        )
      ) {
        reviewRequired =
          true;
      }

      const captionChanged =
        oldCaption !==
          finalCaption ||
        oldLabel !==
          finalLabel;

      const newAnalysis =
        {
          ...oldAnalysis,

          condition:
            audit.corrected_condition ||
            safeText(
              oldAnalysis.condition
            ),

          cleanliness:
            audit.corrected_cleanliness,

          damage_visible:
            audit.visible_defect,

          damage_details:
            audit.defect_details,

          confidence:
            audit.confidence,

          meter_reading:
            audit.meter_reading,

          meter_serial_number:
            audit.meter_serial_number,

          condition_audit: {
            completed:
              true,

            audited_at:
              new Date().toISOString(),

            batch_start_page:
              startPage,

            batch_end_page:
              actualEndPage,

            visible_defect:
              audit.visible_defect,

            defect_details:
              audit.defect_details,

            cleanliness_issue:
              audit.cleanliness_issue,

            cleanliness_details:
              audit.cleanliness_details,

            confidence:
              audit.confidence,

            review_required:
              reviewRequired,

            caption_changed:
              captionChanged,
          },
        };

      const {
        error: saveError,
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

      if (saveError) {
        throw new Error(
          `Could not save audited photograph ${photo.id}: ${saveError.message}`
        );
      }
    }

    console.log(
      `Pages ${startPage}-${actualEndPage} SAVED ✓`
    );

    // --------------------------------------------------------
    // RELOAD PHOTOS AFTER CHECKPOINT
    // --------------------------------------------------------

    const {
      data: refreshedPhotos,
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
          ai_label,
          ai_analysis,
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
        )
        .order(
          "sort_order",
          {
            ascending: true,
          }
        );

    if (
      refreshedError
    ) {
      throw new Error(
        `Audit batch was saved, but progress could not be refreshed: ${refreshedError.message}`
      );
    }

    const summaryAfter =
      calculateSummary(
        refreshedPhotos || []
      );

    // --------------------------------------------------------
    // SAVE REPORT-LEVEL PROGRESS
    // --------------------------------------------------------

    await saveSummary({
      supabase,

      reportId,

      userId:
        user.id,

      overview:
        report.overview,

      summary:
        summaryAfter,
    });

    console.log(
      `Progress: ${summaryAfter.completed_photo_count}/${summaryAfter.total_photo_count} (${summaryAfter.progress_percent}%)`
    );

    console.log(
      "Visible defects so far:",
      summaryAfter.visible_defect_count
    );

    console.log(
      "Needs review so far:",
      summaryAfter.review_required_count
    );

    // --------------------------------------------------------
    // SUCCESS FOR THIS BATCH
    // --------------------------------------------------------

    return NextResponse.json({
      ok: true,

      done:
        summaryAfter.completed,

      batch_completed: {
        start_page:
          startPage,

        end_page:
          actualEndPage,

        photo_count:
          batchPhotos.length,
      },

      ...summaryAfter,
    });
  } catch (error) {
    console.error(
      "Condition audit error:",
      error
    );

    // IMPORTANT:
    // Do not mark the whole report failed.
    // Any previous checkpoint remains valid.

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown condition audit error.",
      },
      {
        status: 500,
      }
    );
  }
}