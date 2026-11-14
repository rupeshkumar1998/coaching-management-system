const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();

// Security middleware
app.use(helmet());

// CORS
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// Request parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Cookie parsing
app.use(cookieParser());

// Basic rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);

// Health/root endpoint
app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Coaching Management System API is running",
    data: {
      environment: process.env.NODE_ENV,
    },
  });
});

// 32.16.16 Sprint 5A — Health endpoints (mounted BEFORE rate limiter)
// So monitoring/load balancers are never rate-limited.
const healthRoutes = require("./routes/healthRoutes");
app.use("/health", healthRoutes);

// Existing routes
const bootstrapRoutes = require("./routes/bootstrapRoutes");
const authRoutes = require("./routes/authRoutes");
const publicRegistrationRoutes = require("./routes/publicRegistrationRoutes");
const adminInstituteRoutes = require("./routes/adminInstituteRoutes");
const adminTeacherRoutes = require("./routes/adminTeacherRoutes");
const teacherRoutes = require("./routes/teacherRoutes");
const teacherAttendanceRoutes = require("./routes/teacherAttendanceRoutes");
const subjectRoutes = require("./routes/subjectRoutes");
const ownerAdminRoutes = require("./routes/ownerAdminRoutes");

const ownerSubscriptionPlanRoutes = require("./routes/ownerSubscriptionPlanRoutes");
const instituteAdminSubscriptionPlanRoutes = require("./routes/instituteAdminSubscriptionPlanRoutes");

const subscriptionPlanVersionRoutes = require("./routes/subscriptionPlanVersionRoutes");
const classRoutes = require("./routes/classRoutes");
const batchRoutes = require("./routes/batchRoutes");
const studentRoutes = require("./routes/studentRoutes");
const parentRoutes = require("./routes/parentRoutes");
const subscriptionUsageRoutes = require("./routes/subscriptionUsageRoutes");
const trialOfferAdminRoutes = require("./routes/trialOfferAdminRoutes");
const auditLogRoutes = require("./routes/auditLogRoutes");
const studentAttendanceRoutes = require("./routes/studentAttendanceRoutes");
const teacherStudentAttendanceRoutes = require("./routes/teacherStudentAttendanceRoutes");
const studentProfileRoutes = require("./routes/studentProfileRoutes");

app.use("/api/bootstrap", bootstrapRoutes);
app.use("/api/auth", authRoutes);
if (["development", "test"].includes(process.env.NODE_ENV)) {
  const testRoutes = require("./routes/testRoutes");
  app.use("/api/test", testRoutes);
}
app.use("/api/public", publicRegistrationRoutes);
app.use("/api/admin/institutes", adminInstituteRoutes);
app.use("/api/admin/teachers", adminTeacherRoutes);
app.use("/api/teacher/student-attendance", teacherStudentAttendanceRoutes);
app.use("/api/teacher", teacherRoutes);
app.use("/api/admin/teacher-attendance", teacherAttendanceRoutes);
app.use("/api/admin/subjects", subjectRoutes);
app.use("/api/owner/admins", ownerAdminRoutes);

app.use("/api/owner/subscription-plans", ownerSubscriptionPlanRoutes);
app.use("/api/admin/available-subscription-plans", instituteAdminSubscriptionPlanRoutes);

app.use("/api/admin/subscription-plans", subscriptionPlanVersionRoutes);
app.use("/api/owner/classes", classRoutes);
app.use("/api/owner/batches", batchRoutes);
app.use("/api/owner/students", studentRoutes);
app.use("/api/owner/student-attendance", studentAttendanceRoutes);
app.use("/api/student", studentProfileRoutes);
app.use("/api/owner/parents", parentRoutes);
app.use("/api/owner/subscription-usage", subscriptionUsageRoutes);
app.use("/api/admin/trial-offer", trialOfferAdminRoutes);
app.use("/api/admin/audit-logs", auditLogRoutes);

module.exports = app;
