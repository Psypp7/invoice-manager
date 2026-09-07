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
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("too_many_requests")
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

function isEnriched(photo: any): boolean {
  const analysis =
    parseObject(
      photo.ai_analysis
    );

  return (
    analysis
      ?.detail_enrichment
      ?.completed === true
  );
}

// ============================================================
// OUTPUT SCHEMA
// ============================================================

const enrichmentSchema: any = {
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

          description_lines: {
            type: "array",

            items: {
              type: "string",
            },
          },

          brand: {
            type: "string",
          },

          model: {
            type: "string",
          },

          count_details: {
            type: "array",

            items: {
              type: "string",
            },
          },

          key_features: {
            type: "array",

            items: {
              type: "string",
            },
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
          "caption_type",
          "description_lines",
          "brand",
          "model",
          "count_details",
          "key_features",
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
// COMPACT PHOTO MAP
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

        current_caption_type:
          safeText(
            photo.ai_label
          ),

        current_caption:
          safeText(
            photo.ai_comment
          ),

        condition:
          safeText(
            analysis.condition
          ),

        cleanliness:
          safeText(
            analysis.cleanliness
          ),

        visible_damage:
          safeBoolean(
            analysis.damage_visible
          ),

        damage_details:
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
You are preparing the FINAL DETAILED PHOTOGRAPH DESCRIPTIONS
for a professional Right Inventories UK property inventory report.

The complete original unfinished report PDF is attached.

Analyse ONLY physical PDF pages:

${startPage} TO ${endPage}

These are the exact photograph records that must be processed:

${JSON.stringify(
  buildPhotoMap(
    photos
  ),
  null,
  2
)}

Return exactly ONE result for every supplied photo id.

==================================================
PURPOSE
==================================================

Previous AI stages already established:

- room and subsection
- basic caption
- condition
- cleanliness
- damage
- final visual validation

DO NOT redo those stages.

Your job is to make the actual ITEM DESCRIPTIONS detailed enough
for the final professional inventory.

The final report must NOT be full of vague captions such as:

Built-in oven
Fridge
Door
Wall
Additional image

when useful visible detail exists.

==================================================
RIGHT INVENTORIES STYLE
==================================================

Use short inventory-clerk wording.

No essays.

No conversational wording.

No phrases such as:

"The image shows..."
"It appears that..."
"We can see..."
"This photograph depicts..."

==================================================
MAIN DESCRIPTION ORDER
==================================================

Where useful describe:

1. colour / finish
2. material
3. type of item
4. defining visible feature

Examples:

White painted walls

White painted timber skirting boards

Wood effect laminate flooring

White painted timber panelled door

White uPVC double glazed window

Grey stone effect laminate worktop

White high gloss kitchen base and wall units

Chrome monobloc mixer tap

White ceramic wash hand basin

Chrome heated towel rail

==================================================
APPLIANCES
==================================================

This is especially important.

When a brand is clearly visible:

BRAND FIRST.

Examples:

Bosch built-in electric oven

Samsung freestanding fridge freezer

Hotpoint washing machine

Indesit integrated dishwasher

If an EXACT model number is genuinely legible on:

- manufacturer label
- appliance sticker
- control panel
- data plate
- visible model marking

include it on a SEPARATE description line.

Example:

Bosch built-in electric oven
Bosch HBG634BS1B

NEVER identify a model merely from appearance.

If the exact model is not legible:

model = ""

Do not guess.

==================================================
FRIDGES / FREEZERS
==================================================

For the main external photograph:

describe appliance type, finish and brand where visible.

Examples:

Samsung stainless steel fridge freezer

White integrated fridge freezer

For INTERNAL photographs:

use:

Internal view

and then add useful CLEARLY COUNTABLE details.

Examples:

Internal view
4 glass shelves, 3 door balconies and 2 salad drawers

Internal view
3 freezer drawers

Internal view
5 glass shelves and 1 salad drawer

Count ONLY clearly visible components.

Possible useful fridge/freezer counts include:

- glass shelves
- wire shelves
- door balconies
- bottle racks
- salad drawers
- freezer drawers
- ice trays

Do not guess items hidden by the door angle or cropped image.

==================================================
OVENS
==================================================

Describe, where visible:

- brand
- built-in / freestanding
- single / double
- electric / gas only when genuinely clear
- finish
- control type if useful

Example:

Bosch stainless steel built-in single oven

If the model is clearly readable:

Bosch HBS534BS0B

For internal views:

Internal view
2 chrome wire shelves and 1 grill tray

Only count clearly visible racks/trays.

==================================================
HOBS
==================================================

Where clear describe:

- brand
- gas / ceramic / induction / electric
- number of cooking zones / burners
- finish

Examples:

Bosch black glass four-zone ceramic hob

Stainless steel four-burner gas hob

Do not guess hob technology when visually uncertain.

==================================================
WASHING MACHINES / DISHWASHERS / DRYERS
==================================================

Use:

brand
finish
integrated / freestanding
appliance type

Example:

Hotpoint white freestanding washing machine

Add exact model only if clearly readable.

==================================================
KITCHEN UNITS
==================================================

Main views may describe:

White high gloss wall and base units

Grey shaker style kitchen units

If useful and clearly visible, include:

- door count
- drawer count
- handles / handleless
- glass-fronted units

Do not force counts across a large kitchen when not all units are visible.

==================================================
CUPBOARDS / WARDROBES
==================================================

External:

White painted timber built-in cupboard

White sliding door wardrobe

Internal:

Internal view
3 timber shelves

Internal view
Hanging rail and upper shelf

Internal view
2 shelves and hanging rail

Only count clearly visible components.

==================================================
DOORS
==================================================

Describe useful visible attributes:

White painted timber panelled door

White painted glazed timber door

Natural timber flush door

Do not repeat door descriptions on every near-identical support image.

==================================================
WINDOWS / BLINDS / CURTAINS
==================================================

Examples:

White uPVC double glazed window

White uPVC double glazed window with grey roller blind

Double glazed patio doors with vertical blinds

Count blind panels / curtain pairs only when useful and clearly visible.

==================================================
LIGHTING
==================================================

Describe type and quantity when clearly visible.

Examples:

Chrome three-arm ceiling light fitting

Six recessed ceiling spotlights

White pendant light fitting

Do not count partially hidden fittings.

==================================================
HEATING
==================================================

Examples:

White panel radiator

White double panel radiator

Chrome heated towel rail

Do not state operational / working from a static image.

==================================================
SOCKETS / SWITCHES
==================================================

Use concise descriptions when they are the subject:

White plastic sockets and switches

Brushed chrome double socket

Do not unnecessarily count every tiny fitting unless the report section
clearly requires it and the quantity is reliable.

==================================================
BATHROOM
==================================================

Use specific visible terms.

Examples:

White ceramic WC with white plastic seat

White ceramic wash hand basin with chrome mixer tap

White acrylic bath with chrome mixer tap and shower attachment

Clear glass shower screen

Chrome thermostatic shower controls

White tiled walls

Grey tiled flooring

==================================================
FURNISHINGS
==================================================

Examples:

Grey fabric two-seat sofa

White laminate double wardrobe

Natural timber bedside table

Black metal framed double bed

If multiple identical items are clearly visible, quantity may be stated.

Example:

Pair of white laminate bedside tables

==================================================
ALARMS
==================================================

Describe type / brand when visible.

Do NOT claim:

working
tested
operational
functioning

unless there is explicit evidence.

==================================================
KEYS
==================================================

Where clearly visible, useful count is acceptable.

Examples:

Set of 3 keys

2 Yale keys and 1 fob

Do not invent what a key operates.

==================================================
ADDITIONAL IMAGE
==================================================

Use:

Additional image

ONLY when the photograph genuinely adds no useful new item detail.

Do NOT turn every support image into a long duplicate description.

However, if a supporting image reveals useful additional information,
for example:

- brand
- exact model
- shelf count
- drawer count
- internal arrangement
- unique fitting
- separate defect

then describe that useful information.

==================================================
AS ABOVE
==================================================

Use:

As above

when the photograph specifically repeats the same previously documented
defect / condition and a new description adds no value.

==================================================
INTERNAL VIEW
==================================================

Internal photographs should normally begin:

Internal view

Useful clearly visible contents can follow on another line.

Example:

Internal view
4 glass shelves and 2 drawers

==================================================
SPECIFIC DEFECTS
==================================================

If the photograph's current purpose is a specific validated defect,
do NOT replace the defect with a generic item description.

Keep concise defect wording such as:

Chip to lower edge

Scuffs to low level

Staining to worktop

Marks adjacent to socket

==================================================
CONDITION / CLEANLINESS
==================================================

DO NOT include:

Good condition
Good condition overall
Clean condition
Needs cleaning

inside description_lines.

Condition and cleanliness are stored separately already.

description_lines are ITEM / FEATURE / DETAIL descriptions only.

==================================================
BRAND / MODEL RULE
==================================================

brand:

Only return a brand when clearly visible.

model:

Only return an EXACT model identifier when clearly legible.

No guessing.

No model-family guessing.

No internet-based identification.

No appearance-based model prediction.

If uncertain:

brand = ""
or
model = ""

as appropriate.

==================================================
COUNT DETAILS
==================================================

count_details should contain only meaningful,
clearly countable inventory information.

Examples:

"4 glass shelves"
"3 door balconies"
"2 salad drawers"
"3 freezer drawers"
"2 chrome wire shelves"
"1 grill tray"
"6 recessed spotlights"

Do not return speculative counts.

==================================================
KEY FEATURES
==================================================

key_features may contain concise defining features such as:

"integrated"
"freestanding"
"high gloss finish"
"panelled"
"double glazed"
"roller blind"
"mixer tap"
"hanging rail"
"glass shower screen"

Do not add generic useless features.

==================================================
CONFIDENCE
==================================================

95-100:
all relevant description details exceptionally clear

85-94:
clear

75-84:
reasonable

below 75:
review_required = true

Do NOT automatically use 95.

==================================================
IMPORTANT
==================================================

The user wants a professional report, not maximum text.

Describe useful visible detail.

Avoid repetition.

Do not hallucinate brands.

Do not hallucinate models.

Do not hallucinate quantities.

Do not overwrite specific defects with generic captions.

Return ONLY JSON matching the schema.
`;
}

// ============================================================
// PROGRESS
// ============================================================

function calculateProgress(
  photos: any[]
) {
  let completed = 0;
  let detailed = 0;
  let models = 0;
  let counts = 0;
  let reviews = 0;

  for (
    const photo of
    photos
  ) {
    const analysis =
      parseObject(
        photo.ai_analysis
      );

    const enrichment =
      parseObject(
        analysis.detail_enrichment
      );

    if (
      enrichment.completed ===
      true
    ) {
      completed++;

      if (
        Array.isArray(
          enrichment.description_lines
        ) &&
        enrichment.description_lines.length >
          0
      ) {
        detailed++;
      }

      if (
        safeText(
          enrichment.model
        )
      ) {
        models++;
      }

      if (
        Array.isArray(
          enrichment.count_details
        ) &&
        enrichment.count_details.length >
          0
      ) {
        counts++;
      }

      if (
        enrichment.review_required ===
        true
      ) {
        reviews++;
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

    progress_percent:
      total > 0
        ? Math.round(
            (
              completed /
              total
            ) *
              100
          )
        : 0,

    detailed_caption_count:
      detailed,

    model_found_count:
      models,

    count_detail_count:
      counts,

    review_required_count:
      reviews,

    completed:
      total > 0 &&
      completed === total,
  };
}

// ============================================================
// SAVE SUMMARY
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
  const oldOverview =
    parseObject(
      overview
    );

  const {
    error,
  } =
    await supabase
      .from(
        "ai_reports"
      )
      .update({
        overview: {
          ...oldOverview,

          detail_enrichment: {
            ...summary,

            batch_size_pages:
              PAGE_BATCH_SIZE,

            model:
              "gemini-3.1-flash-lite",

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
      `Could not save detail-enrichment progress: ${error.message}`
    );
  }
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
    // PHOTOS
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
          reviewed,
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
    // METERS HAVE THEIR OWN DEDICATED PASS
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
      "REPORT DETAIL ENRICHMENT"
    );

    console.log(
      "=========================================="
    );

    console.log(
      "Photos:",
      progressBefore.total_photo_count
    );

    console.log(
      "Already enriched:",
      progressBefore.completed_photo_count
    );

    console.log(
      "Remaining:",
      progressBefore.remaining_photo_count
    );

    // --------------------------------------------------------
    // COMPLETE
    // --------------------------------------------------------

    if (
      progressBefore.completed
    ) {
      await saveSummary({
        supabase,
        reportId,
        userId:
          user.id,
        overview:
          report.overview,
        summary:
          progressBefore,
      });

      return NextResponse.json({
        ok: true,
        done: true,
        ...progressBefore,
      });
    }

    // --------------------------------------------------------
    // PENDING
    // --------------------------------------------------------

    const pending =
      photos.filter(
        (photo: any) =>
          !isEnriched(
            photo
          )
      );

    const first =
      pending[0];

    if (!first) {
      throw new Error(
        "Could not locate the next photograph to enrich."
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
        "The next photograph has no valid PDF page number."
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
            page >=
              startPage &&
            page <=
              endPage
          );
        }
      );

    if (
      batchPhotos.length ===
      0
    ) {
      throw new Error(
        "No photographs were found in the next detail batch."
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
      `Enriching pages ${startPage}-${actualEndPage}`
    );

    console.log(
      "Photos in batch:",
      batchPhotos.length
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
              enrichmentSchema,
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

    // --------------------------------------------------------
    // PARSE
    // --------------------------------------------------------

    const raw =
      interaction.output_text;

    if (
      !raw ||
      !raw.trim()
    ) {
      throw new Error(
        "Gemini returned an empty detail-enrichment response."
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
        "Invalid enrichment JSON:"
      );

      console.error(
        raw.slice(
          -3000
        )
      );

      throw new Error(
        "Gemini returned invalid detail-enrichment JSON. This batch was not saved."
      );
    }

    if (
      !parsed ||
      !Array.isArray(
        parsed.results
      )
    ) {
      throw new Error(
        "Gemini did not return a results array."
      );
    }

    // --------------------------------------------------------
    // VERIFY IDS
    // --------------------------------------------------------

    const expectedIds =
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
        expectedIds.has(
          result.photo_record_id
        )
      ) {
        resultMap.set(
          result.photo_record_id,
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
      missing.length >
      0
    ) {
      throw new Error(
        `Gemini omitted ${missing.length} photograph detail result(s). This batch was not saved.`
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

      const descriptionLines =
        Array.isArray(
          result.description_lines
        )
          ? result.description_lines
              .map(
                (line: any) =>
                  safeText(line)
              )
              .filter(Boolean)
          : [];

      const countDetails =
        Array.isArray(
          result.count_details
        )
          ? result.count_details
              .map(
                (item: any) =>
                  safeText(item)
              )
              .filter(Boolean)
          : [];

      const keyFeatures =
        Array.isArray(
          result.key_features
        )
          ? result.key_features
              .map(
                (item: any) =>
                  safeText(item)
              )
              .filter(Boolean)
          : [];

      let captionType =
        safeText(
          result.caption_type
        ) ||
        safeText(
          photo.ai_label
        ) ||
        "full_description";

      let finalCaption =
        descriptionLines.join(
          "\n"
        );

      // ------------------------------------------------------
      // EXACT SUPPORT CAPTIONS
      // ------------------------------------------------------

      if (
        captionType ===
        "additional_image"
      ) {
        finalCaption =
          "Additional image";
      }

      if (
        captionType ===
        "as_above"
      ) {
        finalCaption =
          "As above";
      }

      if (
        captionType ===
          "internal_view" &&
        descriptionLines.length ===
          0
      ) {
        finalCaption =
          "Internal view";
      }

      if (
        !finalCaption
      ) {
        finalCaption =
          safeText(
            photo.ai_comment
          ) ||
          "Additional image";
      }

      // ------------------------------------------------------
      // MANUAL USER TEXT ALWAYS WINS
      // ------------------------------------------------------

      const manualComment =
        safeText(
          photo.manual_comment
        );

      if (
        manualComment
      ) {
        finalCaption =
          manualComment;
      }

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

      const enrichmentReview =
        safeBoolean(
          result.review_required
        ) ||
        confidence < 75;

      const newAnalysis = {
        ...oldAnalysis,

        detail_enrichment: {
          completed:
            true,

          enriched_at:
            new Date()
              .toISOString(),

          batch_start_page:
            startPage,

          batch_end_page:
            actualEndPage,

          caption_type:
            captionType,

          description_lines:
            descriptionLines,

          brand:
            safeText(
              result.brand
            ),

          model:
            safeText(
              result.model
            ),

          count_details:
            countDetails,

          key_features:
            keyFeatures,

          confidence,

          review_required:
            enrichmentReview,

          review_reason:
            safeText(
              result.review_reason
            ),

          original_caption:
            safeText(
              photo.ai_comment
            ),

          final_caption:
            finalCaption,
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
              captionType,

            ai_analysis:
              newAnalysis,

            review_required:
              photo.review_required ===
                true ||
              enrichmentReview,
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
          `Could not save detailed description ${photo.id}: ${saveError.message}`
        );
      }
    }

    // --------------------------------------------------------
    // REFRESH
    // --------------------------------------------------------

    const {
      data: refreshed,
      error: refreshedError,
    } =
      await supabase
        .from(
          "ai_report_photos"
        )
        .select(
          `
          id,
          ai_analysis
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

    await saveSummary({
      supabase,

      reportId,

      userId:
        user.id,

      overview:
        report.overview,

      summary:
        progressAfter,
    });

    console.log(
      `Pages ${startPage}-${actualEndPage} enriched ✓`
    );

    console.log(
      `Progress: ${progressAfter.completed_photo_count}/${progressAfter.total_photo_count}`
    );

    console.log(
      "Exact models found:",
      progressAfter.model_found_count
    );

    console.log(
      "Photos with count details:",
      progressAfter.count_detail_count
    );

    console.log(
      "Needs review:",
      progressAfter.review_required_count
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
      "Report detail enrichment error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown detail-enrichment error.",
      },
      {
        status: 500,
      }
    );
  }
}