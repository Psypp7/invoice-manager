"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function NewAIReportPage() {
  const router = useRouter();

  const [pdfFile, setPdfFile] = useState(null);
  const [photos, setPhotos] = useState([]);

  const [reportType, setReportType] = useState(
    "Inventory and Check-in"
  );

  const [uploading, setUploading] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState("");

  function cleanFileName(name) {
    return name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_");
  }

  async function uploadOriginalPhotos({
    files,
    reportId,
    userId,
  }) {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];

      setProgressText(
        `Uploading original photo ${index + 1} of ${files.length}...`
      );

      const number = String(index + 1).padStart(4, "0");

      const fileName =
        `${number}-${Date.now()}-${cleanFileName(file.name)}`;

      const storagePath =
        `${userId}/${reportId}/${fileName}`;

      const { error: uploadError } =
        await supabase.storage
          .from("inventory-photos")
          .upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type,
          });

      if (uploadError) {
        throw new Error(
          `Photo upload failed: ${uploadError.message}`
        );
      }

      const { error: insertError } =
        await supabase
          .from("ai_report_photos")
          .insert({
            report_id: reportId,
            storage_path: storagePath,
            original_name: file.name,
            sort_order: index,
            include_in_report: true,
            review_required: false,
          });

      if (insertError) {
        throw new Error(
          `Photo database record failed: ${insertError.message}`
        );
      }
    }
  }

  async function importReport() {
    try {
      setError("");

      if (!pdfFile) {
        setError(
          "Please choose the unfinished inventory PDF."
        );
        return;
      }

      if (pdfFile.type !== "application/pdf") {
        setError("The unfinished report must be a PDF.");
        return;
      }

      if (pdfFile.size > 50 * 1024 * 1024) {
        setError(
          "The PDF is larger than 50 MB."
        );
        return;
      }

      setUploading(true);
      setProgressText("Creating AI report...");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You are not logged in.");
      }

      // Create the report record first.
      const {
        data: report,
        error: reportError,
      } = await supabase
        .from("ai_reports")
        .insert({
          created_by: user.id,
          report_type: reportType,
          status: "importing",
        })
        .select()
        .single();

      if (reportError || !report) {
        throw new Error(
          reportError?.message ||
            "Could not create the AI report."
        );
      }

      setProgressText(
        "Uploading unfinished inventory PDF..."
      );

      const pdfName =
        `${Date.now()}-${cleanFileName(pdfFile.name)}`;

      const pdfStoragePath =
        `${user.id}/${report.id}/${pdfName}`;

      const { error: pdfUploadError } =
        await supabase.storage
          .from("inventory-report-files")
          .upload(pdfStoragePath, pdfFile, {
            cacheControl: "3600",
            upsert: false,
            contentType: "application/pdf",
          });

      if (pdfUploadError) {
        throw new Error(
          `PDF upload failed: ${pdfUploadError.message}`
        );
      }

      const { error: updatePdfError } =
        await supabase
          .from("ai_reports")
          .update({
            source_pdf_path: pdfStoragePath,
            source_pdf_name: pdfFile.name,
            source_pdf_size: pdfFile.size,
            source_pdf_uploaded_at:
              new Date().toISOString(),
          })
          .eq("id", report.id);

      if (updatePdfError) {
        throw new Error(
          `Could not save PDF information: ${updatePdfError.message}`
        );
      }

      // Optional full-resolution originals.
      if (photos.length > 0) {
        await uploadOriginalPhotos({
          files: photos,
          reportId: report.id,
          userId: user.id,
        });
      }

      setProgressText("Preparing report for AI analysis...");

      const { error: finalUpdateError } =
        await supabase
          .from("ai_reports")
          .update({
            status: "source_uploaded",
            updated_at: new Date().toISOString(),
          })
          .eq("id", report.id);

      if (finalUpdateError) {
        throw new Error(finalUpdateError.message);
      }

      router.push(`/reports/${report.id}`);
    } catch (err) {
      console.error("Import report error:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl p-6">

        <div className="mb-8">
          <p className="text-sm font-medium text-gray-500">
            Right Inventories
          </p>

          <h1 className="mt-1 text-3xl font-bold text-gray-900">
            New AI Inventory Report
          </h1>

          <p className="mt-2 max-w-3xl text-gray-600">
            Upload the unfinished inventory PDF. The AI will
            use the existing room and section headings,
            analyse the photographs and prepare the complete
            report.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">

          <div className="rounded-2xl border bg-white p-6 shadow-sm">

            <h2 className="text-xl font-semibold">
              Unfinished report
            </h2>

            <div className="mt-6">
              <label className="mb-2 block text-sm font-semibold">
                Report type
              </label>

              <select
                value={reportType}
                onChange={(e) =>
                  setReportType(e.target.value)
                }
                className="w-full rounded-xl border border-gray-300 px-4 py-3"
              >
                <option value="Inventory">
                  Inventory
                </option>

                <option value="Inventory and Check-in">
                  Inventory & Check-in
                </option>
              </select>
            </div>

            <div className="mt-6">
              <label className="mb-2 block text-sm font-semibold">
                Unfinished inventory PDF
              </label>

              <input
                type="file"
                accept="application/pdf"
                onChange={(e) =>
                  setPdfFile(
                    e.target.files?.[0] || null
                  )
                }
                className="block w-full rounded-xl border border-gray-300 p-4"
              />

              <p className="mt-2 text-sm text-gray-500">
                Upload the report where the photographs are
                already placed under sections such as
                Hallway, Flooring, Walls, Kitchen,
                Appliances and so on.
              </p>

              {pdfFile && (
                <div className="mt-4 rounded-xl bg-gray-50 p-4">
                  <p className="font-semibold">
                    {pdfFile.name}
                  </p>

                  <p className="mt-1 text-sm text-gray-500">
                    {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              )}
            </div>

            <div className="mt-7 border-t pt-6">
              <label className="mb-2 block text-sm font-semibold">
                Original inspection photos
                <span className="ml-2 font-normal text-gray-500">
                  Optional
                </span>
              </label>

              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(e) =>
                  setPhotos(
                    Array.from(e.target.files || [])
                  )
                }
                className="block w-full rounded-xl border border-gray-300 p-4"
              />

              <p className="mt-2 text-sm text-gray-500">
                These are useful later for small scratches,
                meter readings, serial numbers and damage
                where the PDF image quality is not high enough.
              </p>

              {photos.length > 0 && (
                <div className="mt-4 rounded-xl bg-gray-50 p-4">
                  <p className="font-semibold">
                    {photos.length} original photograph
                    {photos.length === 1 ? "" : "s"} selected
                  </p>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
                {error}
              </div>
            )}

            {uploading && (
              <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="font-semibold text-blue-900">
                  Importing report
                </p>

                <p className="mt-1 text-sm text-blue-800">
                  {progressText}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={importReport}
              disabled={!pdfFile || uploading}
              className="mt-7 w-full rounded-xl bg-black px-6 py-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploading
                ? "Importing report..."
                : "Import Full Report"}
            </button>

          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm">

            <h2 className="text-lg font-semibold">
              What the AI will use
            </h2>

            <div className="mt-5 space-y-5">

              <Info
                title="Existing sections"
                text="Hallway, Kitchen, Bedroom, Bathroom and the existing sub-sections are kept."
              />

              <Info
                title="Photo order"
                text="The photographs stay in the same order as the unfinished report."
              />

              <Info
                title="Descriptions"
                text='The AI decides which photograph needs a full description, "Additional image" or "As above".'
              />

              <Info
                title="Damage"
                text="Scratches, chips, stains, marks, cracks, wear and cleaning issues are recorded where visible."
              />

              <Info
                title="Meters"
                text="Meter photographs receive separate high-detail analysis."
              />

              <Info
                title="Overview"
                text="The overview and suggested room actions are prepared after all sections have been analysed."
              />

            </div>

          </div>

        </div>
      </div>
    </div>
  );
}

function Info({ title, text }) {
  return (
    <div>
      <p className="font-semibold text-gray-900">
        {title}
      </p>

      <p className="mt-1 text-sm leading-6 text-gray-500">
        {text}
      </p>
    </div>
  );
}