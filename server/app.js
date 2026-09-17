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

// Existing routes
const bootstrapRoutes = require("./routes/bootstrapRoutes");
const authRoutes = require("./routes/authRoutes");
const testRoutes = require("./routes/testRoutes");
const publicRegistrationRoutes = require("./routes/publicRegistrationRoutes");
const adminInstituteRoutes = require("./routes/adminInstituteRoutes");
const adminTeacherRoutes = require("./routes/adminTeacherRoutes");
const teacherRoutes = require("./routes/teacherRoutes");
const teacherAttendanceRoutes = require("./routes/teacherAttendanceRoutes");
const subjectRoutes = require("./routes/subjectRoutes");

app.use("/api/bootstrap", bootstrapRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/test", testRoutes);
app.use("/api/public", publicRegistrationRoutes);
app.use("/api/admin/institutes", adminInstituteRoutes);
app.use("/api/admin/teachers", adminTeacherRoutes);
app.use("/api/teacher", teacherRoutes);
app.use("/api/admin/teacher-attendance", teacherAttendanceRoutes);
app.use("/api/admin/subjects", subjectRoutes);

module.exports = app;