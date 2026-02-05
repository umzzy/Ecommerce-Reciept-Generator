const PDFDocument = require("pdfkit");
const path = require("path");

const safeCurrencyCode = (value) => {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
};

const formatAmount = (amount, currency) => {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  const code = safeCurrencyCode(currency);

  if (code) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
      }).format(safe);
    } catch {}
  }

  const rounded = safe.toFixed(2);
  return code ? `${code} ${rounded}` : rounded;
};

const formatDateTime = (value) => {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
};

const collectPdfBuffer = (doc) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

const registerReceiptFonts = (doc) => {
  const fonts = { regular: "Helvetica", bold: "Helvetica-Bold" };

  try {
    const fontsDir = path.join(__dirname, "..", "assets", "fonts");
    const regularPath = path.join(fontsDir, "NotoSans-Regular.ttf");
    const boldPath = path.join(fontsDir, "NotoSans-Bold.ttf");

    doc.registerFont("ReceiptFont-Regular", regularPath);
    doc.registerFont("ReceiptFont-Bold", boldPath);

    fonts.regular = "ReceiptFont-Regular";
    fonts.bold = "ReceiptFont-Bold";
  } catch {}

  return fonts;
};

const getFittedFontSize = (
  doc,
  text,
  maxWidth,
  { font = "Helvetica", maxSize = 10, minSize = 7, step = 0.25 } = {},
) => {
  const value = String(text ?? "");
  doc.font(font);

  for (let size = maxSize; size >= minSize; size -= step) {
    doc.fontSize(size);
    if (doc.widthOfString(value) <= maxWidth) return size;
  }

  doc.fontSize(minSize);
  return minSize;
};

const generateReceiptPdfBuffer = async ({
  receiptId,
  order,
  payment,
  customer,
  store,
}) => {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: { Title: receiptId },
  });
  const bufferPromise = collectPdfBuffer(doc);
  const fonts = registerReceiptFonts(doc);

  const currency = safeCurrencyCode(payment?.currency) || "NGN";
  const issuedAt = payment?.paidAt || order?.orderDate || new Date();

  const margin = doc.page.margins.left;
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const contentWidth =
    pageWidth - doc.page.margins.left - doc.page.margins.right;

  const colors = {
    ink: "#111827",
    muted: "#6B7280",
    border: "#E5E7EB",
    bg: "#F9FAFB",
    brand: "#111827",
    accent: "#2563EB",
    success: "#16A34A",
  };

  const storeName = store?.name || "E-commerce Store";
  const storeAddress = store?.address || "";
  const storePhone = store?.phone || "";

  const orderId = String(order?._id || order?.id || "");
  const paymentRef = String(payment?.reference || "");
  const paymentMethod = String(payment?.method || "");
  const statusText = payment?.status
    ? String(payment.status).toUpperCase()
    : "PAID";

  const items = Array.isArray(order?.orderItems)
    ? order.orderItems
    : Array.isArray(order?.items)
      ? order.items
      : [];

  const calc = items.reduce(
    (acc, item) => {
      const qty = Number(item?.quantity) || 0;
      const unit = Number(item?.price) || 0;
      const line = qty * unit;
      acc.subtotal += line;
      acc.quantity += qty;
      return acc;
    },
    { subtotal: 0, quantity: 0 },
  );

  const rawTax = Number(order?.tax ?? payment?.tax ?? 0);
  const rawDiscount = Number(order?.discount ?? payment?.discount ?? 0);
  const tax = Number.isFinite(rawTax) ? rawTax : 0;
  const discount = Number.isFinite(rawDiscount) ? rawDiscount : 0;

  const orderTotal = Number(order?.totalPrice);
  const paymentAmount = Number(payment?.amount);
  const total = Number.isFinite(orderTotal)
    ? orderTotal
    : Number.isFinite(paymentAmount)
      ? paymentAmount
      : calc.subtotal + tax - discount;

  const drawTag = ({ x, y, text, bg, color }) => {
    const paddingX = 8;
    const paddingY = 4;
    doc.font(fonts.bold).fontSize(9);
    const width = doc.widthOfString(text) + paddingX * 2;
    const height = doc.currentLineHeight() + paddingY * 2;
    doc.roundedRect(x, y, width, height, 6).fill(bg);
    doc
      .fillColor(color)
      .text(text, x + paddingX, y + paddingY, { width: width - paddingX * 2 });
    doc.fillColor(colors.ink);
    return { width, height };
  };

  const drawBoxTitle = (title, x, y, w) => {
    doc
      .fillColor(colors.muted)
      .font(fonts.bold)
      .fontSize(9)
      .text(title.toUpperCase(), x, y, { width: w });
    doc.fillColor(colors.ink);
    return y + 14;
  };

  const headerHeight = 92;
  doc.save();
  doc.rect(0, 0, pageWidth, headerHeight).fill(colors.brand);
  doc.restore();

  doc
    .fillColor("#FFFFFF")
    .font(fonts.bold)
    .fontSize(22)
    .text(storeName, margin, 28, { width: contentWidth });

  doc
    .fillColor("#D1D5DB")
    .font(fonts.regular)
    .fontSize(10)
    .text("Payment receipt", margin, 56, { width: contentWidth });

  const tagX = margin + contentWidth - 120;
  const tag = drawTag({
    x: tagX,
    y: 32,
    text: statusText,
    bg: statusText === "FAILED" ? "#7F1D1D" : colors.success,
    color: "#FFFFFF",
  });

  doc.fillColor(colors.ink);

  let y = headerHeight + 18;

  const gap = 14;
  const colW = (contentWidth - gap) / 2;

  const boxH = 92;
  doc
    .roundedRect(margin, y, colW, boxH, 12)
    .strokeColor(colors.border)
    .lineWidth(1)
    .stroke();
  doc
    .roundedRect(margin + colW + gap, y, colW, boxH, 12)
    .strokeColor(colors.border)
    .lineWidth(1)
    .stroke();

  // Store box
  let boxY = drawBoxTitle("From", margin + 14, y + 12, colW - 28);
  doc
    .font(fonts.bold)
    .fontSize(11)
    .fillColor(colors.ink)
    .text(storeName, margin + 14, boxY, { width: colW - 28 });
  doc.font(fonts.regular).fontSize(9.5).fillColor(colors.muted);
  if (storeAddress) {
    doc.text(storeAddress, margin + 14, doc.y + 2, { width: colW - 28 });
  }
  if (storePhone) {
    doc.text(storePhone, margin + 14, doc.y + 2, { width: colW - 28 });
  }

  // Customer box
  const customerName = customer?.name || "";
  const customerEmail = customer?.email || "";
  boxY = drawBoxTitle("Bill To", margin + colW + gap + 14, y + 12, colW - 28);
  doc
    .font(fonts.bold)
    .fontSize(11)
    .fillColor(colors.ink)
    .text(customerName, margin + colW + gap + 14, boxY, { width: colW - 28 });
  doc
    .font(fonts.regular)
    .fontSize(9.5)
    .fillColor(colors.muted)
    .text(customerEmail, margin + colW + gap + 14, doc.y + 2, {
      width: colW - 28,
    });

  y += boxH + 16;

  // Receipt details row
  doc
    .roundedRect(margin, y, contentWidth, 84, 12)
    .fill(colors.bg)
    .strokeColor(colors.border)
    .stroke();

  const detailLeftX = margin + 14;
  const detailRightX = margin + contentWidth / 2 + 7;
  const detailW = contentWidth / 2 - 21;

  const writeKeyVal = (x, startY, key, val) => {
    const keyY = startY;
    doc
      .fillColor(colors.muted)
      .font(fonts.regular)
      .fontSize(9)
      .text(key, x, keyY, { width: detailW });
    doc
      .fillColor(colors.ink)
      .font(fonts.bold)
      .fontSize(10)
      .text(val || "-", x, keyY + 12, { width: detailW });
  };

  const orderDateText = formatDateTime(order?.orderDate || issuedAt);

  writeKeyVal(detailLeftX, y + 14, "Receipt ID", receiptId);
  writeKeyVal(detailLeftX, y + 44, "Order ID", orderId);
  writeKeyVal(detailRightX, y + 14, "Order date", orderDateText || "-");
  writeKeyVal(detailRightX, y + 44, "Payment method", paymentMethod || "-");

  // Small lines under details
  doc
    .fillColor(colors.muted)
    .font(fonts.regular)
    .fontSize(9)
    .text(
      paymentRef ? `Payment reference: ${paymentRef}` : "",
      margin + 14,
      y + 72,
      { width: contentWidth - 28 },
    );

  y += 84 + 18;

  // Items table
  const qtyW = 40;
  const unitW = 110;
  const totalW = 110;
  const itemW = contentWidth - qtyW - unitW - totalW;

  const drawTableHeader = (tableY) => {
    doc.rect(margin, tableY, contentWidth, 24).fill(colors.brand);
    doc
      .fillColor("#FFFFFF")
      .font(fonts.bold)
      .fontSize(9.5)
      .text("Item", margin + 10, tableY + 7, { width: itemW - 10 });
    doc.text("Qty", margin + itemW, tableY + 7, {
      width: qtyW - 10,
      align: "right",
    });
    doc.text("Unit", margin + itemW + qtyW, tableY + 7, {
      width: unitW - 10,
      align: "right",
    });
    doc.text("Total", margin + itemW + qtyW + unitW, tableY + 7, {
      width: totalW - 10,
      align: "right",
    });
    doc.fillColor(colors.ink);
    return tableY + 24;
  };

  y = drawTableHeader(y);

  doc.font(fonts.regular).fontSize(10).fillColor(colors.ink);

  if (items.length === 0) {
    doc
      .fillColor(colors.muted)
      .font(fonts.regular)
      .fontSize(10)
      .text("No items found for this order.", margin, y + 14, {
        width: contentWidth,
        align: "center",
      });
    y += 60;
  } else {
    const gapAfterTable = 14;
    const totalsBoxHeight = 110;
    const gapAfterTotals = 20;
    const footerBlockHeight = 46;
    const reservedHeight =
      gapAfterTable + totalsBoxHeight + gapAfterTotals + footerBlockHeight;
    const bottomLimit = pageHeight - doc.page.margins.bottom - reservedHeight;
    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      const name = String(item?.name || "");
      const qty = Number(item?.quantity) || 0;
      const unit = Number(item?.price) || 0;
      const lineTotal = qty * unit;
      const qtyText = String(qty);
      const unitText = formatAmount(unit, currency);
      const lineTotalText = formatAmount(lineTotal, currency);

      doc.font(fonts.regular).fontSize(10);
      const nameHeight = doc.heightOfString(name, { width: itemW - 10 });
      const qtyHeight = doc.heightOfString(qtyText, {
        width: qtyW - 10,
        align: "right",
      });
      const unitFontSize = getFittedFontSize(doc, unitText, unitW - 10, {
        font: fonts.regular,
        maxSize: 10,
        minSize: 7,
      });
      const totalFontSize = getFittedFontSize(doc, lineTotalText, totalW - 10, {
        font: fonts.regular,
        maxSize: 10,
        minSize: 7,
      });

      doc.font(fonts.regular).fontSize(unitFontSize);
      const unitHeight = doc.heightOfString(unitText, {
        width: unitW - 10,
        align: "right",
      });
      doc.font(fonts.regular).fontSize(totalFontSize);
      const totalHeight = doc.heightOfString(lineTotalText, {
        width: totalW - 10,
        align: "right",
      });

      const contentH = Math.max(nameHeight, qtyHeight, unitHeight, totalHeight);
      const rowH = Math.max(26, contentH + 16);

      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = margin;
        y = drawTableHeader(y);
      }

      if (idx % 2 === 0) {
        doc.rect(margin, y, contentWidth, rowH).fill("#FFFFFF");
      } else {
        doc.rect(margin, y, contentWidth, rowH).fill(colors.bg);
      }
      doc
        .strokeColor(colors.border)
        .lineWidth(0.5)
        .moveTo(margin, y + rowH)
        .lineTo(margin + contentWidth, y + rowH)
        .stroke();

      doc.fillColor(colors.ink);
      doc.font(fonts.regular).fontSize(10);
      doc.text(name, margin + 10, y + 8, { width: itemW - 10 });
      doc.font(fonts.regular).fontSize(10);
      doc.text(qtyText, margin + itemW, y + 8, {
        width: qtyW - 10,
        align: "right",
      });
      doc.font(fonts.regular).fontSize(unitFontSize);
      doc.text(unitText, margin + itemW + qtyW, y + 8, {
        width: unitW - 10,
        align: "right",
      });
      doc.font(fonts.regular).fontSize(totalFontSize);
      doc.text(lineTotalText, margin + itemW + qtyW + unitW, y + 8, {
        width: totalW - 10,
        align: "right",
      });

      y += rowH;
    }
  }

  y += 14;

  const totalsW = 280;
  const totalsX = margin + contentWidth - totalsW;
  const totalsY = y;

  doc
    .roundedRect(totalsX, totalsY, totalsW, 110, 12)
    .strokeColor(colors.border)
    .lineWidth(1)
    .stroke();

  const lineX = totalsX + 14;
  const lineW = totalsW - 28;

  const drawTotalLine = (label, valueText, lineY, bold) => {
    const valueWidth = lineW / 2 - 14;
    const valueFontSize = getFittedFontSize(doc, valueText, valueWidth, {
      font: bold ? fonts.bold : fonts.regular,
      maxSize: bold ? 10.5 : 9.5,
      minSize: 7,
    });
    doc
      .font(bold ? fonts.bold : fonts.regular)
      .fontSize(bold ? 10.5 : 9.5)
      .fillColor(bold ? colors.ink : colors.muted)
      .text(label, lineX, lineY, { width: lineW / 2 });
    doc
      .font(bold ? fonts.bold : fonts.regular)
      .fontSize(valueFontSize)
      .fillColor(colors.ink)
      .text(valueText, totalsX + totalsW / 2, lineY, {
        width: valueWidth,
        align: "right",
        ellipsis: true,
      });
  };

  const subtotalText = formatAmount(calc.subtotal, currency);
  const taxText = formatAmount(tax, currency);
  const discountText = formatAmount(Math.abs(discount), currency);
  const totalText = formatAmount(total, currency);

  drawTotalLine("Subtotal", subtotalText, totalsY + 14, false);
  drawTotalLine("Tax", taxText, totalsY + 34, false);
  drawTotalLine(
    "Discount",
    discount ? `- ${discountText}` : discountText,
    totalsY + 54,
    false,
  );

  doc
    .strokeColor(colors.border)
    .lineWidth(1)
    .moveTo(lineX, totalsY + 74)
    .lineTo(lineX + lineW, totalsY + 74)
    .stroke();

  drawTotalLine("Total paid", totalText, totalsY + 82, true);

  const footerY = Math.min(
    pageHeight - doc.page.margins.bottom - 60,
    totalsY + 130,
  );
  doc
    .fillColor(colors.muted)
    .font(fonts.regular)
    .fontSize(9)
    .text(`Generated: ${formatDateTime(new Date())}`, margin, footerY, {
      width: contentWidth,
    });
  doc
    .fillColor(colors.muted)
    .font(fonts.regular)
    .fontSize(9)
    .text(
      "Thank you for your purchase! This is an automatically generated receipt.",
      margin,
      footerY + 14,
      { width: contentWidth },
    );

  doc.end();
  return bufferPromise;
};

module.exports = {
  generateReceiptPdfBuffer,
};
