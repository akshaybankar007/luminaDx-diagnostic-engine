// public/intake.js

document.addEventListener('DOMContentLoaded', () => {
  const { Store, syncToServer } = window.LuminaDx;
  const data = Store.get();

  /* ─── Restore saved values ─────────────────────────────────────────────── */

  if (data?.patient) {
    const p = data.patient;
    setVal('patient-name',        p.name);
    setVal('patient-age',         p.age);
    setVal('patient-sex',         p.sex);
    setVal('ana-titer',           p.anaTiter);
    setVal('asma-titer',          p.asmaTiter);
    setVal('anti-lkm1',           p.antiLkm1);
    setVal('igg-level',           p.igg);
    setVal('alt-level',           p.alt);
    setVal('ast-level',           p.ast);
    setVal('hbsag',               p.hbsag);
    setVal('anti-hcv',            p.antiHcv);
    setVal('dili',                p.dili);
    setVal('interface-hepatitis', p.interfaceHepatitis);
    setVal('rosette',             p.rosette);
    setVal('histo-notes',         p.histoNotes);
    setVal('clinical-notes',      p.clinicalNotes);
  }

  /* ─── File Drop Zone ───────────────────────────────────────────────────── */

  const dropZone  = document.getElementById('file-drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileList  = document.getElementById('file-list');
  let selectedFiles = [];

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    addFiles(Array.from(e.dataTransfer.files));
  });

  fileInput.addEventListener('change', () => {
    addFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  function addFiles(incoming) {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    const maxSize = 10 * 1024 * 1024;

    incoming.forEach(f => {
      if (!allowed.includes(f.type)) return showError(`${f.name}: unsupported type.`);
      if (f.size > maxSize)          return showError(`${f.name}: exceeds 10MB limit.`);
      if (selectedFiles.find(x => x.name === f.name)) return;
      selectedFiles.push(f);
    });

    renderFileList();
  }

  function renderFileList() {
    fileList.innerHTML = '';
    selectedFiles.forEach((f, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--slate-900);border:1px solid var(--glass-border);border-radius:var(--radius-sm)';
      row.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" style="color:var(--blue-400);flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span style="font-size:12px;color:var(--slate-300);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--slate-500)">${(f.size/1024).toFixed(0)} KB</span>
        <button type="button" data-idx="${i}" style="background:none;border:none;color:var(--slate-500);cursor:pointer;font-size:14px;padding:0;line-height:1" class="remove-file">✕</button>
      `;
      fileList.appendChild(row);
    });

    fileList.querySelectorAll('.remove-file').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFiles.splice(Number(btn.dataset.idx), 1);
        renderFileList();
      });
    });
  }

  /* ─── Form Submission ──────────────────────────────────────────────────── */

  document.getElementById('intake-form').addEventListener('submit', async e => {
    e.preventDefault();
    clearError();

    const patient = {
      name:               getVal('patient-name'),
      age:                getVal('patient-age'),
      sex:                getVal('patient-sex'),
      anaTiter:           getVal('ana-titer'),
      asmaTiter:          getVal('asma-titer'),
      antiLkm1:           getVal('anti-lkm1'),
      igg:                getVal('igg-level'),
      alt:                getVal('alt-level'),
      ast:                getVal('ast-level'),
      hbsag:              getVal('hbsag'),
      antiHcv:            getVal('anti-hcv'),
      dili:               getVal('dili'),
      interfaceHepatitis: getVal('interface-hepatitis'),
      rosette:            getVal('rosette'),
      histoNotes:         getVal('histo-notes'),
      clinicalNotes:      getVal('clinical-notes'),
    };

    if (!patient.name || !patient.age || !patient.sex) {
      return showError('Name, age, and sex are required.');
    }

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.innerHTML = '<span style="opacity:0.6">Processing…</span>';

    // Store file metadata (not binary — files are uploaded separately via FormData)
    const fileMeta = selectedFiles.map(f => ({ name: f.name, size: f.size, type: f.type }));

    const updated = Store.merge({ patient, uploadedFiles: fileMeta });
    await syncToServer(updated);

    // Upload actual files if any
    if (selectedFiles.length > 0) {
      const fd = new FormData();
      selectedFiles.forEach(f => fd.append('files', f));
      fd.append('sessionId', updated.sessionId);
      try {
        await fetch('/api/upload', { method: 'POST', body: fd });
      } catch {
        // Non-fatal: analysis can proceed without uploads
      }
    }

    window.location.href = '/analysis';
  });

  /* ─── Helpers ──────────────────────────────────────────────────────────── */

  function getVal(id) {
    return document.getElementById(id)?.value?.trim() ?? '';
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = val;
  }

  function showError(msg) {
    const el = document.getElementById('form-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  function clearError() {
    const el = document.getElementById('form-error');
    if (el) el.style.display = 'none';
  }
});