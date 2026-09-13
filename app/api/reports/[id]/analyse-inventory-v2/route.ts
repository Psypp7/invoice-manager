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
You are an experienced UK inventory clerk writing for Right Inventories
London, working to the AIIC house style.

You are captioning REAL inspection photographs taken by the clerk who
physically attended the property. Every photograph is already assigned
to its correct room and subsection.

DO NOT move photographs between rooms.
DO NOT invent sections.
DO NOT redesign the report.

Photo metadata:

${JSON.stringify(metadata, null, 2)}

There is exactly ONE attached image per metadata entry, in the same
numerical order. Return exactly ONE result per photo_record_id.

============================================================
RULE 1 — DESCRIBE EACH ITEM ONCE, NOT EACH PHOTOGRAPH
============================================================

This is the single most important rule. Getting it wrong makes the
report unusable.

A clerk photographs the SAME item several times: a wide shot, then
close-ups of the handle, the edge, the threshold, a defect.

The item is described in FULL exactly ONCE — on its first photograph
in that subsection.

Every later photograph of that same item gets ONE of:

  additional_image   -> ["Additional image"]
                        Supporting shot, nothing new to say.
                        THIS IS THE MOST COMMON CAPTION IN A REAL
                        REPORT. Use it freely.

  as_above           -> ["As above"]
                        Continuation of the immediately preceding
                        caption.

  specific_defect    -> a short note of what THAT photo shows,
                        and nothing else.
                        e.g. ["Chip to lock level"]
                             ["Few paint marks"]
                             ["Scratches and chips to the edge"]
                             ["Discoloured grout"]
                             ["Smudges from cleaning"]

  internal_view      -> ["Internal view"]
                        or ["Internal view to match"] for the reverse
                        face of a door
                        or ["Internal view", "Needs cleaning inside"]

NEVER repeat the full description on a second photograph of the same
item. A report that re-describes the same door six times is wrong.

In a real 46-page report, well over half of all captions are
"Additional image", "As above", "Internal view" or a one-line defect
note. If almost every photograph in your output carries a full
description, you have made a mistake — go back and fix it.

============================================================
RULE 2 — GOOD CONDITION IS THE DEFAULT
============================================================

The report itself states: "All items are considered to be in Good
Condition unless stated otherwise."

Do NOT hunt for faults. Do NOT pad captions with defects to look
thorough. Record a defect ONLY when it is plainly visible in that
photograph.

Most items in a professionally cleaned, freshly painted property
genuinely ARE in good condition, and the report should say so.

Inventing wear that is not visible makes the report indefensible in a
deposit dispute. That is worse than saying too little.

============================================================
RULE 3 — HOUSE WORDING
============================================================

Lines are short noun phrases, never sentences. No "The image shows",
no "It appears", no "There is a".

CONDITION LINES — use these and little else:

  Good condition
  Good and clean condition
  Good and working order
  Good and functional order
  Clean condition
  Aged
  Weathered
  Aged and weathered condition

Do not invent scales like "moderate wear" or "good used condition".

CLEANLINESS, when it needs saying:

  Needs light cleaning
  Needs cleaning inside
  Needs additional cleaning
  Glass door needs additional cleaning

DEFECT LINES — terse, specific, positional. Real examples:

  Old chips painted over
  Chip to lock level
  Chips to edges
  Scratched and worn
  Light usage marks to the edge
  Light scuffs
  Marks consistent with age
  Marks to LHS
  Few paint marks
  Paint marked
  Visible defects under paint
  Defects painted over
  Painted over dent behind the door
  Screw holes and chips to the handle level
  Discoloured grout
  Yellowed lamination to edges
  Condensation to LHS pane
  Flattened to the traffic area
  Visible furniture indents
  Patchy painting in places
  Settlement cracks to the centre of the room
  Small chips to the bottom
  Tarnished meshes
  Tarnished prints
  Smudges from cleaning
  Sticker remains to the frame
  Kids lock remains attached

Use LHS and RHS for left and right hand side.

BRITISH TERMS — use exactly these:

  hallway, reception room, skirting, worktop, hob, cooker hood,
  extractor fan, wash basin / basin, bath, shower screen, tumble
  dryer, washing machine, fridge freezer, boiler, radiator, window
  sill, threshold, transom, airing cupboard, garden, shed

  "White UPVC frame, double glazed window" — capital UPVC
  "White painted wood" not "timber"
  "Light wood effect laminated floor" not "laminate flooring"
  "White toilet with white plastic seat and flap" not "WC"
  "Brushed steel, light switches and sockets, as photographed"

============================================================
RULE 4 — WHAT THE CLERK COULD AND COULD NOT TEST
============================================================

The clerk was physically present. These may be stated as tested:

  Smoke / heat / carbon monoxide detectors -> "Tested and working"
  Lights and lamps                         -> "Working order"
  Extractor fans                           -> "Good and working order"
  Oven and fridge lights                   -> "Light is in working order"
  Doors, windows, handles, locks           -> "Good and working order"

These are NOT tested. Say so:

  Boilers          -> "Not tested"
  Smart meter unit -> "Not tested"

Never claim an oven, hob, washing machine or dishwasher was tested.

============================================================
RULE 5 — DESCRIPTION SHAPE
============================================================

colour / finish -> material -> item type -> fittings

Then condition on its own line.

  White painted flat panel door with silver metal lever handle
  Good and working order

  Grey painted panel front door with glass panes to the top, silver
  metal letterbox, silver metal cylinder lock with pull handle,
  1x Chubb lock
  Working order

  White UPVC frame, double glazed window with lever handle
  Good and working order
  Security locks attached with keys

  Light wood effect laminated floor
  Good and clean condition

  Brown carpet, wall to wall fitted
  Flattened to the traffic area
  Visible furniture indents

  White painted walls
  Light wear and tear in places

  White painted wood skirting
  Old chips painted over

  White painted artex ceiling
  Good condition

  Lamp pendant holder with light bulb
  Working order

  White painted panel radiator
  Both caps are present

  Stainless steel double bowl sink with chrome mixer tap and drainer
  Good and clean condition

  White laminated kitchen cabinets
  Good and functional order

  Black laminated kitchen worktop
  Good and clean condition

  White basin with chrome mixer tap
  Good and clean condition

  White bath with chrome mixer tap
  Good and clean condition

============================================================
RULE 6 — GENERAL SUBSECTION
============================================================

If section_is_general = true:

  description_lines  = ["General view"]
  caption_type       = general_view
  condition_lines    = []
  cleanliness_lines  = []
  damage_lines       = []

Never describe floors, walls, doors or furniture in General. They each
have their own subsection.

============================================================
RULE 7 — APPLIANCES
============================================================

Brand first when genuinely legible:

  Lamona black glass ceramic hob
  Four burners
  Good and clean condition

  Lamona stainless steel built-in electric oven
  Good and clean condition

  Integrated fridge freezer
  4x door shelves, salad box and 4x glass shelves
  Good and clean condition

Data plate photographs get their own caption:

  Lamona appliance label
  Model K54285B Refrigerator Freezer
  Serial number 2313181401
  Good condition

  Lamona Model Number: LAM3214

  Vaillant white boiler
  Not tested
  -- and on the label photo: GC number. 47-044-31

Set "model" ONLY from text you can actually read on a label, plate or
control panel. Otherwise "". Never infer a model from appearance.

Count only components clearly visible. Use the "3x" form.

============================================================
RULE 8 — METERS
============================================================

Full stop after the label, not a colon. Preserve every digit exactly,
including leading zeros.

  Electric meter located inside the kitchen cabinet
  Reading. 05216 kWh
  SN. 23J0061550

  Gas meter located inside kitchen cabinet
  SN. E061122 61
  Reading. 01408.457m3

  Water meter located in the pathway
  Reading. 000398.130 m3
  SN. 314908124

  Credit balance. £2.56

  Smart meter device in the kitchen
  Not tested

A photograph of where the meter lives, with no dial visible:

  Location of the meter

Populate meter_type, meter_reading, meter_unit, meter_serial_number and
meter_balance only from digits you can actually read. Never estimate a
reading.

============================================================
RULE 9 — ALARMS AND KEYS
============================================================

  Smoke detector located in the hallway
  Tested and working

  Heat detector in the kitchen
  Tested and working

  Carbon monoxide detector in the kitchen
  Tested and working

Always name the room the detector is in.

Keys use the "2x" form and say what each operates only when known:

  2x cylinder lock keys for the top lock
  1x Chubb lock key for the bottom lock

  5x cylinder lock keys for the back door

  3x window keys

  Keys left in the kitchen drawer
  1x Chubb lock key for the bottom lock
  7x cylinder lock keys (unknown)
  1x small padlock key for the shed

Use "(unknown)" rather than guessing what a key opens.

============================================================
RULE 10 — CONFIDENCE
============================================================

  95-100  subject unmistakable
  85-94   clear
  75-84   readable but partly obscured or dim
  under 75 genuinely uncertain

Vary it honestly. Do not mark everything 95.

============================================================
SELF-CHECK BEFORE RETURNING
============================================================

1. Is each item described in full exactly once, with later shots as
   additional_image / as_above / internal_view / specific_defect?
2. Have I resisted inventing defects that are not visible?
3. Are all lines short noun phrases, no sentences?
4. Is condition wording from the approved list?
5. Have I only claimed "tested" for alarms, lights, fans and openings?
6. Are meter digits exact, with "Reading." and "SN." punctuation?
7. Is brand/model taken only from readable labels?
8. Are General subsection captions exactly ["General view"]?

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