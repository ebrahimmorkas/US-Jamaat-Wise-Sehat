// Gmail addresses for JC users.
// Gmail ignores dots and anything after "+", and googlemail.com = gmail.com, so
// "a.b+jc@gmail.com" and "ab@googlemail.com" are the same inbox -> same canonical key.
const GMAIL_RE = /^[a-z0-9](?:[a-z0-9.]*[a-z0-9])?(?:\+[a-z0-9._-]+)?@(gmail\.com|googlemail\.com)$/;

function parseGmail(input) {
  const email = String(input == null ? "" : input).trim().toLowerCase();
  if (!email) return { error: "Enter the Gmail address." };
  if (!GMAIL_RE.test(email) || email.includes("..")) {
    return { error: "Enter a valid Gmail address (ending in @gmail.com)." };
  }
  const local = email.split("@")[0].split("+")[0].replace(/\./g, "");
  if (local.length < 6 || local.length > 30) return { error: "A Gmail username has 6 to 30 letters or numbers." };
  return { email, emailKey: `${local}@gmail.com` };
}

module.exports = { parseGmail };
