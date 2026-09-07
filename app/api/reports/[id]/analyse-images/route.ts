import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================
// TYPES
// ============================================================

type SectionMapItem = {
  id: string;
  sort_order: number;
  room_name: string;
  section_name: string;
  start_page: number;
  end_page: number;
  expected_photo_count: number;
};

type PhotoAnalysis = {
  section_sort_order: number;

  room_name: string;
  section_name: string;

  page_number: number;
  photo_index_on_page: number;

  existing_caption: string;

  caption_type:
    | "full_description"
    | "additional_image"
    | "as_above"
    | "internal_view"
    | "specific_defect"
    | "meter"
    | "alarm"
    | "key";

  final_caption: string;

  condition: string;
  cleanliness: string;

  damage_visible: boolean;
  damage_details: string;

  confidence: number;

  review_required: boolean;
  include_in_report: boolean;

  meter_type: string;
  meter_reading: string;
  meter_serial_number: string;
};

// ============================================================
// GEMINI STRUCTURED OUTPUT
// ============================================================

const photoSchema: any = {
  type: "object",

  properties: {
    photos: {
      type: "array",

      items: {
        type: "object",

        properties: {
          section_sort_order: {
            type: "integer",
          },

          room_name: {
            type: "string",
          },

          section_name: {
            type: "string",
          },

          page_number: {
            type: "integer",
          },

          photo_index_on_page: {
            type: "integer",
          },

          existing_caption: {
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
              "meter",
              "alarm",
              "key",
            ],
          },

          final_caption: {
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

          include_in_report: {
            type: "boolean",
          },

          meter_type: {
            type: "string",
          },

          meter_reading: {
            type: "string",
          },

          meter_serial_number: {
            type: "string",
          },
        },

        required: [
          "section_sort_order",
          "room_name",
          "section_name",
          "page_number",
          "photo_index_on_page",
          "existing_caption",
          "caption_type",
          "final_caption",
          "condition",
          "cleanliness",
          "damage_visible",
          "damage_details",
          "confidence",
          "review_required",
          "include_in_report",
          "meter_type",
          "meter_reading",
          "meter_serial_number",
        ],

        additionalProperties: false,
      },
    },
  },

  required: ["photos"],

  additionalProperties: false,
};

// ============================================================
// HELPERS
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

function wait(milliseconds: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  );
}

// ============================================================
// PARSE GEMINI JSON
// ============================================================

function parseGeminiJson(
  rawText: string
): {
  photos: PhotoAnalysis[];
} {
  let text = rawText.trim();

  if (text.startsWith("```json")) {
    text = text.slice(7);
  } else if (text.startsWith("```")) {
    text = text.slice(3);
  }

  if (text.endsWith("```")) {
    text = text.slice(0, -3);
  }

  text = text.trim();

  let parsed: any;

  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(
      "Gemini batch returned invalid JSON."
    );

    console.error(
      "Response length:",
      text.length
    );

    console.error(
      "Beginning:",
      text.slice(0, 1500)
    );

    console.error(
      "End:",
      text.slice(-1500)
    );

    throw new Error(
      "Gemini batch response could not be parsed as JSON."
    );
  }

  if (
    !parsed ||
    !Array.isArray(parsed.photos)
  ) {
    throw new Error(
      "Gemini batch did not return a photos array."
    );
  }

  const photos: PhotoAnalysis[] =
    parsed.photos.map((photo: any) => {
      const confidence = Math.min(
        100,
        Math.max(
          0,
          safeInteger(photo?.confidence)
        )
      );

      return {
        section_sort_order:
          safeInteger(
            photo?.section_sort_order
          ),

        room_name:
          safeText(photo?.room_name),

        section_name:
          safeText(photo?.section_name),

        page_number:
          safeInteger(
            photo?.page_number
          ),

        photo_index_on_page:
          safeInteger(
            photo?.photo_index_on_page
          ),

        existing_caption:
          safeText(
            photo?.existing_caption
          ),

        caption_type:
          (
            safeText(
              photo?.caption_type
            ) || "full_description"
          ) as PhotoAnalysis["caption_type"],

        final_caption:
          safeText(
            photo?.final_caption
          ),

        condition:
          safeText(
            photo?.condition
          ),

        cleanliness:
          safeText(
            photo?.cleanliness
          ),

        damage_visible:
          safeBoolean(
            photo?.damage_visible
          ),

        damage_details:
          safeText(
            photo?.damage_details
          ),

        confidence,

        review_required:
          safeBoolean(
            photo?.review_required
          ) ||
          confidence < 75,

        include_in_report:
          safeBoolean(
            photo?.include_in_report,
            true
          ),

        meter_type:
          safeText(
            photo?.meter_type
          ),

        meter_reading:
          safeText(
            photo?.meter_reading
          ),

        meter_serial_number:
          safeText(
            photo?.meter_serial_number
          ),
      };
    });

  return {
    photos,
  };
}

// ============================================================
// BUILD PROMPT FOR ONE PAGE RANGE
// ============================================================

function buildBatchPrompt(
  startPage: number,
  endPage: number,
  relevantSections: SectionMapItem[]
): string {
  const sectionMap = JSON.stringify(
    relevantSections.map((section) => ({
      sort_order:
        section.sort_order,

      room_name:
        section.room_name,

      section_name:
        section.section_name,

      start_page:
        section.start_page,

      end_page:
        section.end_page,

      expected_photo_count:
        section.expected_photo_count,
    })),
    null,
    2
  );

  return `
You are performing STAGE 2 photograph analysis for Right Inventories, a UK property inventory company.

You have been given the COMPLETE unfinished property inventory PDF.

However, for THIS REQUEST you must analyse ONLY ORIGINAL PHYSICAL PDF PAGES:

${startPage} TO ${endPage}

This rule is extremely important.

DO NOT analyse photographs from pages before ${startPage}.

DO NOT analyse photographs from pages after ${endPage}.

Return ONLY photographs physically located on pages ${startPage}-${endPage}.

The page_number returned in JSON must be the physical page number in the COMPLETE original PDF.

==================================================
RELEVANT SECTIONS FOR PAGES ${startPage}-${endPage}
==================================================

${sectionMap}

Use these supplied sections.

Every photograph must be assigned to the most appropriate supplied section_sort_order.

Do not invent rooms.

Do not invent subsections.

==================================================
YOUR JOB
==================================================

Visually inspect EVERY actual PROPERTY INSPECTION PHOTOGRAPH on physical pages ${startPage}-${endPage} only.

Do not count:

Right Inventories logos
branding
icons
decorative graphics
signatures
page furniture

For every actual inspection photograph return:

section_sort_order
room_name
section_name
page_number
photo_index_on_page
existing_caption
caption_type
final_caption
condition
cleanliness
damage_visible
damage_details
confidence
review_required
include_in_report
meter_type
meter_reading
meter_serial_number

==================================================
PHOTO INDEX
==================================================

photo_index_on_page begins at 1 for each physical page.

Count only actual inspection photographs on that page.

Do not count logos or branding.

==================================================
RIGHT INVENTORIES WRITING STYLE
==================================================

Use concise professional inventory wording.

Use short phrases rather than long prose.

GOOD:

White painted walls
Good condition overall
Light scuffs to low level

GOOD:

Grey carpet
Good and clean condition
Light signs of general use

GOOD:

White painted timber door
Good condition
Light marks around handle

BAD:

The walls appear to be in relatively good condition although there are some marks which appear towards the lower part.

==================================================
FULL DESCRIPTION / ADDITIONAL IMAGE
==================================================

Do NOT fully describe every repeated photograph.

Use these rules:

1. The clearest representative image for a subsection should normally have a useful full description.

2. A supporting photograph adding no new information should normally be:

Additional image

3. If another photograph clearly shows the SAME previously described defect:

As above

4. Cupboard, cabinet, drawer, wardrobe and storage interior photographs can use:

Internal view

or:

Internal view
Good and clean condition

5. A photograph showing a NEW defect or materially different condition must receive a specific description.

6. Do not make everything "Additional image".

7. Do not give every duplicate a full description.

==================================================
IMPORTANT BATCH BOUNDARY RULE
==================================================

A subsection may continue from a previous page range.

If a subsection began BEFORE page ${startPage}, do not assume the first photograph in this request requires another full description.

Use the visible existing report context and photographs to decide whether:

Additional image

As above

or a new specific description is appropriate.

If a new defect is visible, describe it.

==================================================
EXCESSIVE DUPLICATES
==================================================

Normally keep supporting photographs.

include_in_report should normally be true.

Set include_in_report = false only for an obviously excessive near-identical duplicate providing no additional evidence.

Do not aggressively remove evidence.

==================================================
VISIBLE CONDITION
==================================================

Look carefully for:

scuffs
scratches
chips
marks
stains
cracks
dents
holes
paint damage
peeling
wear
discolouration
water staining
mould
dust
debris
grease
limescale
rust
damaged sealant
aged finishes
broken components
missing components
poor cleaning

Useful location wording:

low level
mid level
upper level
LHS
RHS
to edge
to corner
around handle
adjacent to socket
below window
above skirting

Only record things actually visible.

==================================================
CONDITION
==================================================

Useful wording includes:

New
Good condition
Good condition overall
Fair condition
Aged
Signs of general use
Light wear
Moderate wear
Heavy wear
Old chips painted over
Marks consistent with age
Scuffs in places

Never invent condition issues.

==================================================
CLEANLINESS
==================================================

Where genuinely visible:

Good and clean condition
Clean condition
Needs light cleaning
Needs further cleaning
Dust present
Limescale present
Grease residue present

Do not invent dirt.

==================================================
STATIC PHOTOGRAPH RULE
==================================================

A static photograph does NOT prove an item works.

Never claim:

working
tested
operational
functioning

for lights, appliances, heating, sockets, switches, alarms, taps or other equipment unless explicit visible report evidence proves it.

==================================================
CAPTION TYPES
==================================================

caption_type must be exactly one of:

full_description
additional_image
as_above
internal_view
specific_defect
meter
alarm
key

If caption_type is additional_image:

final_caption must be exactly:

Additional image

If caption_type is as_above:

final_caption must be exactly:

As above

==================================================
METERS - EXTREMELY STRICT
==================================================

meter_type must be:

Electric
Gas
Water

or an empty string.

Never guess a meter digit.

If ANY important reading digit is unclear:

meter_reading = ""
review_required = true

Never guess serial-number characters.

If any serial-number character is uncertain:

meter_serial_number = ""
review_required = true

Where safely readable, final captions may use:

Reading. 12345 kWh
SN. ABC123456

Only include values genuinely visible.

==================================================
ALARMS
==================================================

Identify visible smoke or carbon monoxide alarms.

Do not claim an alarm is tested or working from a static photograph.

==================================================
KEYS
==================================================

Describe/count keys only where clearly visible.

Do not invent which lock a key operates.

==================================================
CONFIDENCE
==================================================

confidence must be 0-100.

review_required must be true where:

confidence < 75
damage is ambiguous
image quality is poor
meter digits are unclear
serial-number characters are unclear
section assignment is uncertain
material condition judgement is uncertain

==================================================
FINAL ACCURACY RULE
==================================================

Never invent:

defects
damage
dirt
stains
meter digits
serial numbers
testing
room names
subsections

RETURN ONLY PHOTOGRAPHS FROM PHYSICAL PAGES ${startPage}-${endPage}.

Return only JSON matching the supplied schema.
`;
}

// ============================================================
// ANALYSE ONE PAGE RANGE
//
// IMPORTANT:
// We send the ORIGINAL PDF directly to Gemini.
// We do NOT modify or split the encrypted PDF locally.
// ============================================================

async function analyseRangeOnce({
  ai,
  pdfBase64,
  startPage,
  endPage,
  relevantSections,
}: {
  ai: GoogleGenAI;
  pdfBase64: string;
  startPage: number;
  endPage: number;
  relevantSections: SectionMapItem[];
}): Promise<PhotoAnalysis[]> {
  const prompt =
    buildBatchPrompt(
      startPage,
      endPage,
      relevantSections
    );

  console.log(
    `Sending original PDF to Gemini for pages ${startPage}-${endPage}...`
  );

  const interaction =
    await ai.interactions.create({
      model: "gemini-3.6-flash",

      input: [
        {
          type: "text",
          text: prompt,
        },

        {
          type: "document",

          data: pdfBase64,

          mime_type:
            "application/pdf",
        },
      ],

      response_format: [
        {
          type: "text",

          mime_type:
            "application/json",

          schema: photoSchema,
        },
      ],

      generation_config: {
        thinking_level:
          "medium",

        max_output_tokens:
          20000,
      },

      store: false,
    });

  const responseText =
    interaction.output_text;

  if (
    !responseText ||
    !responseText.trim()
  ) {
    throw new Error(
      `Gemini returned an empty response for pages ${startPage}-${endPage}.`
    );
  }

  console.log(
    `Pages ${startPage}-${endPage} response length:`,
    responseText.length
  );

  const result =
    parseGeminiJson(
      responseText
    );

  // ----------------------------------------------------------
  // SAFETY FILTER
  //
  // Gemini sees the whole document, therefore we enforce the
  // requested physical page range again in code.
  // ----------------------------------------------------------

  const filteredPhotos =
    result.photos.filter(
      (photo) =>
        photo.page_number >=
          startPage &&
        photo.page_number <=
          endPage
    );

  const removed =
    result.photos.length -
    filteredPhotos.length;

  if (removed > 0) {
    console.warn(
      `Removed ${removed} Gemini result(s) outside pages ${startPage}-${endPage}.`
    );
  }

  console.log(
    `Pages ${startPage}-${endPage}: ${filteredPhotos.length} photographs accepted.`
  );

  return filteredPhotos;
}

// ============================================================
// ROBUST RANGE ANALYSIS
//
// If a 5-page response is malformed, automatically divide it
// into smaller logical page ranges.
// ============================================================

async function analyseRangeRobust({
  ai,
  pdfBase64,
  startPage,
  endPage,
  relevantSections,
}: {
  ai: GoogleGenAI;
  pdfBase64: string;
  startPage: number;
  endPage: number;
  relevantSections: SectionMapItem[];
}): Promise<PhotoAnalysis[]> {
  try {
    return await analyseRangeOnce({
      ai,
      pdfBase64,
      startPage,
      endPage,
      relevantSections,
    });
  } catch (error) {
    console.error(
      `Pages ${startPage}-${endPage} failed:`,
      error
    );

    if (
      startPage ===
      endPage
    ) {
      throw error;
    }

    const middlePage =
      Math.floor(
        (startPage +
          endPage) /
          2
      );

    console.log(
      `Splitting requested range ${startPage}-${endPage} into ${startPage}-${middlePage} and ${
        middlePage + 1
      }-${endPage}.`
    );

    const firstSections =
      relevantSections.filter(
        (section) =>
          section.end_page >=
            startPage &&
          section.start_page <=
            middlePage
      );

    const secondSections =
      relevantSections.filter(
        (section) =>
          section.end_page >=
            middlePage + 1 &&
          section.start_page <=
            endPage
      );

    const first =
      await analyseRangeRobust({
        ai,
        pdfBase64,
        startPage,
        endPage:
          middlePage,
        relevantSections:
          firstSections,
      });

    await wait(750);

    const second =
      await analyseRangeRobust({
        ai,
        pdfBase64,
        startPage:
          middlePage + 1,
        endPage,
        relevantSections:
          secondSections,
      });

    return [
      ...first,
      ...second,
    ];
  }
}

// ============================================================
// API ROUTE
// ============================================================

export async function POST(
  _request: Request,

  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  let reportId = "";

  let supabaseForError:
    any = null;

  let currentUserId =
    "";

  try {
    // --------------------------------------------------------
    // 1. REPORT ID
    // --------------------------------------------------------

    const params =
      await context.params;

    reportId =
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
    // 2. SUPABASE
    // --------------------------------------------------------

    const supabase =
      await createClient();

    supabaseForError =
      supabase;

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

    currentUserId =
      user.id;

    // --------------------------------------------------------
    // 3. REPORT
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
          property_address,
          property_postcode,
          report_type,
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
    // 4. STAGE 1 SECTIONS
    // --------------------------------------------------------

    const {
      data: sections,
      error: sectionsError,
    } =
      await supabase
        .from(
          "ai_report_sections"
        )
        .select("*")
        .eq(
          "report_id",
          reportId
        )
        .order(
          "sort_order",
          {
            ascending: true,
          }
        );

    if (sectionsError) {
      throw new Error(
        `Could not load report sections: ${sectionsError.message}`
      );
    }

    if (
      !sections ||
      sections.length ===
        0
    ) {
      return NextResponse.json(
        {
          error:
            "Run PDF structure analysis first.",
        },
        {
          status: 400,
        }
      );
    }

    // --------------------------------------------------------
    // 5. SECTION MAP
    // --------------------------------------------------------

    const sectionMap:
      SectionMapItem[] =
      sections.map(
        (section: any) => {
          const info =
            parseJsonObject(
              section.ai_summary
            );

          return {
            id:
              section.id,

            sort_order:
              safeInteger(
                section.sort_order
              ),

            room_name:
              safeText(
                section.room_name
              ),

            section_name:
              safeText(
                section.section_name
              ),

            start_page:
              safeInteger(
                info.start_page
              ),

            end_page:
              safeInteger(
                info.end_page
              ),

            expected_photo_count:
              safeInteger(
                info.photo_count
              ),
          };
        }
      );

    const validSections =
      sectionMap.filter(
        (section) =>
          section.start_page >
            0 &&
          section.end_page >
            0
      );

    if (
      validSections.length ===
      0
    ) {
      throw new Error(
        "The extracted sections do not contain usable page ranges."
      );
    }

    const expectedPhotoCount =
      validSections.reduce(
        (
          total,
          section
        ) =>
          total +
          section.expected_photo_count,
        0
      );

    console.log(
      "Expected approximate photo count:",
      expectedPhotoCount
    );

    // --------------------------------------------------------
    // 6. PAGE RANGE
    // --------------------------------------------------------

    const overview =
      parseJsonObject(
        report.overview
      );

    const sourceStructure =
      parseJsonObject(
        overview
          ?.source_structure
      );

    const firstPhotoPage =
      Math.min(
        ...validSections.map(
          (section) =>
            section.start_page
        )
      );

    let lastPhotoPage =
      Math.max(
        ...validSections.map(
          (section) =>
            section.end_page
        )
      );

    const declarationStart =
      safeInteger(
        sourceStructure
          ?.declaration_start_page
      );

    if (
      declarationStart > 0
    ) {
      lastPhotoPage =
        Math.min(
          lastPhotoPage,
          declarationStart - 1
        );
    }

    console.log(
      `Photograph analysis range: pages ${firstPhotoPage}-${lastPhotoPage}`
    );

    // --------------------------------------------------------
    // 7. STATUS
    // --------------------------------------------------------

    const {
      error: statusError,
    } =
      await supabase
        .from("ai_reports")
        .update({
          status:
            "analysing_images",

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

    if (statusError) {
      throw new Error(
        `Could not start photograph analysis: ${statusError.message}`
      );
    }

    // --------------------------------------------------------
    // 8. DOWNLOAD ORIGINAL PRIVATE PDF
    // --------------------------------------------------------

    console.log(
      "Downloading original source PDF..."
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

    console.log(
      "Original PDF size:",
      pdfBlob.size,
      "bytes"
    );

    if (
      pdfBlob.size >
      50 * 1024 * 1024
    ) {
      throw new Error(
        "The source PDF is larger than 50 MB."
      );
    }

    const pdfArrayBuffer =
      await pdfBlob.arrayBuffer();

    const pdfBase64 =
      Buffer.from(
        pdfArrayBuffer
      ).toString(
        "base64"
      );

    // --------------------------------------------------------
    // 9. GEMINI CLIENT
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

    // --------------------------------------------------------
    // 10. ANALYSE 5 PHYSICAL PAGES AT A TIME
    //
    // The original PDF stays untouched.
    // --------------------------------------------------------

    const PAGE_BATCH_SIZE =
      5;

    const allPhotos:
      PhotoAnalysis[] = [];

    const totalBatches =
      Math.ceil(
        (
          lastPhotoPage -
          firstPhotoPage +
          1
        ) /
          PAGE_BATCH_SIZE
      );

    let batchNumber = 0;

    for (
      let startPage =
        firstPhotoPage;

      startPage <=
      lastPhotoPage;

      startPage +=
        PAGE_BATCH_SIZE
    ) {
      batchNumber++;

      const endPage =
        Math.min(
          startPage +
            PAGE_BATCH_SIZE -
            1,

          lastPhotoPage
        );

      console.log("");
      console.log(
        "=========================================="
      );

      console.log(
        `BATCH ${batchNumber}/${totalBatches}: PAGES ${startPage}-${endPage}`
      );

      console.log(
        "=========================================="
      );

      const relevantSections =
        validSections.filter(
          (section) =>
            section.end_page >=
              startPage &&
            section.start_page <=
              endPage
        );

      if (
        relevantSections.length ===
        0
      ) {
        console.log(
          "No relevant inventory sections. Skipping batch."
        );

        continue;
      }

      const batchPhotos =
        await analyseRangeRobust({
          ai,

          pdfBase64,

          startPage,

          endPage,

          relevantSections,
        });

      allPhotos.push(
        ...batchPhotos
      );

      console.log(
        `Accumulated photograph results: ${allPhotos.length}`
      );

      // Small gap between calls.
      await wait(750);
    }

    // --------------------------------------------------------
    // 11. VALIDATE
    // --------------------------------------------------------

    if (
      allPhotos.length ===
      0
    ) {
      throw new Error(
        "Gemini did not detect any inspection photographs."
      );
    }

    // --------------------------------------------------------
    // 12. SORT
    // --------------------------------------------------------

    allPhotos.sort(
      (a, b) => {
        if (
          a.page_number !==
          b.page_number
        ) {
          return (
            a.page_number -
            b.page_number
          );
        }

        return (
          a.photo_index_on_page -
          b.photo_index_on_page
        );
      }
    );

    // --------------------------------------------------------
    // 13. REMOVE DUPLICATE AI RECORDS
    // --------------------------------------------------------

    const uniquePhotos:
      PhotoAnalysis[] = [];

    const seen =
      new Set<string>();

    for (
      const photo of
      allPhotos
    ) {
      const key =
        `${photo.page_number}:${photo.photo_index_on_page}`;

      if (
        seen.has(key)
      ) {
        console.warn(
          "Skipping duplicate AI record:",
          key
        );

        continue;
      }

      seen.add(key);

      uniquePhotos.push(
        photo
      );
    }

    console.log(
      "Unique photographs detected:",
      uniquePhotos.length
    );

    // --------------------------------------------------------
    // 14. SECTION LOOKUP
    // --------------------------------------------------------

    const sectionBySortOrder =
      new Map<number, any>();

    for (
      const section of
      sections
    ) {
      sectionBySortOrder.set(
        safeInteger(
          section.sort_order
        ),
        section
      );
    }

    // --------------------------------------------------------
    // 15. DATABASE PHOTOS
    // --------------------------------------------------------

    const databasePhotos =
      uniquePhotos.map(
        (
          photo,
          index
        ) => {
          let matchedSection =
            sectionBySortOrder.get(
              photo.section_sort_order
            );

          if (
            !matchedSection
          ) {
            matchedSection =
              sections.find(
                (section: any) =>
                  safeText(
                    section.room_name
                  ).toLowerCase() ===
                    photo.room_name.toLowerCase() &&
                  safeText(
                    section.section_name
                  ).toLowerCase() ===
                    photo.section_name.toLowerCase()
              );
          }

          const mappingUncertain =
            !matchedSection;

          const page =
            safeInteger(
              photo.page_number
            );

          const photoIndex =
            safeInteger(
              photo.photo_index_on_page
            );

          return {
            report_id:
              reportId,

            section_id:
              matchedSection?.id ||
              null,

            storage_path:
              `pdf:${reportId}:page-${page}:photo-${photoIndex}`,

            original_name:
              `PDF page ${page} photo ${photoIndex}`,

            sort_order:
              index,

            ai_comment:
              photo.final_caption,

            ai_label:
              photo.caption_type,

            ai_analysis: {
              source:
                "embedded_pdf",

              page_number:
                page,

              photo_index_on_page:
                photoIndex,

              section_sort_order:
                photo.section_sort_order,

              room_name:
                photo.room_name,

              section_name:
                photo.section_name,

              existing_caption:
                photo.existing_caption,

              caption_type:
                photo.caption_type,

              final_caption:
                photo.final_caption,

              condition:
                photo.condition,

              cleanliness:
                photo.cleanliness,

              damage_visible:
                photo.damage_visible,

              damage_details:
                photo.damage_details,

              confidence:
                photo.confidence,

              meter_type:
                photo.meter_type,

              meter_reading:
                photo.meter_reading,

              meter_serial_number:
                photo.meter_serial_number,

              mapping_uncertain:
                mappingUncertain,
            },

            review_required:
              photo.review_required ||
              mappingUncertain,

            include_in_report:
              photo.include_in_report,
          };
        }
      );

    // --------------------------------------------------------
    // 16. DELETE PREVIOUS PDF-GENERATED RESULTS
    //
    // Only after Gemini successfully completed every batch.
    // --------------------------------------------------------

    const {
      error: deleteError,
    } =
      await supabase
        .from(
          "ai_report_photos"
        )
        .delete()
        .eq(
          "report_id",
          reportId
        )
        .like(
          "storage_path",
          "pdf:%"
        );

    if (deleteError) {
      throw new Error(
        `Could not clear old photograph analysis: ${deleteError.message}`
      );
    }

    // --------------------------------------------------------
    // 17. INSERT RESULTS
    // --------------------------------------------------------

    const DATABASE_BATCH_SIZE =
      100;

    for (
      let index = 0;

      index <
      databasePhotos.length;

      index +=
        DATABASE_BATCH_SIZE
    ) {
      const batch =
        databasePhotos.slice(
          index,
          index +
            DATABASE_BATCH_SIZE
        );

      const {
        error: insertError,
      } =
        await supabase
          .from(
            "ai_report_photos"
          )
          .insert(batch);

      if (insertError) {
        throw new Error(
          `Could not save photograph analysis: ${insertError.message}`
        );
      }
    }

    // --------------------------------------------------------
    // 18. STATISTICS
    // --------------------------------------------------------

    const reviewCount =
      databasePhotos.filter(
        (photo) =>
          photo.review_required
      ).length;

    const excludedCount =
      databasePhotos.filter(
        (photo) =>
          !photo.include_in_report
      ).length;

    const damageCount =
      uniquePhotos.filter(
        (photo) =>
          photo.damage_visible
      ).length;

    const meterCount =
      uniquePhotos.filter(
        (photo) =>
          Boolean(
            photo.meter_type
          )
      ).length;

    // --------------------------------------------------------
    // 19. SAVE SUMMARY
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

    const photoAnalysisSummary =
      {
        analysed_at:
          new Date().toISOString(),

        processing_method:
          "full_pdf_page_range_batches",

        page_batch_size:
          PAGE_BATCH_SIZE,

        analysed_from_page:
          firstPhotoPage,

        analysed_to_page:
          lastPhotoPage,

        expected_photo_count:
          expectedPhotoCount,

        detected_photo_count:
          databasePhotos.length,

        review_required_count:
          reviewCount,

        excluded_duplicate_count:
          excludedCount,

        visible_damage_count:
          damageCount,

        meter_photo_count:
          meterCount,
      };

    // --------------------------------------------------------
    // 20. COMPLETE
    // --------------------------------------------------------

    const {
      error:
        updateReportError,
    } =
      await supabase
        .from(
          "ai_reports"
        )
        .update({
          status:
            "images_analysed",

          overview: {
            ...oldOverview,

            photo_analysis:
              photoAnalysisSummary,
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
      updateReportError
    ) {
      throw new Error(
        `Could not update report status: ${updateReportError.message}`
      );
    }

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "PHOTOGRAPH ANALYSIS COMPLETE"
    );

    console.log(
      "=========================================="
    );

    console.log(
      "Expected:",
      expectedPhotoCount
    );

    console.log(
      "Detected:",
      databasePhotos.length
    );

    console.log(
      "Needs review:",
      reviewCount
    );

    console.log(
      "Visible damage:",
      damageCount
    );

    console.log(
      "Excluded duplicates:",
      excludedCount
    );

    console.log(
      "Meter photographs:",
      meterCount
    );

    return NextResponse.json({
      ok: true,

      stage:
        "images_analysed",

      expected_photo_count:
        expectedPhotoCount,

      detected_photo_count:
        databasePhotos.length,

      review_required_count:
        reviewCount,

      excluded_duplicate_count:
        excludedCount,

      visible_damage_count:
        damageCount,

      meter_photo_count:
        meterCount,
    });
  } catch (error) {
    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------

    console.error(
      "Photograph analysis error:",
      error
    );

    if (
      reportId &&
      supabaseForError &&
      currentUserId
    ) {
      try {
        await supabaseForError
          .from(
            "ai_reports"
          )
          .update({
            status:
              "image_analysis_error",

            updated_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            reportId
          )
          .eq(
            "created_by",
            currentUserId
          );
      } catch (
        statusError
      ) {
        console.error(
          "Could not save image analysis error status:",
          statusError
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown photograph analysis error.",
      },
      {
        status: 500,
      }
    );
  }
}