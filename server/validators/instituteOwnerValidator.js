const { body, param } = require("express-validator");

const createInstituteOwnerValidator = [
  param("instituteId")
    .trim()
    .notEmpty()
    .withMessage("Institute ID is required")
    .isMongoId()
    .withMessage("Invalid institute ID"),

  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters"),

  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),

  body("phone")
    .optional({ values: "null" })
    .trim()
    .isLength({ min: 7, max: 20 })
    .withMessage("Phone number must be between 7 and 20 characters"),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 8, max: 128 })
    .withMessage("Password must be between 8 and 128 characters"),
];

module.exports = {
  createInstituteOwnerValidator,
};