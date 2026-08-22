const { getEmailLogs, getEmailSuccessCount } = require("../models/email.model");
const { getStats, getPendingPaginated, getRecords, getRecentRecords } = require("../models/message.model");
const { sendEmailReport } = require("../services/email.service");

const logs = async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const isSuperAdmin = req.user.role === "Super Admin";
    const data = await getEmailLogs({ page, limit }, req.user.company_id, isSuperAdmin);
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
};

const sendNow = async (req, res, next) => {
  try {
    const result = await sendEmailReport(req.user.company_id);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
};

const dashboardStats = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "Super Admin";
    const [stats, emailSuccess] = await Promise.all([
      getStats(req.user.company_id, isSuperAdmin),
      getEmailSuccessCount(req.user.company_id, isSuperAdmin),
    ]);
    res.json({ success: true, data: { ...stats, emailSuccess, pendingEmails: stats.pending } });
  } catch (err) {
    next(err);
  }
};

const pending = async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const search = req.query.search || "";
    const isSuperAdmin = req.user.role === "Super Admin";
    const data = await getPendingPaginated({ page, limit, search }, req.user.company_id, isSuperAdmin);
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
};

const records = async (req, res, next) => {
  try {
    const page        = Number(req.query.page)  || 1;
    const limit       = Number(req.query.limit) || 20;
    const emailStatus = req.query.emailStatus   || "all";
    const timeRange   = req.query.timeRange     || "all";
    const search      = req.query.search        || "";
    const isSuperAdmin = req.user.role === "Super Admin";
    const data = await getRecords({ page, limit, emailStatus, timeRange, search }, req.user.company_id, isSuperAdmin);
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
};

const recentRecords = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "Super Admin";
    const data = await getRecentRecords(10, req.user.company_id, isSuperAdmin);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

module.exports = { logs, sendNow, dashboardStats, pending, records, recentRecords };
