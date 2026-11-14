const { param, query } = require("express-validator");

// =========================================================
// 32.16.18 ΓÇö Student Fee Validators
// =========================================================

const listMyFeesValidator = [
  query("status")
    .optional()
    .isIn(["PENDING", "PARTIAL", "PAID", "CANCELLED"])
    .withMessage("status must be PENDING|PARTIAL|PAID|CANCELLED"),
  query("from").optional().isISO8601(),
  query("to").optional().isISO8601(),
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 200 }),
];

const getMyFeeValidator = [
  param("feeId")
    .trim()
    .notEmpty()
    .bail()
    .isMongoId()
    .withMessage("feeId must be a valid Mongo ID"),
];

module.exports = {
  listMyFeesValidator,
  getMyFeeValidator,
};