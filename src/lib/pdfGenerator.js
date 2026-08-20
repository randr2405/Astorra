import jsPDF from "jspdf";

// Refined, understated palette — a single ink color plus warm neutrals,
// no loud color blocks. Elegance here comes from spacing and restraint,
// not saturation.
const INK = [30, 32, 36];          // near-black for headings/body
const MUTED = [130, 132, 138];     // secondary text
const HAIRLINE = [225, 226, 230];  // thin rules and dividers
const ACCENT = [24, 60, 92];       // deep, muted navy — used sparingly

const PAGE_WIDTH = 210;
const MARGIN_X = 24;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 162

function statusLabel(status) {
  const map = {
    paid: "Paid",
    accepted: "Accepted",
    unpaid: "Unpaid",
    sent: "Sent",
    draft: "Draft",
    overdue: "Overdue",
    declined: "Declined",
  };
  return map[status] || status;
}

function statusInkColor(status) {
  const map = {
    paid: [40, 110, 76],
    accepted: [40, 110, 76],
    unpaid: [150, 108, 30],
    sent: [45, 82, 140],
    draft: [120, 120, 120],
    overdue: [155, 60, 55],
    declined: [155, 60, 55],
  };
  return map[status] || MUTED;
}

// Truncates a single line to fit maxWidth, appending an ellipsis if needed,
// rather than letting jsPDF print text that visually overruns its column.
function fitLine(doc, text, maxWidth) {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && doc.getTextWidth(truncated + "…") > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "…";
}

function buildDocPdf({ type, number, business, customer, items, total, status }) {
  const doc = new jsPDF();
  const label = type === "invoice" ? "Invoice" : "Quote";

  let y = 26;

  // ---- Letterhead ----
  // Right-hand block (doc type + number) reserves its own zone so the
  // business name on the left can never run into it, however long it is.
  const rightBlockWidth = 60; // reserved zone for label + number, right-aligned
  const nameMaxWidth = CONTENT_WIDTH - rightBlockWidth - 8; // 8mm gutter

  doc.setFont("times", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  const nameLines = doc.splitTextToSize(business?.name || "Your Business", nameMaxWidth).slice(0, 2);
  nameLines.forEach((line, i) => doc.text(line, MARGIN_X, y + i * 8));
  const nameBlockHeight = nameLines.length > 1 ? nameLines.length * 8 : 0;

  doc.setFont("times", "italic");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text("One platform. Your way.", MARGIN_X, y + Math.max(6, nameBlockHeight + 6));

  // Document type + number, right aligned in their own reserved column
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), PAGE_WIDTH - MARGIN_X, y - 5, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(number, PAGE_WIDTH - MARGIN_X, y + 2, { align: "right" });

  y += Math.max(16, nameBlockHeight + 10);
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.6);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);

  y += 12;

  // ---- Bill To / Status / Date row ----
  // Three independent zones (left / middle / right) each with a hard
  // width cap, so a long customer name can wrap instead of colliding
  // with the status badge or date.
  const billToWidth = 85;
  const statusX = PAGE_WIDTH - MARGIN_X - 55;
  const dateX = PAGE_WIDTH - MARGIN_X;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("BILLED TO", MARGIN_X, y);
  doc.text("STATUS", statusX, y);
  doc.text("DATE", dateX, y, { align: "right" });

  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11.5);
  doc.setTextColor(...INK);
  const customerLines = doc.splitTextToSize(customer?.name || "—", billToWidth).slice(0, 2);
  customerLines.forEach((line, i) => doc.text(line, MARGIN_X, y + i * 6));

  const sColor = statusInkColor(status);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...sColor);
  doc.text(statusLabel(status), statusX, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(
    new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }),
    dateX,
    y,
    { align: "right" }
  );

  const billToBlockHeight = customerLines.length > 1 ? (customerLines.length - 1) * 6 : 0;
  y += billToBlockHeight;

  if (customer?.email) {
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(fitLine(doc, customer.email, billToWidth), MARGIN_X, y);
  }

  y += 14;

  // ---- Line items table ----
  // Fixed, non-overlapping zones: description gets the remaining space,
  // the three numeric columns are right-aligned so digits of varying
  // widths never bump into their neighbor.
  const colDescX = MARGIN_X;
  const colQtyRight = MARGIN_X + 108;
  const colPriceRight = MARGIN_X + 138;
  const colTotalRight = PAGE_WIDTH - MARGIN_X;
  const descWidth = colQtyRight - colDescX - 6; // 6mm gutter before Qty

  doc.setDrawColor(...INK);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("DESCRIPTION", colDescX, y);
  doc.text("QTY", colQtyRight, y, { align: "right" });
  doc.text("UNIT PRICE", colPriceRight, y, { align: "right" });
  doc.text("AMOUNT", colTotalRight, y, { align: "right" });

  y += 4;
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);

  y += 8;

  const rows = items && items.length ? items : [];

  if (rows.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    doc.text("No line items.", colDescX, y);
    y += 10;
  }

  const LINE_HEIGHT = 5;
  const ROW_PADDING = 5;

  rows.forEach((item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    const lineTotal = qty * price;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    // Wrap the description across as many lines as it needs (capped so a
    // single absurd entry can't run away) instead of silently truncating
    // to one line the way the previous version did.
    const descLines = doc.splitTextToSize(item.description || "", descWidth).slice(0, 4);
    const rowHeight = Math.max(descLines.length * LINE_HEIGHT, LINE_HEIGHT) + ROW_PADDING - LINE_HEIGHT;

    if (y + descLines.length * LINE_HEIGHT > 258) {
      doc.addPage();
      y = 24;
    }

    doc.setTextColor(...INK);
    descLines.forEach((line, i) => doc.text(line, colDescX, y + i * LINE_HEIGHT));

    // Numeric columns align to the first line of the description.
    doc.text(String(qty), colQtyRight, y, { align: "right" });
    doc.text(`R ${price.toFixed(2)}`, colPriceRight, y, { align: "right" });
    doc.text(`R ${lineTotal.toFixed(2)}`, colTotalRight, y, { align: "right" });

    const consumedHeight = Math.max(descLines.length * LINE_HEIGHT, LINE_HEIGHT);
    y += consumedHeight + (ROW_PADDING - LINE_HEIGHT) + 4;

    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, y - 3.5, PAGE_WIDTH - MARGIN_X, y - 3.5);

    if (y > 258) {
      doc.addPage();
      y = 24;
    }
  });

  // ---- Total ----
  if (y > 250) {
    doc.addPage();
    y = 24;
  }
  y += 6;
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.6);
  doc.line(PAGE_WIDTH - MARGIN_X - 75, y, PAGE_WIDTH - MARGIN_X, y);
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text("TOTAL DUE", PAGE_WIDTH - MARGIN_X - 75, y);

  doc.setFont("times", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...ACCENT);
  doc.text(`R ${Number(total).toFixed(2)}`, PAGE_WIDTH - MARGIN_X, y + 1, { align: "right" });

  // ---- Payment details ----
  // Only rendered for invoices (quotes have nothing to pay yet) and only
  // when the business has actually filled in banking details via Settings.
  const hasBankingDetails = type === "invoice" && business?.bank_name && business?.bank_account_number;

  if (hasBankingDetails) {
    if (y > 235) {
      doc.addPage();
      y = 24;
    }

    y += 14;
    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
    y += 9;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text("PAYMENT DETAILS", MARGIN_X, y);
    y += 7;

    const bankRows = [
      ["Bank", business.bank_name],
      ["Account holder", business.bank_account_holder],
      ["Account number", business.bank_account_number],
      ["Branch code", business.bank_branch_code],
      ["Account type", business.bank_account_type],
    ].filter(([, value]) => value);

    const bankLabelX = MARGIN_X;
    const bankValueX = MARGIN_X + 45;
    const bankValueWidth = CONTENT_WIDTH - 45;

    doc.setFontSize(9.5);
    bankRows.forEach(([bankLabel, value]) => {
      if (y > 270) {
        doc.addPage();
        y = 24;
      }
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text(bankLabel, bankLabelX, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...INK);
      doc.text(fitLine(doc, String(value), bankValueWidth), bankValueX, y);
      y += 6;
    });

    y += 2;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    const refNote = business.bank_payment_reference_note || `Please use "${number}" as your payment reference.`;
    const refLines = doc.splitTextToSize(refNote, CONTENT_WIDTH).slice(0, 3);
    doc.text(refLines, MARGIN_X, y);
    y += refLines.length * 5;
  }

  // ---- Footer ----
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_X, 275, PAGE_WIDTH - MARGIN_X, 275);

    doc.setFont("times", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text("Thank you for your business.", MARGIN_X, 282);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Page ${p} of ${pageCount}`, PAGE_WIDTH - MARGIN_X, 282, { align: "right" });
  }

  return doc;
}

export function generateQuotePdf(quote, customer, items, business) {
  return buildDocPdf({
    type: "quote",
    number: quote.quote_number,
    business,
    customer,
    items,
    total: quote.total,
    status: quote.status,
  });
}

export function generateInvoicePdf(invoice, customer, items, business) {
  return buildDocPdf({
    type: "invoice",
    number: invoice.invoice_number,
    business,
    customer,
    items: items || [],
    total: invoice.total,
    status: invoice.status,
  });
}

export function downloadPdf(doc, filename) {
  doc.save(filename);
}

export function pdfToBase64(doc) {
  return doc.output("datauristring").split(",")[1];
}