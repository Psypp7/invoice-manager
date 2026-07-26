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

function escapeHtml(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    cleanText(value)
  );
}

function cleanIds(value) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 50);
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

    const apiKey = cleanText(
      process.env.RESEND_API_KEY
    );

    const fromAddress = cleanText(
      process.env.RESEND_FROM_EMAIL
    );

    const replyTo = cleanText(
      process.env.RESEND_REPLY_TO
    );

    if (!apiKey || !fromAddress) {
      return NextResponse.json(
        {
          error:
            "The Resend environment variables are incomplete.",
        },
        { status: 500 }
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

    const resend = new Resend(apiKey);
    const failures = [];
    const sentInvoiceIds = [];

    for (const invoice of orderedInvoices) {
      const recipient =
        cleanText(invoice.customer_email) ||
        cleanText(invoice.client?.email);

      if (!isValidEmail(recipient)) {
        failures.push({
          invoiceNumber:
            invoice.invoice_number || "Invoice",
          error:
            "No valid saved client email address.",
        });
        continue;
      }

      try {
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

        const invoiceNumber =
          cleanText(invoice.invoice_number) ||
          "Invoice";

        const document = React.createElement(
          InvoicePdf,
          {
            invoice: completeInvoice,
          }
        );

        const pdfBuffer = await renderToBuffer(
          document
        );

        const payload = {
          from: fromAddress,
          to: [recipient],
          subject:
            `${invoiceNumber} from Right Inventories London Ltd`,
          html: `
            <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
              <p>
                ${escapeHtml(
                  `Please find ${invoiceNumber} attached.`
                )}
              </p>

              <p>
                Kind regards,<br />
                Right Inventories London Ltd
              </p>
            </div>
          `,
          attachments: [
            {
              filename:
                createInvoicePdfFilename(
                  completeInvoice
                ),
              content: pdfBuffer,
            },
          ],
        };

        if (replyTo) {
          payload.replyTo = replyTo;
        }

        const { error: sendError } =
          await resend.emails.send(payload);

        if (sendError) {
          throw new Error(
            sendError?.message ||
              "Resend rejected the email."
          );
        }

        sentInvoiceIds.push(invoice.id);
      } catch (error) {
        failures.push({
          invoiceNumber:
            invoice.invoice_number || "Invoice",
          error:
            error?.message ||
            "The email could not be sent.",
        });
      }
    }

    if (sentInvoiceIds.length > 0) {
      const { error: updateError } =
        await supabase
          .from("invoices")
          .update({
            sent_at: new Date().toISOString(),
          })
          .eq("business_id", business.id)
          .in("id", sentInvoiceIds);

      if (updateError) {
        console.error(
          "BULK SENT STATUS UPDATE ERROR:",
          updateError
        );
      }
    }

    return NextResponse.json({
      success: failures.length === 0,
      sentCount: sentInvoiceIds.length,
      failedCount: failures.length,
      failures,
    });
  } catch (error) {
    console.error(
      "BULK SEND INVOICES ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "The selected invoices could not be emailed.",
      },
      { status: 500 }
    );
  }
}
