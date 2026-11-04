const SUPPORTED_CURRENCIES = Object.freeze(["INR"]);

const DEFAULT_CURRENCY = "INR";

const normalizeCurrency = (currency) => {
  if (typeof currency !== "string") {
    throw new Error("Currency must be a string");
  }

  return currency.trim().toUpperCase();
};

const isSupportedCurrency = (currency) => {
  if (typeof currency !== "string") {
    return false;
  }

  return SUPPORTED_CURRENCIES.includes(
    currency.trim().toUpperCase()
  );
};

const validateAmount = (amount) => {
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount)
  ) {
    throw new Error("Amount must be a finite number");
  }

  if (amount < 0) {
    throw new Error("Amount cannot be negative");
  }

  if (!Number.isInteger(amount * 100)) {
    throw new Error(
      "Amount cannot have more than 2 decimal places"
    );
  }

  return true;
};

const validateCurrency = (currency) => {
  const normalized = normalizeCurrency(currency);

  if (!SUPPORTED_CURRENCIES.includes(normalized)) {
    throw new Error(
      `Unsupported currency: ${normalized}`
    );
  }

  return normalized;
};

const validateDurationDays = (durationDays) => {
  if (
    durationDays === null ||
    durationDays === undefined
  ) {
    return true;
  }

  if (
    !Number.isSafeInteger(durationDays) ||
    durationDays < 1
  ) {
    throw new Error(
      "durationDays must be a positive safe integer or null"
    );
  }

  return true;
};

const validatePaymentConfiguration = ({
  amount,
  paymentRequired,
}) => {
  if (typeof paymentRequired !== "boolean") {
    throw new Error("paymentRequired must be a boolean");
  }

  if (paymentRequired && amount <= 0) {
    throw new Error(
      "Payment-required plan version must have an amount greater than 0"
    );
  }

  if (!paymentRequired && amount !== 0) {
    throw new Error(
      "Plan version that does not require payment must have amount 0"
    );
  }

  return true;
};

module.exports = {
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
  normalizeCurrency,
  isSupportedCurrency,
  validateAmount,
  validateCurrency,
  validateDurationDays,
  validatePaymentConfiguration,
};