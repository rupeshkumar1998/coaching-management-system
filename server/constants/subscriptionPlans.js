// const SUBSCRIPTION_PLANS = Object.freeze({
//   FREE: Object.freeze({
//     code: "FREE",
//     name: "Free",
//     version: 1,
//     amount: 0,
//     currency: "INR",
//     durationDays: null,
//     paymentRequired: false,
//     isActive: true,
//   }),

//   BASIC: Object.freeze({
//     code: "BASIC",
//     name: "Basic",
//     version: 1,
//     amount: 999,
//     currency: "INR",
//     durationDays: 30,
//     paymentRequired: true,
//     isActive: true,
//   }),

//   PRO: Object.freeze({
//     code: "PRO",
//     name: "Pro",
//     version: 1,
//     amount: 1999,
//     currency: "INR",
//     durationDays: 30,
//     paymentRequired: true,
//     isActive: true,
//   }),

//   ENTERPRISE: Object.freeze({
//     code: "ENTERPRISE",
//     name: "Enterprise",
//     version: 1,
//     amount: 4999,
//     currency: "INR",
//     durationDays: 30,
//     paymentRequired: true,
//     isActive: true,
//   }),
// });

// const getSubscriptionPlan = (planCode) => {
//   if (!planCode || typeof planCode !== "string") {
//     return null;
//   }

//   return SUBSCRIPTION_PLANS[planCode.toUpperCase()] || null;
// };

// const isValidSubscriptionPlan = (planCode) => {
//   return Boolean(getSubscriptionPlan(planCode));
// };

// module.exports = {
//   SUBSCRIPTION_PLANS,
//   getSubscriptionPlan,
//   isValidSubscriptionPlan,
// };

const SUBSCRIPTION_PLANS = Object.freeze({
  FREE: Object.freeze({
    code: "FREE",
    name: "Free",
    version: 1,
    amount: 0,
    currency: "INR",
    durationDays: null,
    paymentRequired: false,
    isActive: true,
  }),

  BASIC: Object.freeze({
    code: "BASIC",
    name: "Basic",
    version: 1,
    amount: 999,
    currency: "INR",
    durationDays: 30,
    paymentRequired: true,
    isActive: true,
  }),

  PRO: Object.freeze({
    code: "PRO",
    name: "Pro",
    version: 1,
    amount: 1999,
    currency: "INR",
    durationDays: 30,
    paymentRequired: true,
    isActive: true,
  }),

  ENTERPRISE: Object.freeze({
    code: "ENTERPRISE",
    name: "Enterprise",
    version: 1,
    amount: 4999,
    currency: "INR",
    durationDays: 30,
    paymentRequired: true,
    isActive: true,
  }),
});

const getSubscriptionPlan = (planCode) => {
  if (!planCode || typeof planCode !== "string") {
    return null;
  }

  return SUBSCRIPTION_PLANS[planCode.toUpperCase()] || null;
};

const isValidSubscriptionPlan = (planCode) => {
  return Boolean(getSubscriptionPlan(planCode));
};

module.exports = {
  SUBSCRIPTION_PLANS,
  getSubscriptionPlan,
  isValidSubscriptionPlan,
};