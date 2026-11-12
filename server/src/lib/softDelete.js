// "Delete" never removes a record: it sets status "D" (deleted), hides it everywhere and keeps it
// (with who deleted it and when) so it can be restored. Status "A" = normal.
//
// Records with an isActive flag (Jamiats, Jamaats, users, questions) are also made inactive while
// deleted, so every screen that shows only active records hides them without extra checks.
// Restoring brings back the active / inactive state they had before.
const DELETED = "D";
const STATUSES = ["A", DELETED];

/** Schema fields to add to a model or sub-document. */
const softDeleteFields = () => ({
  status: { type: String, enum: STATUSES, default: "A" },
  deletedAt: Date,
  deletedBy: String,
  activeBeforeDelete: Boolean,
});

/** Mongo filter: not deleted (older documents have no status at all). */
const notDeleted = () => ({ status: { $ne: DELETED } });
const isDeleted = (doc) => !!doc && doc.status === DELETED;

function markDeleted(doc, by) {
  if (typeof doc.isActive === "boolean") { // models with an Active flag (not answers / list values)
    doc.activeBeforeDelete = doc.isActive !== false;
    doc.isActive = false;
  }
  doc.status = DELETED;
  doc.deletedAt = new Date();
  doc.deletedBy = by || "";
}

function markRestored(doc) {
  if (typeof doc.activeBeforeDelete === "boolean") doc.isActive = doc.activeBeforeDelete;
  doc.status = "A";
  doc.deletedAt = undefined;
  doc.deletedBy = undefined;
  doc.activeBeforeDelete = undefined;
}

/** What the admin screens get about a record's deletion. */
const deletedInfo = (doc) => (isDeleted(doc) ? { deleted: true, deletedAt: doc.deletedAt || null, deletedBy: doc.deletedBy || "" } : { deleted: false });

/** Audit-trail line for delete / restore. */
const statusChange = (from, to) => ({ field: "status", label: "Status", from: from === DELETED ? "D (deleted)" : "A", to: to === DELETED ? "D (deleted)" : "A" });

module.exports = { DELETED, STATUSES, softDeleteFields, notDeleted, isDeleted, markDeleted, markRestored, deletedInfo, statusChange };
