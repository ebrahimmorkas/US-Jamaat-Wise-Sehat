// ============================================================
//  WHAT THE DASHBOARD SHOWS — edit here (sent to the React app)
// ============================================================
module.exports = {
  // Sheet that lists the Jamiats (column A from row 8) and the month cell.
  dashboardSheet: "SAHEBO DASHBOARD",
  jamiatListRange: "A8:A500",
  monthCell: "B2",

  // Range read from every Jamiat sheet. Row 6 = first Jamaat, column A = Jamaat name.
  jamaatDataRange: "A6:N1000",
  remarksColumn: "N",
  showRemarks: true,

  // Dropdown values used inside the cards (same as the sheet dropdowns).
  statusSets: {
    progress: ["Completed", "Pending", "In Progress", "Not Applicable"],
    yesNo: ["Yes", "No", "Pending", "Not Applicable"],
  },
  defaultStatus: "Pending",

  // Chart colour for each status: good | info | warn | bad | na
  statusTones: {
    Completed: "good",
    Yes: "good",
    "In Progress": "info",
    Pending: "warn",
    No: "bad",
    "Not Applicable": "na",
  },

  // Statuses counted as "done" in the completion rate ("Not Applicable" is excluded).
  doneStatuses: ["Completed", "Yes"],

  // One card per entry. "column" = column letter in the Jamiat sheets.
  metrics: [
    { key: "tibb", label: "Tibb", group: "Regular Khidmat", column: "E", statuses: "progress" },
    { key: "riyadah", label: "Riyadah", group: "Regular Khidmat", column: "F", statuses: "progress" },
    { key: "nazafat", label: "Nazafat", group: "Regular Khidmat", column: "G", statuses: "progress" },
    { key: "mahulShifa", label: "Mahul Shifa Thayu?", group: "Mahul us Shifa (16mi)", column: "H", statuses: "yesNo" },
    { key: "aamil", label: "Aamil Uploaded?", group: "Mahul us Shifa (16mi)", column: "I", statuses: "yesNo" },
    { key: "before16mi", label: "Before 16mi?", group: "Mahul us Shifa (16mi)", column: "J", statuses: "yesNo" },
    { key: "caseFollow", label: "Hifz Sehhat Follow-up", group: "Hifz us Sehhat", column: "L", statuses: "yesNo" },
    { key: "imadad", label: "Imadad Tibbi Follow-up", group: "Imadad Tibbi", column: "M", statuses: "progress" },
  ],
};
