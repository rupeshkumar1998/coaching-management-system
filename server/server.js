require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const connectDB = require("./config/db");

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