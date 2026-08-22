const {
  getMessagesTrend,
  getEmailStatusDistribution,
  getDailyRecords,
  getEmailHistory,
  getBusyHours,
  getEnhancedStats,
} = require("../models/charts.model");

const messagesTrend = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "Super Admin";
    const data = await getMessagesTrend(req.user.company_id, isSuperAdmin);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

const emailStatus = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "Super Admin";
    const data = await getEmailStatusDistribution(req.user.company_id, isSuperAdmin);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

const dailyRecords = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "Super Admin";
    const data = await getDailyRecords(req.user.company_id, isSuperAdmin);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

const emailHistory = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "Super Admin";
    const data = await getEmailHistory(req.user.company_id, isSuperAdmin);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

const busyHours = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "Super Admin";
    const data = await getBusyHours(req.user.company_id, isSuperAdmin);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

const enhancedStats = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "Super Admin";
    const data = await getEnhancedStats(req.user.company_id, isSuperAdmin);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  messagesTrend,
  emailStatus,
  dailyRecords,
  emailHistory,
  busyHours,
  enhancedStats,
};
