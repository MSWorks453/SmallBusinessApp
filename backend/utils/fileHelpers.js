/**
 * fileHelpers.js
 * Robust read/write utilities for the local JSON file database.
 * All operations are async using Node's fs/promises module.
 */

const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Resolves the full absolute path for a given data file name.
 * @param {string} fileName - e.g. 'employees.json'
 * @returns {string} absolute path
 */
function resolveDataPath(fileName) {
  return path.join(DATA_DIR, fileName);
}

/**
 * Reads and parses a JSON data file.
 * Returns an empty array if the file is missing or its content is malformed.
 * @param {string} fileName - e.g. 'employees.json'
 * @returns {Promise<Array|Object>} parsed JSON content
 */
async function readJSON(fileName) {
  const filePath = resolveDataPath(fileName);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — return sensible default
      console.warn(`[fileHelpers] File not found: ${filePath}. Returning empty array.`);
      return [];
    }
    if (err instanceof SyntaxError) {
      console.error(`[fileHelpers] JSON parse error in ${filePath}:`, err.message);
      return [];
    }
    // Re-throw unexpected errors
    throw err;
  }
}

/**
 * Serialises data to JSON and atomically overwrites the target file.
 * Uses a write-then-rename pattern to prevent partial writes on crash.
 * @param {string} fileName - e.g. 'employees.json'
 * @param {Array|Object} data - the data to persist
 * @returns {Promise<void>}
 */
async function writeJSON(fileName, data) {
  const filePath = resolveDataPath(fileName);
  const tmpPath = filePath + '.tmp';

  try {
    const serialised = JSON.stringify(data, null, 2);
    // Write to a temp file first
    await fs.writeFile(tmpPath, serialised, 'utf-8');
    // Atomically rename temp → target (POSIX rename is atomic)
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    // Clean up the temp file if rename failed
    try {
      await fs.unlink(tmpPath);
    } catch (_) {
      // ignore cleanup errors
    }
    console.error(`[fileHelpers] Write error for ${filePath}:`, err.message);
    throw err;
  }
}

/**
 * Generates a simple unique ID string with a given prefix.
 * Uses timestamp + short random suffix to minimise collisions.
 * @param {string} prefix - e.g. 'emp', 'exp', 'att'
 * @returns {string} e.g. 'emp_1721234567890_a3f'
 */
function generateId(prefix = 'id') {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 5);
  return `${prefix}_${ts}_${rand}`;
}

/**
 * Returns the ISO date string (YYYY-MM-DD) for today in local time.
 * @returns {string}
 */
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Extracts the YYYY-MM portion from an ISO date string.
 * @param {string} isoDate - e.g. '2026-08-15'
 * @returns {string} e.g. '2026-08'
 */
function yearMonth(isoDate) {
  return isoDate.slice(0, 7);
}

module.exports = {
  readJSON,
  writeJSON,
  generateId,
  todayISO,
  yearMonth,
};
