// const CORE_FEATURES = Object.freeze({
//   AUTHENTICATION: {
//     key: "AUTHENTICATION",
//     name: "Authentication",
//     category: "CORE",
//     mandatory: true,
//   },
//   ROLE_AUTHORIZATION: {
//     key: "ROLE_AUTHORIZATION",
//     name: "Role Authorization",
//     category: "CORE",
//     mandatory: true,
//   },
//   TENANT_ISOLATION: {
//     key: "TENANT_ISOLATION",
//     name: "Tenant Isolation",
//     category: "CORE",
//     mandatory: true,
//   },
//   PERMISSION_AUTHORIZATION: {
//     key: "PERMISSION_AUTHORIZATION",
//     name: "Permission Authorization",
//     category: "CORE",
//     mandatory: true,
//   },
//   ACCOUNT_SECURITY: {
//     key: "ACCOUNT_SECURITY",
//     name: "Account Security",
//     category: "CORE",
//     mandatory: true,
//   },
//   SESSION_SECURITY: {
//     key: "SESSION_SECURITY",
//     name: "Session Security",
//     category: "CORE",
//     mandatory: true,
//   },
//   INSTITUTE_PROFILE: {
//     key: "INSTITUTE_PROFILE",
//     name: "Institute Profile",
//     category: "CORE",
//     mandatory: true,
//   },
//   BASIC_DASHBOARD: {
//     key: "BASIC_DASHBOARD",
//     name: "Basic Dashboard",
//     category: "CORE",
//     mandatory: true,
//   },
//   SECURITY_AUDIT: {
//     key: "SECURITY_AUDIT",
//     name: "Security Audit",
//     category: "CORE",
//     mandatory: true,
//   },
// });

// const COMMERCIAL_FEATURES = Object.freeze({
//   LEAD_MANAGEMENT: {
//     key: "LEAD_MANAGEMENT",
//     name: "Lead Management",
//     category: "COMMERCIAL",
//   },
//   STUDENT_MANAGEMENT: {
//     key: "STUDENT_MANAGEMENT",
//     name: "Student Management",
//     category: "COMMERCIAL",
//   },
//   TEACHER_MANAGEMENT: {
//     key: "TEACHER_MANAGEMENT",
//     name: "Teacher Management",
//     category: "COMMERCIAL",
//   },
//   PARENT_MANAGEMENT: {
//     key: "PARENT_MANAGEMENT",
//     name: "Parent Management",
//     category: "COMMERCIAL",
//   },

// PARENT_PORTAL: {
//   key: "PARENT_PORTAL",
//   name: "Parent Portal",
//   description: "Parent access to permitted student information, attendance, fees, and reports",
//   category: "ACADEMIC",
// },

//   ADMIN_MANAGEMENT: {
//     key: "ADMIN_MANAGEMENT",
//     name: "Admin Management",
//     category: "COMMERCIAL",
//   },
//   CLASS_MANAGEMENT: {
//     key: "CLASS_MANAGEMENT",
//     name: "Class Management",
//     category: "COMMERCIAL",
//   },
//   BATCH_MANAGEMENT: {
//     key: "BATCH_MANAGEMENT",
//     name: "Batch Management",
//     category: "COMMERCIAL",
//   },
//   SUBJECT_MANAGEMENT: {
//     key: "SUBJECT_MANAGEMENT",
//     name: "Subject Management",
//     category: "COMMERCIAL",
//   },
//   ATTENDANCE: {
//     key: "ATTENDANCE",
//     name: "Attendance Management",
//     category: "COMMERCIAL",
//   },
//   EXAM_TEST_MANAGEMENT: {
//     key: "EXAM_TEST_MANAGEMENT",
//     name: "Exam and Test Management",
//     category: "COMMERCIAL",
//   },
//   STUDY_MATERIAL: {
//     key: "STUDY_MATERIAL",
//     name: "Study Material",
//     category: "COMMERCIAL",
//   },
//   FEE_MANAGEMENT: {
//     key: "FEE_MANAGEMENT",
//     name: "Fee Management",
//     category: "COMMERCIAL",
//   },
//   ONLINE_FEE_PAYMENT: {
//     key: "ONLINE_FEE_PAYMENT",
//     name: "Online Fee Payment",
//     category: "COMMERCIAL",
//   },
//   REPORTS: {
//     key: "REPORTS",
//     name: "Reports",
//     category: "COMMERCIAL",
//   },
//   REPORT_EXPORT: {
//     key: "REPORT_EXPORT",
//     name: "Report Export",
//     category: "COMMERCIAL",
//   },
//   ANALYTICS: {
//     key: "ANALYTICS",
//     name: "Analytics",
//     category: "COMMERCIAL",
//   },
//   ADVANCED_ANALYTICS: {
//     key: "ADVANCED_ANALYTICS",
//     name: "Advanced Analytics",
//     category: "COMMERCIAL",
//   },
//   CUSTOM_DOMAIN: {
//     key: "CUSTOM_DOMAIN",
//     name: "Custom Domain",
//     category: "COMMERCIAL",
//   },
//   API_ACCESS: {
//     key: "API_ACCESS",
//     name: "API Access",
//     category: "COMMERCIAL",
//   },
//   SMS: {
//     key: "SMS",
//     name: "SMS Notifications",
//     category: "COMMERCIAL",
//   },
//   WHATSAPP: {
//     key: "WHATSAPP",
//     name: "WhatsApp Notifications",
//     category: "COMMERCIAL",
//   },
//   EMAIL_NOTIFICATIONS: {
//     key: "EMAIL_NOTIFICATIONS",
//     name: "Email Notifications",
//     category: "COMMERCIAL",
//   },
//   ADVANCED_SECURITY: {
//     key: "ADVANCED_SECURITY",
//     name: "Advanced Security",
//     category: "COMMERCIAL",
//   },
// });

// const FEATURE_CATALOG = Object.freeze({
//   ...CORE_FEATURES,
//   ...COMMERCIAL_FEATURES,
// });

// const getFeatureDefinition = (key) => {
//   if (typeof key !== "string") {
//     return null;
//   }

//   return FEATURE_CATALOG[key.trim().toUpperCase()] || null;
// };

// const isKnownFeature = (key) => {
//   return getFeatureDefinition(key) !== null;
// };

// const isCoreFeature = (key) => {
//   const definition = getFeatureDefinition(key);
//   return definition?.category === "CORE";
// };

// const getMandatoryFeatureKeys = () => {
//   return Object.values(CORE_FEATURES).map(
//     (feature) => feature.key
//   );
// };

// module.exports = {
//   CORE_FEATURES,
//   COMMERCIAL_FEATURES,
//   FEATURE_CATALOG,
//   getFeatureDefinition,
//   isKnownFeature,
//   isCoreFeature,
//   getMandatoryFeatureKeys,
// };

const CORE_FEATURES = Object.freeze({
  AUTHENTICATION: {
    key: "AUTHENTICATION",
    name: "Authentication",
    category: "CORE",
    mandatory: true,
    isCore: true,
    isActive: true,
  },
  ROLE_AUTHORIZATION: {
    key: "ROLE_AUTHORIZATION",
    name: "Role Authorization",
    category: "CORE",
    mandatory: true,
    isCore: true,
    isActive: true,
  },
  TENANT_ISOLATION: {
    key: "TENANT_ISOLATION",
    name: "Tenant Isolation",
    category: "CORE",
    mandatory: true,
    isCore: true,
    isActive: true,
  },
  PERMISSION_AUTHORIZATION: {
    key: "PERMISSION_AUTHORIZATION",
    name: "Permission Authorization",
    category: "CORE",
    mandatory: true,
    isCore: true,
    isActive: true,
  },
  ACCOUNT_SECURITY: {
    key: "ACCOUNT_SECURITY",
    name: "Account Security",
    category: "CORE",
    mandatory: true,
    isCore: true,
    isActive: true,
  },
  SESSION_SECURITY: {
    key: "SESSION_SECURITY",
    name: "Session Security",
    category: "CORE",
    mandatory: true,
    isCore: true,
    isActive: true,
  },
  INSTITUTE_PROFILE: {
    key: "INSTITUTE_PROFILE",
    name: "Institute Profile",
    category: "CORE",
    mandatory: true,
    isCore: true,
    isActive: true,
  },
  BASIC_DASHBOARD: {
    key: "BASIC_DASHBOARD",
    name: "Basic Dashboard",
    category: "CORE",
    mandatory: true,
    isCore: true,
    isActive: true,
  },
  SECURITY_AUDIT: {
    key: "SECURITY_AUDIT",
    name: "Security Audit",
    category: "CORE",
    mandatory: true,
    isCore: true,
    isActive: true,
  },
});

const COMMERCIAL_FEATURES = Object.freeze({
  LEAD_MANAGEMENT: {
    key: "LEAD_MANAGEMENT",
    name: "Lead Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  STUDENT_MANAGEMENT: {
    key: "STUDENT_MANAGEMENT",
    name: "Student Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  TEACHER_MANAGEMENT: {
    key: "TEACHER_MANAGEMENT",
    name: "Teacher Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  PARENT_MANAGEMENT: {
    key: "PARENT_MANAGEMENT",
    name: "Parent Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  PARENT_PORTAL: {
    key: "PARENT_PORTAL",
    name: "Parent Portal",
    description:
      "Parent access to permitted student information, attendance, fees, and reports",
    category: "ACADEMIC",
    isCore: false,
    isActive: true,
  },
  ADMIN_MANAGEMENT: {
    key: "ADMIN_MANAGEMENT",
    name: "Admin Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  CLASS_MANAGEMENT: {
    key: "CLASS_MANAGEMENT",
    name: "Class Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  BATCH_MANAGEMENT: {
    key: "BATCH_MANAGEMENT",
    name: "Batch Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  SUBJECT_MANAGEMENT: {
    key: "SUBJECT_MANAGEMENT",
    name: "Subject Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  ATTENDANCE: {
    key: "ATTENDANCE",
    name: "Attendance Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  EXAM_TEST_MANAGEMENT: {
    key: "EXAM_TEST_MANAGEMENT",
    name: "Exam and Test Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  STUDY_MATERIAL: {
    key: "STUDY_MATERIAL",
    name: "Study Material",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  FEE_MANAGEMENT: {
    key: "FEE_MANAGEMENT",
    name: "Fee Management",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  ONLINE_FEE_PAYMENT: {
    key: "ONLINE_FEE_PAYMENT",
    name: "Online Fee Payment",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  REPORTS: {
    key: "REPORTS",
    name: "Reports",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  REPORT_EXPORT: {
    key: "REPORT_EXPORT",
    name: "Report Export",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  ANALYTICS: {
    key: "ANALYTICS",
    name: "Analytics",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  ADVANCED_ANALYTICS: {
    key: "ADVANCED_ANALYTICS",
    name: "Advanced Analytics",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  CUSTOM_DOMAIN: {
    key: "CUSTOM_DOMAIN",
    name: "Custom Domain",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  API_ACCESS: {
    key: "API_ACCESS",
    name: "API Access",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  SMS: {
    key: "SMS",
    name: "SMS Notifications",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  WHATSAPP: {
    key: "WHATSAPP",
    name: "WhatsApp Notifications",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  EMAIL_NOTIFICATIONS: {
    key: "EMAIL_NOTIFICATIONS",
    name: "Email Notifications",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
  ADVANCED_SECURITY: {
    key: "ADVANCED_SECURITY",
    name: "Advanced Security",
    category: "COMMERCIAL",
    isCore: false,
    isActive: true,
  },
});

const FEATURE_CATALOG = Object.freeze({
  ...CORE_FEATURES,
  ...COMMERCIAL_FEATURES,
});

const getFeatureDefinition = (key) => {
  if (typeof key !== "string") {
    return null;
  }

  return FEATURE_CATALOG[key.trim().toUpperCase()] || null;
};

const isKnownFeature = (key) => {
  return getFeatureDefinition(key) !== null;
};

const isCoreFeature = (key) => {
  const definition = getFeatureDefinition(key);
  return definition?.isCore === true;
};

const getMandatoryFeatureKeys = () => {
  return Object.values(CORE_FEATURES)
    .filter((feature) => feature.mandatory === true)
    .map((feature) => feature.key);
};

module.exports = {
  CORE_FEATURES,
  COMMERCIAL_FEATURES,
  FEATURE_CATALOG,
  getFeatureDefinition,
  isKnownFeature,
  isCoreFeature,
  getMandatoryFeatureKeys,
};
