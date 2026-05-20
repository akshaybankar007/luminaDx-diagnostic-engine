// public/report.js

document.addEventListener('DOMContentLoaded', () => {
  const { Store } = window.LuminaDx;
  const data = Store.get();

  /* ─── Guard ─────────────────────────────────────────────────────────────── */

  if (!data?.diagnosticResults) {
    window.location.href = '/analysis';
    return;
  }

  const p = data.patient;
  const r = data.diagnosticResults;

  /* ─── Meta ──────────────────────────────────────────────────────────────── */

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  setText('report-timestamp',  `Generated: ${dateStr} ${timeStr}`);
  setText('report-date',       `${dateStr} ${timeStr}`);
  setText('report-sid',        `SID: ${data.sessionId?.slice(0, 8).toUpperCase() || '—'}`);

  /* ─── Patient ───────────────────────────────────────────────────────────── */

  setText('r-name',  p.name  || '—');
  setText('r-age',   p.age   || '—');
  setText('r-sex',   p.sex   ? capitalize(p.sex) : '—');
  setText('r-score', r.iaihgScore ?? '—');

  /* ─── Serology ──────────────────────────────────────────────────────────── */

  setText('r-ana',  p.anaTiter  || '—');
  setText('r-asma', p.asmaTiter || '—');
  setText('r-lkm',  p.antiLkm1  || '—');
  setText('r-igg',  p.igg       || '—');
  setText('r-alt',  p.alt       || '—');
  setText('r-ast',  p.ast       || '—');

  /* ─── Classification Badge ──────────────────────────────────────────────── */

  const badge = document.getElementById('report-classification-badge');
  const classText = r.classification || '—';
  if (badge) {
    badge.textContent = classText.toUpperCase();
    const c = classText.toLowerCase();
    badge.className = 'badge ' + (
      c.includes('definite')  ? 'badge-green' :
      c.includes('probable')  ? 'badge-amber' :
      'badge-slate'
    );
  }

  /* ─── Classification panel ──────────────────────────────────────────────── */

  const classEl = document.getElementById('r-classification');
  if (classEl) {
    classEl.textContent = classText;
    const c = classText.toLowerCase();
    classEl.style.color = c.includes('definite') ? 'var(--accent-emerald)'
      : c.includes('probable')  ? 'var(--accent-amber)'
      : 'var(--slate-400)';
  }

  setText('r-score-total', r.iaihgScore ?? '—');
  setText('r-confidence',  r.confidence  ? `${r.confidence}%` : '—');
  setText('r-treatment',   r.treatmentIndication || '—');

  /* ─── Score Breakdown ───────────────────────────────────────────────────── */

  const breakdown = document.getElementById('r-breakdown');
  if (breakdown && Array.isArray(r.scoreBreakdown)) {
    breakdown.innerHTML = r.scoreBreakdown.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--slate-900);border-radius:var(--radius-sm);border:1px solid var(--glass-border)">
        <span style="font-size:12px;color:var(--slate-400)">${item.criterion}</span>
        <span style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:${item.points >= 0 ? 'var(--blue-400)' : 'var(--accent-red)'}">
          ${item.points >= 0 ? '+' : ''}${item.points}
        </span>
      </div>
    `).join('');
  }

  /* ─── Narrative ─────────────────────────────────────────────────────────── */

  setText('r-narrative', r.narrative || '—');

  /* ─── Recommendations ───────────────────────────────────────────────────── */

  const recs = document.getElementById('r-recommendations');
  if (recs && Array.isArray(r.recommendations)) {
    recs.innerHTML = r.recommendations.map((rec, i) => `
      <div style="display:flex;gap:12px;padding:10px 14px;background:var(--slate-900);border-radius:var(--radius-sm);border:1px solid var(--glass-border)">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--blue-400);padding-top:2px;flex-shrink:0">${String(i + 1).padStart(2, '0')}</span>
        <span style="font-size:13px;color:var(--slate-400);line-height:1.6">${rec}</span>
      </div>
    `).join('');
  }

  /* ─── PDF Download ──────────────────────────────────────────────────────── */

  document.getElementById('download-pdf-btn').addEventListener('click', async () => {
    const btn = document.getElementById('download-pdf-btn');
    btn.disabled = true;
    btn.innerHTML = '<span style="opacity:0.6">Generating…</span>';

    try {
      const res = await fetch('/api/report/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient: p,
          diagnosticResults: r,
          sessionId: data.sessionId,
          generatedAt: now.toISOString(),
        }),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `LuminaDx_Report_${p.name?.replace(/\s+/g, '_') || 'Patient'}_${now.toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

    } catch (err) {
      alert(`PDF generation failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download PDF
      `;
    }
  });

  /* ─── Print ─────────────────────────────────────────────────────────────── */

  document.getElementById('print-btn').addEventListener('click', () => {
    window.print();
  });

  /* ─── New Assessment ────────────────────────────────────────────────────── */

  document.getElementById('new-assessment-btn').addEventListener('click', e => {
    e.preventDefault();
    Store.clear();
    fetch('/api/session', { method: 'DELETE' }).catch(() => {});
    window.location.href = '/';
  });

  /* ─── Helpers ───────────────────────────────────────────────────────────── */

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
});