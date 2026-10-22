const LIMIT_CATALOG = Object.freeze({
  MAX_STUDENTS: {
    key: "MAX_STUDENTS",
    name: "Maximum Students",
    unit: "students",
    period: "LIFETIME_CURRENT",
    requiredFeature: "STUDENT_MANAGEMENT",
    isActive: true,
  },

  MAX_TEACHERS: {
    key: "MAX_TEACHERS",
    name: "Maximum Teachers",
    unit: "teachers",
    period: "LIFETIME_CURRENT",
    requiredFeature: "TEACHER_MANAGEMENT",
    isActive: true,
  },

  MAX_CLASSES: {
    key: "MAX_CLASSES",
    name: "Maximum Classes",
    unit: "classes",
    period: "LIFETIME_CURRENT",
    requiredFeature: "CLASS_MANAGEMENT",
    isActive: true,
  },

  MAX_BATCHES: {
    key: "MAX_BATCHES",
    name: "Maximum Batches",
    unit: "batches",
    period: "LIFETIME_CURRENT",
    requiredFeature: "BATCH_MANAGEMENT",
    isActive: true,
  },

  MAX_ADMINS: {
    key: "MAX_ADMINS",
    name: "Maximum Institute Admins",
    unit: "admins",
    period: "LIFETIME_CURRENT",
    requiredFeature: "ADMIN_MANAGEMENT",
    isActive: true,
  },

  MAX_PARENTS: {
    key: "MAX_PARENTS",
    name: "Maximum Parents",
    unit: "parents",
    period: "LIFETIME_CURRENT",
    requiredFeature: "PARENT_MANAGEMENT",
    isActive: true,
  },

  MAX_ACTIVE_LEADS: {
    key: "MAX_ACTIVE_LEADS",
    name: "Maximum Active Leads",
    unit: "leads",
    period: "LIFETIME_CURRENT",
    requiredFeature: "LEAD_MANAGEMENT",
    isActive: true,
  },

  MAX_EXAMS_PER_MONTH: {
    key: "MAX_EXAMS_PER_MONTH",
    name: "Maximum Exams Per Month",
    unit: "exams",
    period: "CALENDAR_MONTH_UTC",
    requiredFeature: "EXAM_TEST_MANAGEMENT",
    isActive: true,
  },

  MAX_STORAGE_MB: {
    key: "MAX_STORAGE_MB",
    name: "Maximum Storage",
    unit: "MB",
    period: "CURRENT_USAGE",
    requiredFeature: "STUDY_MATERIAL",
    isActive: true,
  },

  MAX_SMS_PER_MONTH: {
    key: "MAX_SMS_PER_MONTH",
    name: "Maximum SMS Per Month",
    unit: "messages",
    period: "CALENDAR_MONTH_UTC",
    requiredFeature: "SMS",
    isActive: true,
  },

  MAX_WHATSAPP_MESSAGES_PER_MONTH: {
    key: "MAX_WHATSAPP_MESSAGES_PER_MONTH",
    name: "Maximum WhatsApp Messages Per Month",
    unit: "messages",
    period: "CALENDAR_MONTH_UTC",
    requiredFeature: "WHATSAPP",
    isActive: true,
  },

  MAX_EMAILS_PER_MONTH: {
    key: "MAX_EMAILS_PER_MONTH",
    name: "Maximum Emails Per Month",
    unit: "emails",
    period: "CALENDAR_MONTH_UTC",
    requiredFeature: "EMAIL_NOTIFICATIONS",
    isActive: true,
  },

  MAX_API_REQUESTS_PER_MONTH: {
    key: "MAX_API_REQUESTS_PER_MONTH",
    name: "Maximum API Requests Per Month",
    unit: "requests",
    period: "CALENDAR_MONTH_UTC",
    requiredFeature: "API_ACCESS",
    isActive: true,
  },
});

const getLimitDefinition = (key) => {
  if (typeof key !== "string") {
    return null;
  }

  return LIMIT_CATALOG[key.trim().toUpperCase()] || null;
};

const isKnownLimit = (key) => {
  return getLimitDefinition(key) !== null;
};

module.exports = {
  LIMIT_CATALOG,
  getLimitDefinition,
  isKnownLimit,
};