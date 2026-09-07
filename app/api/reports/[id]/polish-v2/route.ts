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

const REFINEMENT_VERSION =
  "right-inventories-refinement-v3.0";

const MAX_PHOTOS_PER_BATCH = 32;
const MAX_RAW_IMAGE_BYTES = 14_000_000;

// ============================================================
// HELPERS
// ============================================================

function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function objectValue(value: unknown): any {
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

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => text(item))
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = text(value);

    if (!cleaned) {
      continue;
    }

    const key =
      cleaned.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

function sectionNeedsVisualRefinement(
  sectionName: string
): boolean {
  const name =
    sectionName.toLowerCase();

  return (
    name.includes("appliances") ||
    name.includes("built in storage") ||
    name.includes("walls and skirting") ||
    name.includes("shelving and units") ||
    name.includes("suites") ||
    name.includes("sockets and switches") ||
    name.includes("worktop") ||
    name.includes("flooring")
  );
}

function isGeneral(
  sectionName: string
) {
  return sectionName
    .toLowerCase()
    .startsWith("general");
}

function isSockets(
  sectionName: string
) {
  return sectionName
    .toLowerCase()
    .includes(
      "sockets and switches"
    );
}

function isKitchenUnits(
  sectionName: string
) {
  const name =
    sectionName.toLowerCase();

  return (
    name.includes(
      "shelving and units"
    ) ||
    name.includes(
      "kitchen unit"
    )
  );
}

function sanitizeLine(
  value: string
): string {
  let result =
    text(value);

  result =
    result.replace(
      /^close[\s-]*up view(?:\s+of)?\s*/i,
      ""
    );

  result =
    result.replace(
      /^close[\s-]*up\s*/i,
      ""
    );

  return result.trim();
}

function isFunctionalLine(
  value: string
) {
  const line =
    value.toLowerCase();

  return (
    line.includes(
      "light is in working order"
    ) ||
    line.includes(
      "light is not working"
    ) ||
    line.includes(
      "fan and light are in working order"
    ) ||
    line.includes(
      "fan is in working order"
    ) ||
    line.includes(
      "not working"
    )
  );
}

function isGenericCondition(
  value: string
) {
  const line =
    value.toLowerCase();

  return (
    line.includes(
      "good condition"
    ) ||
    line.includes(
      "good overall condition"
    ) ||
    line.includes(
      "good used condition"
    ) ||
    line.includes(
      "fair condition"
    ) ||
    line.includes(
      "poor condition"
    ) ||
    line.includes(
      "aged condition"
    ) ||
    line.includes(
      "used condition"
    ) ||
    line.includes(
      "functional order"
    )
  );
}

function isRateLimit(error: any) {
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

function retrySeconds(error: any) {
  const message =
    String(
      error?.message ||
        error?.error?.message ||
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
    ? Math.ceil(seconds) + 5
    : 60;
}

// ============================================================
// GEMINI SCHEMA
// ============================================================

const schema: any = {
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

          item_key: {
            type: "string",
          },

          caption_type: {
            type: "string",

            enum: [
              "full_description",
              "additional_image",
              "as_above",
              "internal_view",
              "model",
              "specific_detail",
              "specific_defect",
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

          damage_lines: {
            type: "array",

            items: {
              type: "string",
            },
          },

          confidence: {
            type: "integer",
          },
        },

        required: [
          "photo_record_id",
          "item_key",
          "caption_type",
          "description_lines",
          "condition_lines",
          "cleanliness_lines",
          "damage_lines",
          "confidence",
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

function buildPrompt(metadata: any[]) {
  return `
You are correcting the FINAL photographic wording for a
professional Right Inventories UK inventory report.

You are NOT writing generic AI image captions.

There is one attached photograph for every metadata object,
in the same order.

PHOTO METADATA:

${JSON.stringify(metadata, null, 2)}

Return EXACTLY one result for every supplied photo_record_id.

============================================================
OVERALL RIGHT INVENTORIES STYLE
============================================================

Keep the report SHORT.

Do not describe everything visible in every image.

Usually one photograph introduces the item.

The next photographs should normally be:

Additional image

unless they show:

- a different item
- a different colour / finish
- an important internal view
- a model label
- a new permanent fitting
- a new defect
- a different cleanliness problem
- a useful functional detail

DO NOT repeat the same condition on every photograph.

DO NOT repeat the same shelf/rack count on several photographs.

DO NOT write:

Close-up view
Close-up view of
Detailed view
Image showing
Photograph showing

============================================================
CONDITION
============================================================

Do not overuse:

Poor condition
Fair condition
Good condition

Condition normally belongs on the FIRST useful photograph of
the item.

Later photographs normally do not need a generic condition
unless the condition is materially different.

Specific damage is more useful than repeating "Poor condition".

============================================================
APPLIANCE MODEL LABELS
============================================================

This rule is ABSOLUTE.

If a manufacturer sticker/data plate is clearly photographed,
read ONLY THE EXACT MODEL NUMBER.

The report line must be:

Model XXXXX

Example:

Model WTK84151W

DO NOT output:

Beko model
Brand name before model
SN
S/N
Serial number
Product number
Product code
PNC
GC number
Barcode
Voltage
Wattage
Certification numbers

For appliance label photographs the report needs MODEL ONLY.

Do not guess any character.

If the model cannot definitely be read:

description_lines = ["Additional image"]

============================================================
WASHING MACHINE
============================================================

Main photograph:

White washing machine
Good condition

or equivalent concise colour/type description.

Internal/open-door photographs should only describe something
useful if visible.

A manufacturer sticker photograph should contain only:

Model XXXXX

============================================================
OVEN
============================================================

The first external photograph should identify the oven.

Example:

Built-in stainless steel oven with glass door
Good overall condition
Needs cleaning

Internal view:

Internal view
2x chrome wire shelves
Needs cleaning

IMPORTANT:

State the shelf/rack count ONCE ONLY.

If another photograph also shows the same two wire shelves,
DO NOT repeat:

2x chrome wire shelves

Use:

Additional image

unless it shows something different.

If oven vents / ventilation slots / air vents are clearly visible,
record them concisely on the photograph that best shows them:

Air vents

Do not miss visible air vents.

If a photograph specifically shows heavy grease / burnt residue,
use:

Heavy grease build-up
Needs cleaning

Do not repeat that same finding over multiple photographs.

============================================================
FRIDGE / FREEZER
============================================================

Choose the BEST photograph showing the whole fridge interior.

That photograph should carry the useful complete count.

Example:

Internal view
3x glass shelves and 2x salad boxes
Good condition
Light is in working order

Count what is CLEARLY visible.

Prefer one combined count on the best whole internal photograph.

Do not write:

Internal view
3 glass shelves

on one photograph and then repeat the shelves again later if
the complete view already establishes the quantity.

Door shelves may be recorded separately only when a photograph
specifically documents them.

Freezer drawers may be recorded separately when clearly shown.

LIGHT RULE:

If the refrigerator/freezer internal light is visibly illuminated:

Light is in working order

If it is clearly not illuminated in an open appliance and the
light fitting is visibly expected to illuminate:

Light is not working

Do not invent either statement when the photograph genuinely
cannot establish it.

============================================================
EXTRACTOR HOOD / APPLIANCE LIGHTS
============================================================

If a fan or light is visibly operating:

Fan and light are in working order

or:

Light is in working order

Do not repeat the same working-status statement in several
photographs of the same appliance.

============================================================
BUILT-IN STORAGE
============================================================

Normal cupboard exterior:

describe the door/cupboard once.

Normal cupboard interior:

Internal view

That is normally enough.

DO NOT count ordinary cupboard shelves unless there is a
specific reason to record them.

IMPORTANT EXCEPTION:

If permanent utility equipment is inside the cupboard, identify
it concisely.

For a photograph showing BOTH gas and electric meters and the
fuse box, the wording should be:

Internal view
Gas and electric meter inside
Fuses box inside

If only one meter is visible, describe only what is visible.

Other permanent items such as a water tank, boiler or timer
may also be briefly identified.

Do not describe random possessions stored inside.

============================================================
KITCHEN CABINETS / SHELVING AND UNITS
============================================================

The FIRST useful external photograph should describe the whole
cabinet set.

Preferred style:

Wood effect laminated kitchen cabinets with silver metal pull handles
Good and functional order
Needs light cleaning in places

After that:

- repeated exterior cabinet views = Additional image
- cabinet interiors = Internal view
- DO NOT count ordinary cabinet shelves
- unique damage = describe only that damage
- different coloured/type cabinet = describe the change

Do not repeat:

Good and functional order

on every cabinet photograph.

============================================================
SINK / SUITES
============================================================

Keep sink wording concise.

Preferred style:

Stainless steel single bowl sink with chrome mixer tap and drainer
Needs cleaning

Avoid unnecessary wording such as:

deck-mounted
Fair condition
Light surface scratches inside basin
minor surface scratching

unless the issue is unusually significant and clearly needs
recording.

Limescale should only be separately mentioned when it is
materially obvious / significant.

============================================================
SOCKETS AND SWITCHES
============================================================

First useful photograph:

White plastic light switch and sockets, as photographed
All are in good condition

If silver:

Silver metal light switch and sockets, as photographed
All are in good condition

After the first representative photograph:

Additional image

unless:

- finish/colour changes
- a socket/switch is damaged
- painted over
- marked
- cracked
- otherwise materially different

============================================================
WALLS AND SKIRTING
============================================================

The section is primarily about:

walls
skirting
permanent fittings fixed to the walls

Do not describe unrelated furniture merely visible in the shot.

HOWEVER, do NOT ignore relevant permanent wall-mounted items.

Examples which MAY be recorded in Walls and skirting:

Black laminated wall mounted shelf
Aged

White plastic air vent

Metal rail attached to wall

Hooks attached

Screws / fixing holes

Door stopper attached to wall/skirting

Your job is to recognise these permanent wall-mounted items
when clearly photographed.

A black laminated wall-mounted shelf should NOT be omitted just
because this is the Walls section.

============================================================
FLOORING
============================================================

One main flooring photograph should identify the flooring and
overall condition.

Example:

Wood effect laminate flooring
Used condition

Then record genuinely visible problems separately:

Gaps between boards

Lifting to edges

Heavy wear

Staining

Do not repeat the flooring description and condition on every
image.

============================================================
WORKTOP
============================================================

One main description:

Grey stone effect laminate worktop

or equivalent.

Condition/cleaning once.

Later images:

Additional image

unless they show a new stain, burn, chip, swelling or other
important defect.

============================================================
ADDITIONAL IMAGE
============================================================

Use Additional image aggressively for genuine repetition.

But NEVER use Additional image when the photograph contains
important new information such as:

- exact appliance model label
- permanent wall-mounted shelf
- meter/fuse box inside cupboard
- unique appliance internal configuration
- oven air vents
- new damage
- different cabinet finish
- working appliance light
- useful complete fridge shelf/drawer count

============================================================
OUTPUT
============================================================

item_key must identify the same physical item consistently.

Examples:

washing_machine
oven
fridge_freezer
kitchen_cabinets
sink
worktop
walls
wall_shelf
sockets
meter_cupboard

description_lines:
actual report description only.

condition_lines:
normally maximum ONE generic condition line per item.
A working-status line may also appear here.

cleanliness_lines:
normally maximum ONE cleaning line per item.

damage_lines:
only genuinely useful unique defects.

Return JSON only.
`;
}

// ============================================================
// FINAL LOCAL DE-DUPLICATION
// ============================================================

function compactResults(
  photos: any[],
  sectionMap: Map<string, any>
) {
  const groups =
    new Map<string, any[]>();

  for (const photo of photos) {
    const key =
      photo.section_id ||
      "unknown";

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key)!.push(photo);
  }

  const updates: any[] = [];

  for (
    const [
      sectionId,
      sectionPhotos,
    ] of groups.entries()
  ) {
    sectionPhotos.sort(
      (a, b) =>
        Number(a.sort_order || 0) -
        Number(b.sort_order || 0)
    );

    const section =
      sectionMap.get(
        sectionId
      );

    const sectionName =
      text(
        section?.section_name
      );

    const seenDescriptions =
      new Map<
        string,
        Set<string>
      >();

    const conditionWritten =
      new Set<string>();

    const cleaningWritten =
      new Set<string>();

    const damageSeen =
      new Map<
        string,
        Set<string>
      >();

    let socketsMainWritten =
      false;

    let unitsMainWritten =
      false;

    for (
      const photo of
      sectionPhotos
    ) {
      const analysis =
        objectValue(
          photo.ai_analysis
        );

      const v2 =
        objectValue(
          analysis.inventory_v2
        );

      if (
        isGeneral(sectionName)
      ) {
        updates.push({
          id: photo.id,

          analysis: {
            ...analysis,

            inventory_v2: {
              ...v2,

              caption_type:
                "general_view",

              description_lines: [
                "General view",
              ],

              condition_lines: [],
              cleanliness_lines: [],
              damage_lines: [],
              damage_found: false,
            },
          },
        });

        continue;
      }

      let description =
        textArray(
          v2.description_lines
        )
          .map(sanitizeLine)
          .filter(Boolean);

      let conditions =
        textArray(
          v2.condition_lines
        )
          .map(sanitizeLine)
          .filter(Boolean);

      let cleanliness =
        textArray(
          v2.cleanliness_lines
        )
          .map(sanitizeLine)
          .filter(Boolean);

      let damage =
        textArray(
          v2.damage_lines
        )
          .map(sanitizeLine)
          .filter(Boolean);

      const itemKey =
        text(
          v2.item_key
        ) ||
        lower(
          description[0]
        ) ||
        "item";

      // ------------------------------------------------------
      // APPLIANCE MODEL PHOTO
      // ------------------------------------------------------

      if (
        v2.caption_type ===
        "model"
      ) {
        const modelLine =
          description.find(
            (line) =>
              /^Model\s+/i.test(
                line
              )
          );

        description =
          modelLine
            ? [
                modelLine,
              ]
            : [
                "Additional image",
              ];

        conditions = [];
        cleanliness = [];
        damage = [];

        updates.push({
          id: photo.id,

          analysis: {
            ...analysis,

            inventory_v2: {
              ...v2,

              description_lines:
                description,

              condition_lines: [],
              cleanliness_lines: [],
              damage_lines: [],
              damage_found: false,

              // Prevent renderer adding model again.
              model: "",
              model_number: "",
            },
          },
        });

        continue;
      }

      // ------------------------------------------------------
      // SOCKETS
      // ------------------------------------------------------

      if (
        isSockets(
          sectionName
        )
      ) {
        if (
          !socketsMainWritten &&
          v2.caption_type !==
            "additional_image"
        ) {
          socketsMainWritten =
            true;
        } else if (
          damage.length === 0
        ) {
          description = [
            "Additional image",
          ];

          conditions = [];
          cleanliness = [];
        }
      }

      // ------------------------------------------------------
      // KITCHEN CABINET EXTERIORS
      // ------------------------------------------------------

      if (
        isKitchenUnits(
          sectionName
        )
      ) {
        const internal =
          description.some(
            (line) =>
              lower(line) ===
              "internal view"
          );

        if (internal) {
          description = [
            "Internal view",
          ];

          conditions = [];
          cleanliness = [];

          // Keep a genuinely important cabinet defect only.
          damage =
            damage.slice(
              0,
              1
            );
        } else if (
          !unitsMainWritten &&
          v2.caption_type !==
            "additional_image"
        ) {
          unitsMainWritten =
            true;
        } else if (
          damage.length === 0
        ) {
          description = [
            "Additional image",
          ];

          conditions = [];
          cleanliness = [];
        }
      }

      // ------------------------------------------------------
      // EXACT DESCRIPTION DUPLICATES
      // ------------------------------------------------------

      if (
        description[0] !==
          "Additional image" &&
        description[0] !==
          "Internal view"
      ) {
        if (
          !seenDescriptions.has(
            itemKey
          )
        ) {
          seenDescriptions.set(
            itemKey,
            new Set()
          );
        }

        const seen =
          seenDescriptions.get(
            itemKey
          )!;

        description =
          description.filter(
            (line) => {
              const key =
                lower(line);

              // Model lines are deliberately unique.
              if (
                /^model\s+/i.test(
                  line
                )
              ) {
                return true;
              }

              if (
                seen.has(key)
              ) {
                return false;
              }

              seen.add(key);

              return true;
            }
          );
      }

      // ------------------------------------------------------
      // GENERIC CONDITION ONCE PER PHYSICAL ITEM
      // ------------------------------------------------------

      const functionalLines =
        conditions.filter(
          isFunctionalLine
        );

      const genericConditions =
        conditions.filter(
          (line) =>
            !isFunctionalLine(
              line
            )
        );

      if (
        conditionWritten.has(
          itemKey
        )
      ) {
        conditions =
          functionalLines;
      } else if (
        genericConditions.length >
        0
      ) {
        conditionWritten.add(
          itemKey
        );

        conditions = [
          genericConditions[0],
          ...functionalLines,
        ];
      } else {
        conditions =
          functionalLines;
      }

      // ------------------------------------------------------
      // CLEANING ONCE PER ITEM
      // ------------------------------------------------------

      if (
        cleaningWritten.has(
          itemKey
        )
      ) {
        cleanliness = [];
      } else if (
        cleanliness.length >
        0
      ) {
        cleaningWritten.add(
          itemKey
        );

        cleanliness =
          cleanliness.slice(
            0,
            1
          );
      }

      // ------------------------------------------------------
      // UNIQUE DAMAGE ONLY
      // ------------------------------------------------------

      if (
        !damageSeen.has(
          itemKey
        )
      ) {
        damageSeen.set(
          itemKey,
          new Set()
        );
      }

      const damageSet =
        damageSeen.get(
          itemKey
        )!;

      damage =
        damage.filter(
          (line) => {
            const key =
              lower(line);

            if (
              damageSet.has(
                key
              )
            ) {
              return false;
            }

            damageSet.add(
              key
            );

            return true;
          }
        )
        .slice(
          0,
          2
        );

      // ------------------------------------------------------
      // EMPTY SUPPORT PHOTO
      // ------------------------------------------------------

      if (
        description.length ===
          0 &&
        conditions.length ===
          0 &&
        cleanliness.length ===
          0 &&
        damage.length ===
          0
      ) {
        description = [
          "Additional image",
        ];
      }

      updates.push({
        id: photo.id,

        analysis: {
          ...analysis,

          inventory_v2: {
            ...v2,

            description_lines:
              unique(
                description
              ),

            condition_lines:
              unique(
                conditions
              ),

            cleanliness_lines:
              unique(
                cleanliness
              ),

            damage_lines:
              unique(
                damage
              ),

            damage_found:
              damage.length >
              0,

            // V3 places model text directly into description.
            model: "",
            model_number: "",
          },
        },
      });
    }
  }

  return updates;
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

    const supabase =
      await createClient();

    const {
      data: {
        user,
      },
    } =
      await supabase.auth.getUser();

    if (!user) {
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
      throw new Error(
        "Report not found."
      );
    }

    // ========================================================
    // SECTIONS
    // ========================================================

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

    if (sectionError) {
      throw sectionError;
    }

    const sectionMap =
      new Map();

    for (
      const section of
      sections || []
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
          report_id,
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
            ascending: true,
          }
        );

    if (photoError) {
      throw photoError;
    }

    const realPhotos =
      (
        photoData || []
      ).filter(
        (photo: any) => {
          const analysis =
            objectValue(
              photo.ai_analysis
            );

          const extraction =
            objectValue(
              analysis
                .image_extraction
            );

          const v2 =
            objectValue(
              analysis.inventory_v2
            );

          return (
            photo
              .include_in_report !==
              false &&
            extraction.status ===
              "extracted" &&
            Boolean(
              text(
                extraction
                  .storage_path
              )
            ) &&
            v2.completed === true &&
            v2.version ===
              INVENTORY_V2_VERSION
          );
        }
      );

    if (
      realPhotos.length ===
      0
    ) {
      throw new Error(
        "No completed V2 photographs found."
      );
    }

    // ========================================================
    // PHOTOS REQUIRING TARGETED VISUAL RECHECK
    // ========================================================

    const targetPhotos =
      realPhotos.filter(
        (photo: any) => {
          const section =
            sectionMap.get(
              photo.section_id
            );

          return (
            sectionNeedsVisualRefinement(
              text(
                section
                  ?.section_name
              )
            )
          );
        }
      );

    const pending =
      targetPhotos.filter(
        (photo: any) => {
          const analysis =
            objectValue(
              photo.ai_analysis
            );

          const v2 =
            objectValue(
              analysis.inventory_v2
            );

          return (
            v2.refinement_version !==
            REFINEMENT_VERSION
          );
        }
      );

    // ========================================================
    // VISUAL REFINEMENT BATCH
    // ========================================================

    if (
      pending.length >
      0
    ) {
      const selected: any[] =
        [];

      const metadata: any[] =
        [];

      const imageParts: any[] =
        [];

      let rawBytes = 0;

      for (
        const photo of
        pending
      ) {
        if (
          selected.length >=
          MAX_PHOTOS_PER_BATCH
        ) {
          break;
        }

        const analysis =
          objectValue(
            photo.ai_analysis
          );

        const extraction =
          objectValue(
            analysis
              .image_extraction
          );

        const oldV2 =
          objectValue(
            analysis.inventory_v2
          );

        const storagePath =
          text(
            extraction
              .storage_path
          );

        if (!storagePath) {
          continue;
        }

        const {
          data: blob,
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
          !blob
        ) {
          continue;
        }

        const buffer =
          Buffer.from(
            await blob
              .arrayBuffer()
          );

        if (
          selected.length >
            0 &&
          rawBytes +
            buffer.length >
            MAX_RAW_IMAGE_BYTES
        ) {
          break;
        }

        rawBytes +=
          buffer.length;

        const section =
          sectionMap.get(
            photo.section_id
          );

        selected.push(
          photo
        );

        metadata.push({
          image_number:
            selected.length,

          photo_record_id:
            photo.id,

          room_name:
            text(
              section?.room_name
            ),

          section_name:
            text(
              section
                ?.section_name
            ),

          current_description:
            textArray(
              oldV2
                .description_lines
            ),

          current_condition:
            textArray(
              oldV2
                .condition_lines
            ),

          current_cleanliness:
            textArray(
              oldV2
                .cleanliness_lines
            ),

          current_damage:
            textArray(
              oldV2
                .damage_lines
            ),
        });

        imageParts.push(
          {
            type: "text",

            text:
              `IMAGE ${selected.length} - ${photo.id}`,
          },

          {
            type: "image",

            data:
              buffer.toString(
                "base64"
              ),

            mime_type:
              blob.type ||
              "image/png",
          }
        );
      }

      if (
        selected.length ===
        0
      ) {
        throw new Error(
          "Could not prepare refinement images."
        );
      }

      const ai =
        new GoogleGenAI({});

      let interaction: any;

      try {
        interaction =
          await ai.interactions.create({
            model:
              INVENTORY_V2.model,

            input: [
              {
                type: "text",

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

              schema,
            },

            generation_config: {
              thinking_level:
                "medium",

              max_output_tokens:
                16000,
            },

            store: false,
          });
      } catch (
        error: any
      ) {
        if (
          isRateLimit(error)
        ) {
          return NextResponse.json(
            {
              ok: false,

              quota_limited:
                true,

              retry_after_seconds:
                retrySeconds(
                  error
                ),

              phase:
                "visual_refinement",

              remaining:
                pending.length,
            },
            {
              status: 429,
            }
          );
        }

        throw error;
      }

      const raw =
        text(
          interaction
            .output_text
        );

      if (!raw) {
        throw new Error(
          "Gemini returned no refinement data."
        );
      }

      let parsed: any;

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
          "Gemini returned invalid refinement JSON."
        );
      }

      if (
        !Array.isArray(
          parsed.results
        )
      ) {
        throw new Error(
          "Refinement results missing."
        );
      }

      const resultMap =
        new Map();

      for (
        const result of
        parsed.results
      ) {
        resultMap.set(
          text(
            result
              .photo_record_id
          ),
          result
        );
      }

      for (
        const photo of
        selected
      ) {
        const result =
          resultMap.get(
            photo.id
          );

        if (!result) {
          throw new Error(
            `Gemini omitted photograph ${photo.id}.`
          );
        }

        const analysis =
          objectValue(
            photo.ai_analysis
          );

        const oldV2 =
          objectValue(
            analysis.inventory_v2
          );

        const descriptions =
          textArray(
            result
              .description_lines
          )
            .map(
              sanitizeLine
            )
            .filter(Boolean);

        const conditions =
          textArray(
            result
              .condition_lines
          )
            .map(
              sanitizeLine
            )
            .filter(Boolean);

        const cleanliness =
          textArray(
            result
              .cleanliness_lines
          )
            .map(
              sanitizeLine
            )
            .filter(Boolean);

        const damage =
          textArray(
            result
              .damage_lines
          )
            .map(
              sanitizeLine
            )
            .filter(Boolean);

        const newV2 = {
          ...oldV2,

          refinement_version:
            REFINEMENT_VERSION,

          refined_at:
            new Date()
              .toISOString(),

          item_key:
            text(
              result.item_key
            ) ||
            "item",

          caption_type:
            text(
              result
                .caption_type
            ),

          description_lines:
            descriptions,

          condition_lines:
            conditions,

          cleanliness_lines:
            cleanliness,

          damage_lines:
            damage,

          damage_found:
            damage.length > 0,

          confidence:
            Number(
              result.confidence
            ) || 0,

          // Appliance model is now written directly as:
          // Model WTK84151W
          model: "",
          model_number: "",
          count_details: [],
        };

        const newAnalysis = {
          ...analysis,

          inventory_v2_before_refinement:
            objectValue(
              analysis
                .inventory_v2_before_refinement
            ),

          inventory_v2:
            newV2,
        };

        if (
          Object.keys(
            newAnalysis
              .inventory_v2_before_refinement
          ).length === 0
        ) {
          newAnalysis.inventory_v2_before_refinement =
            oldV2;
        }

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
          throw saveError;
        }
      }

      return NextResponse.json({
        ok: true,

        done: false,

        phase:
          "visual_refinement",

        batch:
          selected.length,

        remaining:
          Math.max(
            0,
            pending.length -
              selected.length
          ),

        target_total:
          targetPhotos.length,
      });
    }

    // ========================================================
    // ALL TARGETED VISUAL CHECKS COMPLETE.
    // NOW APPLY FREE LOCAL DE-DUPLICATION TO WHOLE REPORT.
    // ========================================================

    const updates =
      compactResults(
        realPhotos,
        sectionMap
      );

    for (
      let start = 0;
      start <
      updates.length;
      start += 30
    ) {
      const batch =
        updates.slice(
          start,
          start + 30
        );

      const results =
        await Promise.all(
          batch.map(
            async (
              update
            ) => {
              const {
                error,
              } =
                await supabase
                  .from(
                    "ai_report_photos"
                  )
                  .update({
                    ai_analysis:
                      update
                        .analysis,
                  })
                  .eq(
                    "id",
                    update.id
                  )
                  .eq(
                    "report_id",
                    reportId
                  );

              return error;
            }
          )
        );

      const failed =
        results.find(
          Boolean
        );

      if (failed) {
        throw failed;
      }
    }

    // ========================================================
    // REMOVE OLD FINAL OVERVIEW
    // It must be rebuilt from corrected text.
    // ========================================================

    const oldOverview =
      objectValue(
        report.overview
      );

    const {
      inventory_v2_final:
        _removeOldFinal,

      ...overviewWithoutFinal
    } =
      oldOverview;

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
            ...overviewWithoutFinal,

            inventory_style_v3: {
              completed: true,

              version:
                REFINEMENT_VERSION,

              completed_at:
                new Date()
                  .toISOString(),

              total_real_photos:
                realPhotos.length,

              visually_rechecked_photos:
                targetPhotos.length,
            },
          },

          status:
            "v3_refined",

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
      throw reportSaveError;
    }

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "RIGHT INVENTORIES V3 REFINEMENT COMPLETE"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `Total report photographs: ${realPhotos.length}`
    );

    console.log(
      `Visually rechecked: ${targetPhotos.length}`
    );

    return NextResponse.json({
      ok: true,

      done: true,

      phase:
        "complete",

      total_real_photos:
        realPhotos.length,

      visually_rechecked_photos:
        targetPhotos.length,
    });
  } catch (error) {
    console.error(
      "V3 report refinement error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Report refinement failed.",
      },
      {
        status: 500,
      }
    );
  }
}