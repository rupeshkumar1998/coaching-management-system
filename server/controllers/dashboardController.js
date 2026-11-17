const mongoose = require("mongoose");

const User = require("../models/User");
const Teacher = require("../models/Teacher");
const Batch = require("../models/Batch");
const Class = require("../models/Class");
const StudentAttendance = require("../models/StudentAttendance");

const { validateInstituteId } = require("../services/entitlementService");
const { getFeeSummary } = require("../services/feeService");

// =========================================================
// 32.16.19 ΓÇö Dashboard Summary Controller
//
// Single endpoint that aggregates 7 sections for the
// institute's "at a glance" view:
//   - students    : total / active / inactive
//   - teachers    : total / active / onLeave / terminated
//   - batches     : total / active / inactive
//   - classes     : total / active / inactive
//   - fees        : reuse getFeeSummary()
//   - attendance  : today + last 7 days
//   - subscription: reuse getAllLimitStatuses()
//
// Performance note: all queries run in parallel.
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_INSTITUTE_ID: 400,

  ENTITLEMENT_SNAPSHOT_MISSING: 500,
  ENTITLEMENT_CONFIGURATION_INVALID: 500,
  SUBSCRIPTION_NOT_FOUND: 500,
  LIMIT_NOT_CONFIGURED: 500,
  INTERNAL_ERROR: 500,
});

const resolveStatus = (error) => {
  if (error && typeof error.status === "number") return error.status;
  if (error && typeof error.code === "string") {
    return ERROR_STATUS_MAP[error.code] || 500;
  }
  return 500;
};

const handleControllerError = (res, error, operation) => {
  const status = resolveStatus(error);
  if (status === 500) {
    console.error(`[dashboardController] ${operation} failed:`, error);
  }
  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred while building the dashboard"
        : error.message,
  });
};

const getTodayInIndia = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

const shiftDate = (base, days) => {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};

const emptyStatusCounts = () => ({
  PRESENT: 0,
  ABSENT: 0,
  LATE: 0,
  LEAVE: 0,
  HALF_DAY: 0,
});

const sumCounts = (obj) =>
  Object.values(obj).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------
// GET /api/owner/dashboard/summary
// ---------------------------------------------------------
const summaryHandler = async (req, res) => {
  try {
    const instituteId = validateInstituteId(req.tenantId);
    const instituteOid = new mongoose.Types.ObjectId(
      String(instituteId)
    );

    const today = getTodayInIndia();
    const sevenDaysAgo = shiftDate(today, -6);

    // ----------------------------------------------
    // Parallel fetch ΓÇö 13 queries
    // ----------------------------------------------
    const [
      studentsTotal,
      studentsActive,
      teachersTotal,
      teachersActive,
      teachersOnLeave,
      teachersTerminated,
      batchesTotal,
      batchesActive,
      classesTotal,
      classesActive,
      feeSummary,
      todayAttendanceAgg,
      last7DaysAgg,
    ] = await Promise.all([
      User.countDocuments({
        instituteId,
        role: "STUDENT",
        isDeleted: false,
      }),
      User.countDocuments({
        instituteId,
        role: "STUDENT",
        isDeleted: false,
        isActive: true,
        accountStatus: "ACTIVE",
      }),
      Teacher.countDocuments({
        instituteId,
        isDeleted: false,
      }),
      Teacher.countDocuments({
        instituteId,
        isDeleted: false,
        status: "ACTIVE",
      }),
      Teacher.countDocuments({
        instituteId,
        isDeleted: false,
        status: "ON_LEAVE",
      }),
      Teacher.countDocuments({
        instituteId,
        isDeleted: false,
        status: "TERMINATED",
      }),
      Batch.countDocuments({
        instituteId,
        isDeleted: false,
      }),
      Batch.countDocuments({
        instituteId,
        isDeleted: false,
        status: "ACTIVE",
      }),
      Class.countDocuments({
        instituteId,
        isDeleted: false,
      }),
      Class.countDocuments({
        instituteId,
        isDeleted: false,
        isActive: true,
      }),
      getFeeSummary({ instituteId }),
      StudentAttendance.aggregate([
        {
          $match: {
            instituteId: instituteOid,
            attendanceDate: today,
            isDeleted: false,
          },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
      StudentAttendance.aggregate([
        {
          $match: {
            instituteId: instituteOid,
            attendanceDate: {
              $gte: sevenDaysAgo,
              $lte: today,
            },
            isDeleted: false,
          },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // ----------------------------------------------
    // Attendance aggregation
    // ----------------------------------------------
    const todayCounts = emptyStatusCounts();
    for (const row of todayAttendanceAgg) {
      if (
        Object.prototype.hasOwnProperty.call(todayCounts, row._id)
      ) {
        todayCounts[row._id] = row.count;
      }
    }

    const todayMarked = sumCounts(todayCounts);
    const todayUnmarked = Math.max(
      studentsActive - todayMarked,
      0
    );

    const last7Counts = emptyStatusCounts();
    for (const row of last7DaysAgg) {
      if (
        Object.prototype.hasOwnProperty.call(last7Counts, row._id)
      ) {
        last7Counts[row._id] = row.count;
      }
    }

    const last7Total = sumCounts(last7Counts);

    // ----------------------------------------------
    // Subscription usage (fail-soft: dashboard still
    // returns the rest if subscription info fails)
    // ----------------------------------------------
    let subscription = null;
    let subscriptionError = null;
    try {
      const { getAllLimitStatuses } = require("../services/limitService");
      subscription = await getAllLimitStatuses({ instituteId });
    } catch (err) {
      subscriptionError = {
        code: err.code || "UNKNOWN",
        message: err.message || "Failed to load subscription usage",
      };
    }

    return res.status(200).json({
      success: true,
      message: "Dashboard summary fetched successfully",
      data: {
        students: {
          total: studentsTotal,
          active: studentsActive,
          inactive: studentsTotal - studentsActive,
        },
        teachers: {
          total: teachersTotal,
          active: teachersActive,
          onLeave: teachersOnLeave,
          terminated: teachersTerminated,
        },
        batches: {
          total: batchesTotal,
          active: batchesActive,
          inactive: batchesTotal - batchesActive,
        },
        classes: {
          total: classesTotal,
          active: classesActive,
          inactive: classesTotal - classesActive,
        },
        fees: feeSummary,
        attendance: {
          today: {
            date: today,
            totalStudents: studentsActive,
            marked: todayMarked,
            unmarked: todayUnmarked,
            present: todayCounts.PRESENT,
            absent: todayCounts.ABSENT,
            late: todayCounts.LATE,
            leave: todayCounts.LEAVE,
            halfDay: todayCounts.HALF_DAY,
          },
          last7Days: {
            from: sevenDaysAgo,
            to: today,
            totalRecords: last7Total,
            present: last7Counts.PRESENT,
            absent: last7Counts.ABSENT,
            late: last7Counts.LATE,
            leave: last7Counts.LEAVE,
            halfDay: last7Counts.HALF_DAY,
          },
        },
        subscription:
          subscription !== null
            ? subscription
            : { error: subscriptionError },
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "summary");
  }
};

module.exports = {
  summaryHandler,
};