/**
 * Name Normalization Utility
 *
 * This module provides functions to normalize and group similar usernames
 * in the database. It handles variations in:
 * - Case sensitivity (brenda vs Brenda vs BRENDA)
 * - Typos (dgital vs digital, yarz vs yara)
 * - Formatting differences (Design 2 vs Design #2 vs design 2)
 * - Abbreviations (j vs jacob, h vs henry)
 * - Full names vs short names (Jacob vs Jacob Babichenko)
 *
 * Based on actual user data from the active_devices table.
 */

// ============================================
// EXPLICIT NAME GROUPINGS
// Based on analysis of active_devices_rows.csv
// ============================================

/**
 * Explicit mapping of name variations to their canonical form.
 * Keys are lowercase versions of all known variations.
 * Values are the canonical (preferred) name to use.
 */
const NAME_GROUPS = {
  // Brenda group
  brenda: "Brenda",

  // C&B group - includes numbered variant
  "c&b": "C&B",
  "c&b-1": "C&B",

  // Design 2 group - formatting variations
  "design 2": "Design #2",
  "design #2": "Design #2",
  "design#2": "Design #2",
  "design-2": "Design #2",

  // Design 3 (standalone but normalized)
  "design 3": "Design 3",
  "design #3": "Design 3",

  // Digital group - includes typo 'dgital'
  digital: "Digital",
  dgital: "Digital", // common typo

  // Eli group
  eli: "Eli",

  // Ella group - includes typo 'ela'
  ella: "Ella",
  ela: "Ella", // typo/abbreviation

  // Henry group - includes abbreviation and work computer
  henry: "Henry",
  h: "Henry", // single letter abbreviation
  "henry comp": "Henry", // work computer variant

  // Jacob group - includes abbreviation and full name
  jacob: "Jacob",
  j: "Jacob", // single letter abbreviation
  "jacob babichenko": "Jacob", // full name

  // Jesse group - includes abbreviation
  jesse: "Jesse",
  jj: "Jesse", // initials/abbreviation

  // Kayla (standalone)
  kayla: "Kayla",

  // NM group
  nm: "NM",

  // Olha group
  olha: "Olha",

  // Print (standalone - likely test/utility)
  print: "print",

  // Robert (standalone)
  robert: "Robert",

  // Slavik group - includes full name variant
  slavik: "Slavik",
  "slavik p": "Slavik", // with initial

  // Test group - includes abbreviations
  test: "Test",
  t: "Test", // single letter abbreviation
  tg: "Test", // abbreviation

  // EG (standalone - separate from test)
  eg: "EG",

  // Vlad/Vladimir group
  vlad: "Vlad",
  "vladimir yarets": "Vlad", // full name
  vy: "Vlad", // initials

  // Yara group - many variations and typos
  yara: "Yara",
  "y ara": "Yara", // space typo
  yarz: "Yara", // typo
  yra: "Yara", // missing letter
  ysara: "Yara", // extra letter typo

  // Finishing (standalone - likely utility/test)
  finishing: "finishing",

  // Numeric IDs (standalone)
  565: "565",
};

// ============================================
// NORMALIZATION FUNCTIONS
// ============================================

/**
 * Normalizes a raw name input to a consistent format for comparison.
 * This is used as a first pass before looking up in NAME_GROUPS.
 *
 * @param {string} name - The raw name input
 * @returns {string} - Normalized key for lookup
 */
function normalizeForLookup(name) {
  if (!name) return "";

  return (
    name
      .trim()
      .toLowerCase()
      // Normalize spaces around special characters
      .replace(/\s*([#\-&])\s*/g, "$1")
      // Remove multiple spaces
      .replace(/\s+/g, " ")
      // Handle "design #2" -> "design 2" for matching
      .replace(/#(\d)/g, " $1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Gets the canonical name for a given input.
 * If the name is found in NAME_GROUPS, returns the canonical form.
 * Otherwise, returns a title-cased version of the input.
 *
 * @param {string} name - The raw name input
 * @returns {string} - The canonical name
 */
export function getCanonicalName(name) {
  if (!name) return "";

  const normalizedKey = normalizeForLookup(name);

  // Check explicit mappings first
  if (NAME_GROUPS[normalizedKey]) {
    return NAME_GROUPS[normalizedKey];
  }

  // For unknown names, return title-cased version
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Checks if two names should be considered the same user.
 *
 * @param {string} name1 - First name to compare
 * @param {string} name2 - Second name to compare
 * @returns {boolean} - True if names belong to same user
 */
export function isSameUser(name1, name2) {
  if (!name1 || !name2) return false;

  const canonical1 = getCanonicalName(name1);
  const canonical2 = getCanonicalName(name2);

  return canonical1 === canonical2;
}

/**
 * Gets all known variations for a given name.
 * Useful for database queries to find all records for a user.
 *
 * @param {string} name - The name to find variations for
 * @returns {string[]} - Array of all known variations (lowercase)
 */
export function getNameVariations(name) {
  if (!name) return [];

  const canonicalName = getCanonicalName(name);
  const variations = [];

  // Find all keys that map to this canonical name
  for (const [key, value] of Object.entries(NAME_GROUPS)) {
    if (value === canonicalName) {
      variations.push(key);
    }
  }

  // If no explicit mappings found, just return the lowercase version
  if (variations.length === 0) {
    variations.push(name.toLowerCase().trim());
  }

  return variations;
}

/**
 * Gets the normalization key for database queries.
 * This is the lowercase key used to match against NAME_GROUPS.
 *
 * @param {string} name - The raw name input
 * @returns {string} - Normalized key for database matching
 */
export function getNormalizationKey(name) {
  return normalizeForLookup(name);
}

/**
 * Validates if a name input is likely a real user vs test data.
 * Filters out obvious test entries and very short abbreviations.
 *
 * @param {string} name - The name to validate
 * @returns {boolean} - True if name appears to be a real user
 */
export function isValidUserName(name) {
  if (!name) return false;

  const trimmed = name.trim();

  // Too short
  if (trimmed.length < 2) return false;

  // Obvious test patterns
  const testPatterns = /^(test|asdf|qwer|xxx|yyy|zzz|abc|aaa|bbb|\d+)$/i;
  if (testPatterns.test(trimmed)) return false;

  return true;
}

/**
 * Gets all canonical names in the system.
 * Useful for displaying a list of known users.
 *
 * @returns {string[]} - Array of unique canonical names
 */
export function getAllCanonicalNames() {
  const uniqueNames = new Set(Object.values(NAME_GROUPS));
  return Array.from(uniqueNames).sort();
}

// ============================================
// EXPORTS
// ============================================

export default {
  getCanonicalName,
  isSameUser,
  getNameVariations,
  getNormalizationKey,
  isValidUserName,
  getAllCanonicalNames,
  NAME_GROUPS,
};
