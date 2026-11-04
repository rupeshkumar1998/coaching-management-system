const { AuditLog } = require("../models/AuditLog");

const logPlanAction = async (
  {
    action,
    actorId,
    planId,
    planVersionId = null,
    oldValue = null,
    newValue = null,
    reason = null,
  },
  session
) => {
  if (typeof action !== "string" || !action) {
    throw new Error("Audit action is required");
  }

  if (!actorId) {
    throw new Error("Audit actor is required");
  }

  if (!planId) {
    throw new Error("Audit planId is required");
  }

  const log = new AuditLog({
    action,
    actor: actorId,
    planId,
    planVersionId,
    oldValue,
    newValue,
    reason,
  });

  await log.save(session ? { session } : {});

  return log;
};

module.exports = {
  logPlanAction,
};