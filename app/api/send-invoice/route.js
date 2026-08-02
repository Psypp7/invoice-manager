import React from "react";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { renderToBuffer } from "@react-pdf/renderer";

import InvoicePdf from "../../../components/InvoicePdf";
import { createInvoicePdfFilename } from "../../../lib/invoiceFileName";
import { createClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value) {
  return String(value ?? "").trim();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    cleanText(value)
  );
}

function escapeHtml(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function messageToHtml(message) {
  const escaped = escapeHtml(message);

  return escaped
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return '<div style="height: 14px;"></div>';
      }

      const withEmailLink =
        trimmed.replace(
          /(info@rightinventories\.co\.uk)/gi,
          '<a href="mailto:$1" style="color:#5b21b6;text-decoration:underline;">$1</a>'
        );

      const withWebsiteLink =
        withEmailLink.replace(
          /(www\.rightinventories\.co\.uk)/gi,
          '<a href="https://$1" style="color:#5b21b6;text-decoration:underline;">$1</a>'
        );

      const signatureLine =
        /^(Magda Rac-Paczesny|right inventories ltd|m:|e:|w:)/i.test(
          trimmed
        );

      return `<div style="${
        signatureLine
          ? "margin-top:2px;"
          : "margin-top:0;"
      }">${withWebsiteLink}</div>`;
    })
    .join("");
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
        {
          error:
            "You must be signed in to send an invoice.",
        },
        { status: 401 }
      );
    }

    const apiKey = cleanText(
      process.env.RESEND_API_KEY
    );

    const fromAddress = cleanText(
      process.env.RESEND_FROM_EMAIL
    );

    const replyTo = cleanText(
      process.env.RESEND_REPLY_TO
    );

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "RESEND_API_KEY is missing.",
        },
        { status: 500 }
      );
    }

    if (!fromAddress) {
      return NextResponse.json(
        {
          error:
            "RESEND_FROM_EMAIL is missing.",
        },
        { status: 500 }
      );
    }

    const body = await request.json();

    const invoice = body?.invoice;
    const business = body?.business || null;
    const recipient = cleanText(
      body?.to ||
        body?.recipientEmail ||
        body?.email
    );
    const subject = cleanText(
      body?.subject
    );
    const message = String(
      body?.message ?? ""
    ).trim();

    if (!validEmail(recipient)) {
      return NextResponse.json(
        {
          error:
            "Enter a valid recipient email address.",
        },
        { status: 400 }
      );
    }

    if (!subject) {
      return NextResponse.json(
        {
          error:
            "The email subject is required.",
        },
        { status: 400 }
      );
    }

    if (!message) {
      return NextResponse.json(
        {
          error:
            "The email message is required.",
        },
        { status: 400 }
      );
    }

    if (!invoice?.id) {
      return NextResponse.json(
        {
          error:
            "Complete invoice data is missing.",
        },
        { status: 400 }
      );
    }

    const {
      data: businessRecord,
      error: businessError,
    } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_user_id", user.id)
      .single();

    if (businessError || !businessRecord) {
      return NextResponse.json(
        {
          error:
            "The signed-in business could not be verified.",
        },
        { status: 403 }
      );
    }

    if (
      invoice.business_id &&
      invoice.business_id !==
        businessRecord.id
    ) {
      return NextResponse.json(
        {
          error:
            "You do not have access to this invoice.",
        },
        { status: 403 }
      );
    }

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

    const attachmentFilename =
      createInvoicePdfFilename(invoice);

    const resend = new Resend(apiKey);

    const payload = {
      from: fromAddress,
      to: [recipient],
      subject,
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#333;font-size:15px;line-height:1.5;">
          ${messageToHtml(message)}
        </div>
      `,
      text: message,
      attachments: [
        {
          filename:
            attachmentFilename,
          content: pdfBuffer,
        },
      ],
    };

    if (replyTo) {
      payload.replyTo = replyTo;
    }

    const {
      data,
      error,
    } = await resend.emails.send(
      payload
    );

    if (error) {
      console.error(
        "RESEND SEND-INVOICE ERROR:",
        error
      );

      return NextResponse.json(
        {
          error:
            error?.message ||
            "Resend could not send the invoice.",
        },
        { status: 500 }
      );
    }

    const sentAt =
      new Date().toISOString();

    const {
      error: updateError,
    } = await supabase
      .from("invoices")
      .update({
        sent_at: sentAt,
        customer_email: recipient,
        updated_at: sentAt,
      })
      .eq("id", invoice.id)
      .eq(
        "business_id",
        businessRecord.id
      );

    if (updateError) {
      console.error(
        "INVOICE SENT STATUS UPDATE ERROR:",
        updateError
      );
    }

    return NextResponse.json({
      success: true,
      emailId: data?.id || null,
      attachmentFilename,
      sentAt,
      message: `${invoice.invoice_number || "Invoice"} was emailed successfully.`,
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
