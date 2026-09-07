"use client";

import { useEffect, useState } from "react";

type Damage = {
  type: string;
  location: string;
  description: string;
  severity: string;
  confidence: number;
  box_2d: number[];
};

type Analysis = {
  room_or_area: string;
  main_item: string;
  item_description: string;
  condition: string;
  cleanliness: string;
  damages: Damage[];
  visible_items: string[];
  report_comment: string;
  recommended_photo_label: string;
  manual_review_required: boolean;
  manual_review_reason: string;
};

export default function AIInventoryTestPage() {
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");

  const [roomHint, setRoomHint] = useState("");

  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  function handleImageChange(file: File | null) {
    setAnalysis(null);
    setError("");

    if (preview) {
      URL.revokeObjectURL(preview);
    }

    if (!file) {
      setImage(null);
      setPreview("");
      return;
    }

    setImage(file);
    setPreview(URL.createObjectURL(file));
  }

  async function analyseImage() {
    if (!image) {
      setError("Please choose a photograph first.");
      return;
    }

    setLoading(true);
    setError("");
    setAnalysis(null);

    try {
      const formData = new FormData();

      formData.append("image", image);
      formData.append("roomHint", roomHint);

      const response = await fetch(
        "/api/reports/analyse-image",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "The AI analysis failed."
        );
      }

      setAnalysis(data.analysis);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl p-6">
        {/* HEADER */}

        <div className="mb-8">
          <p className="mb-2 text-sm font-medium text-gray-500">
            Right Inventories
          </p>

          <h1 className="text-3xl font-bold text-gray-900">
            AI Inventory Vision Test
          </h1>

          <p className="mt-2 max-w-3xl text-gray-600">
            Upload one property photograph and test how the
            AI identifies the item, condition, cleanliness
            and visible damage.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          {/* LEFT SIDE */}

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">
              Property photograph
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Use an original inspection photograph where
              possible.
            </p>

            {/* ROOM HINT */}

            <div className="mt-6">
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Room / report section
              </label>

              <input
                type="text"
                value={roomHint}
                onChange={(event) =>
                  setRoomHint(event.target.value)
                }
                placeholder="Example: Hallway - Walls and skirting boards"
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 outline-none transition focus:border-black"
              />

              <p className="mt-2 text-xs text-gray-500">
                Optional, but giving the AI the correct
                section should improve its description.
              </p>
            </div>

            {/* FILE */}

            <div className="mt-6">
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Photograph
              </label>

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(event) =>
                  handleImageChange(
                    event.target.files?.[0] || null
                  )
                }
                className="block w-full rounded-xl border border-gray-300 bg-white p-3 text-sm"
              />
            </div>

            {/* PREVIEW */}

            {preview && (
              <div className="mt-6">
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
                  <img
                    src={preview}
                    alt="Selected property"
                    className="max-h-[650px] w-full object-contain"
                  />
                </div>

                {image && (
                  <div className="mt-3 text-sm text-gray-500">
                    <p>{image.name}</p>

                    <p>
                      {(image.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* BUTTON */}

            <button
              type="button"
              disabled={!image || loading}
              onClick={analyseImage}
              className="mt-6 w-full rounded-xl bg-black px-5 py-3.5 font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading
                ? "AI is inspecting the photograph..."
                : "Analyse photograph with AI"}
            </button>

            {loading && (
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="font-medium text-blue-900">
                  Inspecting photograph
                </p>

                <p className="mt-1 text-sm text-blue-700">
                  Looking for scratches, chips, scuffs,
                  staining, cracks, marks, cleanliness and
                  other visible defects.
                </p>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="font-semibold text-red-800">
                  Analysis error
                </p>

                <p className="mt-1 text-sm text-red-700">
                  {error}
                </p>
              </div>
            )}
          </div>

          {/* RIGHT SIDE */}

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">
              AI inspection result
            </h2>

            {!analysis && !loading && (
              <div className="mt-6 rounded-2xl border border-dashed border-gray-300 p-10 text-center">
                <p className="text-gray-500">
                  Your AI result will appear here.
                </p>
              </div>
            )}

            {analysis && (
              <div className="mt-6 space-y-6">
                {/* ROOM */}

                <div className="grid gap-4 sm:grid-cols-2">
                  <ResultBox
                    label="Room / area"
                    value={analysis.room_or_area}
                  />

                  <ResultBox
                    label="Inventory section"
                    value={analysis.main_item}
                  />
                </div>

                {/* DESCRIPTION */}

                <div className="rounded-xl border border-gray-200 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                    Item description
                  </p>

                  <p className="mt-2 text-gray-900">
                    {analysis.item_description}
                  </p>
                </div>

                {/* CONDITION */}

                <div className="grid gap-4 sm:grid-cols-2">
                  <ResultBox
                    label="Condition"
                    value={analysis.condition}
                  />

                  <ResultBox
                    label="Cleanliness"
                    value={analysis.cleanliness}
                  />
                </div>

                {/* FINAL REPORT COMMENT */}

                <div>
                  <p className="mb-2 text-sm font-bold text-gray-900">
                    Right Inventories description
                  </p>

                  <div className="whitespace-pre-wrap rounded-xl border-2 border-black bg-gray-50 p-5 text-base font-medium leading-7 text-gray-900">
                    {analysis.report_comment}
                  </div>
                </div>

                {/* DAMAGE */}

                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Damage detected
                    </h3>

                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
                      {analysis.damages.length} issue
                      {analysis.damages.length === 1
                        ? ""
                        : "s"}
                    </span>
                  </div>

                  {analysis.damages.length === 0 ? (
                    <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                      <p className="font-medium text-green-800">
                        No clear visible damage detected.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {analysis.damages.map(
                        (damage, index) => (
                          <div
                            key={`${damage.type}-${index}`}
                            className="rounded-xl border border-gray-200 p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="font-bold capitalize text-gray-900">
                                  {damage.type}
                                </p>

                                <p className="mt-1 text-sm text-gray-500">
                                  {damage.location}
                                </p>
                              </div>

                              <ConfidenceBadge
                                confidence={
                                  damage.confidence
                                }
                              />
                            </div>

                            <p className="mt-3 text-gray-800">
                              {damage.description}
                            </p>

                            <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                              <span>
                                Severity:{" "}
                                <strong>
                                  {damage.severity}
                                </strong>
                              </span>

                              {damage.box_2d?.length ===
                                4 && (
                                <span>
                                  Damage location recorded
                                  ✓
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>

                {/* VISIBLE ITEMS */}

                {analysis.visible_items?.length > 0 && (
                  <div>
                    <h3 className="mb-3 text-sm font-bold text-gray-900">
                      Other visible items
                    </h3>

                    <div className="flex flex-wrap gap-2">
                      {analysis.visible_items.map(
                        (item, index) => (
                          <span
                            key={`${item}-${index}`}
                            className="rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700"
                          >
                            {item}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* PHOTO LABEL */}

                <ResultBox
                  label="AI photograph classification"
                  value={
                    analysis.recommended_photo_label
                  }
                />

                {/* MANUAL REVIEW */}

                {analysis.manual_review_required && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
                    <p className="font-bold text-amber-900">
                      ⚠ Manual review recommended
                    </p>

                    <p className="mt-2 text-sm text-amber-800">
                      {analysis.manual_review_reason}
                    </p>
                  </div>
                )}

                {!analysis.manual_review_required && (
                  <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                    <p className="font-medium text-green-800">
                      ✓ AI considers this photograph clear
                      enough for the report.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultBox({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-gray-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
        {label}
      </p>

      <p className="mt-2 font-semibold text-gray-900">
        {value || "Not identified"}
      </p>
    </div>
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: number;
}) {
  let textClass =
    "bg-red-100 text-red-800";

  if (confidence >= 85) {
    textClass =
      "bg-green-100 text-green-800";
  } else if (confidence >= 65) {
    textClass =
      "bg-amber-100 text-amber-800";
  }

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-bold ${textClass}`}
    >
      {confidence}% confidence
    </span>
  );
}