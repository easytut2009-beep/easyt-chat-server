"use strict";

/**
 * Brain entry:
 * - CHAT_ENGINE=gpt (افتراضي): GPT + سياق من DB.
 * - CHAT_ENGINE=legacy: المحرك القديم (chunks + vm).
 */
const raw = (process.env.CHAT_ENGINE || "gpt").toLowerCase().trim();
const engine = raw === "gp" ? "gpt" : raw;

const impl =
  engine === "legacy" ? require("./runtime") : require("./gptPrimaryEngine");

module.exports = impl;

module.exports.clearFaqCache =
  typeof impl.clearFaqCache === "function"
    ? impl.clearFaqCache
    : function noopClearFaq() {};

module.exports.clearCorrectionCache =
  typeof impl.clearCorrectionCache === "function"
    ? impl.clearCorrectionCache
    : function noopClearCorrection() {};
