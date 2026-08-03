import jsPDF from "jspdf";

const BRAND_BLUE = [59, 130, 246];
const BRAND_BLUE_LIGHT = [55, 138, 221];
const BG_TINT = [232, 238, 245];
const TEXT_MUTED = [120, 130, 140];

function statusColor(status) {
  const map = {
    paid: [34, 139, 87],
    accepted: [34, 139, 87],
    unpaid: [200, 140, 30],
    sent: [55, 100, 200],
    draft: [140, 140, 140],
    overdue: [190, 60, 60],
    declined: [190, 60, 60],
  };
  return map[status] || [120, 120, 120];
}

function buildDocPdf({ type, number, business, customer, items, total, status }) {
  const doc = new jsPDF();
  const pageWidth = 210;
  const marginX = 20;
  const contentWidth = pageWidth - marginX * 2;

  // Header banner
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(0, 0, pageWidth, 38, "F");
  doc.setFillColor(...BRAND_BLUE_LIGHT);
  doc.rect(0, 36, pageWidth, 2, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont(undefined, "bold");
  doc.text(business?.name || "Your Business", marginX, 20);

  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.text("One platform. Your way.", marginX, 28);

  // Doc type + number, right aligned
  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  const label = type === "invoice" ? "INVOICE" : "QUOTE";
  doc.text(label, pageWidth - marginX, 18, { align: "right" });
  doc.setFontSize(11);
  doc.setFont(undefined, "normal");
  doc.text(number, pageWidth - marginX, 26, { align: "right" });

  let y = 52;

  // Status badge
  const sColor = statusColor(status);
  const badgeText = status.toUpperCase();
  doc.setFontSize(9);
  const badgeWidth = doc.getTextWidth(badgeText) + 10;
  doc.setFillColor(...sColor);
  doc.roundedRect(marginX, y - 5, badgeWidth, 7, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, "bold");
  doc.text(badgeText, marginX + 5, y);

  doc.setTextColor(...TEXT_MUTED);
  doc.setFont(undefined, "normal");
  doc.text(`Date: ${new Date().toLocaleDateString("en-ZA")}`, pageWidth - marginX, y, { align: "right" });

  y += 14;

  // Bill To block
  doc.setDrawColor(...BG_TINT);
  doc.setFillColor(...BG_TINT);
  doc.roundedRect(marginX, y, contentWidth, 26, 2, 2, "F");

  doc.setTextColor(...BRAND_BLUE);
  doc.setFontSize(9);
  doc.setFont(undefined, "bold");
  doc.text("BILL TO", marginX + 6, y + 8);

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(11);
  doc.text(customer?.name || "—", marginX + 6, y + 15);

  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  doc.setFont(undefined, "normal");
  if (customer?.email) {
    doc.text(customer.email, marginX + 6, y + 21);
  }

  y += 38;

  // Table header
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(marginX, y, contentWidth, 9, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont(undefined, "bold");
  doc.text("DESCRIPTION", marginX + 3, y + 6);
  doc.text("QTY", marginX + 108, y + 6);
  doc.text("UNIT PRICE", marginX + 128, y + 6);
  doc.text("LINE TOTAL", marginX + 160, y + 6);
  y += 9;

  doc.setTextColor(30, 30, 30);
  doc.setFont(undefined, "normal");

  const rows = items && items.length ? items : [];
  rows.forEach((item, i) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    const lineTotal = qty * price;
    const rowHeight = 9;

    if (i % 2 === 1) {
      doc.setFillColor(...BG_TINT);
      doc.rect(marginX, y, contentWidth, rowHeight, "F");
    }

    doc.setFontSize(9);
    const desc = doc.splitTextToSize(item.description || "", 100);
    doc.text(desc[0] || "", marginX + 3, y + 6);
    doc.text(String(qty), marginX + 108, y + 6);
    doc.text(`R${price.toFixed(2)}`, marginX + 128, y + 6);
    doc.setFont(undefined, "bold");
    doc.text(`R${lineTotal.toFixed(2)}`, marginX + 160, y + 6);
    doc.setFont(undefined, "normal");

    y += rowHeight;

    if (y > 250) {
      doc.addPage();
      y = 20;
    }
  });

  if (rows.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_MUTED);
    doc.text("No line items.", marginX + 3, y + 6);
    y += 9;
  }

  // Total box
  y += 8;
  doc.setDrawColor(...BRAND_BLUE);
  doc.setFillColor(...BRAND_BLUE);
  const totalBoxWidth = 70;
  doc.roundedRect(pageWidth - marginX - totalBoxWidth, y, totalBoxWidth, 16, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.text("TOTAL", pageWidth - marginX - totalBoxWidth + 6, y + 6);
  doc.setFontSize(14);
  doc.setFont(undefined, "bold");
  doc.text(`R${Number(total).toFixed(2)}`, pageWidth - marginX - 6, y + 12, { align: "right" });

  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(...BG_TINT);
    doc.line(marginX, 280, pageWidth - marginX, 280);
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.setFont(undefined, "normal");
    doc.text("Thank you for your business.", marginX, 287);
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - marginX, 287, { align: "right" });
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