import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

import {
  createClient,
} from "../../../../../lib/supabase/server";

import {
  INVENTORY_V2,
  INVENTORY_V2_VERSION,
} from "../../../../../lib/inventory-v2-config";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================
// TYPES
// ============================================================

type PhotoRecord = {
  id: string;
  section_id: string | null;
  sort_order: number | null;
  ai_analysis: any;
  include_in_report: boolean | null;
};

type SectionRecord = {
  id: string;
  room_name: string | null;
  section_name: string | null;
  sort_order: number | null;
};

// ============================================================
// HELPERS
// ============================================================

function safeText(
  value: unknown
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function safeNumber(
  value: unknown,
  fallback = 0
): number {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function safeBoolean(
  value: unknown,
  fallback = false
): boolean {
  return typeof value === "boolean"
    ? value
    : fallback;
}

function safeArray(
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) =>
      safeText(item)
    )
    .filter(Boolean);
}

function parseObject(
  value: unknown
): any {
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

function getExtraction(
  photo: PhotoRecord
) {
  const analysis =
    parseObject(
      photo.ai_analysis
    );

  return parseObject(
    analysis.image_extraction
  );
}

function isRealExtractedPhoto(
  photo: PhotoRecord
): boolean {
  const extraction =
    getExtraction(photo);

  return (
    extraction.completed === true &&
    extraction.status === "extracted" &&
    Boolean(
      safeText(
        extraction.storage_path
      )
    ) &&
    photo.include_in_report !== false
  );
}

function getV2(
  photo: PhotoRecord
) {
  const analysis =
    parseObject(
      photo.ai_analysis
    );

  return parseObject(
    analysis.inventory_v2
  );
}

function isV2Complete(
  photo: PhotoRecord
): boolean {
  const v2 =
    getV2(photo);

  return (
    v2.completed === true &&
    v2.version ===
      INVENTORY_V2_VERSION
  );
}

function isGeneralSection(
  sectionName: string
): boolean {
  return (
    sectionName
      .trim()
      .toLowerCase()
      .startsWith("general")
  );
}

function isMeterSection(
  roomName: string,
  sectionName: string
): boolean {
  const combined =
    `${roomName} ${sectionName}`
      .toLowerCase();

  return (
    combined.includes(
      "meter reading"
    ) ||
    sectionName
      .toLowerCase()
      .includes("electricity") ||
    sectionName
      .toLowerCase()
      .includes("gas")
  );
}

function getRetrySeconds(
  error: any
): number {
  const message =
    String(
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

  return Number.isFinite(
    seconds
  )
    ? Math.max(
        15,
        Math.ceil(seconds) + 5
      )
    : 60;
}

function isRateLimitError(
  error: any
): boolean {
  const status =
    error?.statusCode ||
    error?.status ||
    error?.cause?.statusCode;

  const message =
    String(
      error?.message ||
        error?.error?.message ||
        ""
    );

  return (
    status === 429 ||
    message.includes("429") ||
    message.includes(
      "too_many_requests"
    ) ||
    message.includes(
      "RESOURCE_EXHAUSTED"
    )
  );
}

// ============================================================
// JSON OUTPUT SCHEMA
// ============================================================

const outputSchema: any = {
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
              "general_view",
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

          description_lines: {
            type: "array",

            items: {
              type: "string",
            },
          },

          condition_lines: {
            type: "array",

            items: {
              type: "string",
            },
          },

          cleanliness_lines: {
            type: "array",

            items: {
              type: "string",
            },
          },

          damage_found: {
            type: "boolean",
          },

          damage_lines: {
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

          confidence: {
            type: "integer",
          },

          meter_type: {
            type: "string",
          },

          meter_reading: {
            type: "string",
          },

          meter_unit: {
            type: "string",
          },

          meter_serial_number: {
            type: "string",
          },

          meter_balance: {
            type: "string",
          },

          meter_rate_1: {
            type: "string",
          },

          meter_rate_2: {
            type: "string",
          },
        },

        required: [
          "photo_record_id",
          "caption_type",
          "description_lines",
          "condition_lines",
          "cleanliness_lines",
          "damage_found",
          "damage_lines",
          "brand",
          "model",
          "count_details",
          "confidence",
          "meter_type",
          "meter_reading",
          "meter_unit",
          "meter_serial_number",
          "meter_balance",
          "meter_rate_1",
          "meter_rate_2",
        ],

        additionalProperties:
          false,
      },
    },
  },

  required: [
    "results",
  ],

  additionalProperties:
    false,
};

// ============================================================
// PROMPT
// ============================================================

function buildPrompt(
  metadata: any[]
) {
  return `
You are the FINAL inventory clerk AI for Right Inventories.

You are analysing REAL inspection photographs for a professional
UK Inventory / Inventory and Check-in Report.

These photographs are already assigned to the ORIGINAL report
room and subsection.

DO NOT redesign the report.
DO NOT move photographs to different rooms.
DO NOT invent new sections.

The exact photo metadata is:

${JSON.stringify(metadata, null, 2)}

There is exactly ONE attached image for every metadata entry,
in the same numerical order.

You MUST return exactly ONE result for every photo_record_id.

============================================================
MOST IMPORTANT RULE
============================================================

This is NOT a generic image captioning task.

The output must read like a professional Right Inventories clerk
actually inspected the property.

MOST photographs should be genuinely described.

Do NOT lazily output "Additional image" for photograph after
photograph.

Use "Additional image" ONLY when the photograph genuinely adds
no useful information beyond another immediately preceding
photograph in the SAME subsection.

============================================================
GENERAL SECTION — ABSOLUTE RULE
============================================================

If section_is_general = true:

description_lines MUST be exactly:

["General view"]

caption_type MUST be:

general_view

condition_lines MUST be []
cleanliness_lines MUST be []
damage_lines MUST be []

Do NOT describe the floor, walls, door, window or furniture in
the General subsection.

Those have their own sections.

============================================================
DESCRIPTION STYLE
============================================================

Keep descriptions concise.

Correct examples:

White painted timber panelled door with silver metal lever handle

Wood effect laminate flooring

White painted walls and timber skirting boards

White uPVC double glazed window with brown timber venetian blind

White panel radiator

White plastic sockets and switches

White high gloss wall and base kitchen units

Grey stone effect laminate worktop

Bosch stainless steel built-in oven

White integrated fridge freezer

Chrome heated towel rail

No essays.

Never write:

"The image shows..."
"This photograph depicts..."
"It appears to be..."

============================================================
DESCRIPTION ORDER
============================================================

Where useful:

1. colour / finish
2. material
3. item type
4. defining feature

Example:

White painted timber panelled door with silver metal lever handle

============================================================
DOORS
============================================================

Describe visible:

colour
material
panelled / glazed / flush
handle / knob
finish

Look specifically for:

chips to edges
paint loss
scuffs
marks
old fixing holes
damage around handles
wear to frames

============================================================
FLOORING — VERY IMPORTANT
============================================================

Do NOT automatically state Good condition.

Inspect carefully for:

gaps
board separation
lifting
raised edges
chips
scratches
scuffs
staining
wear
damaged laminate
loose-looking edges

Example:

Wood effect laminate flooring

Fair condition

Gaps and separation between laminate boards in places
Lifting / wear to edges

If the floor visibly looks poor, SAY SO.

============================================================
WALLS / SKIRTING
============================================================

Describe material and finish.

Look at:

low level
corners
around sockets
around switches
door frames
above skirting

Record:

scuffs
marks
chips
paint touch-ups
holes
fixing holes
staining
cracks
paint loss

============================================================
WINDOWS / BLINDS / CURTAINS
============================================================

Examples:

White uPVC double glazed window

Brown timber venetian blind

Dark navy curtains

White painted window sill

Record visible dirt, marks, damaged blinds, staining or wear.

============================================================
CEILING / LIGHTING
============================================================

Examples:

White painted ceiling

Chrome three-arm ceiling light fitting

Six recessed ceiling spotlights

Do not say working / operational from a static image.

============================================================
HEATING
============================================================

Examples:

White panel radiator

White double panel radiator

Chrome heated towel rail

Never state tested or working from a photograph.

============================================================
SOCKETS / SWITCHES
============================================================

Examples:

White plastic sockets and switches

Brushed chrome double socket

If discolouration / marks / damage are visible, record them.

============================================================
BUILT-IN STORAGE
============================================================

External example:

White painted timber built-in cupboard

Internal examples:

Internal view
3 timber shelves

Internal view
Hanging rail and upper shelf

Count only clearly visible shelves / rails / drawers.

============================================================
KITCHEN UNITS
============================================================

Examples:

White high gloss wall and base units

Grey shaker style wall and base units

For internal views:

Internal view
2 white laminate shelves

Record marks, chips, dirt, grease or damaged edges.

============================================================
WORKTOP
============================================================

Describe finish/material.

Inspect carefully for:

staining
ring marks
chips
scratches
burn marks
swelling
damaged edges
residue
grease

Do NOT call a visibly stained worktop clean.

============================================================
APPLIANCES
============================================================

Use BRAND FIRST when the brand is genuinely readable.

Example:

Bosch stainless steel built-in oven

If an EXACT model number is legible on a sticker, data plate,
control panel or label:

model = exact text

Otherwise:

model = ""

NEVER GUESS AN APPLIANCE MODEL FROM ITS APPEARANCE.

Never claim an appliance is:

working
tested
operational
functioning

from a static photograph.

============================================================
OVEN INTERNAL VIEW
============================================================

Examples:

Internal view

Internal view
2 chrome wire shelves and 1 grill tray

Look for grease, residue, burnt deposits and cleaning issues.

============================================================
FRIDGE / FREEZER
============================================================

External:

White integrated fridge freezer

Internal:

Internal view
4 glass shelves, 3 door balconies and 2 salad drawers

Internal view
3 freezer drawers

Count ONLY clearly visible components.

Look for:

food residue
marks
staining
ice build-up
debris
dirty seals
cleaning requirement

============================================================
BATHROOM
============================================================

Examples:

White ceramic WC with white plastic seat

White ceramic wash hand basin with chrome mixer tap

White acrylic bath with chrome mixer tap and shower attachment

Clear glass shower screen

Chrome thermostatic shower controls

White tiled walls

Grey tiled flooring

Look carefully for:

limescale
soap residue
mould
staining
dirty grout
aged sealant
damaged sealant
rust
water marks

============================================================
FURNISHINGS
============================================================

Describe colour, material, type and useful quantity.

Examples:

Grey fabric two-seat sofa

Dark wood dining chair with cream upholstered seat

Pair of white laminate bedside tables

============================================================
CONDITION
============================================================

Do NOT default to Good condition.

Only use Good condition when visual evidence genuinely supports it.

Other appropriate wording:

Good condition overall
Good used condition
Fair condition
Aged condition
Used condition
Poor condition
Light signs of general use
Signs of general use
Moderate wear
Heavy wear

Specific defects belong in damage_lines.

============================================================
CLEANLINESS
============================================================

Only use visible evidence.

Examples:

Good and clean condition
Clean condition
Needs light cleaning
Needs further cleaning
Needs cleaning
Heavy cleaning required

Specific evidence may include:

Dust present
Grease residue present
Limescale present
Debris present
Staining present

Do not invent dirt.

============================================================
DAMAGE
============================================================

Inspect EVERY non-general image independently.

Look for:

${INVENTORY_V2.conditionIssues.join("\n")}

Do not mistake:

shadow
reflection
normal material grain
perspective
normal joints

for damage.

============================================================
ADDITIONAL IMAGE
============================================================

Use Additional image only if:

- the previous image in the SAME section has already described
  the same item; AND
- this image adds no useful feature, condition, cleanliness,
  count, brand, model or defect information.

If a different angle exposes a defect or useful detail,
DESCRIBE IT.

============================================================
AS ABOVE
============================================================

Use As above only when this photograph specifically repeats
the same previously documented defect / condition.

============================================================
INTERNAL VIEW
============================================================

Internal cupboard / fridge / oven / wardrobe / drawer images
should generally use:

Internal view

followed by useful visible counts/details where appropriate.

============================================================
METERS — STRICT
============================================================

Read every visible digit EXACTLY.

Never guess.

meter_type examples:

Electric
Gas
Water

meter_reading:

Current numerical reading only.

Preserve leading zeroes.

meter_unit examples:

kWh
m3
m³

meter_serial_number:

Exact serial number only when readable.

meter_balance:

Exact balance / credit only when displayed.

Do NOT convert or invent £0.00.

meter_rate_1 / meter_rate_2:

Only when genuinely displayed.

If a value cannot be read:

return ""

Supporting meter photographs may contain only the serial number
or only the reading. That is acceptable.

============================================================
ALARMS
============================================================

Describe smoke / carbon monoxide alarm where identifiable.

Never say tested / working unless explicit evidence exists.

============================================================
KEYS
============================================================

Count keys/fobs where clearly visible.

Do not invent what individual keys operate.

============================================================
CONFIDENCE
============================================================

95-100 = extremely clear
85-94 = clear
75-84 = reasonable
below 75 = significant uncertainty

Do NOT give everything 95.

============================================================
FINAL SELF-CHECK BEFORE RETURNING JSON
============================================================

For EACH image ask yourself:

1. Did I actually describe the visible subject?
2. Did I accidentally use Additional image when useful detail exists?
3. Did I assume Good condition without checking?
4. Did I inspect flooring/walls/doors for subtle wear?
5. Did I inspect cleaning properly?
6. Did I count visible shelves/drawers/racks where useful?
7. Did I avoid guessing brand/model?
8. Did I preserve exact meter digits?
9. Is the wording concise and professional?

Return JSON only.
`;
}

// ============================================================
// REPORT SUMMARY
// ============================================================

function buildSummary(
  photos: PhotoRecord[]
) {
  const realPhotos =
    photos.filter(
      isRealExtractedPhoto
    );

  let completed = 0;
  let damageCount = 0;
  let cleaningCount = 0;
  let modelCount = 0;
  let additionalImages = 0;

  const meterGroups: Record<
    string,
    any
  > = {};

  for (
    const photo of
    realPhotos
  ) {
    const v2 =
      getV2(photo);

    if (
      v2.completed === true &&
      v2.version ===
        INVENTORY_V2_VERSION
    ) {
      completed++;
    } else {
      continue;
    }

    if (
      v2.damage_found === true
    ) {
      damageCount++;
    }

    if (
      Array.isArray(
        v2.cleanliness_lines
      ) &&
      v2.cleanliness_lines
        .some(
          (line: any) => {
            const text =
              safeText(line)
                .toLowerCase();

            return (
              text.includes(
                "needs"
              ) ||
              text.includes(
                "dust"
              ) ||
              text.includes(
                "grease"
              ) ||
              text.includes(
                "limescale"
              ) ||
              text.includes(
                "debris"
              ) ||
              text.includes(
                "stain"
              )
            );
          }
        )
    ) {
      cleaningCount++;
    }

    if (
      safeText(v2.model)
    ) {
      modelCount++;
    }

    if (
      v2.caption_type ===
      "additional_image"
    ) {
      additionalImages++;
    }

    const meterType =
      safeText(
        v2.meter_type
      );

    if (meterType) {
      const key =
        meterType.toLowerCase();

      if (
        !meterGroups[key]
      ) {
        meterGroups[key] = {
          meter_type:
            meterType,

          reading: "",
          unit: "",
          serial_number: "",
          balance: "",
          rate_1: "",
          rate_2: "",

          reading_confidence: 0,
          serial_confidence: 0,
          balance_confidence: 0,
        };
      }

      const meter =
        meterGroups[key];

      const confidence =
        safeNumber(
          v2.confidence
        );

      if (
        safeText(
          v2.meter_reading
        ) &&
        confidence >=
          meter.reading_confidence
      ) {
        meter.reading =
          safeText(
            v2.meter_reading
          );

        meter.unit =
          safeText(
            v2.meter_unit
          );

        meter.reading_confidence =
          confidence;
      }

      if (
        safeText(
          v2.meter_serial_number
        ) &&
        confidence >=
          meter.serial_confidence
      ) {
        meter.serial_number =
          safeText(
            v2.meter_serial_number
          );

        meter.serial_confidence =
          confidence;
      }

      if (
        safeText(
          v2.meter_balance
        ) &&
        confidence >=
          meter.balance_confidence
      ) {
        meter.balance =
          safeText(
            v2.meter_balance
          );

        meter.balance_confidence =
          confidence;
      }

      if (
        safeText(
          v2.meter_rate_1
        )
      ) {
        meter.rate_1 =
          safeText(
            v2.meter_rate_1
          );
      }

      if (
        safeText(
          v2.meter_rate_2
        )
      ) {
        meter.rate_2 =
          safeText(
            v2.meter_rate_2
          );
      }
    }
  }

  const total =
    realPhotos.length;

  return {
    version:
      INVENTORY_V2_VERSION,

    model:
      INVENTORY_V2.model,

    total_real_photos:
      total,

    completed_photos:
      completed,

    remaining_photos:
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

    damage_photo_count:
      damageCount,

    cleaning_issue_photo_count:
      cleaningCount,

    exact_model_count:
      modelCount,

    additional_image_count:
      additionalImages,

    meters:
      Object.values(
        meterGroups
      ),

    completed:
      total > 0 &&
      completed === total,

    updated_at:
      new Date()
        .toISOString(),
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
    const {
      id: reportId,
    } =
      await context.params;

    if (!reportId) {
      return NextResponse.json(
        {
          error:
            "Report ID missing.",
        },
        {
          status: 400,
        }
      );
    }

    // ========================================================
    // AUTH
    // ========================================================

    const supabase =
      await createClient();

    const {
      data: {
        user,
      },
      error:
        userError,
    } =
      await supabase.auth.getUser();

    if (
      userError ||
      !user
    ) {
      return NextResponse.json(
        {
          error:
            "Not logged in.",
        },
        {
          status: 401,
        }
      );
    }

    // ========================================================
    // REPORT
    // ========================================================

    const {
      data:
        report,
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
          created_by,
          property_address,
          property_postcode,
          report_type,
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
            "Report not found.",
        },
        {
          status: 404,
        }
      );
    }

    // ========================================================
    // SECTIONS
    // ========================================================

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
      throw new Error(
        sectionError.message
      );
    }

    const sectionMap =
      new Map<
        string,
        SectionRecord
      >();

    for (
      const section of
      sectionData || []
    ) {
      sectionMap.set(
        section.id,
        section
      );
    }

    // ========================================================
    // PHOTOS
    // ========================================================

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
      throw new Error(
        photoError.message
      );
    }

    const allPhotos =
      (
        photoData ||
        []
      ) as PhotoRecord[];

    const realPhotos =
      allPhotos.filter(
        isRealExtractedPhoto
      );

    if (
      realPhotos.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "No real extracted photographs are available yet. Finish photo extraction first.",
        },
        {
          status: 400,
        }
      );
    }

    // ========================================================
    // MAKE SURE EXTRACTION IS ACTUALLY FINISHED
    // ========================================================

    const oldOverview =
      parseObject(
        report.overview
      );

    const extractionSummary =
      parseObject(
        oldOverview
          .photo_extraction
      );

    if (
      extractionSummary
        .completed !==
      true
    ) {
      return NextResponse.json(
        {
          error:
            "Photo extraction is not 100% complete yet.",

          extraction_required:
            true,

          extracted:
            safeNumber(
              extractionSummary
                .processed_photo_count ??
                extractionSummary
                  .extracted_photo_count
            ),

          total:
            safeNumber(
              extractionSummary
                .total_photo_count
            ),
        },
        {
          status: 409,
        }
      );
    }

    // ========================================================
    // PROGRESS
    // ========================================================

    const summaryBefore =
      buildSummary(
        allPhotos
      );

    if (
      summaryBefore.completed
    ) {
      return NextResponse.json({
        ok: true,
        done: true,
        ...summaryBefore,
      });
    }

    const pending =
      realPhotos.filter(
        (photo) =>
          !isV2Complete(
            photo
          )
      );

    // ========================================================
    // BUILD DYNAMIC BATCH
    //
    // Maximum 30 images AND approx 14 MB raw image bytes.
    // ========================================================

    const selectedPhotos:
      PhotoRecord[] = [];

    const imageParts:
      any[] = [];

    const metadata:
      any[] = [];

    let totalRawBytes = 0;

    for (
      const photo of pending
    ) {
      if (
        selectedPhotos.length >=
        INVENTORY_V2
          .maxPhotosPerRequest
      ) {
        break;
      }

      const extraction =
        getExtraction(
          photo
        );

      const storagePath =
        safeText(
          extraction.storage_path
        );

      if (!storagePath) {
        continue;
      }

      const {
        data:
          imageBlob,
        error:
          downloadError,
      } =
        await supabase.storage
          .from(
            "inventory-photos"
          )
          .download(
            storagePath
          );

      if (
        downloadError ||
        !imageBlob
      ) {
        throw new Error(
          `Could not download ${storagePath}: ${
            downloadError?.message ||
            "unknown error"
          }`
        );
      }

      const buffer =
        Buffer.from(
          await imageBlob
            .arrayBuffer()
        );

      if (
        selectedPhotos.length >
          0 &&
        totalRawBytes +
          buffer.length >
          INVENTORY_V2
            .maxRawImageBytesPerRequest
      ) {
        break;
      }

      const section =
        photo.section_id
          ? sectionMap.get(
              photo.section_id
            )
          : undefined;

      const oldAnalysis =
        parseObject(
          photo.ai_analysis
        );

      const roomName =
        safeText(
          section
            ?.room_name ||
            oldAnalysis
              .room_name
        );

      const sectionName =
        safeText(
          section
            ?.section_name ||
            oldAnalysis
              .section_name
        );

      const number =
        selectedPhotos.length +
        1;

      selectedPhotos.push(
        photo
      );

      totalRawBytes +=
        buffer.length;

      metadata.push({
        image_number:
          number,

        photo_record_id:
          photo.id,

        room_name:
          roomName,

        section_name:
          sectionName,

        section_is_general:
          isGeneralSection(
            sectionName
          ),

        section_is_meter:
          isMeterSection(
            roomName,
            sectionName
          ),

        source_pdf_page:
          safeNumber(
            oldAnalysis
              .page_number
          ),

        photo_index_on_page:
          safeNumber(
            oldAnalysis
              .photo_index_on_page
          ),
      });

      imageParts.push(
        {
          type: "text",

          text:
            `IMAGE ${number} — photo_record_id=${photo.id}`,
        },

        {
          type: "image",

          data:
            buffer.toString(
              "base64"
            ),

          mime_type:
            imageBlob.type ||
            "image/png",
        }
      );
    }

    if (
      selectedPhotos.length ===
      0
    ) {
      throw new Error(
        "Could not build the next V2 image batch."
      );
    }

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "RIGHT INVENTORIES V2"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `Model: ${INVENTORY_V2.model}`
    );

    console.log(
      `Batch photographs: ${selectedPhotos.length}`
    );

    console.log(
      `Batch raw image data: ${(totalRawBytes / 1024 / 1024).toFixed(2)} MB`
    );

    console.log(
      `Before: ${summaryBefore.completed_photos}/${summaryBefore.total_real_photos}`
    );

    // ========================================================
    // GEMINI
    // ========================================================

    if (
      !process.env
        .GEMINI_API_KEY
    ) {
      throw new Error(
        "GEMINI_API_KEY missing."
      );
    }

    const ai =
      new GoogleGenAI({});

    let interaction:
      any;

    try {
      interaction =
        await ai.interactions.create({
          model:
            INVENTORY_V2.model,

          input: [
            {
              type:
                "text",

              text:
                buildPrompt(
                  metadata
                ),
            },

            ...imageParts,
          ],

          response_format: {
            type: "text",

            mime_type:
              "application/json",

            schema:
              outputSchema,
          },

          generation_config: {
            thinking_level:
              INVENTORY_V2
                .thinkingLevel,

            max_output_tokens:
              INVENTORY_V2
                .maxOutputTokens,
          },

          store: false,
        });
    } catch (
      geminiError: any
    ) {
      if (
        isRateLimitError(
          geminiError
        )
      ) {
        return NextResponse.json(
          {
            ok: false,

            quota_limited:
              true,

            retry_after_seconds:
              getRetrySeconds(
                geminiError
              ),

            ...summaryBefore,
          },
          {
            status: 429,
          }
        );
      }

      throw geminiError;
    }

    // ========================================================
    // PARSE
    // ========================================================

    const raw =
      safeText(
        interaction
          .output_text
      );

    if (!raw) {
      throw new Error(
        "Gemini returned an empty V2 result."
      );
    }

    let parsed:
      any;

    try {
      parsed =
        JSON.parse(raw);
    } catch {
      console.error(
        raw.slice(
          -5000
        )
      );

      throw new Error(
        "Gemini returned invalid V2 JSON. Nothing from this batch was saved."
      );
    }

    if (
      !Array.isArray(
        parsed?.results
      )
    ) {
      throw new Error(
        "Gemini V2 results array missing."
      );
    }

    // ========================================================
    // VERIFY EVERY ID
    // ========================================================

    const expectedIds =
      new Set(
        selectedPhotos.map(
          (photo) =>
            photo.id
        )
      );

    const resultMap =
      new Map<
        string,
        any
      >();

    for (
      const result of
      parsed.results
    ) {
      const id =
        safeText(
          result
            .photo_record_id
        );

      if (
        expectedIds.has(
          id
        )
      ) {
        resultMap.set(
          id,
          result
        );
      }
    }

    const missingIds =
      selectedPhotos
        .filter(
          (photo) =>
            !resultMap.has(
              photo.id
            )
        )
        .map(
          (photo) =>
            photo.id
        );

    if (
      missingIds.length >
      0
    ) {
      throw new Error(
        `Gemini omitted ${missingIds.length} V2 photograph result(s). Batch was not saved.`
      );
    }

    // ========================================================
    // SAVE
    // ========================================================

    for (
      const photo of
      selectedPhotos
    ) {
      const result =
        resultMap.get(
          photo.id
        );

      if (!result) {
        continue;
      }

      const section =
        photo.section_id
          ? sectionMap.get(
              photo.section_id
            )
          : undefined;

      const roomName =
        safeText(
          section
            ?.room_name
        );

      const sectionName =
        safeText(
          section
            ?.section_name
        );

      const general =
        isGeneralSection(
          sectionName
        );

      const oldAnalysis =
        parseObject(
          photo.ai_analysis
        );

      let captionType =
        safeText(
          result.caption_type
        );

      let descriptionLines =
        safeArray(
          result
            .description_lines
        );

      let conditionLines =
        safeArray(
          result
            .condition_lines
        );

      let cleanlinessLines =
        safeArray(
          result
            .cleanliness_lines
        );

      let damageLines =
        safeArray(
          result
            .damage_lines
        );

      let damageFound =
        safeBoolean(
          result
            .damage_found
        );

      // ------------------------------------------------------
      // ENFORCE GENERAL VIEW RULE IN CODE
      // ------------------------------------------------------

      if (general) {
        captionType =
          "general_view";

        descriptionLines = [
          INVENTORY_V2
            .generalCaption,
        ];

        conditionLines =
          [];

        cleanlinessLines =
          [];

        damageLines =
          [];

        damageFound =
          false;
      }

      // ------------------------------------------------------
      // SUPPORT CAPTION NORMALISATION
      // ------------------------------------------------------

      if (
        captionType ===
        "additional_image"
      ) {
        descriptionLines = [
          INVENTORY_V2
            .additionalImageCaption,
        ];
      }

      if (
        captionType ===
        "as_above"
      ) {
        descriptionLines = [
          INVENTORY_V2
            .asAboveCaption,
        ];
      }

      if (
        captionType ===
          "internal_view" &&
        descriptionLines.length ===
          0
      ) {
        descriptionLines = [
          INVENTORY_V2
            .internalViewCaption,
        ];
      }

      const confidence =
        Math.max(
          0,
          Math.min(
            100,
            safeNumber(
              result
                .confidence
            )
          )
        );

      const v2 = {
        completed:
          true,

        version:
          INVENTORY_V2_VERSION,

        model:
          INVENTORY_V2.model,

        analysed_at:
          new Date()
            .toISOString(),

        room_name:
          roomName,

        section_name:
          sectionName,

        caption_type:
          captionType,

        description_lines:
          descriptionLines,

        condition_lines:
          conditionLines,

        cleanliness_lines:
          cleanlinessLines,

        damage_found:
          damageFound,

        damage_lines:
          damageLines,

        brand:
          safeText(
            result.brand
          ),

        model_number:
          safeText(
            result.model
          ),

        // Keep "model" too so old/new renderer code can read it.
        model:
          safeText(
            result.model
          ),

        count_details:
          safeArray(
            result
              .count_details
          ),

        confidence,

        meter_type:
          safeText(
            result
              .meter_type
          ),

        meter_reading:
          safeText(
            result
              .meter_reading
          ),

        meter_unit:
          safeText(
            result
              .meter_unit
          ),

        meter_serial_number:
          safeText(
            result
              .meter_serial_number
          ),

        meter_balance:
          safeText(
            result
              .meter_balance
          ).replace(
            /^£/,
            ""
          ),

        meter_rate_1:
          safeText(
            result
              .meter_rate_1
          ),

        meter_rate_2:
          safeText(
            result
              .meter_rate_2
          ),
      };

      const newAnalysis = {
        ...oldAnalysis,

        inventory_v2:
          v2,
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
            ai_analysis:
              newAnalysis,
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
          `Could not save V2 photo ${photo.id}: ${saveError.message}`
        );
      }
    }

    // ========================================================
    // REFRESH PHOTOS
    // ========================================================

    const {
      data:
        refreshedData,
      error:
        refreshError,
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
      refreshError
    ) {
      throw new Error(
        refreshError.message
      );
    }

    const refreshedPhotos =
      (
        refreshedData ||
        []
      ) as PhotoRecord[];

    const summaryAfter =
      buildSummary(
        refreshedPhotos
      );

    // ========================================================
    // REPORT OVERVIEW
    // ========================================================

    const currentOverview =
      parseObject(
        report.overview
      );

    const {
      error:
        overviewError,
    } =
      await supabase
        .from(
          "ai_reports"
        )
        .update({
          overview: {
            ...currentOverview,

            inventory_v2:
              summaryAfter,
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
      overviewError
    ) {
      throw new Error(
        overviewError.message
      );
    }

    console.log(
      `V2 batch SAVED ✓`
    );

    console.log(
      `Progress: ${summaryAfter.completed_photos}/${summaryAfter.total_real_photos} (${summaryAfter.progress_percent}%)`
    );

    console.log(
      `Damage photos: ${summaryAfter.damage_photo_count}`
    );

    console.log(
      `Cleaning issues: ${summaryAfter.cleaning_issue_photo_count}`
    );

    console.log(
      `Exact models: ${summaryAfter.exact_model_count}`
    );

    console.log(
      `Additional images: ${summaryAfter.additional_image_count}`
    );

    console.log(
      `Meters: ${JSON.stringify(summaryAfter.meters)}`
    );

    return NextResponse.json({
      ok: true,

      done:
        summaryAfter.completed,

      batch_photo_count:
        selectedPhotos.length,

      ...summaryAfter,
    });
  } catch (
    error
  ) {
    console.error(
      "Inventory V2 error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown V2 error.",
      },
      {
        status: 500,
      }
    );
  }
}