// ============================================================
//  JC FORM SETTINGS
//  The questions ("portal fields") and their answers are managed by the Super Admin
//  (Super Admin portal -> Portal Fields) and stored in MongoDB. The values below are
//  only used the first time the server starts, to create the starting set.
// ============================================================
const PROGRESS = [["Completed", "done"], ["Pending", "pending"], ["In Progress", "progress"], ["Not Applicable", "na"]];
const YES_NO = [["Yes", "done"], ["No", "notdone"], ["Pending", "pending"], ["Not Applicable", "na"]];
const YES_PENDING = [["Yes", "done"], ["Pending", "pending"]];

module.exports = {
  // Reports are monthly, by Hijri month of the Misri calendar (see server/src/lib/month.js).
  // A new day starts at midnight Indian time.
  timeZone: "Asia/Kolkata",

  // The Month + Year pickers go from this Hijri month ("YYYY-MM", e.g. "1448-05" = Jumadal Ula 1448)
  // up to the current month. A JC can fill (or update) any month in that range; future months are
  // never offered. The Sahebo dashboard also shows any older month that has entries.
  firstMonth: "1448-05",

  // Names of the 12 Hijri months as shown on the pickers.
  hijriMonthNames: [
    "Moharram ul Haraam", "Safar ul Muzaffar", "Rabi ul Awwal", "Rabi ul Aakhar",
    "Jumadal Ula", "Jumadal Ukhra", "Rajab ul Asab", "Shaban ul Karim",
    "Ramadan ul Moazzam", "Shawwal ul Mukarram", "Zilqadah ul Haraam", "Zilhaj ul Haraam",
  ],

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
  // type "date" = a date picker instead of a dropdown. hasActivities = answered per monthly activity.
  defaultFields: [
    { key: "tibb", label: "Tibb", section: "Event Status", options: PROGRESS, hasActivities: true },
    { key: "riyadah", label: "Riyadah", section: "Event Status", options: PROGRESS, hasActivities: true },
    { key: "nazafat", label: "Nazafat", section: "Event Status", options: PROGRESS, hasActivities: true },
    { key: "mahulShifa", label: "Mahul Shifa Thayu?", section: "Mahul us Shifa (16mi)", options: YES_NO },
    { key: "aamil", label: "Mahal Us Shifa report filled on amalat.com?", section: "Mahul us Shifa (16mi)", options: YES_NO },
    { key: "reportDate", label: "Date the report was filled", section: "Mahul us Shifa (16mi)", type: "date", required: false, showOnDashboard: false },
    { key: "hsCoordinator", label: "HS Coordinator Assigned?", section: "Hifz us Sehhat", options: YES_PENDING, showOnDashboard: false },
    { key: "caseFollow", label: "Hifz Sehhat Follow-up", section: "Hifz us Sehhat", options: YES_PENDING },
    { key: "imadad", label: "Imadad Tibbi Follow-up", section: "Imadad Tibbi", options: PROGRESS },
  ],

  // Simple lists managed on the same page.
  lists: {
    mauzeType: { label: "Mauze Type", usedBy: ["Jamaat details on the JC portal", "Jamaat master"], defaults: ["UMMAL", "MASOOL UL MAUZE"] },
  },

  remarksLabel: "Short Remarks / Next Action",
  remarksMaxLength: 500,
  commentMaxLength: 300, // the comment box under a question
  showRemarks: true,
};
