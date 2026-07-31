import jsPDF from "jspdf";

function buildDocPdf({ type, number, business, customer, items, total, status }) {
  const doc = new jsPDF();
  const marginX = 20;
  let y = 20;

  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.text(business?.name || "Your Business", marginX, y);

  doc.setFontSize(11);
  doc.setFont(undefined, "normal");
  y += 10;
  doc.text(type === "invoice" ? "INVOICE" : "QUOTE", marginX, y);
  doc.text(number, marginX + 30, y);

  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Status: ${status}`, marginX, y);
  doc.text(`Date: ${new Date().toLocaleDateString("en-ZA")}`, 150, y);
  doc.setTextColor(0);

  y += 12;
  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  doc.text("Bill to", marginX, y);
  doc.setFont(undefined, "normal");
  y += 6;
  doc.text(customer?.name || "—", marginX, y);
  if (customer?.email) {
    y += 5;
    doc.text(customer.email, marginX, y);
  }

  y += 12;
  doc.setFillColor(24, 95, 165);
  doc.rect(marginX, y, 170, 8, "F");
  doc.setTextColor(255);
  doc.setFontSize(10);
  doc.text("Description", marginX + 2, y + 5.5);
  doc.text("Qty", marginX + 110, y + 5.5);
  doc.text("Unit price", marginX + 130, y + 5.5);
  doc.text("Line total", marginX + 160, y + 5.5);
  doc.setTextColor(0);
  y += 8;

  (items && items.length ? items : []).forEach((item, i) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    const lineTotal = qty * price;

    if (i % 2 === 1) {
      doc.setFillColor(232, 238, 245);
      doc.rect(marginX, y, 170, 8, "F");
    }

    doc.setFontSize(9);
    const desc = doc.splitTextToSize(item.description || "", 105);
    doc.text(desc[0] || "", marginX + 2, y + 5.5);
    doc.text(String(qty), marginX + 110, y + 5.5);
    doc.text(`R${price.toFixed(2)}`, marginX + 130, y + 5.5);
    doc.text(`R${lineTotal.toFixed(2)}`, marginX + 160, y + 5.5);
    y += 8;

    if (y > 260) {
      doc.addPage();
      y = 20;
    }
  });

  y += 6;
  doc.setDrawColor(200);
  doc.line(marginX + 120, y, marginX + 170, y);
  y += 8;
  doc.setFont(undefined, "bold");
  doc.setFontSize(12);
  doc.text("Total", marginX + 120, y);
  doc.text(`R${Number(total).toFixed(2)}`, marginX + 160, y);

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