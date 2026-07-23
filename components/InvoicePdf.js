import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Link,
} from "@react-pdf/renderer";

/*
  Exact layout reference:
  RL1044 Raakhee Lakhani 20.07.2026

  IMPORTANT:
  The original invoice is US Letter size (612 x 792 points),
  not A4. These positions reproduce that document.
*/

const styles = StyleSheet.create({
  page: {
    width: 612,
    height: 792,
    position: "relative",
    fontFamily: "Helvetica",
    fontSize: 11,
    color: "#222222",
    backgroundColor: "#ffffff",
  },

  brand: {
    position: "absolute",
    left: 74,
    top: 34,
    fontSize: 25,
    lineHeight: 1,
    color: "#d0007f",
  },

  invoiceTitle: {
    position: "absolute",
    left: 415,
    top: 76,
    width: 145,
    fontFamily: "Helvetica-Bold",
    fontSize: 25,
    lineHeight: 1,
    textAlign: "center",
  },

  businessBlock: {
    position: "absolute",
    left: 70,
    top: 122,
    width: 240,
  },

  businessName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    lineHeight: 1.18,
    marginBottom: 4,
  },

  businessLine: {
    fontSize: 11,
    lineHeight: 1.18,
    marginBottom: 4,
  },

  website: {
    color: "#426429",
    textDecoration: "underline",
  },

  invoiceInfoBlock: {
    position: "absolute",
    left: 417,
    top: 123,
    width: 150,
  },

  invoiceInfoRow: {
    flexDirection: "row",
    height: 18,
    alignItems: "flex-start",
  },

  invoiceInfoLabel: {
    width: 83,
    fontSize: 10,
    lineHeight: 1,
  },

  invoiceInfoValue: {
    width: 67,
    fontSize: 11,
    lineHeight: 1,
  },

  customerBlock: {
    position: "absolute",
    left: 72,
    top: 259,
    width: 310,
  },

  customerName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    lineHeight: 1.18,
    marginBottom: 4,
  },

  customerLine: {
    fontSize: 11,
    lineHeight: 1.18,
    marginBottom: 4,
  },

  lineTotalHeading: {
    position: "absolute",
    left: 438,
    top: 340,
    width: 98,
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    lineHeight: 1,
    textAlign: "right",
  },

  descriptionHeading: {
    position: "absolute",
    left: 77,
    top: 381,
    width: 130,
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    lineHeight: 1,
  },

  headingRule: {
    position: "absolute",
    left: 77,
    top: 402,
    width: 457,
    borderTopWidth: 0.6,
    borderTopColor: "#666666",
  },

  itemsBlock: {
    position: "absolute",
    left: 77,
    top: 418,
    width: 457,
  },

  itemRow: {
    position: "relative",
    width: 457,
    minHeight: 34,
  },

  itemDescription: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 352,
    fontSize: 11,
    lineHeight: 1.35,
  },

  itemAmount: {
    position: "absolute",
    right: 0,
    top: 0,
    width: 70,
    fontSize: 11,
    lineHeight: 1.1,
    textAlign: "right",
  },

  totalBlock: {
    position: "absolute",
    left: 402,
    top: 613,
    width: 133,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  totalLabel: {
    width: 55,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    lineHeight: 1,
  },

  totalAmount: {
    width: 55,
    fontSize: 11,
    lineHeight: 1,
    textAlign: "right",
  },

  bankBlock: {
    position: "absolute",
    left: 77,
    top: 667,
    width: 180,
  },

  footerHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    lineHeight: 1.18,
    marginBottom: 4,
  },

  footerLine: {
    fontSize: 11,
    lineHeight: 1.18,
    marginBottom: 4,
  },

  termsBlock: {
    position: "absolute",
    left: 332,
    top: 667,
    width: 230,
  },

  termsRow: {
    flexDirection: "row",
    fontSize: 11,
    lineHeight: 1.18,
    marginBottom: 4,
  },

  bold: {
    fontFamily: "Helvetica-Bold",
  },
});

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatInvoiceDate(value) {
  if (!value) return "";

  const parts = String(value).slice(0, 10).split("-");

  if (parts.length !== 3) {
    return String(value);
  }

  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function splitAddress(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((line) => String(line).trim())
      .filter(Boolean);
  }

  const text = String(value).trim();

  if (text.includes("\n")) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return text
    .split(",")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function InvoicePdf({ invoice }) {
  const items = Array.isArray(invoice?.invoice_items)
    ? invoice.invoice_items
    : [];

  const customerAddress = splitAddress(
    invoice?.customer_address
  );

  return (
    <Document
      title={`${invoice?.invoice_number || "Invoice"}.pdf`}
      author="Right Inventories London Ltd"
      subject="Invoice"
    >
      <Page size={[612, 792]} style={styles.page}>
        <Text style={styles.brand}>
          right inventories london
        </Text>

        <Text style={styles.invoiceTitle}>
          INVOICE
        </Text>

        <View style={styles.businessBlock}>
          <Text style={styles.businessName}>
            Right Inventories London Ltd
          </Text>

          <Text style={styles.businessLine}>
            145 Kings Road
          </Text>

          <Text style={styles.businessLine}>
            Harrow, Middlesex HA2 9LE
          </Text>

          <Text style={styles.businessLine}>
            Tel. 07866611413
          </Text>

          <Link
            src="https://www.rightinventories.co.uk"
            style={[
              styles.businessLine,
              styles.website,
            ]}
          >
            www.rightinventories.co.uk
          </Link>
        </View>

        <View style={styles.invoiceInfoBlock}>
          <View style={styles.invoiceInfoRow}>
            <Text style={styles.invoiceInfoLabel}>
              Invoice number
            </Text>

            <Text style={styles.invoiceInfoValue}>
              {invoice?.invoice_number || ""}
            </Text>
          </View>

          <View style={styles.invoiceInfoRow}>
            <Text style={styles.invoiceInfoLabel}>
              Invoice date
            </Text>

            <Text style={styles.invoiceInfoValue}>
              {formatInvoiceDate(
                invoice?.issue_date
              )}
            </Text>
          </View>
        </View>

        <View style={styles.customerBlock}>
          <Text style={styles.customerName}>
            {invoice?.customer_name || ""}
          </Text>

          {customerAddress.map((line, index) => (
            <Text
              key={`${line}-${index}`}
              style={styles.customerLine}
            >
              {line}
            </Text>
          ))}
        </View>

        <Text style={styles.lineTotalHeading}>
          LINE TOTAL
        </Text>

        <Text style={styles.descriptionHeading}>
          DESCRIPTION
        </Text>

        <View style={styles.headingRule} />

        <View style={styles.itemsBlock}>
          {items.map((item, index) => (
            <View
              key={item?.id || index}
              style={[
                styles.itemRow,
                {
                  top: index * 44,
                },
              ]}
              wrap={false}
            >
              <Text style={styles.itemDescription}>
                {item?.description || ""}
              </Text>

              <Text style={styles.itemAmount}>
                {money(
                  item?.line_total ??
                    Number(item?.quantity || 1) *
                      Number(item?.unit_price || 0)
                )}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalBlock}>
          <Text style={styles.totalLabel}>
            TOTAL:
          </Text>

          <Text style={styles.totalAmount}>
            {money(invoice?.total)}
          </Text>
        </View>

        <View style={styles.bankBlock}>
          <Text style={styles.footerHeading}>
            Bank details
          </Text>

          <Text style={styles.footerLine}>
            HSBC Bank
          </Text>

          <Text style={styles.footerLine}>
            Sort Code 40-46-09
          </Text>

          <Text style={styles.footerLine}>
            Account 92210193
          </Text>
        </View>

        <View style={styles.termsBlock}>
          <View style={styles.termsRow}>
            <Text style={styles.bold}>
              Terms:{" "}
            </Text>

            <Text>
              Total payable on receipt of invoice
            </Text>
          </View>

          <View style={styles.termsRow}>
            <Text style={styles.bold}>
              Preferred payment method:{" "}
            </Text>

            <Text>Bank Transfer</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
