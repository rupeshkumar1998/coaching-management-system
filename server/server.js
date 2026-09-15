require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const connectDB = require("./config/db");
const bootstrapRoutes = require("./routes/bootstrapRoutes");
const authRoutes = require("./routes/authRoutes");
const testRoutes = require("./routes/testRoutes");

const publicRegistrationRoutes = require("./routes/publicRegistrationRoutes");

const adminInstituteRoutes = require("./routes/adminInstituteRoutes");

const adminTeacherRoutes = require("./routes/adminTeacherRoutes");

const teacherRoutes = require("./routes/teacherRoutes");

const teacherAttendanceRoutes = require("./routes/teacherAttendanceRoutes");

const app = express();

// MongoDB Connection
connectDB();

// Security Middleware
app.use(helmet());

// CORS
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// Body Parser
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Cookie Parser
app.use(cookieParser());

// Bootstrap Routes
app.use("/api/bootstrap", bootstrapRoutes);

// Authentication Routes
app.use("/api/auth", authRoutes);

// Test Routes
app.use("/api/test", testRoutes);

// PublicRegistration Routes
app.use(
  "/api/public",
  publicRegistrationRoutes
);

// AdminInstitute Routes
app.use(
  "/api/admin/institutes",
  adminInstituteRoutes
);

// AdminTeacher Routes
app.use(
  "/api/admin/teachers", 
  adminTeacherRoutes
);

// Teacher Routes
app.use(
  "/api/teacher", 
  teacherRoutes
);

// Teacher Attendance Routes
app.use("/api/admin/teacher-attendance", teacherAttendanceRoutes);

// Health Check API
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Coaching Management System API is running",
    data: {
      environment: process.env.NODE_ENV,
    },
  });
});

// Server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
