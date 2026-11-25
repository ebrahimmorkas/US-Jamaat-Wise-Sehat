// Portal notifications for Jamaat Coordinators. The email reminders (part C) call notify() with the same
// text they email, so the message is also in the Coordinator's portal.
const Notification = require("../models/Notification");

/**
 * Save one notification for each user.
 * @param {Array<string|ObjectId>} users  user ids
 * @param {{ kind?: "reminder"|"form"|"info", title: string, body?: string, form?: string|ObjectId }} msg
 * @returns {Promise<number>} how many were saved
 */
async function notify(users, { kind = "info", title, body = "", form = null }) {
  const ids = [...new Set((users || []).map(String))];
  if (!ids.length || !title) return 0;
  const docs = ids.map((user) => ({ user, kind, title: String(title).slice(0, 200), body: String(body || "").slice(0, 5000), form }));
  const out = await Notification.insertMany(docs, { ordered: false });
  return out.length;
}

module.exports = { notify };
