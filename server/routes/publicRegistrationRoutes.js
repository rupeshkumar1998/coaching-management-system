const express = require("express");

const {
  registerInstitute,
} = require("../controllers/publicRegistrationController");

const router = express.Router();

router.post(
  "/register-institute",
  registerInstitute
);

module.exports = router;