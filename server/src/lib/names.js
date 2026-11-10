// Jamiat / Jamaat names are stored in capitals with single spaces, so
// "Ahmedabad", " AHMEDABAD " and "ahmedabad" can never become two different entries.
const cleanName = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().toUpperCase();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = { cleanName, escapeRegex };
