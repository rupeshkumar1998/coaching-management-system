
const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

// Always load the server's .env, regardless of the command's working directory.
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

const TEST_DATABASE = "coaching_management_test";

const connectTestDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing from server/.env");
  }

  if (mongoose.connection.readyState !== 0) {
    throw new Error(
      "Mongoose is already connected. Refusing to change database."
    );
  }

  let testUri;

  try {
    testUri = new URL(process.env.MONGO_URI);
  } catch {
    throw new Error("MONGO_URI is not a valid MongoDB connection URL.");
  }

  // Override the database path so tests cannot connect to the development DB.
  testUri.pathname = `/${TEST_DATABASE}`;

  const selectedDatabase = decodeURIComponent(
    testUri.pathname.slice(1)
  );

  if (selectedDatabase !== TEST_DATABASE) {
    throw new Error(
      `Unsafe test database "${selectedDatabase}". Aborting.`
    );
  }

  await mongoose.connect(testUri.toString());

  const actualDatabase = mongoose.connection.name;

  if (actualDatabase !== TEST_DATABASE) {
    await mongoose.disconnect();

    throw new Error(
      `Unsafe database "${actualDatabase}". ` +
      `Expected "${TEST_DATABASE}". Connection closed.`
    );
  }

  console.log(`Connected to isolated test database: ${TEST_DATABASE}`);

  return mongoose.connection;
};

module.exports = connectTestDB;
