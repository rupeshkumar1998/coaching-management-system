const mongoose = require("mongoose");

const connectTestDB = require("../helpers/connectTestDB");

const User = require("../../models/User");
const Institute = require("../../models/Institute");

const testModels = async () => {
  try {
   await connectTestDB();

    console.log("MongoDB Connected");

    console.log("User model:", User.modelName);
    console.log("Institute model:", Institute.modelName);

    console.log("User collection:", User.collection.name);
    console.log("Institute collection:", Institute.collection.name);

    await mongoose.disconnect();

    console.log("Model test successful");
  } catch (error) {
    console.error("Model test failed:", error.message);
    process.exit(1);
  }
};

testModels();