// const SUBSCRIPTION_STATUS = Object.freeze({
//   PENDING: "PENDING",
//   ACTIVE: "ACTIVE",
//   SUSPENDED: "SUSPENDED",
//   EXPIRED: "EXPIRED",
//   CANCELLED: "CANCELLED",
// });

// const SUBSCRIPTION_TRANSITIONS = Object.freeze({
//   PENDING: Object.freeze([
//     SUBSCRIPTION_STATUS.ACTIVE,
//     SUBSCRIPTION_STATUS.CANCELLED,
//   ]),

//   ACTIVE: Object.freeze([
//     SUBSCRIPTION_STATUS.SUSPENDED,
//     SUBSCRIPTION_STATUS.EXPIRED,
//     SUBSCRIPTION_STATUS.CANCELLED,
//   ]),

//   SUSPENDED: Object.freeze([
//     SUBSCRIPTION_STATUS.ACTIVE,
//     SUBSCRIPTION_STATUS.EXPIRED,
//     SUBSCRIPTION_STATUS.CANCELLED,
//   ]),

//   EXPIRED: Object.freeze([]),

//   CANCELLED: Object.freeze([]),
// });

// const canTransitionSubscription = (fromStatus, toStatus) => {
//   if (!fromStatus || !toStatus) {
//     return false;
//   }

//   const allowedTransitions =
//     SUBSCRIPTION_TRANSITIONS[fromStatus];

//   if (!allowedTransitions) {
//     return false;
//   }

//   return allowedTransitions.includes(toStatus);
// };

// module.exports = {
//   SUBSCRIPTION_STATUS,
//   SUBSCRIPTION_TRANSITIONS,
//   canTransitionSubscription,
// };

const SUBSCRIPTION_STATUS = Object.freeze({
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
});

const SUBSCRIPTION_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze([
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.CANCELLED,
  ]),

  ACTIVE: Object.freeze([
    SUBSCRIPTION_STATUS.SUSPENDED,
    SUBSCRIPTION_STATUS.EXPIRED,
    SUBSCRIPTION_STATUS.CANCELLED,
  ]),

  SUSPENDED: Object.freeze([
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.EXPIRED,
    SUBSCRIPTION_STATUS.CANCELLED,
  ]),

  EXPIRED: Object.freeze([]),

  CANCELLED: Object.freeze([]),
});

const canTransitionSubscription = (fromStatus, toStatus) => {
  if (!fromStatus || !toStatus) {
    return false;
  }

  const allowedTransitions =
    SUBSCRIPTION_TRANSITIONS[fromStatus];

  if (!allowedTransitions) {
    return false;
  }

  return allowedTransitions.includes(toStatus);
};

module.exports = {
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TRANSITIONS,
  canTransitionSubscription,
};