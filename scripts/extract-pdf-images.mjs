import fs from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

import {
  getDocument,
  OPS,
} from "pdfjs-dist/legacy/build/pdf.mjs";

// ============================================================
// ARGUMENTS
// ============================================================

const [
  ,
  ,
  pdfPath,
  specPath,
  outputDirectory,
] = process.argv;

if (
  !pdfPath ||
  !specPath ||
  !outputDirectory
) {
  console.error(
    "Usage: node extract-pdf-images.mjs <pdf> <spec.json> <output-directory>"
  );

  process.exit(1);
}

// ============================================================
// BASIC HELPERS
// ============================================================

function safeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function getSourceSequence(sourceId) {
  const text =
    String(
      sourceId || ""
    );

  const match =
    text.match(
      /_(\d+)$/
    );

  if (!match) {
    return 0;
  }

  return safeNumber(
    match[1]
  );
}

// ============================================================
// MATRIX HELPERS
// ============================================================

function multiplyMatrix(
  first,
  second
) {
  const [
    a1,
    b1,
    c1,
    d1,
    e1,
    f1,
  ] = first;

  const [
    a2,
    b2,
    c2,
    d2,
    e2,
    f2,
  ] = second;

  return [
    a1 * a2 +
      c1 * b2,

    b1 * a2 +
      d1 * b2,

    a1 * c2 +
      c1 * d2,

    b1 * c2 +
      d1 * d2,

    a1 * e2 +
      c1 * f2 +
      e1,

    b1 * e2 +
      d1 * f2 +
      f1,
  ];
}

function transformPoint(
  matrix,
  x,
  y
) {
  return {
    x:
      matrix[0] * x +
      matrix[2] * y +
      matrix[4],

    y:
      matrix[1] * x +
      matrix[3] * y +
      matrix[5],
  };
}

function boundsFromMatrix(
  matrix
) {
  const points = [
    transformPoint(
      matrix,
      0,
      0
    ),

    transformPoint(
      matrix,
      1,
      0
    ),

    transformPoint(
      matrix,
      0,
      1
    ),

    transformPoint(
      matrix,
      1,
      1
    ),
  ];

  const xs =
    points.map(
      (point) =>
        point.x
    );

  const ys =
    points.map(
      (point) =>
        point.y
    );

  const minX =
    Math.min(...xs);

  const maxX =
    Math.max(...xs);

  const minY =
    Math.min(...ys);

  const maxY =
    Math.max(...ys);

  return {
    x: minX,
    y: minY,

    width:
      Math.abs(
        maxX - minX
      ),

    height:
      Math.abs(
        maxY - minY
      ),

    top:
      maxY,

    area:
      Math.abs(
        (maxX - minX) *
          (maxY - minY)
      ),
  };
}

// ============================================================
// PNG ENCODER
// ============================================================

const CRC_TABLE =
  (() => {
    const table =
      new Uint32Array(
        256
      );

    for (
      let n = 0;
      n < 256;
      n++
    ) {
      let c = n;

      for (
        let k = 0;
        k < 8;
        k++
      ) {
        c =
          c & 1
            ? 0xedb88320 ^
              (c >>> 1)
            : c >>> 1;
      }

      table[n] =
        c >>> 0;
    }

    return table;
  })();

function crc32(buffer) {
  let crc =
    0xffffffff;

  for (
    let index = 0;
    index < buffer.length;
    index++
  ) {
    crc =
      CRC_TABLE[
        (
          crc ^
          buffer[index]
        ) &
          0xff
      ] ^
      (crc >>> 8);
  }

  return (
    crc ^
    0xffffffff
  ) >>> 0;
}

function pngChunk(
  type,
  data
) {
  const typeBuffer =
    Buffer.from(
      type,
      "ascii"
    );

  const length =
    Buffer.alloc(4);

  length.writeUInt32BE(
    data.length,
    0
  );

  const crcBuffer =
    Buffer.alloc(4);

  crcBuffer.writeUInt32BE(
    crc32(
      Buffer.concat([
        typeBuffer,
        data,
      ])
    ),
    0
  );

  return Buffer.concat([
    length,
    typeBuffer,
    data,
    crcBuffer,
  ]);
}

function imageToPng(
  image
) {
  const width =
    safeNumber(
      image?.width
    );

  const height =
    safeNumber(
      image?.height
    );

  if (
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(
      "Invalid extracted image dimensions."
    );
  }

  if (!image?.data) {
    throw new Error(
      "Extracted PDF image contains no pixel data."
    );
  }

  const source =
    Buffer.from(
      image.data.buffer,
      image.data.byteOffset || 0,
      image.data.byteLength
    );

  const pixelCount =
    width * height;

  let channels;
  let pixels;

  // RGBA
  if (
    source.length ===
    pixelCount * 4
  ) {
    channels = 4;
    pixels = source;
  }

  // RGB
  else if (
    source.length ===
    pixelCount * 3
  ) {
    channels = 3;
    pixels = source;
  }

  // Greyscale
  else if (
    source.length ===
    pixelCount
  ) {
    channels = 1;
    pixels = source;
  }

  // 1-bit monochrome
  else if (
    source.length ===
    Math.ceil(
      width / 8
    ) *
      height
  ) {
    channels = 1;

    pixels =
      Buffer.alloc(
        pixelCount
      );

    const packedRowSize =
      Math.ceil(
        width / 8
      );

    for (
      let y = 0;
      y < height;
      y++
    ) {
      for (
        let x = 0;
        x < width;
        x++
      ) {
        const byteIndex =
          y *
            packedRowSize +
          Math.floor(
            x / 8
          );

        const bit =
          7 -
          (x % 8);

        const value =
          (
            source[
              byteIndex
            ] >>
            bit
          ) &
          1;

        pixels[
          y * width + x
        ] =
          value
            ? 255
            : 0;
      }
    }
  } else {
    throw new Error(
      `Unsupported extracted image buffer: ${width}x${height}, ${source.length} bytes.`
    );
  }

  const rowSize =
    width * channels;

  const raw =
    Buffer.alloc(
      (
        rowSize + 1
      ) *
        height
    );

  for (
    let y = 0;
    y < height;
    y++
  ) {
    const destination =
      y *
      (
        rowSize + 1
      );

    raw[
      destination
    ] = 0;

    pixels.copy(
      raw,
      destination + 1,
      y * rowSize,
      y * rowSize +
        rowSize
    );
  }

  const ihdr =
    Buffer.alloc(13);

  ihdr.writeUInt32BE(
    width,
    0
  );

  ihdr.writeUInt32BE(
    height,
    4
  );

  ihdr[8] = 8;

  ihdr[9] =
    channels === 4
      ? 6
      : channels === 3
        ? 2
        : 0;

  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed =
    deflateSync(
      raw,
      {
        level: 6,
      }
    );

  return Buffer.concat([
    Buffer.from([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
    ]),

    pngChunk(
      "IHDR",
      ihdr
    ),

    pngChunk(
      "IDAT",
      compressed
    ),

    pngChunk(
      "IEND",
      Buffer.alloc(0)
    ),
  ]);
}

// ============================================================
// PDF OBJECT ACCESS
// ============================================================

async function getPdfObject(
  page,
  objectId
) {
  const objectStore =
    objectId.startsWith(
      "g_"
    ) &&
    page.commonObjs
      ? page.commonObjs
      : page.objs;

  try {
    const existing =
      objectStore.get(
        objectId
      );

    if (existing) {
      return existing;
    }
  } catch {
    // Wait below.
  }

  return await new Promise(
    (
      resolve,
      reject
    ) => {
      let finished =
        false;

      const timer =
        setTimeout(
          () => {
            if (
              finished
            ) {
              return;
            }

            finished =
              true;

            reject(
              new Error(
                `Timed out waiting for PDF image ${objectId}.`
              )
            );
          },
          20000
        );

      try {
        objectStore.get(
          objectId,
          (
            value
          ) => {
            if (
              finished
            ) {
              return;
            }

            finished =
              true;

            clearTimeout(
              timer
            );

            resolve(
              value
            );
          }
        );
      } catch (
        error
      ) {
        if (
          finished
        ) {
          return;
        }

        finished =
          true;

        clearTimeout(
          timer
        );

        reject(
          error
        );
      }
    }
  );
}

// ============================================================
// COLLECT IMAGE OBJECTS
// ============================================================

async function collectPageImages(
  page
) {
  const operatorList =
    await page.getOperatorList();

  let matrix = [
    1,
    0,
    0,
    1,
    0,
    0,
  ];

  const stack = [];
  const candidates = [];

  for (
    let index = 0;
    index <
    operatorList.fnArray.length;
    index++
  ) {
    const fn =
      operatorList.fnArray[
        index
      ];

    const args =
      operatorList.argsArray[
        index
      ] || [];

    if (
      fn === OPS.save
    ) {
      stack.push([
        ...matrix,
      ]);

      continue;
    }

    if (
      fn === OPS.restore
    ) {
      matrix =
        stack.pop() || [
          1,
          0,
          0,
          1,
          0,
          0,
        ];

      continue;
    }

    if (
      fn ===
      OPS.transform
    ) {
      matrix =
        multiplyMatrix(
          matrix,
          [
            Number(args[0]),
            Number(args[1]),
            Number(args[2]),
            Number(args[3]),
            Number(args[4]),
            Number(args[5]),
          ]
        );

      continue;
    }

    let image = null;
    let sourceId = "";

    if (
      fn ===
      OPS.paintImageXObject
    ) {
      sourceId =
        String(
          args[0]
        );

      try {
        image =
          await getPdfObject(
            page,
            sourceId
          );
      } catch {
        continue;
      }
    } else if (
      OPS.paintJpegXObject &&
      fn ===
        OPS.paintJpegXObject
    ) {
      sourceId =
        String(
          args[0]
        );

      try {
        image =
          await getPdfObject(
            page,
            sourceId
          );
      } catch {
        continue;
      }
    } else if (
      fn ===
      OPS.paintInlineImageXObject
    ) {
      sourceId =
        `inline-${index}`;

      image =
        args[0];
    } else {
      continue;
    }

    if (
      !image ||
      !image.data ||
      !image.width ||
      !image.height
    ) {
      continue;
    }

    const bounds =
      boundsFromMatrix(
        matrix
      );

    candidates.push({
      source_id:
        sourceId,

      source_sequence:
        getSourceSequence(
          sourceId
        ),

      image,

      pixel_width:
        safeNumber(
          image.width
        ),

      pixel_height:
        safeNumber(
          image.height
        ),

      ...bounds,
    });
  }

  return candidates;
}

// ============================================================
// DETECT REAL INSPECTION PHOTOS
//
// IMPORTANT:
// This DOES NOT compare against how many AI records exist.
//
// If source PDF contains 8 real photographs and database says 9,
// we keep the 8 real photographs and mark record 9 missing.
// ============================================================

function chooseRealPhotos({
  candidates,
  pageWidth,
  pageHeight,
}) {
  const pageArea =
    pageWidth *
    pageHeight;

  let usable =
    candidates.filter(
      (
        candidate
      ) => {
        const ratio =
          candidate.width > 0
            ? candidate.height /
              candidate.width
            : 0;

        const wholePage =
          candidate.area >
          pageArea * 0.7;

        return (
          candidate.pixel_width >=
            80 &&
          candidate.pixel_height >=
            80 &&
          candidate.width >=
            30 &&
          candidate.height >=
            30 &&
          candidate.area >=
            900 &&
          ratio >=
            0.15 &&
          ratio <=
            6 &&
          !wholePage
        );
      }
    );

  if (
    usable.length ===
    0
  ) {
    usable =
      candidates.filter(
        (
          candidate
        ) =>
          candidate.pixel_width >=
            50 &&
          candidate.pixel_height >=
            50 &&
          candidate.area >=
            400
      );
  }

  const deduplicated =
    [];

  const seen =
    new Set();

  for (
    const candidate of
    usable
  ) {
    const key =
      [
        candidate.source_id,
        candidate.x.toFixed(1),
        candidate.y.toFixed(1),
        candidate.width.toFixed(1),
        candidate.height.toFixed(1),
      ].join("|");

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    deduplicated.push(
      candidate
    );
  }

  return deduplicated.sort(
    (
      first,
      second
    ) => {
      const firstSequence =
        safeNumber(
          first.source_sequence
        );

      const secondSequence =
        safeNumber(
          second.source_sequence
        );

      if (
        firstSequence > 0 &&
        secondSequence > 0 &&
        firstSequence !==
          secondSequence
      ) {
        return (
          firstSequence -
          secondSequence
        );
      }

      const rowDifference =
        Math.abs(
          first.top -
            second.top
        );

      if (
        rowDifference >
        20
      ) {
        return (
          second.top -
          first.top
        );
      }

      return (
        first.x -
        second.x
      );
    }
  );
}

// ============================================================
// MAP DATABASE RECORDS TO REAL PDF IMAGES
// ============================================================

function mapPhotoRecords(
  photoSpecs,
  realPhotos
) {
  const matches = [];
  const missing = [];

  // ----------------------------------------------------------
  // PRIMARY METHOD:
  // PDF image names such as:
  //
  // img_p49_1
  // img_p49_2
  // ...
  //
  // map naturally to database photo index.
  // ----------------------------------------------------------

  const sequenceMap =
    new Map();

  let reliableSequences =
    true;

  for (
    const candidate of
    realPhotos
  ) {
    const sequence =
      safeNumber(
        candidate.source_sequence
      );

    if (
      sequence <= 0 ||
      sequenceMap.has(
        sequence
      )
    ) {
      reliableSequences =
        false;

      break;
    }

    sequenceMap.set(
      sequence,
      candidate
    );
  }

  if (
    reliableSequences &&
    sequenceMap.size > 0
  ) {
    for (
      const spec of
      photoSpecs
    ) {
      const index =
        safeNumber(
          spec.photoIndex
        );

      const candidate =
        sequenceMap.get(
          index
        );

      if (
        candidate
      ) {
        matches.push({
          spec,
          candidate,
        });
      } else {
        missing.push({
          spec,

          reason:
            "The database contains this photo index but the original PDF contains no corresponding image.",
        });
      }
    }

    const sequences =
      [
        ...sequenceMap.keys(),
      ].sort(
        (
          first,
          second
        ) =>
          first - second
      );

    const contiguous =
      sequences.every(
        (
          value,
          index
        ) =>
          value ===
          index + 1
      );

    const maxSequence =
      sequences.length
        ? Math.max(
            ...sequences
          )
        : 0;

    return {
      method:
        "source-sequence",

      matches,

      missing:
        missing.map(
          (
            item
          ) => ({
            ...item,

            safe_to_exclude:
              contiguous &&
              safeNumber(
                item.spec
                  .photoIndex
              ) >
                maxSequence,

            source_sequence_max:
              maxSequence,
          })
        ),
    };
  }

  // ----------------------------------------------------------
  // FALLBACK:
  // visual order
  // ----------------------------------------------------------

  const count =
    Math.min(
      photoSpecs.length,
      realPhotos.length
    );

  for (
    let index = 0;
    index < count;
    index++
  ) {
    matches.push({
      spec:
        photoSpecs[
          index
        ],

      candidate:
        realPhotos[
          index
        ],
    });
  }

  for (
    let index = count;
    index <
    photoSpecs.length;
    index++
  ) {
    missing.push({
      spec:
        photoSpecs[
          index
        ],

      reason:
        "No corresponding source image could be located.",

      safe_to_exclude:
        false,

      source_sequence_max:
        0,
    });
  }

  return {
    method:
      "visual-order",

    matches,
    missing,
  };
}

// ============================================================
// MAIN
// ============================================================

let pdfDocument;

try {
  await fs.mkdir(
    outputDirectory,
    {
      recursive: true,
    }
  );

  const rawSpec =
    await fs.readFile(
      specPath,
      "utf8"
    );

  const spec =
    JSON.parse(
      rawSpec
    );

  console.log(
    `Standalone PDF loading: ${pdfPath}`
  );

  const loadingTask =
    getDocument({
      url: pdfPath,

      isEvalSupported:
        false,

      useSystemFonts:
        true,
    });

  pdfDocument =
    await loadingTask.promise;

  console.log(
    `PDF loaded. Pages: ${pdfDocument.numPages}`
  );

  const manifest = {
    photos: [],
    missing: [],
    pages: [],
  };

  for (
    const pageSpec of
    spec.pages || []
  ) {
    const pageNumber =
      safeNumber(
        pageSpec.pageNumber
      );

    const photoSpecs =
      Array.isArray(
        pageSpec.photos
      )
        ? pageSpec.photos
        : [];

    if (
      pageNumber <= 0 ||
      photoSpecs.length ===
        0
    ) {
      continue;
    }

    console.log("");
    console.log(
      `Page ${pageNumber}: database records = ${photoSpecs.length}`
    );

    const page =
      await pdfDocument.getPage(
        pageNumber
      );

    const view =
      page.view;

    const pageWidth =
      Math.abs(
        view[2] -
          view[0]
      );

    const pageHeight =
      Math.abs(
        view[3] -
          view[1]
      );

    const allCandidates =
      await collectPageImages(
        page
      );

    const realPhotos =
      chooseRealPhotos({
        candidates:
          allCandidates,

        pageWidth,

        pageHeight,
      });

    console.log(
      `Page ${pageNumber}: PDF image objects = ${allCandidates.length}`
    );

    console.log(
      `Page ${pageNumber}: real inspection photos = ${realPhotos.length}`
    );

    const mapping =
      mapPhotoRecords(
        photoSpecs,
        realPhotos
      );

    console.log(
      `Page ${pageNumber}: mapping = ${mapping.method}`
    );

    console.log(
      `Page ${pageNumber}: matched = ${mapping.matches.length}`
    );

    console.log(
      `Page ${pageNumber}: missing = ${mapping.missing.length}`
    );

    // ========================================================
    // EXTRACT REAL MATCHED PHOTOS
    // ========================================================

    for (
      const match of
      mapping.matches
    ) {
      const specPhoto =
        match.spec;

      const candidate =
        match.candidate;

      const photoIndex =
        safeNumber(
          specPhoto.photoIndex
        );

      const png =
        imageToPng(
          candidate.image
        );

      const filename =
        `page-${String(
          pageNumber
        ).padStart(
          3,
          "0"
        )}-photo-${String(
          photoIndex
        ).padStart(
          2,
          "0"
        )}.png`;

      await fs.writeFile(
        path.join(
          outputDirectory,
          filename
        ),
        png
      );

      const result = {
        photo_record_id:
          String(
            specPhoto.id
          ),

        page_number:
          pageNumber,

        photo_index_on_page:
          photoIndex,

        filename,

        source_object_id:
          candidate.source_id,

        source_sequence:
          safeNumber(
            candidate.source_sequence
          ),

        pixel_width:
          candidate.pixel_width,

        pixel_height:
          candidate.pixel_height,

        display_box: {
          x:
            candidate.x,

          y:
            candidate.y,

          width:
            candidate.width,

          height:
            candidate.height,
        },
      };

      manifest.photos.push(
        result
      );

      console.log(
        `Page ${pageNumber}, photo ${photoIndex} extracted ✓`
      );
    }

    // ========================================================
    // RECORD MISSING DATABASE ENTRIES
    // ========================================================

    for (
      const item of
      mapping.missing
    ) {
      const missingResult = {
        photo_record_id:
          String(
            item.spec.id
          ),

        page_number:
          pageNumber,

        photo_index_on_page:
          safeNumber(
            item.spec.photoIndex
          ),

        reason:
          item.reason,

        safe_to_exclude:
          item.safe_to_exclude ===
          true,

        source_sequence_max:
          safeNumber(
            item.source_sequence_max
          ),
      };

      manifest.missing.push(
        missingResult
      );

      console.warn(
        `Page ${pageNumber}, database photo ${missingResult.photo_index_on_page}: no corresponding PDF photo.`
      );
    }

    manifest.pages.push({
      page_number:
        pageNumber,

      database_records:
        photoSpecs.length,

      actual_photos:
        realPhotos.length,

      matched:
        mapping.matches.length,

      missing:
        mapping.missing.length,

      mapping_method:
        mapping.method,
    });

    page.cleanup();
  }

  const manifestPath =
    path.join(
      outputDirectory,
      "manifest.json"
    );

  await fs.writeFile(
    manifestPath,

    JSON.stringify(
      manifest,
      null,
      2
    ),

    "utf8"
  );

  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    "STANDALONE EXTRACTION FINISHED"
  );

  console.log(
    "=========================================="
  );

  console.log(
    `Real images extracted: ${manifest.photos.length}`
  );

  console.log(
    `Database records without source images: ${manifest.missing.length}`
  );

  console.log(
    `EXTRACTION_COMPLETE:${manifestPath}`
  );
} catch (
  error
) {
  console.error(
    "Standalone extraction failed:"
  );

  console.error(
    error instanceof Error
      ? error.stack ||
          error.message
      : String(error)
  );

  process.exitCode =
    1;
} finally {
  if (
    pdfDocument
  ) {
    try {
      await pdfDocument.destroy();
    } catch {
      // ignore
    }
  }
}