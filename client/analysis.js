// public/analysis.js

document.addEventListener('DOMContentLoaded', () => {
  const { Store, syncToServer } = window.LuminaDx;
  const data = Store.get();

  /* ─── Guard: require intake data ───────────────────────────────────────── */

  if (!data?.patient || !data.patient.name) {
    window.location.href = '/intake';
    return;
  }

  /* ─── Populate patient summary bar ─────────────────────────────────────── */

  const p = data.patient;
  setText('summary-name',    p.name || '—');
  setText('summary-age-sex', [p.age, p.sex].filter(Boolean).join(' / ') || '—');
  setText('summary-ana',     p.anaTiter  || '—');
  setText('summary-igg',     p.igg       || '—');
  setText('summary-alt',     p.alt       || '—');
  setText('summary-ast',     p.ast       || '—');

  /* ─── If results already exist, render them immediately ────────────────── */

  if (data.diagnosticResults) {
    renderResults(data.diagnosticResults);
  }

  /* ─── Run Analysis ──────────────────────────────────────────────────────── */

  document.getElementById('run-analysis-btn').addEventListener('click', runAnalysis);
  document.getElementById('retry-btn')?.addEventListener('click', runAnalysis);
  document.getElementById('rerun-btn')?.addEventListener('click', () => {
    showPanel('pre');
    Store.merge({ diagnosticResults: null, iaihgScore: null });
  });

  async function runAnalysis() {
    showPanel('loading');
    setStatusText('PROCESSING', true);

    try {
      setLoadingStep('Sending intake data to LuminaDx…');

      const res = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient: data.patient, sessionId: data.sessionId }),
      });

      setLoadingStep('Scoring against IAIHG criteria…');

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const result = await res.json();

      setLoadingStep('Finalising results…');

      const updated = Store.merge({
        diagnosticResults: result,
        iaihgScore: result.iaihgScore,
      });
      await syncToServer(updated);

      renderResults(result);
      setStatusText('COMPLETE', false);

    } catch (err) {
      showPanel('error');
      setText('error-message', err.message || 'Unknown error. Check server logs.');
      setStatusText('ERROR', false);
    }
  }

  /* ─── Render Results ────────────────────────────────────────────────────── */

  function renderResults(result) {
    // KPIs
    setText('result-score',          result.iaihgScore ?? '—');
    setText('result-classification', result.classification ?? '—');
    setText('result-confidence',     result.confidence ? `${result.confidence}%` : '—');
    setText('result-treatment',      result.treatmentIndication ?? '—');

    // Classification colour
    const classEl = document.getElementById('result-classification');
    if (classEl) {
      const c = (result.classification || '').toLowerCase();
      classEl.className = 'kpi-value';
      if (c.includes('definite'))  classEl.classList.add('green');
      else if (c.includes('probable')) classEl.classList.add('amber');
      else classEl.classList.add('text-muted');
    }

    // Score breakdown
    const breakdown = document.getElementById('score-breakdown');
    if (breakdown && Array.isArray(result.scoreBreakdown)) {
      breakdown.innerHTML = result.scoreBreakdown.map(item => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--slate-900);border-radius:var(--radius-sm);border:1px solid var(--glass-border)">
          <span style="font-size:12px;color:var(--slate-400)">${item.criterion}</span>
          <span style="font-family:var(--font-mono);font-size:12px;color:${item.points >= 0 ? 'var(--blue-400)' : 'var(--accent-red)'};font-weight:600">
            ${item.points >= 0 ? '+' : ''}${item.points}
          </span>
        </div>
      `).join('');
    }

    // Narrative
    const narrative = document.getElementById('ai-narrative');
    if (narrative) narrative.textContent = result.narrative || 'No narrative returned.';

    // Recommendations
    const recs = document.getElementById('ai-recommendations');
    if (recs) {
      if (Array.isArray(result.recommendations)) {
        recs.innerHTML = result.recommendations.map(r => `
          <div style="display:flex;gap:10px;margin-bottom:10px">
            <span style="color:var(--blue-400);flex-shrink:0;margin-top:2px">→</span>
            <span>${r}</span>
          </div>
        `).join('');
      } else {
        recs.textContent = result.recommendations || '—';
      }
    }

    // Unlock report nav link
    document.querySelector('.nav-item[data-page="report"]')?.classList.remove('disabled');

    showPanel('results');
  }

  /* ─── UI Helpers ────────────────────────────────────────────────────────── */

  function showPanel(which) {
    document.getElementById('pre-analysis-panel').style.display  = which === 'pre'     ? '' : 'none';
    document.getElementById('loading-panel').style.display        = which === 'loading' ? '' : 'none';
    document.getElementById('results-panel').style.display        = which === 'results' ? '' : 'none';
    document.getElementById('error-panel').style.display          = which === 'error'   ? '' : 'none';
  }

  function setLoadingStep(msg) {
    setText('loading-step-text', msg);
  }

  function setStatusText(text, pulsing) {
    const dot  = document.getElementById('analysis-status-dot');
    const label = document.getElementById('analysis-status-text');
    if (label) label.textContent = text;
    if (dot) {
      dot.style.background   = pulsing ? 'var(--accent-amber)' : text === 'COMPLETE' ? 'var(--accent-emerald)' : text === 'ERROR' ? 'var(--accent-red)' : 'var(--accent-emerald)';
      dot.style.boxShadow    = `0 0 6px ${dot.style.background}`;
    }
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
});