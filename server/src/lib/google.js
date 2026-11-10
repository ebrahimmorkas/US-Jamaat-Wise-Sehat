// Verifies the ID token that "Sign in with Google" gives the browser.
// Checks Google's signature, that it was issued for OUR Client ID, is not expired, and the email is verified.
const { OAuth2Client } = require("google-auth-library");
const config = require("../config");

let client = null;

async function verifyGoogleCredential(credential) {
  if (!config.googleClientId) throw Object.assign(new Error("Google sign-in is not set up yet (GOOGLE_CLIENT_ID is missing)."), { status: 503 });
  if (typeof credential !== "string" || credential.length > 4096) throw Object.assign(new Error("Invalid Google sign-in."), { status: 400 });
  client = client || new OAuth2Client(config.googleClientId);
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: config.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw Object.assign(new Error("Google sign-in could not be verified. Please try again."), { status: 401 });
  }
  if (!payload || !payload.email || payload.email_verified !== true) {
    throw Object.assign(new Error("Your Google account email is not verified."), { status: 401 });
  }
  return { sub: payload.sub, email: payload.email.toLowerCase(), name: payload.name || "" };
}

module.exports = { verifyGoogleCredential };
