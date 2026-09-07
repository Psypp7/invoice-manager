import { NextResponse } from "next/server";

import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  spawn,
} from "node:child_process";

import {
  join,
} from "node:path";

import {
  tmpdir,
} from "node:os";

import {
  createClient,
} from "../../../../../lib/supabase/server";

export const runtime =
  "nodejs";

export const maxDuration =
  300;

const PAGE_BATCH_SIZE =
  5;

// ============================================================
// HELPERS
// ============================================================

function safeText(
  value: unknown
): string {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}

function safeNumber(
  value: unknown
): number {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : 0;
}

function parseObject(
  value: unknown
): any {
  if (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }

  if (
    typeof value ===
    "string"
  ) {
    try {
      return JSON.parse(
        value
      );
    } catch {
      return {};
    }
  }

  return {};
}

function extractionComplete(
  photo: any
): boolean {
  const analysis =
    parseObject(
      photo.ai_analysis
    );

  const extraction =
    parseObject(
      analysis.image_extraction
    );

  if (
    extraction.completed !==
    true
  ) {
    return false;
  }

  if (
    safeText(
      extraction.storage_path
    )
  ) {
    return true;
  }

  if (
    extraction.status ===
    "source_missing"
  ) {
    return true;
  }

  return false;
}

function getPhotoPage(
  photo: any
): number {
  return safeNumber(
    parseObject(
      photo.ai_analysis
    ).page_number
  );
}

function getPhotoIndex(
  photo: any
): number {
  return safeNumber(
    parseObject(
      photo.ai_analysis
    ).photo_index_on_page
  );
}

function calculateProgress(
  photos: any[]
) {
  let processed = 0;
  let realImages = 0;
  let sourceMissing = 0;

  for (
    const photo of
    photos
  ) {
    const analysis =
      parseObject(
        photo.ai_analysis
      );

    const extraction =
      parseObject(
        analysis.image_extraction
      );

    if (
      extractionComplete(
        photo
      )
    ) {
      processed++;
    }

    if (
      safeText(
        extraction.storage_path
      )
    ) {
      realImages++;
    }

    if (
      extraction.status ===
      "source_missing"
    ) {
      sourceMissing++;
    }
  }

  const total =
    photos.length;

  return {
    total_photo_count:
      total,

    extracted_photo_count:
      processed,

    processed_photo_count:
      processed,

    actual_image_count:
      realImages,

    source_missing_count:
      sourceMissing,

    remaining_photo_count:
      Math.max(
        0,
        total -
          processed
      ),

    progress_percent:
      total > 0
        ? Math.round(
            (
              processed /
              total
            ) * 100
          )
        : 0,

    completed:
      total > 0 &&
      processed ===
        total,
  };
}

// ============================================================
// RUN CHILD PROCESS
// ============================================================

function runExtractor(
  scriptPath: string,
  pdfPath: string,
  specPath: string,
  outputDirectory: string
): Promise<void> {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const child =
        spawn(
          process.execPath,
          [
            scriptPath,
            pdfPath,
            specPath,
            outputDirectory,
          ],
          {
            cwd:
              process.cwd(),

            env:
              process.env,

            windowsHide:
              true,

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          }
        );

      let stdout = "";
      let stderr = "";

      child.stdout.on(
        "data",
        (
          chunk
        ) => {
          const text =
            chunk.toString();

          stdout += text;

          process.stdout.write(
            text
          );
        }
      );

      child.stderr.on(
        "data",
        (
          chunk
        ) => {
          const text =
            chunk.toString();

          stderr += text;

          process.stderr.write(
            text
          );
        }
      );

      child.on(
        "error",
        (
          error
        ) => {
          reject(
            error
          );
        }
      );

      child.on(
        "close",
        (
          code
        ) => {
          if (
            code === 0
          ) {
            resolve();

            return;
          }

          reject(
            new Error(
              stderr ||
                stdout ||
                `Extractor exited with code ${code}.`
            )
          );
        }
      );
    }
  );
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
  let tempRoot = "";

  try {
    const params =
      await context.params;

    const reportId =
      params.id;

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
            "Report not found.",
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
        "Source PDF missing."
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
          report_id,
          sort_order,
          ai_analysis,
          include_in_report,
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

    if (
      !photoData ||
      photoData.length ===
        0
    ) {
      throw new Error(
        "No photo records found."
      );
    }

    const allPhotos =
      photoData;

    const before =
      calculateProgress(
        allPhotos
      );

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "PHOTO EXTRACTION"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `Processed: ${before.processed_photo_count}/${before.total_photo_count}`
    );

    console.log(
      `Actual images: ${before.actual_image_count}`
    );

    console.log(
      `Source missing: ${before.source_missing_count}`
    );

    if (
      before.completed
    ) {
      return NextResponse.json({
        ok: true,
        done: true,
        ...before,
      });
    }

    // ========================================================
    // NEXT UNFINISHED PAGE
    // ========================================================

    const pending =
      allPhotos.filter(
        (
          photo
        ) =>
          !extractionComplete(
            photo
          )
      );

    const first =
      pending[0];

    const startPage =
      getPhotoPage(
        first
      );

    if (
      startPage <= 0
    ) {
      throw new Error(
        "Next record has invalid page number."
      );
    }

    const endPage =
      startPage +
      PAGE_BATCH_SIZE -
      1;

    const pages = [];

    for (
      let pageNumber =
        startPage;
      pageNumber <=
        endPage;
      pageNumber++
    ) {
      const pagePhotos =
        allPhotos
          .filter(
            (
              photo
            ) =>
              getPhotoPage(
                photo
              ) ===
              pageNumber
          )
          .sort(
            (
              firstPhoto,
              secondPhoto
            ) =>
              getPhotoIndex(
                firstPhoto
              ) -
              getPhotoIndex(
                secondPhoto
              )
          );

      if (
        pagePhotos.length ===
        0
      ) {
        continue;
      }

      if (
        pagePhotos.every(
          extractionComplete
        )
      ) {
        continue;
      }

      pages.push({
        pageNumber,

        photos:
          pagePhotos.map(
            (
              photo,
              index
            ) => ({
              id:
                photo.id,

              photoIndex:
                getPhotoIndex(
                  photo
                ) ||
                index + 1,
            })
          ),
      });
    }

    if (
      pages.length === 0
    ) {
      throw new Error(
        "No unfinished extraction pages found."
      );
    }

    const actualEndPage =
      Math.max(
        ...pages.map(
          (
            page
          ) =>
            page.pageNumber
        )
      );

    // ========================================================
    // TEMP FILES
    // ========================================================

    tempRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "right-inventories-"
        )
      );

    const outputDirectory =
      join(
        tempRoot,
        "images"
      );

    await mkdir(
      outputDirectory,
      {
        recursive:
          true,
      }
    );

    const pdfPath =
      join(
        tempRoot,
        "source.pdf"
      );

    const specPath =
      join(
        tempRoot,
        "spec.json"
      );

    // ========================================================
    // DOWNLOAD SOURCE
    // ========================================================

    console.log(
      `Extracting pages ${startPage}-${actualEndPage}`
    );

    const {
      data:
        pdfBlob,
      error:
        downloadError,
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
        downloadError?.message ||
          "Could not download PDF."
      );
    }

    await writeFile(
      pdfPath,

      Buffer.from(
        await pdfBlob.arrayBuffer()
      )
    );

    await writeFile(
      specPath,

      JSON.stringify(
        {
          pages,
        },
        null,
        2
      ),

      "utf8"
    );

    // ========================================================
    // RUN STANDALONE EXTRACTOR
    // ========================================================

    const scriptPath =
      join(
        process.cwd(),
        "scripts",
        "extract-pdf-images.mjs"
      );

    console.log(
      `Standalone extractor: ${scriptPath}`
    );

    await runExtractor(
      scriptPath,
      pdfPath,
      specPath,
      outputDirectory
    );

    // ========================================================
    // READ MANIFEST
    // ========================================================

    const manifest =
      JSON.parse(
        await readFile(
          join(
            outputDirectory,
            "manifest.json"
          ),
          "utf8"
        )
      );

    const extracted =
      Array.isArray(
        manifest.photos
      )
        ? manifest.photos
        : [];

    const missing =
      Array.isArray(
        manifest.missing
      )
        ? manifest.missing
        : [];

    // ========================================================
    // SAVE REAL IMAGES
    // ========================================================

    for (
      const result of
      extracted
    ) {
      const photo =
        allPhotos.find(
          (
            item
          ) =>
            item.id ===
            result.photo_record_id
        );

      if (!photo) {
        continue;
      }

      const png =
        await readFile(
          join(
            outputDirectory,
            result.filename
          )
        );

      const storagePath =
        `${user.id}/${reportId}/extracted/page-${String(
          result.page_number
        ).padStart(
          3,
          "0"
        )}-photo-${String(
          result.photo_index_on_page
        ).padStart(
          2,
          "0"
        )}.png`;

      const {
        error:
          uploadError,
      } =
        await supabase.storage
          .from(
            "inventory-photos"
          )
          .upload(
            storagePath,
            png,
            {
              contentType:
                "image/png",

              upsert:
                true,

              cacheControl:
                "3600",
            }
          );

      if (
        uploadError
      ) {
        throw new Error(
          uploadError.message
        );
      }

      const oldAnalysis =
        parseObject(
          photo.ai_analysis
        );

      const newAnalysis = {
        ...oldAnalysis,

        image_extraction: {
          completed:
            true,

          status:
            "extracted",

          storage_path:
            storagePath,

          extracted_at:
            new Date()
              .toISOString(),

          page_number:
            safeNumber(
              result.page_number
            ),

          photo_index_on_page:
            safeNumber(
              result.photo_index_on_page
            ),

          source_object_id:
            safeText(
              result.source_object_id
            ),

          source_sequence:
            safeNumber(
              result.source_sequence
            ),

          pixel_width:
            safeNumber(
              result.pixel_width
            ),

          pixel_height:
            safeNumber(
              result.pixel_height
            ),

          display_box:
            parseObject(
              result.display_box
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
          saveError.message
        );
      }

      console.log(
        `Saved page ${result.page_number}, photo ${result.photo_index_on_page} ✓`
      );
    }

    // ========================================================
    // HANDLE PHANTOM / SOURCE-MISSING DATABASE RECORDS
    // ========================================================

    for (
      const result of
      missing
    ) {
      const photo =
        allPhotos.find(
          (
            item
          ) =>
            item.id ===
            result.photo_record_id
        );

      if (!photo) {
        continue;
      }

      const oldAnalysis =
        parseObject(
          photo.ai_analysis
        );

      const safeToExclude =
        result.safe_to_exclude ===
        true;

      const newAnalysis = {
        ...oldAnalysis,

        image_extraction: {
          completed:
            true,

          status:
            "source_missing",

          storage_path:
            "",

          handled_at:
            new Date()
              .toISOString(),

          page_number:
            safeNumber(
              result.page_number
            ),

          photo_index_on_page:
            safeNumber(
              result.photo_index_on_page
            ),

          reason:
            safeText(
              result.reason
            ),

          safe_to_exclude:
            safeToExclude,
        },
      };

      const updateData: any = {
        ai_analysis:
          newAnalysis,
      };

      if (
        safeToExclude
      ) {
        updateData.include_in_report =
          false;
      } else {
        updateData.review_required =
          true;
      }

      const {
        error:
          saveError,
      } =
        await supabase
          .from(
            "ai_report_photos"
          )
          .update(
            updateData
          )
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
          saveError.message
        );
      }

      console.log(
        safeToExclude
          ? `Phantom record excluded: page ${result.page_number}, photo ${result.photo_index_on_page} ✓`
          : `Missing-source record flagged: page ${result.page_number}, photo ${result.photo_index_on_page}`
      );
    }

    // ========================================================
    // REFRESH PROGRESS
    // ========================================================

    const {
      data:
        refreshed,
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
      refreshError
    ) {
      throw new Error(
        refreshError.message
      );
    }

    const after =
      calculateProgress(
        refreshed || []
      );

    // ========================================================
    // SAVE REPORT EXTRACTION PROGRESS
    // ========================================================

    const overview =
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
            ...overview,

            photo_extraction: {
              ...after,

              extraction_method:
                "standalone-pdfjs",

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

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "EXTRACTION CHECKPOINT SAVED"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `Processed: ${after.processed_photo_count}/${after.total_photo_count}`
    );

    console.log(
      `Actual images: ${after.actual_image_count}`
    );

    console.log(
      `Source missing: ${after.source_missing_count}`
    );

    console.log(
      `Progress: ${after.progress_percent}%`
    );

    return NextResponse.json({
      ok: true,

      done:
        after.completed,

      batch_completed: {
        start_page:
          startPage,

        end_page:
          actualEndPage,
      },

      ...after,
    });
  } catch (
    error
  ) {
    console.error(
      "PDF photo extraction error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown extraction error.",
      },
      {
        status: 500,
      }
    );
  } finally {
    if (
      tempRoot
    ) {
      try {
        await rm(
          tempRoot,
          {
            recursive:
              true,

            force:
              true,
          }
        );
      } catch {
        // Ignore temporary-file cleanup error.
      }
    }
  }
}