const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const logger = require("../utils/logger");

function pad(n) { return String(n).padStart(2, "0"); }

function getFileName() {
  const d = new Date();
  return `TCP_Records_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
}

async function generateExcelBuffer(records) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TCP Monitor";
  wb.created = new Date();

  const ws = wb.addWorksheet("TCP Records");

  ws.columns = [
    { header: "ID",          key: "id",          width: 12 },
    { header: "Received At", key: "received_at", width: 22 },
    { header: "Message",     key: "message",     width: 60 },
    { header: "Barcode",     key: "barcode",     width: 40 },
  ];

  // Style header row
  ws.getRow(1).eachCell((cell) => {
    cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
    cell.font   = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.border = {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  // Filter to include only Barcode records (where barcode exists and is not empty)
  const barcodeRecords = records.filter(r => r.barcode && String(r.barcode).trim() !== "");

  // Add rows in chunks to keep memory bounded for large datasets
  const CHUNK = 500;
  for (let i = 0; i < barcodeRecords.length; i += CHUNK) {
    const chunk = barcodeRecords.slice(i, i + CHUNK);
    chunk.forEach((r, idx) => {
      const row = ws.addRow({
        id:          r.id,
        received_at: r.received_at ? new Date(r.received_at).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }) : "",
        message:     r.message,
        barcode:     r.barcode ? String(r.barcode).replace(/\|/g, " | ") : "",
      });

      // Alternate row shading
      if ((i + idx) % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
        });
      }

      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };
      });
    });
  }

  ws.getRow(1).height = 20;
  ws.autoFilter = { from: "A1", to: "D1" };

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, fileName: getFileName() };
}

async function createImagesZip(records) {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks = [];

    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    // Add each image file to the zip (NR-record images only)
    records.forEach((record) => {
      // NR records have no barcode
      if (record.barcode && String(record.barcode).trim() !== "") return;

      if (record.image) {
        // If image is a full path, use it; otherwise construct path from folder_path
        let imagePath = record.image;
        if (!path.isAbsolute(imagePath) && record.folder_path) {
          imagePath = path.join(record.folder_path, record.image);
        }

        if (fs.existsSync(imagePath)) {
          const fileName = `Record_${record.id}_${path.basename(imagePath)}`;
          archive.file(imagePath, { name: fileName });
        } else {
          logger.warn(`Image file not found: ${imagePath}`);
        }
      }
    });

    archive.finalize();
  });
}

module.exports = { generateExcelBuffer, createImagesZip };
