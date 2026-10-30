
const Institute = require("../../models/Institute");
const User = require("../../models/User");

const createOrReuseUser = async (userData) => {
  return User.findOneAndUpdate(
    { email: userData.email },
    {
      $setOnInsert: userData,
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
    }
  );
};

const ensurePermissionFixtures = async () => {
  // Create or reuse two test institutes.
  const instituteA = await Institute.findOneAndUpdate(
    { code: "PERMTEST_A" },
    {
      $setOnInsert: {
        name: "Permission Test Institute A",
        code: "PERMTEST_A",
        approvalStatus: "APPROVED",
        isActive: true,
        subscriptionStatus: "ACTIVE",
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
    }
  );

  const instituteB = await Institute.findOneAndUpdate(
    { code: "PERMTEST_B" },
    {
      $setOnInsert: {
        name: "Permission Test Institute B",
        code: "PERMTEST_B",
        approvalStatus: "APPROVED",
        isActive: true,
        subscriptionStatus: "ACTIVE",
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
    }
  );

  // Create or reuse the Institute A Owner.
  const ownerA = await createOrReuseUser({
    name: "Permission Test Owner A",
    email: "owner-permtest-a@example.com",
    password: "PermissionTestPassword123!",
    role: "INSTITUTE_OWNER",
    instituteId: instituteA._id,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
  });

  // Keep the Institute ownership mapping synchronized.
  if (
    !instituteA.ownerId ||
    !instituteA.ownerId.equals(ownerA._id)
  ) {
    instituteA.ownerId = ownerA._id;
    await instituteA.save();
  }

  // Create or reuse Institute A Admin.
  const adminA = await createOrReuseUser({
    name: "Permission Test Admin A",
    email: "admin-permtest-a@example.com",
    password: "PermissionTestPassword123!",
    role: "INSTITUTE_ADMIN",
    instituteId: instituteA._id,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
  });

  // Create or reuse Institute B Admin.
  const adminB = await createOrReuseUser({
    name: "Permission Test Admin B",
    email: "admin-permtest-b@example.com",
    password: "PermissionTestPassword123!",
    role: "INSTITUTE_ADMIN",
    instituteId: instituteB._id,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
  });

  // Create or reuse a non-admin Institute A user.
  const teacherA = await createOrReuseUser({
    name: "Permission Test Teacher A",
    email: "teacher-permtest-a@example.com",
    password: "PermissionTestPassword123!",
    role: "TEACHER",
    instituteId: instituteA._id,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
  });

  // Create or reuse the platform Super Admin fixture.
  const superAdmin = await createOrReuseUser({
    name: "Permission Test Super Admin",
    email: "superadmin-permtest@example.com",
    password: "PermissionTestPassword123!",
    role: "SUPER_ADMIN",
    instituteId: null,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
  });

  return {
    instituteA,
    instituteB,
    ownerA,
    adminA,
    adminB,
    teacherA,
    superAdmin,
  };
};

module.exports = ensurePermissionFixtures;
