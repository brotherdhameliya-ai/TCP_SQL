const fs   = require("fs");
const path = require("path");
const { createTransporter }                               = require("../config/mailer");
const { getUnsentRecords, markAsSent }                    = require("../models/message.model");
const { getActiveRecipients, createEmailLog, getSmtpSettings } = require("../models/email.model");
const buildEmailHtml                                      = require("../utils/emailTemplate");
const { generateExcelBuffer, createImagesZip }            = require("./excel.service");
const logger                                              = require("../utils/logger");

/**
 * Sends scheduled email report for a company.
 * Records are grouped by zone_id so each Zone gets its own email
 * with the correct per-IP OK/NR image folders already embedded in the
 * tcp_messages rows (folder_path / image columns set at insert time).
 *
 * Records with no zone_id (legacy / unassigned) are batched together.
 */
async function sendEmailReport(companyId = 1) {
  logger.info(`Email job triggered for Company ID ${companyId}`);

  const recipients = await getActiveRecipients(companyId);
  if (!recipients.length) {
    logger.warn(`No active recipients for Company ID ${companyId}, skipping.`);
    return { skipped: true, reason: "No active recipients" };
  }

  const allRecords = await getUnsentRecords(companyId);
  if (!allRecords.length) {
    logger.info(`No unsent records for Company ID ${companyId}, skipping.`);
    return { skipped: true, reason: "No unsent records" };
  }

  const smtp = await getSmtpSettings(companyId);
  if (!smtp) {
    logger.warn(`SMTP not configured for Company ID ${companyId}, skipping.`);
    return { skipped: true, reason: "SMTP settings not configured" };
  }

  // ── Group by zone_id ──────────────────────────────────────────────────────
  const groups = {};
  for (const r of allRecords) {
    const key = r.zone_id != null ? String(r.zone_id) : "unassigned";
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  const results = [];

  for (const [zoneKey, records] of Object.entries(groups)) {
    const zoneLabel = zoneKey === "unassigned" ? "Unassigned" : `Zone ${zoneKey}`;

    const dates    = records.map(r => r.received_at.toString().split("T")[0]);
    const dateFrom = dates[dates.length - 1];
    const dateTo   = dates[0];
    const html     = buildEmailHtml({ records, dateFrom, dateTo });
    const from     = `${smtp.from_name} <${smtp.user}>`;

    const attachments = [];

    // Excel
    try {
      const { buffer, fileName } = await generateExcelBuffer(records);
      attachments.push({
        filename:    fileName,
        content:     buffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      logger.info(`[${zoneLabel}] Created Excel with ${records.length} records`);
    } catch (excelErr) {
      logger.error(`[${zoneLabel}] Excel generation failed: ${excelErr.message}`);
    }

    // Images ZIP (uses per-record folder_path already set in tcp_messages)
    try {
      const zipBuffer = await createImagesZip(records);
      if (zipBuffer.length > 0) {
        attachments.push({
          filename:    `Records_Images_${zoneLabel}_${dateFrom}.zip`,
          content:     zipBuffer,
          contentType: "application/zip",
        });
        logger.info(`[${zoneLabel}] Created images ZIP for ${records.length} records`);
      } else {
        logger.warn(`[${zoneLabel}] No images found to ZIP`);
      }
    } catch (zipErr) {
      logger.error(`[${zoneLabel}] ZIP generation failed: ${zipErr.message}`);
    }

    try {
      const transporter = await createTransporter(companyId);
      await transporter.sendMail({
        from,
        to:          recipients.join(", "),
        subject:     `TCP Report — ${records.length} records (${zoneLabel}) (${dateFrom})`,
        html,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      const ids = records.map(r => r.id);
      await markAsSent(ids);

      await createEmailLog({
        record_count: records.length,
        status:       "success",
        date_from:    dateFrom,
        date_to:      dateTo,
        action:       `Scheduled Report (${zoneLabel})`,
        recipients:   recipients.join(", "),
      }, companyId);

      logger.info(`[${zoneLabel}] Email sent: ${records.length} records → ${recipients.join(", ")}`);
      results.push({ success: true, zone: zoneLabel, count: records.length });
    } catch (err) {
      await createEmailLog({
        record_count:  records.length,
        status:        "failed",
        error_message: err.message,
        date_from:     dateFrom,
        date_to:       dateTo,
        action:        `Scheduled Report (${zoneLabel})`,
        recipients:    recipients.join(", "),
      }, companyId);

      logger.error(`[${zoneLabel}] Email failed for Company ID ${companyId}: ${err.message}`);
      results.push({ success: false, zone: zoneLabel, error: err.message });
    }
  }

  const totalSent  = results.filter(r => r.success).reduce((acc, r) => acc + (r.count || 0), 0);
  const firstError = results.find(r => !r.success)?.error;

  if (totalSent === 0 && firstError) {
    return { success: false, error: firstError, results };
  }

  return { success: true, count: totalSent, results };
}

module.exports = { sendEmailReport };
