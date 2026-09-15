const express = require("express");

const {
  login,
  logout,
  getMe,
  changePassword,
} = require("../controllers/authController");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

// Public
router.post("/login", login);
router.post("/logout", logout);

// Protected
router.get("/me", protect, getMe);
router.post("/change-password", protect, changePassword);

module.exports = router;