import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";

const inventorySchema = {
  type: "object",
  properties: {
    room_or_area: {
      type: "string",
      description:
        "Most likely room or area, for example Hallway, Kitchen, Bedroom, Bathroom or Exterior.",
    },

    main_item: {
      type: "string",
      description:
        "Main inventory item being photographed, for example Walls and skirting boards, Flooring, Door, Radiator, Kitchen units.",
    },

    item_description: {
      type: "string",
      description:
        "Short factual description of colour, material and item construction.",
    },

    condition: {
      type: "string",
      enum: [
        "New",
        "Good condition",
        "Good condition overall",
        "Fair condition",
        "Aged",
        "Poor condition",
        "Not clear",
      ],
    },

    cleanliness: {
      type: "string",
      enum: [
        "Good and clean condition",
        "Clean condition",
        "Needs light cleaning",
        "Needs cleaning",
        "Dirty",
        "Not clear",
      ],
    },

    damages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description:
              "Damage type such as scratch, scuff, chip, stain, crack, dent, hole, discolouration, water damage, peeling paint, rust, tarnishing, missing part.",
          },

          location: {
            type: "string",
            description:
              "Precise short location using inventory terminology, for example low level, RHS edge, LHS corner, adjacent to doorway.",
          },

          description: {
            type: "string",
            description:
              "Short factual inventory wording describing the visible issue.",
          },

          severity: {
            type: "string",
            enum: ["Minor", "Moderate", "Significant", "Unclear"],
          },

          confidence: {
            type: "integer",
            description:
              "Confidence from 0 to 100 that the issue is genuinely visible.",
          },

          box_2d: {
            type: "array",
            items: {
              type: "integer",
            },
            description:
              "Bounding box of the visible defect as [ymin, xmin, ymax, xmax], normalized from 0 to 1000. Use [0,0,0,0] if not possible.",
          },
        },

        required: [
          "type",
          "location",
          "description",
          "severity",
          "confidence",
          "box_2d",
        ],
      },
    },

    visible_items: {
      type: "array",
      items: {
        type: "string",
      },
      description:
        "Other clearly visible inventory items that may need recording.",
    },

    report_comment: {
      type: "string",
      description:
        "Finished concise inventory wording ready to place beneath the photograph.",
    },

    recommended_photo_label: {
      type: "string",
      enum: [
        "MAIN_DESCRIPTION",
        "DAMAGE_DETAIL",
        "ADDITIONAL_IMAGE",
        "AS_ABOVE",
        "INTERNAL_VIEW",
        "METER_READING",
        "REVIEW_REQUIRED",
      ],
    },

    manual_review_required: {
      type: "boolean",
    },

    manual_review_reason: {
      type: "string",
    },
  },

  required: [
    "room_or_area",
    "main_item",
    "item_description",
    "condition",
    "cleanliness",
    "damages",
    "visible_items",
    "report_comment",
    "recommended_photo_label",
    "manual_review_required",
    "manual_review_reason",
  ],
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY is missing from .env.local. Restart the development server after adding it.",
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();

    const image = formData.get("image");
    const roomHint = String(formData.get("roomHint") || "").trim();

    if (!(image instanceof File)) {
      return NextResponse.json(
        {
          error: "No image supplied.",
        },
        { status: 400 }
      );
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ];

    if (!allowedTypes.includes(image.type)) {
      return NextResponse.json(
        {
          error:
            "Unsupported image format. Please use JPG, PNG, WEBP, HEIC or HEIF.",
        },
        { status: 400 }
      );
    }

    // Gemini inline requests have a total request limit.
    // Keep the first test below 15 MB.
    if (image.size > 15 * 1024 * 1024) {
      return NextResponse.json(
        {
          error:
            "Image is larger than 15 MB. Please use a smaller image for this test.",
        },
        { status: 400 }
      );
    }

    const imageBuffer = Buffer.from(await image.arrayBuffer());

    const base64Image = imageBuffer.toString("base64");

    const ai = new GoogleGenAI({
      apiKey,
    });

    const sectionHint = roomHint
      ? `
The inventory clerk has supplied this section:
"${roomHint}"

Use this as strong context, but still analyse what is actually visible.
`
      : `
No room or section was supplied.
Identify the most likely room and inventory item.
`;

    const prompt = `
You are the computer-vision inspection assistant for RIGHT INVENTORIES,
a professional UK residential inventory and check-in reporting company.

Your task is NOT to write a long generic image description.

Your task is to inspect this ORIGINAL PROPERTY PHOTOGRAPH carefully and
produce factual inventory evidence in the same concise style used by
professional Right Inventories reports.

${sectionHint}

VERY IMPORTANT VISUAL INSPECTION RULES:

Study the ENTIRE photograph.

Then specifically inspect:

- top edge
- bottom edge
- left and right sides
- corners
- flooring
- wall edges
- skirting
- thresholds
- handles
- door edges
- window frames
- around switches and sockets
- around radiators
- around taps
- joins between surfaces
- furniture edges
- appliance fronts
- cabinet doors
- low-level areas
- high-level areas

LOOK FOR:

- scratches
- line scratches
- scuffs
- chips
- dents
- cracks
- stains
- marks
- discolouration
- water damage
- swollen flooring
- damaged laminate
- peeling paint
- patchy painting
- old chips painted over
- screw holes
- nail holes
- missing fittings
- broken components
- rust
- tarnishing
- mould where genuinely visible
- dirt
- grease
- dust
- debris
- worn areas
- flattened carpet
- damaged seals
- burns
- chips to tiles
- broken tiles
- damaged furniture
- damage around handles

DO NOT INVENT DAMAGE.

A shadow is not damage.
A reflection is not damage.
Image compression is not damage.
A natural wood grain is not damage.
A tile pattern is not damage.

If uncertain whether something is genuine damage:
- describe it cautiously;
- reduce the confidence;
- set manual_review_required to true.

DAMAGE LOCATION:

Use concise UK inventory terminology where appropriate:

- RHS
- LHS
- low level
- mid level
- upper level
- lower edge
- upper edge
- adjacent to
- beneath
- above
- near the doorway
- near the threshold
- to corner
- in places

For every genuine defect, return a box_2d:
[ymin, xmin, ymax, xmax]

Coordinates must be normalized between 0 and 1000.

REPORT WRITING STYLE:

Keep comments short and factual.

Good examples:

White painted walls
Good condition overall
Light scuffs to low level

Light wood effect laminate flooring
Good and clean condition
Few surface scratches in places

White painted wood door with silver metal lever handle
Good and working appearance
Small chips to lower edge

Grey carpet, wall to wall fitted
Good condition overall
Small stain to traffic area

White painted wood skirting
Old chips painted over

Do NOT write phrases such as:

"The image shows..."
"I can see..."
"It appears that the photograph..."
"This beautiful room..."
"The property seems..."

Do not exaggerate.

Do not call an item "working" merely because it exists in the photograph.

You cannot confirm that:
- a light works
- a tap works
- an appliance works
- a lock works
- a window operates
- an alarm was tested

unless separate evidence clearly establishes this.

PHOTO LABEL RULES:

For this first single-photo test:

MAIN_DESCRIPTION:
use when this photograph provides the main useful view of an item.

DAMAGE_DETAIL:
use when the photograph primarily focuses on damage.

INTERNAL_VIEW:
use for inside cupboards, wardrobes, drawers, ovens, fridges or storage.

METER_READING:
use when a utility meter is the main subject.

REVIEW_REQUIRED:
use when the photograph is too unclear to describe reliably.

Do not normally use ADDITIONAL_IMAGE or AS_ABOVE yet because only one
photograph is being analysed. Those labels will become important when
we analyse groups of photographs together.

REPORT_COMMENT must be immediately usable inside an inventory report.

Return only the required structured result.
`;

    const interaction = await ai.interactions.create({
      model: "gemini-3.6-flash",

      input: [
        {
          type: "text",
          text: prompt,
        },
        {
          type: "image",
          data: base64Image,
          mime_type: image.type,
        },
      ],

      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: inventorySchema,
      },

      generation_config: {
        thinking_level: "medium",
      },

      // We do not need Gemini to store this interaction
      // because every property photo is analysed independently.
      store: false,
    });

    const outputText =
      (interaction as any).outputText ??
      (interaction as any).output_text;

    if (!outputText) {
      throw new Error("Gemini returned no result.");
    }

    const analysis = JSON.parse(outputText);

    return NextResponse.json({
      success: true,
      analysis,
    });
  } catch (error) {
    console.error("RIGHT INVENTORIES AI ERROR:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown AI analysis error.",
      },
      {
        status: 500,
      }
    );
  }
}