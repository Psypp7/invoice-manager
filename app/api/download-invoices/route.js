import React from "react";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import InvoicePdf from "../../../components/InvoicePdf";
import { createInvoicePdfFilename } from "../../../lib/invoiceFileName";
import { createClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        (crc >>> 1) ^
        (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());

  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);

  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return { dosDate, dosTime };
}

function makeStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const content = Buffer.from(file.content);
    const checksum = crc32(content);
    const { dosDate, dosTime } = dosDateTime();

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);

    offset +=
      localHeader.length +
      name.length +
      content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    end,
  ]);
}

function cleanIds(value) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 100);
}

export async function POST(request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const invoiceIds = cleanIds(body?.invoiceIds);

    if (invoiceIds.length === 0) {
      return NextResponse.json(
        { error: "Select at least one invoice." },
        { status: 400 }
      );
    }

    const {
      data: business,
      error: businessError,
    } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_user_id", user.id)
      .single();

    if (businessError || !business) {
      throw businessError || new Error("Business not found.");
    }

    const {
      data: invoices,
      error: invoiceError,
    } = await supabase
      .from("invoices")
      .select(
        `
          *,
          client:clients(
            id,
            name,
            company_name,
            email
          ),
          property:properties(
            id,
            property_name,
            address_line_1,
            address_line_2,
            city,
            postcode
          ),
          invoice_items(
            *
          )
        `
      )
      .eq("business_id", business.id)
      .in("id", invoiceIds)
      .is("deleted_at", null);

    if (invoiceError) {
      throw invoiceError;
    }

    const invoiceMap = new Map(
      (invoices || []).map((invoice) => [
        invoice.id,
        invoice,
      ])
    );

    const orderedInvoices = invoiceIds
      .map((id) => invoiceMap.get(id))
      .filter(Boolean);

    if (orderedInvoices.length === 0) {
      return NextResponse.json(
        { error: "No selected invoices were found." },
        { status: 404 }
      );
    }

    const files = [];

    for (const invoice of orderedInvoices) {
      const sortedItems = [
        ...(invoice.invoice_items || []),
      ].sort(
        (first, second) =>
          Number(first.sort_order || 0) -
          Number(second.sort_order || 0)
      );

      const completeInvoice = {
        ...invoice,
        invoice_items: sortedItems,
      };

      const document = React.createElement(
        InvoicePdf,
        {
          invoice: completeInvoice,
        }
      );

      const pdfBuffer = await renderToBuffer(document);

      files.push({
        name: createInvoicePdfFilename(
          completeInvoice
        ),
        content: pdfBuffer,
      });
    }

    const zipBuffer = makeStoredZip(files);
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          `attachment; filename="selected-invoices-${date}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      "BULK DOWNLOAD INVOICES ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "The selected invoices could not be downloaded.",
      },
      { status: 500 }
    );
  }
}
