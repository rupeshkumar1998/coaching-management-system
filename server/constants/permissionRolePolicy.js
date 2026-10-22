const Permission = require("../models/Permission");

const OWNER_ROLE = "INSTITUTE_OWNER";
const ADMIN_ROLE = "INSTITUTE_ADMIN";
const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

const PLATFORM_CATEGORY = "PLATFORM";

const getOwnerPermissions = async () => {
  return Permission.find({
    isActive: true,
    category: {
      $ne: PLATFORM_CATEGORY,
    },
  }).sort({
    resource: 1,
    action: 1,
  });
};

const canOwnerDelegatePermission = (permission) => {
  if (!permission) {
    return false;
  }

  if (!permission.isActive) {
    return false;
  }

  if (permission.category === PLATFORM_CATEGORY) {
    return false;
  }

  if (!permission.isDelegatable) {
    return false;
  }

  return true;
};

const isPlatformPermission = (permission) => {
  return (
    permission &&
    permission.category === PLATFORM_CATEGORY
  );
};

const isOwner = (user) => {
  return (
    user &&
    user.role === OWNER_ROLE
  );
};

const isAdmin = (user) => {
  return (
    user &&
    user.role === ADMIN_ROLE
  );
};

const isSuperAdmin = (user) => {
  return (
    user &&
    user.role === SUPER_ADMIN_ROLE
  );
};

module.exports = {
  OWNER_ROLE,
  ADMIN_ROLE,
  SUPER_ADMIN_ROLE,
  PLATFORM_CATEGORY,
  getOwnerPermissions,
  canOwnerDelegatePermission,
  isPlatformPermission,
  isOwner,
  isAdmin,
  isSuperAdmin,
};