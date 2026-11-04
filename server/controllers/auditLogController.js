const mongoose = require("mongoose");
const { AuditLog, AUDIT_ACTIONS } = require("../models/AuditLog");

// ==========================================
// 32.16.15.9.14 — SUPER_ADMIN Audit Log Read
// ==========================================

const getAuditLogs = async (req, res) => {
  try {
    const {
      planId,
      action,
      actorId,
      fromDate,
      toDate,
      page,
      limit,
    } = req.query;

    const filter = {};

    if (planId) {
      if (!mongoose.isValidObjectId(planId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid planId",
        });
      }
      filter.planId = planId;
    }

    if (action) {
      if (!AUDIT_ACTIONS.includes(action)) {
        return res.status(400).json({
          success: false,
          message: "Invalid audit action",
        });
      }
      filter.action = action;
    }

    if (actorId) {
      if (!mongoose.isValidObjectId(actorId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid actorId",
        });
      }
      filter.actor = actorId;
    }

    if (fromDate || toDate) {
      filter.timestamp = {};

      if (fromDate) {
        const from = new Date(fromDate);
        if (Number.isNaN(from.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid fromDate",
          });
        }
        filter.timestamp.$gte = from;
      }

      if (toDate) {
        const to = new Date(toDate);
        if (Number.isNaN(to.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid toDate",
          });
        }
        filter.timestamp.$lte = to;
      }
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(
      Math.max(parseInt(limit, 10) || 20, 1),
      100
    );
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Audit logs fetched successfully",
      count: logs.length,
      total,
      page: pageNum,
      limit: limitNum,
      data: { logs },
    });
  } catch (error) {
    console.error("Get Audit Logs Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch audit logs",
    });
  }
};

module.exports = {
  getAuditLogs,
};