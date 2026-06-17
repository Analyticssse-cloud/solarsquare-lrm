const { google } = require('googleapis');

const SHEET_ID = process.env.SHEET_ID;

function getAuth() {
  let privateKey = process.env.GOOGLE_SA_KEY || '';
  
  // Handle both escaped \n and real newlines
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  // Strip surrounding quotes if present
  privateKey = privateKey.replace(/^["']|["']$/g, '');

  return new google.auth.JWT({
    email:  process.env.GOOGLE_SA_EMAIL,
    key:    privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

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
