// Reads ranges from the Google Sheet.
//   - "public": sheet shared "Anyone with the link" -> Google Visualization endpoint, no key.
//   - "service-account": private sheet shared with the service account -> Google Sheets API.
// Both return the same shape: [{ sheet, range, rows: string[][] } | { sheet, range, error }]
const fs = require("fs");
const config = require("../config");

// ---------- public (gviz) ----------
async function readPublicRange(sheet, range) {
  const url =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.sheetId)}/gviz/tq` +
    `?tqx=out:json&headers=0&sheet=${encodeURIComponent(sheet)}&range=${encodeURIComponent(range)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Sheet is not public. Share it as 'Anyone with the link' or use SHEET_ACCESS=service-account."
        : `Google returned HTTP ${res.status}`
    );
  }
  const text = await res.text();
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end < 0) throw new Error("Unexpected response from Google");
  const json = JSON.parse(text.slice(start + 1, end));
  if (json.status === "error") {
    throw new Error((json.errors || []).map((e) => e.detailed_message || e.message).join("; "));
  }
  return json.table.rows.map((r) =>
    (r.c || []).map((c) => (c == null ? "" : String(c.f != null ? c.f : c.v ?? "").trim()))
  );
}

async function readPublic(requests) {
  return Promise.all(
    requests.map(async ({ sheet, range }) => {
      try {
        return { sheet, range, rows: await readPublicRange(sheet, range) };
      } catch (err) {
        return { sheet, range, error: err.message };
      }
    })
  );
}

// ---------- service account (Sheets API) ----------
let sheetsClient = null;
function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const { google } = require("googleapis");

  let credentials;
  if (config.serviceAccountKeyJson) {
    const raw = config.serviceAccountKeyJson.trim();
    credentials = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  } else if (config.serviceAccountKeyFile && fs.existsSync(config.serviceAccountKeyFile)) {
    credentials = JSON.parse(fs.readFileSync(config.serviceAccountKeyFile, "utf8"));
  } else {
    throw new Error(
      "SHEET_ACCESS=service-account but no key found. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_KEY_JSON."
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

const a1 = (sheet, range) => `'${sheet.replace(/'/g, "''")}'!${range}`;

async function readServiceAccount(requests) {
  const sheets = getSheetsClient();
  // Find which tabs exist, so one missing tab doesn't fail the whole batch.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.sheetId,
    fields: "sheets.properties.title",
  });
  const titles = new Set(meta.data.sheets.map((s) => s.properties.title));
  const valid = requests.filter((r) => titles.has(r.sheet));

  const byKey = new Map();
  if (valid.length) {
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: config.sheetId,
      ranges: valid.map((r) => a1(r.sheet, r.range)),
      valueRenderOption: "FORMATTED_VALUE",
    });
    res.data.valueRanges.forEach((vr, i) => {
      const r = valid[i];
      byKey.set(r.sheet + "|" + r.range, (vr.values || []).map((row) => row.map((v) => String(v ?? "").trim())));
    });
  }
  return requests.map(({ sheet, range }) =>
    byKey.has(sheet + "|" + range)
      ? { sheet, range, rows: byKey.get(sheet + "|" + range) }
      : { sheet, range, error: `Tab "${sheet}" not found in the spreadsheet` }
  );
}

async function readRanges(requests) {
  return config.sheetAccess === "service-account" ? readServiceAccount(requests) : readPublic(requests);
}

module.exports = { readRanges };
