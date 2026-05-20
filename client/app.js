// public/app.js

/* ─── Constants ──────────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'clinicalData';

const DEFAULT_CLINICAL_DATA = {
  patient: {},
  symptoms: [],
  labValues: {},
  uploadedFiles: [],
  diagnosticResults: null,
  iaihgScore: null,
  sessionId: null,
  createdAt: null,
  updatedAt: null,
};

/* ─── LocalStorage API ───────────────────────────────────────────────────────── */

const Store = {
  init() {
    const existing = this.get();
    if (!existing || !existing.sessionId) {
      const fresh = {
        ...DEFAULT_CLINICAL_DATA,
        sessionId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      this.set(fresh);
      return fresh;
    }
    return existing;
  },

  get() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      console.error('[Store] Failed to parse clinicalData from localStorage.');
      return null;
    }
  },

  set(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('[Store] Failed to write clinicalData:', e);
    }
  },

  merge(partial) {
    const current = this.get() || { ...DEFAULT_CLINICAL_DATA };
    const updated = {
      ...current,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    this.set(updated);
    return updated;
  },

  clear() {
    const fresh = {
      ...DEFAULT_CLINICAL_DATA,
      sessionId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.set(fresh);
    return fresh;
  },
};

/* ─── Navigation: Active State ───────────────────────────────────────────────── */

function initNavigation() {
  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';

  document.querySelectorAll('.nav-item[data-page]').forEach(link => {
    link.classList.remove('active');
    const href = link.getAttribute('href');
    const normalizedHref = href === '/' ? '/' : href.replace(/\/$/, '');
    if (normalizedHref === currentPath) {
      link.classList.add('active');
    }
  });
}

/* ─── Sidebar: Unlock Steps Based on Progress ───────────────────────────────── */

function syncNavState(data) {
  const analysisLink = document.querySelector('.nav-item[data-page="analysis"]');
  const reportLink   = document.querySelector('.nav-item[data-page="report"]');

  const hasIntakeData = data?.patient && Object.keys(data.patient).length > 0;
  const hasResults    = !!data?.diagnosticResults;

  if (analysisLink) {
    analysisLink.classList.toggle('disabled', !hasIntakeData);
  }
  if (reportLink) {
    reportLink.classList.toggle('disabled', !hasResults);
  }
}

/* ─── Session ID Display ─────────────────────────────────────────────────────── */

function renderSessionId(data) {
  const el = document.getElementById('topbar-session-id');
  if (el && data?.sessionId) {
    el.textContent = `SID: ${data.sessionId.slice(0, 8).toUpperCase()}`;
  }

  const kpiStatus = document.getElementById('kpi-session-status');
  if (kpiStatus) {
    const hasData = data?.patient && Object.keys(data.patient).length > 0;
    kpiStatus.textContent = hasData ? 'ACTIVE' : 'READY';
    kpiStatus.className   = `kpi-value ${hasData ? 'blue' : 'green'}`;
  }
}

/* ─── Clear Session Handler ──────────────────────────────────────────────────── */

function initClearSession() {
  const btn = document.getElementById('clear-session-btn');
  if (!btn) return;

  btn.addEventListener('click', e => {
    e.preventDefault();
    const confirmed = window.confirm(
      'Clear all session data and start a new assessment?'
    );
    if (!confirmed) return;

    const fresh = Store.clear();

    // Also reset server-side session
    fetch('/api/session', { method: 'DELETE' }).catch(() => {});

    renderSessionId(fresh);
    syncNavState(fresh);

    if (window.location.pathname !== '/') {
      window.location.href = '/';
    }
  });
}

/* ─── Sync localStorage → Server Session (best-effort) ──────────────────────── */

async function syncToServer(data) {
  try {
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    // Offline or server down — localStorage is the source of truth client-side
  }
}

/* ─── Boot ───────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  const data = Store.init();

  initNavigation();
  syncNavState(data);
  renderSessionId(data);
  initClearSession();

  // Expose Store globally so intake.js / analysis.js can use it without re-importing
  window.LuminaDx = { Store, syncToServer };
});