"use strict";

const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { supabase, openai } = require("../lib/clients");
const constants = require("../config/constants");

const CHUNK_FILES = [
  "01-arabic-reply-caches-intro.js",
  "02-corrections-faq-roots.js",
  "03-search-engine.js",
  "04-cards-and-logging.js",
  "05-session-analyzer-pipeline.js",
  "06-smartchat-orchestrator.js",
];

function loadBrain() {
  const chunksDir = path.join(__dirname, "chunks");
  const code = CHUNK_FILES.map((f) =>
    fs.readFileSync(path.join(chunksDir, f), "utf8")
  ).join("\n\n");

  const module = { exports: {} };
  const exports = module.exports;

  const sandbox = {
    module,
    exports,
    supabase,
    openai,
    ...constants,
    console,
    process,
    fetch,
    setInterval,
    setTimeout,
    clearInterval,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Date,
    Promise,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    BigInt,
    Symbol,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    encodeURI,
    decodeURI,
    encodeURIComponent,
    decodeURIComponent,
    Buffer,
    Intl,
    TextEncoder,
    TextDecoder,
    URL,
    AbortController,
    AbortSignal,
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "easyt-brain.js" });

  return sandbox.module.exports;
}

module.exports = loadBrain();
