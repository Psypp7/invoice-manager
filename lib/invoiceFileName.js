function cleanText(value) {
  return String(value ?? "").trim();
}

function getInvoiceClientName(invoice) {
  return (
    cleanText(invoice?.customer_name) ||
    cleanText(invoice?.client?.company_name) ||
    cleanText(invoice?.client?.name) ||
    cleanText(invoice?.company_name) ||
    cleanText(invoice?.landlord_name) ||
    "Client"
  );
}

function formatInvoiceDateForFilename(value) {
  const text = cleanText(value);

  if (!text) {
    return "No Date";
  }

  // Supabase dates normally arrive as YYYY-MM-DD.
  // Read the calendar parts directly so UK/BST cannot shift the date.
  const isoDate = text.match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (isoDate) {
    return `${isoDate[3]}.${isoDate[2]}.${isoDate[1]}`;
  }

  // Also support DD/MM/YYYY or DD.MM.YYYY.
  const ukDate = text.match(
    /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/
  );

  if (ukDate) {
    return [
      String(Number(ukDate[1])).padStart(2, "0"),
      String(Number(ukDate[2])).padStart(2, "0"),
      ukDate[3],
    ].join(".");
  }

  return text.replaceAll("-", ".");
}

function safeFilenamePart(value, fallback) {
  const cleaned = cleanText(value)
    // Remove characters Windows does not allow in filenames.
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    // Replace repeated spaces with one space.
    .replace(/\s+/g, " ")
    // Avoid filenames ending with a dot or space.
    .replace(/[. ]+$/g, "")
    .trim();

  return cleaned || fallback;
}

export function createInvoicePdfFilename(invoice) {
  const invoiceNumber = safeFilenamePart(
    invoice?.invoice_number,
    "Invoice"
  );

  const clientName = safeFilenamePart(
    getInvoiceClientName(invoice),
    "Client"
  );

  const invoiceDate = safeFilenamePart(
    formatInvoiceDateForFilename(
      invoice?.issue_date
    ),
    "No Date"
  );

  const filename =
    `${invoiceNumber} ${clientName} ${invoiceDate}.pdf`;

  // Keep the complete filename within a sensible cross-platform length.
  if (filename.length <= 180) {
    return filename;
  }

  const reservedLength =
    invoiceNumber.length +
    invoiceDate.length +
    "  .pdf".length;

  const allowedClientLength = Math.max(
    20,
    180 - reservedLength
  );

  const shortenedClient = clientName
    .slice(0, allowedClientLength)
    .trim();

  return `${invoiceNumber} ${shortenedClient} ${invoiceDate}.pdf`;
}