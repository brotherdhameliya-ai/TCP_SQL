const fs = require("fs");
const path = require("path");
const { createTransporter } = require("../config/mailer");
const { getUnsentRecords, markAsSent } = require("../models/message.model");
const { getActiveRecipients, createEmailLog, getSmtpSettings } = require("../models/email.model");
const buildEmailHtml = require("../utils/emailTemplate");
const { generateExcelBuffer, createImagesZip } = require("./excel.service");
const logger = require("../utils/logger");

async function sendEmailReport(companyId = 1) {
  logger.info(`Email job triggered for Company ID ${companyId}`);

  const recipients = await getActiveRecipients(companyId);
  if (!recipients.length) {
    logger.warn(`No active recipients for Company ID ${companyId}, skipping.`);
    return { skipped: true, reason: "No active recipients" };
  }

  const records = await getUnsentRecords(companyId);
  if (!records.length) {
    logger.info(`No unsent records for Company ID ${companyId}, skipping.`);
    return { skipped: true, reason: "No unsent records" };
  }

  const smtp = await getSmtpSettings(companyId);
  if (!smtp) {
    logger.warn(`SMTP not configured for Company ID ${companyId}, skipping.`);
    return { skipped: true, reason: "SMTP settings not configured" };
  }

  const dates = records.map((r) => r.received_at.toString().split("T")[0]);
  const dateFrom = dates[0];
  const dateTo = dates[dates.length - 1];
  const html = buildEmailHtml({ records, dateFrom, dateTo });
  const from = `${smtp.from_name} <${smtp.user}>`;

  // Prepare attachments
  const attachments = [];

  // Generate and add Excel file
  try {
    const { buffer, fileName } = await generateExcelBuffer(records);
    attachments.push({
      filename: fileName,
      content: buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    logger.info(`Created Excel file with ${records.length} records`);
  } catch (excelErr) {
    logger.error(`Failed to create Excel file for Company ID ${companyId}: ${excelErr.message}`);
  }

  // Create and add zip file with images
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
      logger.warn(`No images found to zip for Company ID ${companyId}`);
    }
  } catch (zipErr) {
    logger.error(`Failed to create images zip for Company ID ${companyId}: ${zipErr.message}`);
  }

  try {
    const transporter = await createTransporter(companyId);
    await transporter.sendMail({
      from,
      to: recipients.join(", "),
      subject: `TCP Report — ${records.length} records (${dateFrom})`,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    const ids = records.map((r) => r.id);
    await markAsSent(ids);
    await createEmailLog({
      record_count: records.length,
      status: "success",
      date_from: dateFrom,
      date_to: dateTo,
      action: "Scheduled Report",
      recipients: recipients.join(", "),
    }, companyId);

    logger.info(`Email sent: ${records.length} records to ${recipients.join(", ")} for Company ID ${companyId}`);
    return { success: true, count: records.length };
  } catch (err) {
    await createEmailLog({
      record_count: records.length,
      status: "failed",
      error_message: err.message,
      date_from: dateFrom,
      date_to: dateTo,
      action: "Scheduled Report",
      recipients: recipients.join(", "),
    }, companyId);

    logger.error(`Email failed for Company ID ${companyId}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { sendEmailReport };
