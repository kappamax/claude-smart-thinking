'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Read + parse JSON. Returns `fallback` when the file is missing, but THROWS
 * when the file exists and is malformed. That distinction matters: silently
 * treating an unparseable settings.json as `{}` would let us overwrite a file
 * we never successfully understood.
 */
function readJson(file, fallback = null) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  if (raw.trim() === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
}

/**
 * Atomic write: serialize to a temp file in the same directory, fsync, then
 * rename over the target. rename(2) is atomic within a filesystem, so a crash
 * mid-write leaves the original intact rather than a truncated file.
 */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

module.exports = { readJson, writeJsonAtomic };
