"use strict";

const { start } = require("./src/bootstrap");

start().catch((err) => {
  console.error("❌ Failed to start server:", err);
  process.exit(1);
});
