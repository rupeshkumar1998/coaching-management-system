// const http = require("http");
// const mongoose = require("mongoose");
// require("dotenv").config();

// const app = require("./app");

// const PORT = process.env.PORT || 5000;
// const MONGO_URI =
//   process.env.MONGO_URI || "mongodb://127.0.0.1:27017/coaching_management";

// const server = http.createServer(app);

// const startServer = async () => {
//   try {
//     await mongoose.connect(MONGO_URI);

//     console.log(`MongoDB Connected: ${mongoose.connection.host}`);

//     server.listen(PORT, () => {
//       console.log(`Server running on http://localhost:${PORT}`);
//     });
//   } catch (error) {
//     console.error("Server startup failed:", error.message);
//     process.exit(1);
//   }
// };

// startServer();


const http = require("http");
const mongoose = require("mongoose");
require("dotenv").config();

// 32.16.16 Sprint 5D — Fail fast on missing env vars
const validateEnv = require("./config/validateEnv");

const app = require("./app");

// Validate environment BEFORE any further setup.
validateEnv();

const PORT = process.env.PORT || 5000;

// ⚠️ No fallback: validateEnv guarantees MONGO_URI exists.
// If missing → server exits with clear message before reaching here.
const MONGO_URI = process.env.MONGO_URI;

const server = http.createServer(app);

const startServer = async () => {
  try {
    await mongoose.connect(MONGO_URI);

    console.log(`MongoDB Connected: ${mongoose.connection.host}`);

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
};

startServer();