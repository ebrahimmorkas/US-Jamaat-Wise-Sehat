// ============================================================
//  THE JC FORM AND THE DASHBOARD — edit here
//  (sent to the React app; the server validates every entry against it)
// ============================================================
module.exports = {
  // Months follow Indian time (a new month starts at midnight IST).
  timeZone: "Asia/Kolkata",

  // On /jc-portal a JC can fill the current month and this many months before it.
  portalMonthsBack: 2,

  // Answer sets (the same values as the old Excel dropdowns).
  statusSets: {
    progress: ["Completed", "Pending", "In Progress", "Not Applicable"],
    yesNo: ["Yes", "No", "Pending", "Not Applicable"],
  },
  defaultStatus: "Pending",

  // Chart colour for each answer: good | info | warn | bad | na
  statusTones: {
    Completed: "good",
    Yes: "good",
    "In Progress": "info",
    Pending: "warn",
    No: "bad",
    "Not Applicable": "na",
  },

  // Answers counted as "done" in the completion rate ("Not Applicable" is excluded).
  doneStatuses: ["Completed", "Yes"],

  // Jamaat details kept in the Jamaat master.
  mauzeTypes: ["UMMAL", "MASOOL UL MAUZE"],

  // Every question on the JC form, in the same order as the Excel sheet.
  // dashboard: false = asked on the form, but no card on the dashboard.
  fields: [
    { key: "tibb", label: "Tibb", group: "Regular Khidmat", statuses: "progress" },
    { key: "riyadah", label: "Riyadah", group: "Regular Khidmat", statuses: "progress" },
    { key: "nazafat", label: "Nazafat", group: "Regular Khidmat", statuses: "progress" },
    { key: "mahulShifa", label: "Mahul Shifa Thayu?", group: "Mahul us Shifa (16mi)", statuses: "yesNo" },
    { key: "aamil", label: "Aamil Uploaded?", group: "Mahul us Shifa (16mi)", statuses: "yesNo" },
    { key: "before16mi", label: "Before 16mi?", group: "Mahul us Shifa (16mi)", statuses: "yesNo" },
    { key: "hsCoordinator", label: "HS Coordinator Assigned?", group: "Hifz us Sehhat", statuses: "yesNo", dashboard: false },
    { key: "caseFollow", label: "Hifz Sehhat Follow-up", group: "Hifz us Sehhat", statuses: "yesNo" },
    { key: "imadad", label: "Imadad Tibbi Follow-up", group: "Imadad Tibbi", statuses: "progress" },
  ],
  remarksLabel: "Short Remarks / Next Action",
  remarksMaxLength: 500,
  showRemarks: true,
};
