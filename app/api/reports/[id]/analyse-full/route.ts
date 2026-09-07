import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type ExtractedSection = {
  room_name: string;
  section_name: string;
  start_page: number;
  end_page: number;
  photo_count: number;
  notes: string;
};

type StructureAnalysis = {
  property_address: string;
  property_postcode: string;
  report_type: string;
  report_date: string;
  total_pages: number;
  declaration_start_page: number;
  meter_pages: number[];
  sections: ExtractedSection[];
};

const structureSchema: any = {
  type: "object",

  properties: {
    property_address: {
      type: "string",
      description:
        "Full property address exactly as shown in the report. Return an empty string if it cannot be determined.",
    },

    property_postcode: {
      type: "string",
      description:
        "Property postcode exactly as shown in the report. Return an empty string if it cannot be determined.",
    },

    report_type: {
      type: "string",
      description:
        "The report type exactly as shown, for example Inventory or Inventory and Check-in.",
    },

    report_date: {
      type: "string",
      description:
        "The inspection/report date exactly as shown. Return an empty string if unavailable.",
    },

    total_pages: {
      type: "integer",
      description:
        "Total physical number of pages in the PDF.",
    },

    declaration_start_page: {
      type: "integer",
      description:
        "Physical PDF page number where Declaration or signature content begins. Pages start at 1. Return 0 if not found.",
    },

    meter_pages: {
      type: "array",
      description:
        "Physical PDF page numbers containing electricity, gas or water meter photographs or readings.",
      items: {
        type: "integer",
      },
    },

    sections: {
      type: "array",
      description:
        "All inventory photographic schedule subsections in their exact document order. Do not include Declaration/signature pages.",

      items: {
        type: "object",

        properties: {
          room_name: {
            type: "string",
            description:
              "Main area heading exactly as shown, such as Hallway, Kitchen, Reception room, Bedroom 1 or Bathroom.",
          },

          section_name: {
            type: "string",
            description:
              "Subsection heading exactly as shown, such as General, Flooring, Walls and skirting boards, Appliances or Heating.",
          },

          start_page: {
            type: "integer",
            description:
              "Physical PDF page number where this subsection begins. Pages start at 1.",
          },

          end_page: {
            type: "integer",
            description:
              "Physical PDF page number where this subsection ends.",
          },

          photo_count: {
            type: "integer",
            description:
              "Approximate number of actual inspection photographs belonging to this subsection. Do not count logos or decorative graphics.",
          },

          notes: {
            type: "string",
            description:
              "Very short structural note only. Do not write the final inventory condition description in this field.",
          },
        },

        required: [
          "room_name",
          "section_name",
          "start_page",
          "end_page",
          "photo_count",
          "notes",
        ],

        additionalProperties: false,
      },
    },
  },

  required: [
    "property_address",
    "property_postcode",
    "report_type",
    "report_date",
    "total_pages",
    "declaration_start_page",
    "meter_pages",
    "sections",
  ],

  additionalProperties: false,
};

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

  return Math.max(0, Math.round(number));
}

function parseGeminiJson(rawText: string): StructureAnalysis {
  let text = rawText.trim();

  // Defensive fallback in case a model ever wraps JSON in markdown.
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
  } catch (error) {
    console.error(
      "Could not parse Gemini JSON. First 3000 characters:"
    );

    console.error(text.slice(0, 3000));

    throw new Error(
      "Gemini returned a response that could not be parsed as JSON."
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      "Gemini did not return a valid report structure."
    );
  }

  if (!Array.isArray(parsed.sections)) {
    throw new Error(
      "Gemini did not return a sections array."
    );
  }

  return {
    property_address: safeText(parsed.property_address),

    property_postcode: safeText(parsed.property_postcode),

    report_type: safeText(parsed.report_type),

    report_date: safeText(parsed.report_date),

    total_pages: safeInteger(parsed.total_pages),

    declaration_start_page: safeInteger(
      parsed.declaration_start_page
    ),

    meter_pages: Array.isArray(parsed.meter_pages)
      ? parsed.meter_pages
          .map((page: unknown) => safeInteger(page))
          .filter((page: number) => page > 0)
      : [],

    sections: parsed.sections
      .map((section: any) => ({
        room_name: safeText(section?.room_name),

        section_name: safeText(section?.section_name),

        start_page: safeInteger(section?.start_page),

        end_page: safeInteger(section?.end_page),

        photo_count: safeInteger(section?.photo_count),

        notes: safeText(section?.notes),
      }))
      .filter(
        (section: ExtractedSection) =>
          section.room_name.length > 0 &&
          section.section_name.length > 0
      ),
  };
}

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  let reportId = "";
  let supabaseForError: any = null;

  try {
    // ---------------------------------------------------------
    // 1. Get report ID from the dynamic Next.js route
    // ---------------------------------------------------------

    const params = await context.params;

    reportId = params.id;

    if (!reportId) {
      return NextResponse.json(
        {
          error: "Report ID is missing.",
        },
        {
          status: 400,
        }
      );
    }

    // ---------------------------------------------------------
    // 2. Create authenticated Supabase server client
    // ---------------------------------------------------------

    const supabase = await createClient();

    supabaseForError = supabase;

    // ---------------------------------------------------------
    // 3. Confirm that the user is logged in
    // ---------------------------------------------------------

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "You are not logged in.",
        },
        {
          status: 401,
        }
      );
    }

    // ---------------------------------------------------------
    // 4. Load ONLY this user's report
    // ---------------------------------------------------------

    const {
      data: report,
      error: reportError,
    } = await supabase
      .from("ai_reports")
      .select(
        `
          id,
          created_by,
          report_type,
          property_address,
          property_postcode,
          source_pdf_path,
          source_pdf_name,
          source_pdf_size,
          overview,
          status
        `
      )
      .eq("id", reportId)
      .eq("created_by", user.id)
      .single();

    if (reportError || !report) {
      return NextResponse.json(
        {
          error: "AI report could not be found.",
        },
        {
          status: 404,
        }
      );
    }

    if (!report.source_pdf_path) {
      return NextResponse.json(
        {
          error:
            "This report does not have an unfinished source PDF.",
        },
        {
          status: 400,
        }
      );
    }

    // ---------------------------------------------------------
    // 5. Mark structure analysis as started
    // ---------------------------------------------------------

    const {
      error: statusStartError,
    } = await supabase
      .from("ai_reports")
      .update({
        status: "analysing_structure",
        updated_at: new Date().toISOString(),
      })
      .eq("id", reportId)
      .eq("created_by", user.id);

    if (statusStartError) {
      throw new Error(
        `Could not start analysis: ${statusStartError.message}`
      );
    }

    // ---------------------------------------------------------
    // 6. Download the private source PDF from Supabase
    // ---------------------------------------------------------

    console.log(
      "Downloading source PDF:",
      report.source_pdf_name
    );

    const {
      data: pdfBlob,
      error: downloadError,
    } = await supabase.storage
      .from("inventory-report-files")
      .download(report.source_pdf_path);

    if (downloadError || !pdfBlob) {
      throw new Error(
        `Could not download source PDF: ${
          downloadError?.message ||
          "Unknown Supabase Storage error"
        }`
      );
    }

    console.log(
      "Downloaded PDF size:",
      pdfBlob.size,
      "bytes"
    );

    // Gemini inline PDF limit.
    const maxPdfSize = 50 * 1024 * 1024;

    if (pdfBlob.size > maxPdfSize) {
      throw new Error(
        "The PDF is larger than 50 MB and cannot be sent inline to Gemini."
      );
    }

    // ---------------------------------------------------------
    // 7. Convert PDF to base64
    // ---------------------------------------------------------

    const pdfArrayBuffer =
      await pdfBlob.arrayBuffer();

    const pdfBase64 = Buffer.from(
      pdfArrayBuffer
    ).toString("base64");

    if (!pdfBase64) {
      throw new Error(
        "Could not convert the PDF for AI analysis."
      );
    }

    // ---------------------------------------------------------
    // 8. Check Gemini API configuration
    // ---------------------------------------------------------

    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY is missing from .env.local."
      );
    }

    // GoogleGenAI automatically reads GEMINI_API_KEY
    // from the server environment.
    const ai = new GoogleGenAI({});

    // ---------------------------------------------------------
    // 9. Stage 1 prompt
    //
    // IMPORTANT:
    // This stage ONLY understands the report structure.
    // It does NOT create final photograph captions yet.
    // ---------------------------------------------------------

    const prompt = `
You are performing STAGE 1 of an automated UK property inventory processing system for Right Inventories.

You have been given an UNFINISHED Inventory or Inventory and Check-in PDF.

Your task in this stage is ONLY to understand the existing document structure accurately.

DO NOT produce final inventory photograph descriptions yet.

DO NOT redesign the report.

DO NOT invent rooms or subsections.

DO NOT remove existing legitimate rooms or subsections.

DO NOT merge subsections merely because they appear similar.

The source PDF already contains the intended structure, including:
- property details
- report type
- inspection date
- room and area headings
- subsection headings
- inspection photographs
- photograph order
- meter sections
- declaration/signature pages

Many photograph captions may currently contain the placeholder:
"Additional image"

Ignore those placeholder captions when determining the report structure.

==================================================
DOCUMENT STRUCTURE TO EXTRACT
==================================================

Identify:

1. Property address.
2. Property postcode.
3. Report type.
4. Report/inspection date.
5. Total physical number of pages in the PDF.
6. Every page containing meter photographs.
7. Every main room or area.
8. Every existing subsection beneath each room or area.
9. Physical PDF page range for each subsection.
10. Approximate number of actual inspection photographs in each subsection.
11. The physical PDF page where Declaration/signature content begins.

==================================================
IMPORTANT PAGE NUMBER RULE
==================================================

Use PHYSICAL PDF PAGE NUMBERS.

The first page of the PDF is page 1.

Do not use printed page numbers that might appear inside the document if they differ from the physical PDF page order.

==================================================
ROOM AND AREA RULE
==================================================

Examples of room/area headings that MAY occur include:

Meter readings
Smoke alarms
Carbon monoxide alarms
Keys
Exterior
Hallway
Kitchen
Reception room
Bedroom 1
Bedroom 2
Bathroom
Balcony

These are examples only.

Use the actual headings visible in THIS PDF.

Do not invent a heading because it appears in this instruction.

==================================================
SUBSECTION RULE
==================================================

Examples of subsections that MAY occur include:

General
Doors
Flooring
Walls and skirting boards
Windows and Blinds
Ceiling
Lighting
Heating
Sockets and Switches
Built in storage
Suites
Appliances
Furnishings
Shelving and Units
Worktop

Again, these are examples only.

Preserve the actual subsection names and order visible in THIS PDF.

==================================================
PHOTO COUNT RULE
==================================================

Count actual property inspection photographs only.

Do NOT count:
- logos
- icons
- decorative graphics
- signatures
- branding
- page furniture

A reasonable approximate count is acceptable in this structural stage.

==================================================
METER RULE
==================================================

Identify physical PDF pages containing:
- electricity meter photographs
- gas meter photographs
- water meter photographs

Do NOT attempt to guess meter readings or serial numbers in this stage.

Meter readings will be analysed separately later using stricter validation.

==================================================
DECLARATION RULE
==================================================

Do not include Declaration, tenant signature, clerk signature or legal declaration content in the sections array.

Return only the FIRST physical PDF page where declaration/signature content begins in declaration_start_page.

If no declaration section exists, return 0.

==================================================
ACCURACY RULE
==================================================

Never invent information.

If text cannot safely be determined:
return an empty string.

If a page number or count genuinely cannot be determined:
return 0.

Preserve the original report order.

Return ONLY the data required by the supplied JSON schema.
`;

    // ---------------------------------------------------------
    // 10. Send the FULL PDF to the current Gemini
    //     Interactions API.
    //
    // PDF is sent as a document input.
    // Structured JSON output is enforced by response_format.
    // ---------------------------------------------------------

    console.log(
      "Sending PDF to Gemini for structure analysis..."
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
            mime_type: "application/pdf",
          },
        ],

        response_format: [
          {
            type: "text",
            mime_type: "application/json",
            schema: structureSchema,
          },
        ],

        generation_config: {
          thinking_level: "medium",
          max_output_tokens: 32768,
        },

        store: false,
      });

    // ---------------------------------------------------------
    // 11. Read Gemini result
    // ---------------------------------------------------------

    const responseText =
      interaction.output_text;

    if (
      !responseText ||
      !responseText.trim()
    ) {
      throw new Error(
        "Gemini returned an empty response."
      );
    }

    console.log(
      "Gemini response received."
    );

    console.log(
      "Gemini response length:",
      responseText.length
    );

    // ---------------------------------------------------------
    // 12. Parse and validate JSON
    // ---------------------------------------------------------

    const analysis =
      parseGeminiJson(responseText);

    if (
      !Array.isArray(analysis.sections) ||
      analysis.sections.length === 0
    ) {
      throw new Error(
        "Gemini did not detect any inventory sections in the PDF."
      );
    }

    console.log(
      "Sections detected:",
      analysis.sections.length
    );

    // ---------------------------------------------------------
    // 13. Convert extracted structure into our database format
    // ---------------------------------------------------------

    const databaseSections =
      analysis.sections.map(
        (
          section: ExtractedSection,
          index: number
        ) => {
          let startPage =
            safeInteger(section.start_page);

          let endPage =
            safeInteger(section.end_page);

          // Fix accidental reversed ranges.
          if (
            startPage > 0 &&
            endPage > 0 &&
            endPage < startPage
          ) {
            const temporary = startPage;

            startPage = endPage;
            endPage = temporary;
          }

          return {
            report_id: reportId,

            room_name:
              safeText(section.room_name),

            section_name:
              safeText(section.section_name),

            sort_order: index,

            condition: null,

            cleanliness: null,

            ai_summary: JSON.stringify({
              start_page: startPage,

              end_page: endPage,

              photo_count:
                safeInteger(
                  section.photo_count
                ),

              notes:
                safeText(section.notes),
            }),
          };
        }
      );

    // ---------------------------------------------------------
    // 14. Delete previous extracted structure
    //
    // This makes the button safe to re-run after an error.
    // ---------------------------------------------------------

    const {
      error: deleteError,
    } = await supabase
      .from("ai_report_sections")
      .delete()
      .eq("report_id", reportId);

    if (deleteError) {
      throw new Error(
        `Could not clear previous extracted sections: ${deleteError.message}`
      );
    }

    // ---------------------------------------------------------
    // 15. Insert the newly extracted sections
    // ---------------------------------------------------------

    const {
      error: sectionInsertError,
    } = await supabase
      .from("ai_report_sections")
      .insert(databaseSections);

    if (sectionInsertError) {
      throw new Error(
        `Could not save extracted sections: ${sectionInsertError.message}`
      );
    }

    // ---------------------------------------------------------
    // 16. Preserve any existing overview information
    // ---------------------------------------------------------

    const oldOverview: Record<
      string,
      any
    > =
      report.overview &&
      typeof report.overview ===
        "object" &&
      !Array.isArray(
        report.overview
      )
        ? (report.overview as Record<
            string,
            any
          >)
        : {};

    // ---------------------------------------------------------
    // 17. Save source-document structure
    //
    // We keep the complete raw structure here so later stages
    // know which PDF pages correspond to each room/section.
    // ---------------------------------------------------------

    const sourceStructure = {
      property_address:
        analysis.property_address,

      property_postcode:
        analysis.property_postcode,

      report_type:
        analysis.report_type,

      report_date:
        analysis.report_date,

      total_pages:
        analysis.total_pages,

      declaration_start_page:
        analysis.declaration_start_page,

      meter_pages:
        analysis.meter_pages,

      sections:
        analysis.sections,
    };

    // ---------------------------------------------------------
    // 18. Update main report record
    // ---------------------------------------------------------

    const {
      error: reportUpdateError,
    } = await supabase
      .from("ai_reports")
      .update({
        property_address:
          analysis.property_address ||
          report.property_address ||
          null,

        property_postcode:
          analysis.property_postcode ||
          report.property_postcode ||
          null,

        report_type:
          analysis.report_type ||
          report.report_type ||
          "Inventory",

        overview: {
          ...oldOverview,

          source_structure:
            sourceStructure,
        },

        status:
          "sections_extracted",

        updated_at:
          new Date().toISOString(),
      })
      .eq("id", reportId)
      .eq("created_by", user.id);

    if (reportUpdateError) {
      throw new Error(
        `Could not update the main AI report: ${reportUpdateError.message}`
      );
    }

    // ---------------------------------------------------------
    // 19. Success
    // ---------------------------------------------------------

    console.log(
      "Structure analysis completed successfully."
    );

    console.log(
      "Property:",
      analysis.property_address
    );

    console.log(
      "Pages:",
      analysis.total_pages
    );

    console.log(
      "Sections:",
      analysis.sections.length
    );

    return NextResponse.json({
      ok: true,

      stage: "sections_extracted",

      report_id: reportId,

      property_address:
        analysis.property_address,

      property_postcode:
        analysis.property_postcode,

      report_type:
        analysis.report_type,

      report_date:
        analysis.report_date,

      total_pages:
        analysis.total_pages,

      declaration_start_page:
        analysis.declaration_start_page,

      meter_pages:
        analysis.meter_pages,

      sections_found:
        analysis.sections.length,

      sections:
        analysis.sections,
    });
  } catch (error) {
    // ---------------------------------------------------------
    // ERROR HANDLING
    // ---------------------------------------------------------

    console.error(
      "Full report analysis error:",
      error
    );

    if (
      reportId &&
      supabaseForError
    ) {
      try {
        await supabaseForError
          .from("ai_reports")
          .update({
            status: "analysis_error",

            updated_at:
              new Date().toISOString(),
          })
          .eq("id", reportId);
      } catch (
        statusUpdateError
      ) {
        console.error(
          "Could not update analysis_error status:",
          statusUpdateError
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,

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