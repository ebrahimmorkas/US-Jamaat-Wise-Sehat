// "Send email to Jamaat Coordinators with the form link": when such a form is published, every active
// Jamaat Coordinator gets an email with their own link (personal-link forms: with their Gmail inside), and
// the same message in their portal (Notifications). It happens once per form (form.announce.at).
const Form = require("../models/Form");
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const { notDeleted } = require("../lib/softDelete");
const { notify } = require("./notify");
const mail = require("./email");
const F = require("./forms");

const linkFor = (f, email) => (f.access === "personal_link" ? F.personalLink(f.code, email) : F.formLink(f.code));

/** The email for one Coordinator. */
function message(form, person, jamaatName, link) {
  const hello = person.name ? `Salaam ${person.name},` : "Salaam,";
  const desc = (form.description || "").trim().slice(0, 1000);
  const when = `Open from ${mail.emailTime(form.startAt)}\nCloses ${mail.emailTime(form.endAt)}`;
  const personal = form.access === "personal_link" ? "This link is personal to you. Please don't forward it." : "";
  const text = [
    hello,
    `A new form is open for ${jamaatName ? `your Jamaat (${jamaatName})` : "you"}: ${form.title}`,
    desc,
    when,
    `Fill the form: ${link}`,
    personal,
    "You can also find it in your Coordinator portal under My forms.",
    "Umoor Sehhat",
  ].filter(Boolean).join("\n\n");
  const e = mail.esc;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1d2433;max-width:560px">
<p>${e(hello)}</p>
<p>A new form is open for ${jamaatName ? `your Jamaat (<b>${e(jamaatName)}</b>)` : "you"}:</p>
<h2 style="font-size:19px;margin:0 0 8px">${e(form.title)}</h2>
${desc ? `<p style="white-space:pre-wrap;color:#4a5568">${e(desc)}</p>` : ""}
<p style="color:#4a5568">Open from ${e(mail.emailTime(form.startAt))}<br>Closes <b>${e(mail.emailTime(form.endAt))}</b></p>
<p><a href="${e(link)}" style="display:inline-block;background:#1f6f43;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:bold">Fill the form</a></p>
<p style="font-size:13px;color:#718096">If the button doesn't work, open this link:<br><a href="${e(link)}">${e(link)}</a></p>
${personal ? `<p style="font-size:13px;color:#718096">${e(personal)}</p>` : ""}
<p style="font-size:13px;color:#718096">You can also find it in your Coordinator portal under <b>My forms</b>.</p>
<p>Umoor Sehhat</p></div>`;
  return { subject: `New form: ${form.title}`, text, html };
}

/**
 * Announce a published form (once). Runs in the background; progress is saved on the form (form.announce).
 * @returns {Promise<boolean>} false when it was already announced (or isn't meant to be)
 */
async function announceForm(formId) {
  // Claim it first, so two clicks never send twice.
  const form = await Form.findOneAndUpdate(
    { _id: formId, stage: "published", announceEmail: true, "announce.at": { $in: [null, undefined] }, ...notDeleted() },
    { $set: { announce: { at: new Date(), status: "sending", total: 0, sent: 0, failed: 0, error: "" } } },
    { returnDocument: "after" }
  ).lean();
  if (!form) return false;
  const people = await User.find({ role: "jamaat_coordinator", isActive: true, email: { $nin: [null, ""] }, ...notDeleted() }).select("name email jamaat").lean();
  const jms = await Jamaat.find({ _id: { $in: people.map((p) => p.jamaat).filter(Boolean) } }).select("name").lean();
  const jmName = new Map(jms.map((j) => [String(j._id), j.name]));
  const ready = mail.isReady();
  await Form.updateOne({ _id: form._id }, { $set: { "announce.total": people.length, ...(ready ? {} : { "announce.error": "Email isn't set up on the server: only the portal notifications were sent." }) } });

  // The portal notification (same message), for everyone at once.
  await notify(people.map((p) => p._id), { kind: "form", title: `New form: ${form.title}`, body: `A new form is open for your Jamaat. It closes ${mail.emailTime(form.endAt)}.`, form: form._id }).catch((e) => console.error("[announce] notifications", e.message));

  let sent = 0;
  let failed = 0;
  let lastError = "";
  if (ready) {
    for (const p of people) {
      try {
        await mail.sendMail({ to: p.email, ...message(form, p, jmName.get(String(p.jamaat)) || "", linkFor(form, p.email)) });
        sent += 1;
      } catch (e) {
        failed += 1;
        lastError = String((e && e.message) || e).slice(0, 300);
      }
      if ((sent + failed) % 10 === 0) await Form.updateOne({ _id: form._id }, { $set: { "announce.sent": sent, "announce.failed": failed } });
    }
  }
  await Form.updateOne({ _id: form._id }, { $set: {
    "announce.sent": sent, "announce.failed": failed, "announce.finishedAt": new Date(),
    "announce.status": !ready ? "not_set_up" : failed && !sent ? "failed" : "done",
    ...(lastError ? { "announce.error": lastError } : {}),
  } });
  return true;
}

/** Start it without waiting (the Super Admin's click returns at once). */
function announceInBackground(formId) {
  announceForm(formId).catch((e) => console.error("[announce]", e && e.message));
}

module.exports = { announceForm, announceInBackground, message };
