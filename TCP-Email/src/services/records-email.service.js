const fs = require("fs");
const path = require("path");
const { createTransporter } = require("../config/mailer");
const { getSmtpSettings, getActiveRecipients, createEmailLog } = require("../models/email.model");
const { getRecordsByIds, getRecordsByFilter } = require("../models/message.model");
const { generateExcelBuffer, createImagesZip } = require("./excel.service");
const logger = require("../utils/logger");

function buildReportHtml({ records, totalCount, action }) {
  const preview  = records.slice(0, 20);
  const hasMore  = totalCount > 20;
  const now      = new Date().toLocaleString();

  const rows = preview.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? "#f8fafc" : "#ffffff"}">
      <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:12px">${r.id}</td>
      <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:12px">${r.received_at ? new Date(r.received_at).toLocaleString() : ""}</td>
      <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;max-width:360px;word-break:break-word">${r.message}</td>
      <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;max-width:280px;word-break:break-word">${r.barcode ? String(r.barcode).replace(/\|/g, ' | ') : '—'}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f1f5f9">
  <div style="max-width:860px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="background:#1e40af;padding:24px 32px">
      <h1 style="margin:0;color:#fff;font-size:20px">TCP Records Report</h1>
      <p style="margin:6px 0 0;color:#bfdbfe;font-size:13px">Action: ${action}</p>
    </div>
    <div style="padding:24px 32px">
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tr>
          <td style="padding:12px 16px;background:#eff6ff;border-radius:8px;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#1e40af">${totalCount.toLocaleString()}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:2px">Total Records</div>
          </td>
          <td style="padding:12px 16px;background:#f0fdf4;border-radius:8px;text-align:center;padding-left:12px">
            <div style="font-size:14px;font-weight:600;color:#166534">${now}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:2px">Generated At</div>
          </td>
        </tr>
      </table>

      <h3 style="font-size:14px;color:#374151;margin:0 0 12px">Record Preview (first 20)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#1e40af;color:#fff">
            <th style="padding:9px 10px;border:1px solid #e2e8f0;text-align:left">ID</th>
            <th style="padding:9px 10px;border:1px solid #e2e8f0;text-align:left">Received At</th>
            <th style="padding:9px 10px;border:1px solid #e2e8f0;text-align:left">Message</th>
            <th style="padding:9px 10px;border:1px solid #e2e8f0;text-align:left">Barcode</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      ${hasMore ? `<p style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:6px;font-size:13px;color:#92400e">
        📎 Full data (${totalCount.toLocaleString()} records) is available in the attached Excel file.
      </p>` : ""}
    </div>
    <div style="background:#f8fafc;padding:14px 32px;text-align:center;font-size:11px;color:#9ca3af">
      Generated at ${now} · TCP Monitor System
    </div>
  </div>
</body>
</html>`;
}

async function sendRecordsEmail({ records, action, companyId }) {
  const smtp = await getSmtpSettings(companyId);
  if (!smtp) return { skipped: true, reason: "SMTP settings not configured" };

  const recipients = await getActiveRecipients(companyId);
  if (!recipients.length) return { skipped: true, reason: "No active recipients" };

  const { buffer, fileName } = await generateExcelBuffer(records);
  const html = buildReportHtml({ records, totalCount: records.length, action });

  const dateFrom = records.length ? new Date(records[records.length - 1].received_at).toISOString().split("T")[0] : null;
  const dateTo   = records.length ? new Date(records[0].received_at).toISOString().split("T")[0] : null;

  // Prepare attachments
  const attachments = [{ filename: fileName, content: buffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }];

  // Create zip file with images
  try {
    const zipBuffer = await createImagesZip(records);
    if (zipBuffer.length > 0) {
      attachments.push({
        filename: `Records_Images_${dateFrom}.zip`,
        content: zipBuffer,
        contentType: "application/zip",
      });
      logger.info(`Created zip file with images for ${records.length} records`);
    } else {
      logger.warn(`No images found to zip for action: ${action}`);
    }
  } catch (zipErr) {
    logger.error(`Failed to create images zip for action ${action}: ${zipErr.message}`);
  }

  try {
    const transporter = await createTransporter(companyId);
    await transporter.sendMail({
      from:        `${smtp.from_name} <${smtp.user}>`,
      to:          recipients.join(", "),
      subject:     `TCP Records — ${records.length.toLocaleString()} records · ${action}`,
      html,
      attachments,
    });

    try {
      await createEmailLog({
        record_count:  records.length,
        status:        "success",
        date_from:     dateFrom,
        date_to:       dateTo,
        action,
        recipients:    recipients.join(", "),
      }, companyId);
    } catch (logErr) {
      logger.error(`[${action}] Failed to create email log (success): ${logErr.message}`);
    }

    logger.info(`[${action}] Email sent: ${records.length} records → ${recipients.join(", ")} for Company ID ${companyId}`);
    return { success: true, count: records.length, recipients };
  } catch (err) {
    try {
      await createEmailLog({
        record_count:  records.length,
        status:        "failed",
        error_message: err.message,
        date_from:     dateFrom,
        date_to:       dateTo,
        action,
        recipients:    recipients.join(", "),
      }, companyId);
    } catch (logErr) {
      logger.error(`[${action}] Failed to create email log (failed): ${logErr.message}`);
    }
    logger.error(`[${action}] Email failed for Company ID ${companyId}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function sendSelectedRecords(ids, companyId, isSuperAdmin) {
  const records = await getRecordsByIds(ids, companyId, isSuperAdmin);
  if (!records.length) return { skipped: true, reason: "No records found for given IDs" };
  return sendRecordsEmail({ records, action: "Selected Records Send", companyId });
}

async function sendFilteredRecords({ emailStatus, timeRange, search }, companyId, isSuperAdmin) {
  const records = await getRecordsByFilter({ emailStatus, timeRange, search }, companyId, isSuperAdmin);
  if (!records.length) return { skipped: true, reason: "No records match the filter" };
  return sendRecordsEmail({ records, action: "Filtered Send", companyId });
}

module.exports = { sendSelectedRecords, sendFilteredRecords };
