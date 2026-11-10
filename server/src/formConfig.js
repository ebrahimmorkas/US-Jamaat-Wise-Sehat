// ============================================================
//  JC FORM SETTINGS
//  The questions ("portal fields") and their answers are managed by the Super Admin
//  (Super Admin portal -> Portal Fields) and stored in MongoDB. The values below are
//  only used the first time the server starts, to create the starting set.
// ============================================================
const PROGRESS = [["Completed", "done"], ["Pending", "pending"], ["In Progress", "progress"], ["Not Applicable", "na"]];
const YES_NO = [["Yes", "done"], ["No", "notdone"], ["Pending", "pending"], ["Not Applicable", "na"]];

module.exports = {
  // Months follow Indian time (a new month starts at midnight IST).
  timeZone: "Asia/Kolkata",

  // On /jc-portal a JC can fill the current month and this many months before it.
  portalMonthsBack: 2,

  // What each answer meaning does on the dashboard.
  //   tone: colour · "done" counts as done in the completion rate · "na" is left out of it
  meanings: {
    done: { label: "Done", tone: "good" },
    progress: { label: "In progress", tone: "info" },
    pending: { label: "Pending", tone: "warn" },
    notdone: { label: "Not done", tone: "bad" },
    na: { label: "Not applicable", tone: "na" },
  },

  // Starting questions (same as the old Excel sheet). key = where answers are saved; never changes.
  defaultFields: [
    { key: "tibb", label: "Tibb", section: "Regular Khidmat", options: PROGRESS },
    { key: "riyadah", label: "Riyadah", section: "Regular Khidmat", options: PROGRESS },
    { key: "nazafat", label: "Nazafat", section: "Regular Khidmat", options: PROGRESS },
    { key: "mahulShifa", label: "Mahul Shifa Thayu?", section: "Mahul us Shifa (16mi)", options: YES_NO },
    { key: "aamil", label: "Aamil Uploaded?", section: "Mahul us Shifa (16mi)", options: YES_NO },
    { key: "before16mi", label: "Before 16mi?", section: "Mahul us Shifa (16mi)", options: YES_NO },
    { key: "hsCoordinator", label: "HS Coordinator Assigned?", section: "Hifz us Sehhat", options: YES_NO, showOnDashboard: false },
    { key: "caseFollow", label: "Hifz Sehhat Follow-up", section: "Hifz us Sehhat", options: YES_NO },
    { key: "imadad", label: "Imadad Tibbi Follow-up", section: "Imadad Tibbi", options: PROGRESS },
  ],

  // Simple lists managed on the same page.
  lists: {
    mauzeType: { label: "Mauze Type", usedBy: ["Jamaat details on the JC portal", "Jamaat master"], defaults: ["UMMAL", "MASOOL UL MAUZE"] },
  },

  remarksLabel: "Short Remarks / Next Action",
  remarksMaxLength: 500,
  showRemarks: true,
};
