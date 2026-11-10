// ============================================================
//  THE JC FORM AND THE DASHBOARD — edit here
//  (sent to the React app; the server validates every entry against it)
// ============================================================
module.exports = {
  // Months follow Indian time (a new month starts at midnight IST).
  timeZone: "Asia/Kolkata",

  // On /jc-portal a JC can fill the current month and this many months before it.
  portalMonthsBack: 2,

  // Dropdown lists. The Super Admin edits the values in the portal (stored in MongoDB,
  // collection "optionlists"); "defaults" are only used the first time the server starts.
  //   kind "answers": answer choices of the JC form; every value has a meaning.
  //   kind "plain":   a simple list.
  lists: {
    progress: {
      label: "Progress answers",
      kind: "answers",
      defaults: [["Completed", "done"], ["Pending", "pending"], ["In Progress", "progress"], ["Not Applicable", "na"]],
    },
    yesNo: {
      label: "Yes / No answers",
      kind: "answers",
      defaults: [["Yes", "done"], ["No", "notdone"], ["Pending", "pending"], ["Not Applicable", "na"]],
    },
    mauzeType: {
      label: "Mauze Type",
      kind: "plain",
      usedBy: ["Jamaat master"],
      defaults: [["UMMAL"], ["MASOOL UL MAUZE"]],
    },
  },

  // What each meaning does on the dashboard.
  //   tone: chart colour   done: counted as done in the completion rate   na: left out of it
  meanings: {
    done: { label: "Done", tone: "good" },
    progress: { label: "In progress", tone: "info" },
    pending: { label: "Pending", tone: "warn" },
    notdone: { label: "Not done", tone: "bad" },
    na: { label: "Not applicable", tone: "na" },
  },

  // Every question on the JC form, in the same order as the old Excel sheet.
  // statuses = which answer list it uses. dashboard: false = on the form, but no dashboard card.
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
