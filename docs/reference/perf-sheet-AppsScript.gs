/**
 * Cvideo → Google Sheet bridge  (the cowork content-engine's authoritative version).
 * Paste into your tracker Sheet → Extensions → Apps Script.
 *
 * Cvideo POSTs a JSON ARRAY of rows (one row for a live log, many for a backfill),
 * each matching columns A–M (Cvideo does NOT send a score — the Sheet computes
 * Score/Verdict from the Setup-tab weights):
 *   [{ post_id, date, brand, platform, journey_stage, hook, hook_trigger, angle,
 *      caption_style, views, follows, saves, sends }, ...]
 * (journey_stage + hook_trigger arrive blank; the Sunday run infers them.)
 *
 * SETUP:
 *  1. Drag content-performance-tracker.xlsx into Drive → open with Google Sheets →
 *     File → Save as Google Sheets (keeps the Setup tab + dropdowns + formatting).
 *  2. Extensions → Apps Script → paste THIS → Save.
 *  3. Deploy → New deployment (or Manage deployments → Edit → New version) → Web app →
 *     Execute as: Me, Access: Anyone → copy URL.
 *  4. backend/.env:  PERF_SHEET_WEBHOOK_URL=<that URL>   → restart the backend.
 *  5. Results page → "📊 Sync to Google Sheet" backfills every existing row.
 *
 * NOTE: re-deploy a NEW VERSION after any edit — Apps Script serves the last DEPLOYED
 * version, not the saved one.
 */
function doPost(e) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Content Log');
  const data = JSON.parse(e.postData.contents);
  const rows = Array.isArray(data) ? data : [data];   // Cvideo sends an ARRAY of rows
  rows.forEach(function (d) {
    sh.appendRow([
      d.post_id || '', d.date || new Date().toISOString().slice(0, 10),
      d.brand || '', d.platform || '', d.journey_stage || '',
      d.hook || '', d.hook_trigger || '', d.angle || '', d.caption_style || '',
      Number(d.views) || 0, Number(d.follows) || 0, Number(d.saves) || 0, Number(d.sends) || 0
    ]);
    const r = sh.getLastRow();
    sh.getRange(r, 14).setFormula('=IF(J' + r + '="","",IF(J' + r + '<Setup!$B$5,"low data",ROUND((L' + r + '*Setup!$B$7+K' + r + '*Setup!$B$8+M' + r + '*Setup!$B$9)/J' + r + '*1000,1)))');
    sh.getRange(r, 15).setFormula('=IF(N' + r + '="","",IF(N' + r + '="low data","collecting",IF(N' + r + '>=Setup!$B$3,"winner",IF(N' + r + '<Setup!$B$4,"flop","ok"))))');
  });
  return ContentService.createTextOutput(JSON.stringify({ ok: true, added: rows.length }))
    .setMimeType(ContentService.MimeType.JSON);
}
