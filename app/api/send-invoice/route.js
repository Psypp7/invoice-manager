import React from "react";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { renderToBuffer } from "@react-pdf/renderer";
import InvoicePdf from "../../../components/InvoicePdf";
import { createInvoicePdfFilename } from "../../../lib/invoiceFileName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(request) {
  try {
    const apiKey =
      process.env.RESEND_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "RESEND_API_KEY is missing from the environment variables.",
        },
        { status: 500 }
      );
    }

    const body = await request.json();

    const invoice = body?.invoice;
    const business = body?.business || null;

    const recipient =
      cleanText(body?.to) ||
      cleanText(body?.recipientEmail) ||
      cleanText(body?.email);

    if (!recipient) {
      return NextResponse.json(
        {
          error:
            "A recipient email address is required.",
        },
        { status: 400 }
      );
    }

    if (!invoice || !invoice.id) {
      return NextResponse.json(
        {
          error:
            "Invoice data is missing. The email page must send the complete invoice object.",
        },
        { status: 400 }
      );
    }

    const invoiceNumber =
      cleanText(invoice.invoice_number) ||
      "Invoice";

    const attachmentFilename =
      createInvoicePdfFilename(invoice);

    const subject =
      cleanText(body?.subject) ||
      `${invoiceNumber} from Right Inventories London Ltd`;

    const message =
      cleanText(body?.message) ||
      `Please find ${invoiceNumber} attached.`;

    const fromAddress =
      cleanText(
        process.env.RESEND_FROM_EMAIL
      ) ||
      "Right Inventories London <onboarding@resend.dev>";

    const replyTo =
      cleanText(
        process.env.RESEND_REPLY_TO
      ) || undefined;

    const pdfDocument =
      React.createElement(
        InvoicePdf,
        {
          invoice,
          business,
        }
      );

    const pdfBuffer =
      await renderToBuffer(
        pdfDocument
      );

    const resend =
      new Resend(apiKey);

    const { data, error } =
      await resend.emails.send({
        from: fromAddress,
        to: [recipient],
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
            <p>${escapeHtml(message).replaceAll(
              "\n",
              "<br />"
            )}</p>

            <p>
              Kind regards,<br />
              Right Inventories London Ltd
            </p>
          </div>
        `,
        ...(replyTo
          ? { replyTo }
          : {}),
        attachments: [
          {
            filename:
              attachmentFilename,
            content: pdfBuffer,
          },
        ],
      });

    if (error) {
      console.error(
        "RESEND SEND-INVOICE ERROR:",
        error
      );

      return NextResponse.json(
        {
          error:
            error?.message ||
            "Resend could not send the invoice email.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      emailId: data?.id || null,
      attachmentFilename,
      message:
        `${invoiceNumber} was emailed successfully as ${attachmentFilename}.`,
    });
  } catch (error) {
    console.error(
      "SEND-INVOICE ROUTE ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "The invoice email could not be sent.",
      },
      { status: 500 }
    );
  }
}
