import jsPDF from "jspdf";

// Refined, understated palette — a single ink color plus warm neutrals,
// no loud color blocks. Elegance here comes from spacing and restraint,
// not saturation.
const INK = [30, 32, 36];          // near-black for headings/body
const MUTED = [130, 132, 138];     // secondary text
const HAIRLINE = [225, 226, 230];  // thin rules and dividers
const ACCENT = [24, 60, 92];       // deep, muted navy — used sparingly

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

function buildDocPdf({ type, number, business, customer, items, total, status }) {
  const doc = new jsPDF();
  const pageWidth = 210;
  const marginX = 24;
  const label = type === "invoice" ? "Invoice" : "Quote";

  let y = 26;

  // ---- Letterhead ----
  // Business name set as the visual anchor, quiet and confident —
  // no color banner, just weight and spacing to establish hierarchy.
  doc.setTextColor(...INK);
  doc.setFont("times", "bold");
  doc.setFontSize(22);
  doc.text(business?.name || "Your Business", marginX, y);

  doc.setFont("times", "italic");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text("One platform. Your way.", marginX, y + 6);

  // Document type + number, right aligned, restrained size
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), pageWidth - marginX, y - 5, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(number, pageWidth - marginX, y + 2, { align: "right" });

  y += 16;
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, pageWidth - marginX, y);

  y += 12;

  // ---- Bill To / Status / Date row ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("BILLED TO", marginX, y);

  doc.text("STATUS", pageWidth - marginX - 55, y);
  doc.text("DATE", pageWidth - marginX, y, { align: "right" });

  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11.5);
  doc.setTextColor(...INK);
  doc.text(customer?.name || "—", marginX, y);

  const sColor = statusInkColor(status);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...sColor);
  doc.text(statusLabel(status), pageWidth - marginX - 55, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }), pageWidth - marginX, y, { align: "right" });

  if (customer?.email) {
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(customer.email, marginX, y);
  }

  y += 14;

  // ---- Line items table ----
  const colDesc = marginX;
  const colQty = marginX + 112;
  const colPrice = marginX + 134;
  const colTotal = pageWidth - marginX;

  doc.setDrawColor(...INK);
  doc.setLineWidth(0.4);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("DESCRIPTION", colDesc, y);
  doc.text("QTY", colQty, y);
  doc.text("UNIT PRICE", colPrice, y);
  doc.text("AMOUNT", colTotal, y, { align: "right" });

  y += 4;
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.3);
  doc.line(marginX, y, pageWidth - marginX, y);

  y += 8;

  const rows = items && items.length ? items : [];

  if (rows.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    doc.text("No line items.", colDesc, y);
    y += 10;
  }

  rows.forEach((item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    const lineTotal = qty * price;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const desc = doc.splitTextToSize(item.description || "", 100);
    doc.text(desc[0] || "", colDesc, y);
    doc.text(String(qty), colQty, y);
    doc.text(`R ${price.toFixed(2)}`, colPrice, y);
    doc.text(`R ${lineTotal.toFixed(2)}`, colTotal, y, { align: "right" });

    y += 9;
    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.2);
    doc.line(marginX, y - 3.5, pageWidth - marginX, y - 3.5);

    if (y > 245) {
      doc.addPage();
      y = 24;
    }
  });

  // ---- Total ----
  y += 6;
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.6);
  doc.line(pageWidth - marginX - 75, y, pageWidth - marginX, y);
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text("TOTAL DUE", pageWidth - marginX - 75, y);

  doc.setFont("times", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...ACCENT);
  doc.text(`R ${Number(total).toFixed(2)}`, pageWidth - marginX, y + 1, { align: "right" });

  // ---- Footer ----
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.3);
    doc.line(marginX, 275, pageWidth - marginX, 275);

    doc.setFont("times", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text("Thank you for your business.", marginX, 282);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - marginX, 282, { align: "right" });
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