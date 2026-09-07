// ============================================================
// RIGHT INVENTORIES — INVENTORY AI V2
// ============================================================
//
// One-pass inventory analysis.
//
// IMPORTANT:
// - Runs completely inside the Right Inventories app.
// - Uses Google Gemini directly.
// - Does NOT depend on ChatGPT.
// - Old AI captions/condition results are NOT trusted.
// - Real extracted source photographs are the visual truth.
// ============================================================

export const INVENTORY_V2 = {
  model: "gemini-3.5-flash",

  // Maximum number of photographs in ONE Gemini request.
  //
  // 470-ish photos therefore require roughly 16 requests
  // instead of dozens/hundreds of calls.
  maxPhotosPerRequest: 30,

  // Inline Gemini requests have a request-size limit.
  // Stay comfortably below it after Base64 expansion.
  maxRawImageBytesPerRequest: 14_000_000,

  // Medium gives strong visual reasoning without making
  // every call unnecessarily slow.
  thinkingLevel: "medium",

  maxOutputTokens: 32768,

  // Small pause between successful calls.
  delayBetweenBatchesMs: 2000,

  // Never invent information that is not visible.
  neverGuess: true,

  // ----------------------------------------------------------
  // REPORT WORDING
  // ----------------------------------------------------------

  generalCaption: "General view",

  additionalImageCaption: "Additional image",

  asAboveCaption: "As above",

  internalViewCaption: "Internal view",

  // ----------------------------------------------------------
  // CONDITION
  // ----------------------------------------------------------

  conditionIssues: [
    "scuffs",
    "rub marks",
    "scratches",
    "chips",
    "cracks",
    "holes",
    "fixing holes",
    "dents",
    "paint loss",
    "paint touch-ups",
    "stains",
    "discolouration",
    "general wear",
    "heavy wear",
    "lifting",
    "gaps",
    "separation",
    "swelling",
    "water staining",
    "mould",
    "rust",
    "limescale",
    "grease",
    "dust",
    "debris",
    "damaged sealant",
    "damaged grout",
    "peeling",
    "missing parts",
    "broken parts",
  ],
} as const;

// Change this whenever we materially improve the V2 prompt.
// Existing V2 results will then automatically be re-analysed.
export const INVENTORY_V2_VERSION =
  "right-inventories-v2.1";