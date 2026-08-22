function buildEmailHtml({ records, dateFrom, dateTo }) {
  const rows = records
    .map(
      (r, i) => `
      <tr style="background:${i % 2 === 0 ? "#f9fafb" : "#ffffff"}">
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${r.id}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${r.received_at}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;max-width:400px;word-break:break-word">${r.message}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;max-width:300px;word-break:break-word">${r.barcode ? String(r.barcode).replace(/\|/g, ' | ') : '—'}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>TCP Report</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f3f4f6">
  <div style="max-width:800px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
    <div style="background:#1e40af;padding:24px 32px">
      <h1 style="margin:0;color:#ffffff;font-size:22px">TCP Message Report</h1>
      <p style="margin:4px 0 0;color:#bfdbfe;font-size:14px">${dateFrom} → ${dateTo}</p>
    </div>
    <div style="padding:24px 32px">
      <div style="display:flex;gap:16px;margin-bottom:24px">
        <div style="flex:1;background:#eff6ff;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:32px;font-weight:700;color:#1e40af">${records.length}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:4px">Total Records</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#1e40af;color:#ffffff">
            <th style="padding:10px 12px;border:1px solid #e5e7eb;text-align:left">ID</th>
            <th style="padding:10px 12px;border:1px solid #e5e7eb;text-align:left">Received At</th>
            <th style="padding:10px 12px;border:1px solid #e5e7eb;text-align:left">Message</th>
            <th style="padding:10px 12px;border:1px solid #e5e7eb;text-align:left">Barcode</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;font-size:12px;color:#9ca3af">
      Generated at ${new Date().toISOString()} · TCP Monitor System
    </div>
  </div>
</body>
</html>`;
}

module.exports = buildEmailHtml;
