const express = require("express");

const {
  createSuperAdmin,
} = require("../controllers/bootstrapController");

const bootstrapAuth = require("../middleware/bootstrapAuth");

const router = express.Router();

router.post(
  "/create-super-admin",
  bootstrapAuth,
  createSuperAdmin
);

module.exports = router;