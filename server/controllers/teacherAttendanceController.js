const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const Teacher = require("../models/Teacher");


const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidCalendarDate = (dateString) => {
  if (!DATE_ONLY_PATTERN.test(dateString)) {
    return false;
  }

  const [year, month, day] = dateString.split("-").map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const getTodayInIndia = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};


// const markTeacherAttendance = async (req, res) => {
//   try {
//     const { teacherId, date, status, remarks } = req.body;

//     // Tenant must exist
//     if (!req.tenantId) {
//       return res.status(403).json({
//         success: false,
//         message: "Institute association is missing",
//       });
//     }

//     // Required fields
//     if (!teacherId || !date || !status) {
//       return res.status(400).json({
//         success: false,
//         message: "Teacher ID, date and status are required",
//       });
//     }

//     // Validate teacher ObjectId
//     if (!mongoose.Types.ObjectId.isValid(teacherId)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid teacher ID",
//       });
//     }

//     // Validate status
//     const allowedStatuses = [
//       "PRESENT",
//       "ABSENT",
//       "HALF_DAY",
//       "LEAVE",
//     ];

//     if (!allowedStatuses.includes(status)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid attendance status",
//       });
//     }

//     // Validate date
//     const attendanceDate = new Date(date);

//     if (Number.isNaN(attendanceDate.getTime())) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid attendance date",
//       });
//     }

//     // Normalize date to start of day
//     attendanceDate.setHours(0, 0, 0, 0);

//     // Do not allow future attendance
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     if (attendanceDate > today) {
//       return res.status(400).json({
//         success: false,
//         message: "Attendance date cannot be in the future",
//       });
//     }

//     // Find teacher only inside logged-in admin's institute
//     const teacher = await Teacher.findOne({
//       _id: teacherId,
//       instituteId: req.tenantId,
//       isDeleted: false,
//     });

//     if (!teacher) {
//       return res.status(404).json({
//         success: false,
//         message: "Teacher not found",
//       });
//     }

//     // Do not mark attendance for terminated teachers
//     if (teacher.status === "TERMINATED") {
//       return res.status(400).json({
//         success: false,
//         message: "Cannot mark attendance for a terminated teacher",
//       });
//     }

//     // Check duplicate attendance
//     const existingAttendance = await Attendance.findOne({
//       teacherId: teacher._id,
//       instituteId: req.tenantId,
//       date: attendanceDate,
//       isDeleted: false,
//     });

//     if (existingAttendance) {
//       return res.status(409).json({
//         success: false,
//         message: "Attendance already exists for this teacher on this date",
//       });
//     }

//     // Create attendance
//     const attendance = await Attendance.create({
//       teacherId: teacher._id,
//       instituteId: req.tenantId,
//       date: attendanceDate,
//       status,
//       remarks: remarks ? remarks.trim() : null,

//       // Always use authenticated admin
//       // instead of trusting client input.
//       markedBy: req.user._id,
//     });

//     return res.status(201).json({
//       success: true,
//       message: "Teacher attendance marked successfully",
//       data: {
//         attendance: {
//           id: attendance._id,
//           teacherId: attendance.teacherId,
//           instituteId: attendance.instituteId,
//           date: attendance.date,
//           status: attendance.status,
//           remarks: attendance.remarks,
//           markedBy: attendance.markedBy,
//           createdAt: attendance.createdAt,
//         },
//       },
//     });
//   } catch (error) {
//     // Handle MongoDB duplicate-key race condition
//     if (error.code === 11000) {
//       return res.status(409).json({
//         success: false,
//         message: "Attendance already exists for this teacher on this date",
//       });
//     }

//     console.error("Mark Teacher Attendance Error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to mark teacher attendance",
//     });
//   }
// };
const markTeacherAttendance = async (req, res) => {
  try {
    const { teacherId, date, status, remarks } = req.body;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!teacherId || !date || !status) {
      return res.status(400).json({
        success: false,
        message: "Teacher ID, date and status are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid teacher ID",
      });
    }

    const allowedStatuses = [
      "PRESENT",
      "ABSENT",
      "HALF_DAY",
      "LEAVE",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid attendance status",
      });
    }

    if (typeof date !== "string" || !isValidCalendarDate(date)) {
      return res.status(400).json({
        success: false,
        message: "Attendance date must be a valid YYYY-MM-DD date",
      });
    }

    const todayInIndia = getTodayInIndia();

    if (date > todayInIndia) {
      return res.status(400).json({
        success: false,
        message: "Attendance date cannot be in the future",
      });
    }

    if (
      remarks !== undefined &&
      remarks !== null &&
      typeof remarks !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Remarks must be a string or null",
      });
    }

    const teacher = await Teacher.findOne({
      _id: teacherId,
      instituteId: req.tenantId,
      isDeleted: false,
    });

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    if (teacher.status === "TERMINATED") {
      return res.status(400).json({
        success: false,
        message: "Cannot mark attendance for a terminated teacher",
      });
    }

    const existingAttendance = await Attendance.findOne({
      teacherId: teacher._id,
      instituteId: req.tenantId,
      attendanceDate: date,
      isDeleted: false,
    });

    if (existingAttendance) {
      return res.status(409).json({
        success: false,
        message: "Attendance already exists for this teacher on this date",
      });
    }

    const attendance = await Attendance.create({
      teacherId: teacher._id,
      instituteId: req.tenantId,

      // Temporary legacy field.
      // It will be removed after complete migration.
      date: new Date(`${date}T00:00:00.000Z`),

      // Canonical business/calendar date.
      attendanceDate: date,

      status,
      remarks:
        remarks === undefined ||
        remarks === null ||
        remarks.trim() === ""
          ? null
          : remarks.trim(),

      markedBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Teacher attendance marked successfully",
      data: {
        attendance: {
          id: attendance._id,
          teacherId: attendance.teacherId,
          instituteId: attendance.instituteId,
          attendanceDate: attendance.attendanceDate,
          date: attendance.date,
          status: attendance.status,
          remarks: attendance.remarks,
          markedBy: attendance.markedBy,
          createdAt: attendance.createdAt,
        },
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Attendance already exists for this teacher on this date",
      });
    }

    console.error("Mark Teacher Attendance Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to mark teacher attendance",
    });
  }
};






// const getTeacherAttendance = async (req, res) => {
//   try {
//     if (!req.tenantId) {
//       return res.status(403).json({
//         success: false,
//         message: "Institute association is missing",
//       });
//     }

//     const attendance = await Attendance.find({
//       instituteId: req.tenantId,
//       isDeleted: false,
//     })
//       .populate({
//         path: "teacherId",
//         select: "employeeId userId status",
//         populate: {
//           path: "userId",
//           select: "name email",
//         },
//       })
//       .populate({
//         path: "markedBy",
//         select: "name email role",
//       })
//       //.sort({ date: -1, createdAt: -1 })
//       .sort({ attendanceDate: -1, createdAt: -1 })
//       .lean();

//     return res.status(200).json({
//       success: true,
//       count: attendance.length,
//       data: attendance,
//     });
//   } catch (error) {
//     console.error("Get Teacher Attendance Error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch teacher attendance",
//     });
//   }
// };
const getTeacherAttendance = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    const { from, to, teacherId, status } = req.query;

    const query = {
      instituteId: req.tenantId,
      isDeleted: false,
    };

    // Optional teacher filter
    if (teacherId) {
      if (!mongoose.Types.ObjectId.isValid(teacherId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid teacherId",
        });
      }

      query.teacherId = teacherId;
    }

    // Optional date-range filter
    if (from || to) {
      if (
        (from && !isValidCalendarDate(from)) ||
        (to && !isValidCalendarDate(to))
      ) {
        return res.status(400).json({
          success: false,
          message: "Dates must be valid YYYY-MM-DD dates",
        });
      }

      if (from && to && from > to) {
        return res.status(400).json({
          success: false,
          message: "From date cannot be after to date",
        });
      }

      query.attendanceDate = {};

      if (from) {
        query.attendanceDate.$gte = from;
      }

      if (to) {
        query.attendanceDate.$lte = to;
      }
    }

    // Optional status filter
    if (status) {
      const allowedStatuses = [
        "PRESENT",
        "ABSENT",
        "HALF_DAY",
        "LEAVE",
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid attendance status",
        });
      }

      query.status = status;
    }

    const attendance = await Attendance.find(query)
      .populate({
        path: "teacherId",
        select: "employeeId userId status",
        populate: {
          path: "userId",
          select: "name email",
        },
      })
      .populate({
        path: "markedBy",
        select: "name email role",
      })
      .sort({
        attendanceDate: -1,
        createdAt: -1,
      })
      .lean();

    return res.status(200).json({
      success: true,
      count: attendance.length,
      filters: {
        from: from || null,
        to: to || null,
        teacherId: teacherId || null,
        status: status || null,
      },
      data: attendance,
    });
  } catch (error) {
    console.error("Get teacher attendance error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get teacher attendance",
    });
  }
};



const getAttendanceByTeacher = async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid teacher ID",
      });
    }

    const teacher = await Teacher.findOne({
      _id: teacherId,
      instituteId: req.tenantId,
      isDeleted: false,
    })
      .populate({
        path: "userId",
        select: "name email phone",
      })
      .lean();

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    const attendance = await Attendance.find({
      teacherId: teacher._id,
      instituteId: req.tenantId,
      isDeleted: false,
    })
      .populate({
        path: "markedBy",
        select: "name email role",
      })
      //.sort({ date: -1, createdAt: -1 })
      .sort({ attendanceDate: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: attendance.length,
      data: {
        teacher: {
          id: teacher._id,
          employeeId: teacher.employeeId,
          name: teacher.userId?.name || null,
          email: teacher.userId?.email || null,
          phone: teacher.userId?.phone || null,
          status: teacher.status,
        },
        attendance,
      },
    });
  } catch (error) {
    console.error("Get Attendance By Teacher Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch attendance by teacher",
    });
  }
};


// const getAttendanceByDate = async (req, res) => {
//   try {
//     const { date } = req.params;

//     if (!req.tenantId) {
//       return res.status(403).json({
//         success: false,
//         message: "Institute association is missing",
//       });
//     }

//     const attendanceDate = new Date(date);

//     if (Number.isNaN(attendanceDate.getTime())) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid attendance date",
//       });
//     }

//     attendanceDate.setHours(0, 0, 0, 0);

//     const attendance = await Attendance.find({
//       instituteId: req.tenantId,
//       date: attendanceDate,
//       isDeleted: false,
//     })
//       .populate({
//         path: "teacherId",
//         select: "employeeId userId status",
//         populate: {
//           path: "userId",
//           select: "name email phone",
//         },
//       })
//       .populate({
//         path: "markedBy",
//         select: "name email role",
//       })
//       .sort({ createdAt: -1 })
//       .lean();

//     return res.status(200).json({
//       success: true,
//       date: attendanceDate,
//       count: attendance.length,
//       data: attendance,
//     });
//   } catch (error) {
//     console.error("Get Attendance By Date Error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch attendance by date",
//     });
//   }
// };
const getAttendanceByDate = async (req, res) => {
  try {
    const { date } = req.params;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (typeof date !== "string" || !isValidCalendarDate(date)) {
      return res.status(400).json({
        success: false,
        message: "Attendance date must be a valid YYYY-MM-DD date",
      });
    }

    const attendance = await Attendance.find({
      instituteId: req.tenantId,
      attendanceDate: date,
      isDeleted: false,
    })
      .populate({
        path: "teacherId",
        select: "employeeId userId status",
        populate: {
          path: "userId",
          select: "name email phone",
        },
      })
      .populate({
        path: "markedBy",
        select: "name email role",
      })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      date,
      count: attendance.length,
      data: attendance,
    });
  } catch (error) {
    console.error("Get Attendance By Date Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch attendance by date",
    });
  }
};





const updateTeacherAttendance = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { status, remarks } = req.body;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(attendanceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid attendance ID",
      });
    }

    if (status === undefined && remarks === undefined) {
      return res.status(400).json({
        success: false,
        message: "At least status or remarks is required",
      });
    }

    const allowedStatuses = [
      "PRESENT",
      "ABSENT",
      "HALF_DAY",
      "LEAVE",
    ];

    if (status !== undefined && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid attendance status",
      });
    }

    if (
      remarks !== undefined &&
      remarks !== null &&
      typeof remarks !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Remarks must be a string or null",
      });
    }

    const attendance = await Attendance.findOne({
      _id: attendanceId,
      instituteId: req.tenantId,
      isDeleted: false,
    });

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    if (status !== undefined) {
      attendance.status = status;
    }

    if (remarks !== undefined) {
      attendance.remarks =
        remarks === null || remarks.trim() === ""
          ? null
          : remarks.trim();
    }

    await attendance.save();

    return res.status(200).json({
      success: true,
      message: "Teacher attendance updated successfully",
      data: {
        attendance: {
          id: attendance._id,
          teacherId: attendance.teacherId,
          instituteId: attendance.instituteId,
          attendanceDate: attendance.attendanceDate,
          date: attendance.date,
          status: attendance.status,
          remarks: attendance.remarks,
          markedBy: attendance.markedBy,
          updatedAt: attendance.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error("Update Teacher Attendance Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update teacher attendance",
    });
  }
};


const deleteTeacherAttendance = async (req, res) => {
  try {
    // const { attendanceId } = req.params;
    // const { reason } = req.body;
    const { attendanceId } = req.params;
    const { reason } = req.body || {};
    

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(attendanceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid attendance ID",
      });
    }

    if (
      reason !== undefined &&
      reason !== null &&
      typeof reason !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Delete reason must be a string or null",
      });
    }

    const attendance = await Attendance.findOne({
      _id: attendanceId,
      instituteId: req.tenantId,
      isDeleted: false,
    });

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    attendance.isDeleted = true;
    attendance.deletedBy = req.user._id;
    attendance.deletedAt = new Date();
    attendance.deleteReason =
      reason === undefined || reason === null || reason.trim() === ""
        ? null
        : reason.trim();

    await attendance.save();

    return res.status(200).json({
      success: true,
      message: "Teacher attendance deleted successfully",
      data: {
        attendance: {
          id: attendance._id,
          teacherId: attendance.teacherId,
          instituteId: attendance.instituteId,
          attendanceDate: attendance.attendanceDate,
          date: attendance.date,
          isDeleted: attendance.isDeleted,
          deletedBy: attendance.deletedBy,
          deletedAt: attendance.deletedAt,
          deleteReason: attendance.deleteReason,
        },
      },
    });
  } catch (error) {
    console.error("Delete Teacher Attendance Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete teacher attendance",
    });
  }
};



// const getTeacherAttendanceSummary = async (req, res) => {
//   try {
//     const { teacherId } = req.params;

//     // Tenant must exist
//     if (!req.tenantId) {
//       return res.status(403).json({
//         success: false,
//         message: "Institute association is missing",
//       });
//     }

//     // Validate teacher ID
//     if (!mongoose.Types.ObjectId.isValid(teacherId)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid teacher ID",
//       });
//     }

//     // Find teacher only inside logged-in admin's institute
//     const teacher = await Teacher.findOne({
//       _id: teacherId,
//       instituteId: req.tenantId,
//       isDeleted: false,
//     })
//       .populate({
//         path: "userId",
//         select: "name email",
//       })
//       .lean();

//     if (!teacher) {
//       return res.status(404).json({
//         success: false,
//         message: "Teacher not found",
//       });
//     }

//     // Count only active attendance records
//     const summary = await Attendance.aggregate([
//       {
//         $match: {
//           teacherId: teacher._id,
//           instituteId: req.tenantId,
//           isDeleted: false,
//         },
//       },
//       {
//         $group: {
//           _id: "$status",
//           count: {
//             $sum: 1,
//           },
//         },
//       },
//     ]);

//     const counts = {
//       PRESENT: 0,
//       ABSENT: 0,
//       HALF_DAY: 0,
//       LEAVE: 0,
//     };

//     for (const item of summary) {
//       if (Object.prototype.hasOwnProperty.call(counts, item._id)) {
//         counts[item._id] = item.count;
//       }
//     }

//     const totalAttendance =
//       counts.PRESENT +
//       counts.ABSENT +
//       counts.HALF_DAY +
//       counts.LEAVE;

//     return res.status(200).json({
//       success: true,
//       data: {
//         teacher: {
//           id: teacher._id,
//           employeeId: teacher.employeeId,
//           name: teacher.userId?.name || null,
//           email: teacher.userId?.email || null,
//           status: teacher.status,
//         },
//         summary: {
//           totalAttendance,
//           present: counts.PRESENT,
//           absent: counts.ABSENT,
//           halfDay: counts.HALF_DAY,
//           leave: counts.LEAVE,
//         },
//       },
//     });
//   } catch (error) {
//     console.error("Get Teacher Attendance Summary Error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch teacher attendance summary",
//     });
//   }
// };
///////////new version of getTeacherAttendanceSummary
const getTeacherAttendanceSummary = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { from, to } = req.query;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid teacher ID",
      });
    }

    if ((from && !to) || (!from && to)) {
      return res.status(400).json({
        success: false,
        message: "Both from and to dates are required",
      });
    }

    // let startDate = null;
    // let endDate = null;

    // if (from && to) {
    //   const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    //   if (!datePattern.test(from) || !datePattern.test(to)) {
    //     return res.status(400).json({
    //       success: false,
    //       message: "Dates must be in YYYY-MM-DD format",
    //     });
    //   }

    //   startDate = new Date(`${from}T00:00:00+05:30`);
    //   endDate = new Date(`${to}T23:59:59.999+05:30`);

    //   if (
    //     Number.isNaN(startDate.getTime()) ||
    //     Number.isNaN(endDate.getTime())
    //   ) {
    //     return res.status(400).json({
    //       success: false,
    //       message: "Invalid attendance date range",
    //     });
    //   }

    //   if (startDate > endDate) {
    //     return res.status(400).json({
    //       success: false,
    //       message: "From date cannot be after to date",
    //     });
    //   }
    // }
    let startDate = null;
let endDate = null;

if (from && to) {
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !isValidCalendarDate(from) ||
    !isValidCalendarDate(to)
  ) {
    return res.status(400).json({
      success: false,
      message: "Dates must be valid YYYY-MM-DD dates",
    });
  }

  if (from > to) {
    return res.status(400).json({
      success: false,
      message: "From date cannot be after to date",
    });
  }

  startDate = from;
  endDate = to;
}





    const teacher = await Teacher.findOne({
      _id: teacherId,
      instituteId: req.tenantId,
      isDeleted: false,
    })
      .populate({
        path: "userId",
        select: "name email",
      })
      .lean();

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    const matchStage = {
      teacherId: teacher._id,
      instituteId: req.tenantId,
      isDeleted: false,
    };

    // if (startDate && endDate) {
    //   matchStage.date = {
    //     $gte: startDate,
    //     $lte: endDate,
    //   };
    // }
    if (startDate && endDate) {
      matchStage.attendanceDate = {
      $gte: startDate,
      $lte: endDate,
      };
    }


    const summary = await Attendance.aggregate([
      {
        $match: matchStage,
      },
      {
        $group: {
          _id: "$status",
          count: {
            $sum: 1,
          },
        },
      },
    ]);

    const counts = {
      PRESENT: 0,
      ABSENT: 0,
      HALF_DAY: 0,
      LEAVE: 0,
    };

    for (const item of summary) {
      if (Object.prototype.hasOwnProperty.call(counts, item._id)) {
        counts[item._id] = item.count;
      }
    }

    const totalAttendance =
      counts.PRESENT +
      counts.ABSENT +
      counts.HALF_DAY +
      counts.LEAVE;

    return res.status(200).json({
      success: true,
      data: {
        teacher: {
          id: teacher._id,
          employeeId: teacher.employeeId,
          name: teacher.userId?.name || null,
          email: teacher.userId?.email || null,
          status: teacher.status,
        },
        filters: {
          from: from || null,
          to: to || null,
        },
        summary: {
          totalAttendance,
          present: counts.PRESENT,
          absent: counts.ABSENT,
          halfDay: counts.HALF_DAY,
          leave: counts.LEAVE,
        },
      },
    });
  } catch (error) {
    console.error("Get Teacher Attendance Summary Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch teacher attendance summary",
    });
  }
};
/////////


module.exports = {
  markTeacherAttendance,
  getTeacherAttendance,
  getAttendanceByTeacher,
  getAttendanceByDate,
  updateTeacherAttendance,
  deleteTeacherAttendance,
  getTeacherAttendanceSummary,
};


