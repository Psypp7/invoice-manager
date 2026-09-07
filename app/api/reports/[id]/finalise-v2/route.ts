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
// HELPERS
// ============================================================

function text(
  value: unknown
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function numberValue(
  value: unknown
): number {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function objectValue(
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

function textArray(
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => text(item))
    .filter(Boolean);
}

function unique(
  values: string[]
): string[] {
  const seen =
    new Set<string>();

  const output:
    string[] = [];

  for (const value of values) {
    const cleaned =
      text(value);

    if (!cleaned) {
      continue;
    }

    const key =
      cleaned.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(cleaned);
  }

  return output;
}

function isMeterSection(
  room: string,
  section: string
): boolean {
  const value =
    `${room} ${section}`
      .toLowerCase();

  return (
    value.includes("meter reading") ||
    value.includes("electricity") ||
    value.includes("electric meter") ||
    value.includes("gas meter") ||
    value.includes("water meter")
  );
}

function isRateLimit(
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

function retrySeconds(
  error: any
): number {
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

  const number =
    Number(match[1]);

  return Number.isFinite(number)
    ? Math.ceil(number) + 5
    : 60;
}

// ============================================================
// FINAL JSON SCHEMA
// ============================================================

const finalSchema: any = {
  type: "object",

  properties: {
    meters: {
      type: "array",

      items: {
        type: "object",

        properties: {
          meter_type: {
            type: "string",
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
        },

        required: [
          "meter_type",
          "reading",
          "unit",
          "serial_number",
          "balance",
          "rate_1",
          "rate_2",
          "confidence",
        ],

        additionalProperties:
          false,
      },
    },

    overview: {
      type: "object",

      properties: {
        property: {
          type: "string",
        },

        garden: {
          type: "string",
        },

        doors: {
          type: "string",
        },

        skirting: {
          type: "string",
        },

        woodwork: {
          type: "string",
        },

        paintwork: {
          type: "string",
        },

        windows: {
          type: "string",
        },

        flooring: {
          type: "string",
        },

        carpets: {
          type: "string",
        },

        tiles: {
          type: "string",
        },

        linen: {
          type: "string",
        },

        curtains_and_blinds: {
          type: "string",
        },

        mattresses: {
          type: "string",
        },

        kitchen: {
          type: "string",
        },

        hob: {
          type: "string",
        },

        oven: {
          type: "string",
        },

        cooker_hood: {
          type: "string",
        },

        dishwasher: {
          type: "string",
        },

        fridge_freezer: {
          type: "string",
        },

        washing_machine: {
          type: "string",
        },

        bathroom: {
          type: "string",
        },

        fireplaces: {
          type: "string",
        },

        additional_comments: {
          type: "string",
        },

        room_actions: {
          type: "array",

          items: {
            type: "object",

            properties: {
              room: {
                type: "string",
              },

              action: {
                type: "string",
              },
            },

            required: [
              "room",
              "action",
            ],

            additionalProperties:
              false,
          },
        },
      },

      required: [
        "property",
        "garden",
        "doors",
        "skirting",
        "woodwork",
        "paintwork",
        "windows",
        "flooring",
        "carpets",
        "tiles",
        "linen",
        "curtains_and_blinds",
        "mattresses",
        "kitchen",
        "hob",
        "oven",
        "cooker_hood",
        "dishwasher",
        "fridge_freezer",
        "washing_machine",
        "bathroom",
        "fireplaces",
        "additional_comments",
        "room_actions",
      ],

      additionalProperties:
        false,
    },
  },

  required: [
    "meters",
    "overview",
  ],

  additionalProperties:
    false,
};

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

    if (sectionError) {
      throw new Error(
        sectionError.message
      );
    }

    const sectionMap =
      new Map();

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

    if (photoError) {
      throw new Error(
        photoError.message
      );
    }

    const finalPhotos =
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
            v2.completed ===
              true &&
            v2.version ===
              INVENTORY_V2_VERSION
          );
        }
      );

    if (
      finalPhotos.length ===
      0
    ) {
      throw new Error(
        "No completed V2 photographs found."
      );
    }

    // ========================================================
    // BUILD COMPACT FINDINGS BY ROOM
    //
    // We do NOT send 466 copies of repetitive text.
    // The overview needs final significant findings only.
    // ========================================================

    const roomMap =
      new Map<
        string,
        any
      >();

    for (
      const photo of
      finalPhotos
    ) {
      const analysis =
        objectValue(
          photo.ai_analysis
        );

      const v2 =
        objectValue(
          analysis.inventory_v2
        );

      const section =
        sectionMap.get(
          photo.section_id
        );

      const roomName =
        text(
          section?.room_name ||
          v2.room_name
        ) ||
        "Other";

      const sectionName =
        text(
          section?.section_name ||
          v2.section_name
        ) ||
        "General";

      if (
        !roomMap.has(
          roomName
        )
      ) {
        roomMap.set(
          roomName,
          {
            room:
              roomName,

            sections:
              new Map(),
          }
        );
      }

      const room =
        roomMap.get(
          roomName
        );

      if (
        !room.sections.has(
          sectionName
        )
      ) {
        room.sections.set(
          sectionName,
          {
            section:
              sectionName,

            descriptions:
              [],

            condition:
              [],

            cleanliness:
              [],

            damage:
              [],
          }
        );
      }

      const bucket =
        room.sections.get(
          sectionName
        );

      bucket.descriptions.push(
        ...textArray(
          v2.description_lines
        )
      );

      bucket.condition.push(
        ...textArray(
          v2.condition_lines
        )
      );

      bucket.cleanliness.push(
        ...textArray(
          v2.cleanliness_lines
        )
      );

      bucket.damage.push(
        ...textArray(
          v2.damage_lines
        )
      );
    }

    const findings =
      Array.from(
        roomMap.values()
      ).map(
        (room: any) => ({
          room:
            room.room,

          sections:
            Array.from(
              room.sections.values()
            ).map(
              (section: any) => ({
                section:
                  section.section,

                descriptions:
                  unique(
                    section
                      .descriptions
                  ).slice(
                    0,
                    12
                  ),

                condition:
                  unique(
                    section
                      .condition
                  ).slice(
                    0,
                    12
                  ),

                cleanliness:
                  unique(
                    section
                      .cleanliness
                  ).slice(
                    0,
                    12
                  ),

                damage:
                  unique(
                    section
                      .damage
                  ).slice(
                    0,
                    20
                  ),
              })
            ),
        })
      );

    // ========================================================
    // STRICT METER PHOTO SET
    //
    // IMPORTANT:
    // Final meter values are read again from the REAL images.
    // We deliberately IGNORE the bad 14011 / 00102 summary.
    // ========================================================

    const meterPhotos =
      finalPhotos.filter(
        (photo: any) => {
          const analysis =
            objectValue(
              photo.ai_analysis
            );

          const v2 =
            objectValue(
              analysis.inventory_v2
            );

          const section =
            sectionMap.get(
              photo.section_id
            );

          return (
            Boolean(
              text(
                v2.meter_type
              )
            ) ||
            isMeterSection(
              text(
                section?.room_name
              ),

              text(
                section?.section_name
              )
            )
          );
        }
      );

    const input:
      any[] = [
      {
        type: "text",

        text: `
You are producing the FINAL data for a professional
Right Inventories UK Inventory and Check-in Report.

There are TWO tasks only.

============================================================
TASK 1 — STRICT METER READING
============================================================

Meter photographs are attached after this prompt.

IGNORE ALL PREVIOUS AI METER VALUES.

Do NOT use:
14011
00102
19E2904125
E06112261
£5.47
or any other previous AI guess merely because it existed.

READ THE ACTUAL ATTACHED METER PHOTOGRAPHS.

Multiple photographs may belong to one meter.
One photograph may show the reading.
Another may show the printed serial number.
Another may show a balance or tariff screen.

Consolidate photographs belonging to the same physical meter.

Return separately:

meter_type
reading
unit
serial_number
balance
rate_1
rate_2
confidence

RULES:

- Every digit must come from the actual photograph.
- Preserve leading zeroes.
- Never guess a digit.
- Do not confuse serial number with reading.
- Do not confuse a tariff/rate with the current meter reading.
- Do not call a random currency-looking value "Balance".
- Balance must be explicitly shown as balance/credit.
- Exact serial number only when readable.
- Exact model/meter identifier must not be used as serial unless it
  is genuinely the serial number.
- If unclear, return "".
- Missing data is better than wrong data.

============================================================
TASK 2 — OVERVIEW
============================================================

Here are consolidated FINAL V2 findings:

${JSON.stringify(
  findings,
  null,
  2
)}

Create the Overview in the SAME concise style as a professional
Right Inventories report.

The property must NOT be made to sound better than the findings.

There are many V2 damage and cleaning findings, therefore assess
the property realistically.

Use concise overview terms such as:

N/A
Good
Good Domestic
Good used condition
Average
Fair
Aged
Worn
Needs Light Clean
Needs Cleaning
Further cleaning required
Poor

Do NOT default to Good.

Examples:

Flooring:
Fair / used condition

Kitchen:
Further cleaning required

Doors:
Used condition with visible marks/chips in places

Bathroom:
Needs cleaning; limescale / aged sealant in places

Property:
Used condition overall with visible wear and cleaning omissions

ROOM ACTION values should be one of:

No action required
Requires light clean
Requires cleaning
Action required

Only create room actions for actual rooms.

Additional Comments should concisely summarise the real report.

Return JSON only.
`,
      },
    ];

    // ========================================================
    // ATTACH REAL METER IMAGES
    // ========================================================

    let meterNumber =
      0;

    for (
      const photo of
      meterPhotos
    ) {
      const analysis =
        objectValue(
          photo.ai_analysis
        );

      const extraction =
        objectValue(
          analysis
            .image_extraction
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
        continue;
      }

      meterNumber++;

      const section =
        sectionMap.get(
          photo.section_id
        );

      input.push(
        {
          type: "text",

          text:
            `METER IMAGE ${meterNumber}
Room: ${text(
              section?.room_name
            )}
Section: ${text(
              section?.section_name
            )}`,
        },

        {
          type: "image",

          data:
            Buffer.from(
              await imageBlob
                .arrayBuffer()
            ).toString(
              "base64"
            ),

          mime_type:
            imageBlob.type ||
            "image/png",
        }
      );
    }

    if (
      meterNumber === 0
    ) {
      throw new Error(
        "No real meter photographs were found."
      );
    }

    // ========================================================
    // ONE FINAL GEMINI CALL
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

          input,

          response_format: {
            type: "text",

            mime_type:
              "application/json",

            schema:
              finalSchema,
          },

          generation_config: {
            thinking_level:
              "high",

            max_output_tokens:
              12000,
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
          },
          {
            status: 429,
          }
        );
      }

      throw error;
    }

    // ========================================================
    // PARSE
    // ========================================================

    const raw =
      text(
        interaction
          .output_text
      );

    if (!raw) {
      throw new Error(
        "Gemini returned no final report data."
      );
    }

    let parsed:
      any;

    try {
      parsed =
        JSON.parse(raw);
    } catch {
      console.error(
        raw
      );

      throw new Error(
        "Gemini final report data was invalid JSON."
      );
    }

    // ========================================================
    // CLEAN FINAL METERS
    // ========================================================

    const meters =
      Array.isArray(
        parsed.meters
      )
        ? parsed.meters
            .map(
              (
                meter: any
              ) => ({
                meter_type:
                  text(
                    meter
                      .meter_type
                  ),

                reading:
                  text(
                    meter.reading
                  ),

                unit:
                  text(
                    meter.unit
                  ),

                serial_number:
                  text(
                    meter
                      .serial_number
                  ),

                balance:
                  text(
                    meter.balance
                  ).replace(
                    /^£/,
                    ""
                  ),

                rate_1:
                  text(
                    meter.rate_1
                  ),

                rate_2:
                  text(
                    meter.rate_2
                  ),

                confidence:
                  Math.max(
                    0,
                    Math.min(
                      100,
                      numberValue(
                        meter.confidence
                      )
                    )
                  ),
              })
            )
            .filter(
              (
                meter: any
              ) =>
                meter
                  .meter_type
            )
        : [];

    const finalOverview =
      objectValue(
        parsed.overview
      );

    const existingOverview =
      objectValue(
        report.overview
      );

    const finalData = {
      completed:
        true,

      version:
        INVENTORY_V2_VERSION,

      model:
        INVENTORY_V2.model,

      completed_at:
        new Date()
          .toISOString(),

      total_final_photos:
        finalPhotos.length,

      meter_photo_count:
        meterNumber,

      meters,

      overview:
        finalOverview,
    };

    // ========================================================
    // SAVE
    // ========================================================

    const {
      error:
        saveError,
    } =
      await supabase
        .from(
          "ai_reports"
        )
        .update({
          status:
            "v2_finalised",

          overview: {
            ...existingOverview,

            inventory_v2_final:
              finalData,
          },

          additional_comments:
            text(
              finalOverview
                .additional_comments
            ),

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

    if (saveError) {
      throw new Error(
        saveError.message
      );
    }

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "V2 FINAL REPORT DATA COMPLETE"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `Final photos: ${finalPhotos.length}`
    );

    console.log(
      `Meter photos: ${meterNumber}`
    );

    console.log(
      "Meters:"
    );

    console.log(
      JSON.stringify(
        meters,
        null,
        2
      )
    );

    return NextResponse.json({
      ok: true,

      done: true,

      ...finalData,
    });
  } catch (
    error
  ) {
    console.error(
      "V2 finalisation error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "V2 finalisation failed.",
      },
      {
        status: 500,
      }
    );
  }
}