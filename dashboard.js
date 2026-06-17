// api/_sheets.js  –  shared Google Sheets client (service account auth)
// Same pattern as solarsquare-qa. Reuses GOOGLE_SA_EMAIL + GOOGLE_SA_KEY env vars.

const { google } = require('googleapis');

const SHEET_ID = process.env.SHEET_ID;

function getAuth() {
  const privateKey = (process.env.GOOGLE_SA_KEY || '').replace(/\\n/g, '\n');
  return new google.auth.JWT({
    email:  process.env.GOOGLE_SA_EMAIL,
    key:    privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

/**
 * Read a named range or tab from the sheet.
 * Returns raw 2D array of values.
 */
async function readSheet(range) {
  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res    = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });
  return res.data.values || [];
}

module.exports = { readSheet };
