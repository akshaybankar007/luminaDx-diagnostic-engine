// server/server.js
import express          from 'express';
import session          from 'express-session';
import cors             from 'cors';
import rateLimit        from 'express-rate-limit';
import multer           from 'multer';
import PDFDocument      from 'pdfkit';
import { GoogleGenAI }  from '@google/genai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { readFile }     from 'fs/promises';
import dotenv           from 'dotenv';
import { calculateIAIHG } from './scoring.js';
import { buildDiagnosticPrompt } from './diagnosticPrompt.js';
import { buildInfoPrompt, infoFallback } from './infoPrompt.js';

dotenv.config();

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = dirname(__filename);
const ROOT        = join(__dirname, '..');
const PUBLIC_DIR  = join(ROOT, 'client');
const UPLOADS_DIR = join(ROOT, 'uploads');
const REPORTS_DIR = join(ROOT, 'reports');

// Ensure required directories exist
[UPLOADS_DIR, REPORTS_DIR].forEach(dir => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

// ─── Gemini Client ────────────────────────────────────────────────────────────

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ─── Multer ───────────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const ts   = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${ts}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// ─── App ──────────────────────────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
}));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'medigen-dev-secret-change-in-prod',
  resave:            false,
  saveUninitialized: true,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   1000 * 60 * 60 * 2,
  },
}));

// Initialise server-side clinicalData mirror on every request
app.use((req, _res, next) => {
  if (!req.session.clinicalData) {
    req.session.clinicalData = {
      patient:          {},
      symptoms:         [],
      uploadedFiles:    [],
      diagnosticResults: null,
      createdAt:        new Date().toISOString(),
    };
  }
  next();
});

// ─── Static ───────────────────────────────────────────────────────────────────

app.use(express.static(PUBLIC_DIR));

// ─── Page Routes ──────────────────────────────────────────────────────────────

app.get('/',         (_req, res) => res.sendFile(join(PUBLIC_DIR, 'home.html')));
app.get('/intake',   (_req, res) => res.sendFile(join(PUBLIC_DIR, 'intake.html')));
app.get('/analysis', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'analysis.html')));
app.get('/report',   (_req, res) => res.sendFile(join(PUBLIC_DIR, 'report.html')));

// ─── Session API ──────────────────────────────────────────────────────────────

app.get('/api/session', (req, res) => {
  res.json({ clinicalData: req.session.clinicalData });
});

app.post('/api/session', (req, res) => {
  req.session.clinicalData = {
    ...req.session.clinicalData,
    ...req.body,
    updatedAt: new Date().toISOString(),
  };
  res.json({ ok: true, clinicalData: req.session.clinicalData });
});

app.delete('/api/session', (req, res) => {
  req.session.clinicalData = {
    patient:           {},
    symptoms:          [],
    uploadedFiles:     [],
    diagnosticResults: null,
    createdAt:         new Date().toISOString(),
  };
  res.json({ ok: true });
});

// ─── Upload API ───────────────────────────────────────────────────────────────

app.post('/api/upload', upload.array('files', 10), (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ error: 'No files received.' });
  }

  const meta = req.files.map(f => ({
    originalName: f.originalname,
    storedName:   f.filename,
    size:         f.size,
    mimetype:     f.mimetype,
    path:         f.path,
  }));

  // Mirror into server session
  req.session.clinicalData.uploadedFiles = [
    ...(req.session.clinicalData.uploadedFiles || []),
    ...meta,
  ];

  res.json({ ok: true, files: meta });
});

// ─── Analyse API ──────────────────────────────────────────────────────────────

app.post('/api/analyse', async (req, res) => {
  const { patient, sessionId } = req.body;

  if (!patient || !patient.name) {
    return res.status(400).json({ error: 'Patient data is required.' });
  }

  // Optionally enrich with parsed text from uploaded PDFs
  let enrichedPatient = { ...patient };
  const uploads = req.session.clinicalData?.uploadedFiles || [];

  if (uploads.length > 0) {
    try {
      const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
      const pdfTexts = [];

      for (const file of uploads) {
        if (file.mimetype === 'application/pdf' && existsSync(file.path)) {
          const buffer = await readFile(file.path);
          const parsed = await pdfParse(buffer);
          pdfTexts.push(parsed.text.slice(0, 2000)); // cap per file
        }
      }

      if (pdfTexts.length > 0) {
        enrichedPatient.clinicalNotes =
          (enrichedPatient.clinicalNotes || '') +
          '\n\n--- Extracted from uploaded documents ---\n' +
          pdfTexts.join('\n\n');
      }
    } catch (parseErr) {
      // Non-fatal: proceed without PDF enrichment
      console.warn('[Analyse] PDF parse failed:', parseErr.message);
    }
  }

  const scoringResult = calculateIAIHG(enrichedPatient);
  const prompt = buildDiagnosticPrompt(enrichedPatient, scoringResult);

  try {
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: prompt, // your existing prompt variable
  config: {
    systemInstruction: "Your existing system instruction string here",
    temperature: 0.2, 
  }
});

    const raw  = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      console.error('[Analyse] JSON parse failed. Raw LuminaDx output:', raw);
      return res.status(502).json({
        error: 'LuminaDx returned malformed JSON. Check diagnosticPrompt.',
      });
    }

    // Validate required keys
    const required = ['iaihgScore', 'classification', 'confidence', 'treatmentIndication', 'scoreBreakdown', 'narrative', 'recommendations'];
    const missing  = required.filter(k => !(k in result));
    if (missing.length > 0) {
      return res.status(502).json({
        error: `LuminaDx response missing fields: ${missing.join(', ')}`,
      });
    }

    // Mirror into server session
    req.session.clinicalData.diagnosticResults = result;
    req.session.clinicalData.iaihgScore        = result.iaihgScore;

    res.json(result);

  } catch (err) {
    console.error('[Analyse] LuminaDx API error:', err);
    res.status(502).json({ error: err.message || 'Gemini API call failed.' });
  }
});

// ─── Info / Chat API ──────────────────────────────────────────────────────────

app.post('/api/info', async (req, res) => {
  const { message, history } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const { system, turns } = buildInfoPrompt(message, history || []);

  try {
// Replace the diagnostic generateContent call with this:
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: prompt, 
  config: {
    systemInstruction: "You are an AIH diagnostic engine...", 
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: {
        iaihgScore: { type: "INTEGER", description: "Total IAIHG score" },
        classification: { type: "STRING", description: "e.g., Definite AIH, Probable AIH" },
        confidence: { type: "INTEGER", description: "Confidence percentage (0-100)" },
        treatmentIndication: { type: "STRING" },
        scoreBreakdown: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              criterion: { type: "STRING" },
              points: { type: "INTEGER" }
            },
            required: ["criterion", "points"]
          }
        },
        narrative: { type: "STRING", description: "Clinical narrative summary" },
        recommendations: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "List of advisory recommendations"
        }
      },
      required: [
        "iaihgScore", 
        "classification", 
        "confidence", 
        "treatmentIndication", 
        "scoreBreakdown", 
        "narrative", 
        "recommendations"
      ]
    }
  }
});
    const reply = response.candidates?.[0]?.content?.parts?.[0]?.text
      || infoFallback();

    res.json({ reply });

  } catch (err) {
    console.error('[Info] LuminaDx API error:', err);
    res.status(502).json({ error: err.message || 'Assistant unavailable.' });
  }
});

// ─── PDF Report API ───────────────────────────────────────────────────────────

app.post('/api/report/pdf', async (req, res) => {
  const { patient, diagnosticResults: r, sessionId, generatedAt } = req.body;

  if (!patient || !r) {
    return res.status(400).json({ error: 'Patient and diagnostic results are required.' });
  }

  const filename = `LuminaDx_AIH_${patient.name?.replace(/\s+/g, '_') || 'Report'}_${Date.now()}.pdf`;

  res.setHeader('Content-Type',        'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({
    size:    'A4',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
  });

  doc.pipe(res);

  const W = doc.page.width - 100;

  // Print-safe clinical palette
  const TEXT_MAIN  = '#0f172a';
  const TEXT_MUTED = '#64748b';
  const BORDER     = '#e2e8f0';
  const BLUE       = '#2563eb';
  const GREEN      = '#059669';
  const AMBER      = '#d97706';
  const RED        = '#dc2626';

  const classColor = (c = '') =>
    c.toLowerCase().includes('definite') ? GREEN :
    c.toLowerCase().includes('probable') ? AMBER : TEXT_MUTED;

  // ── Header ──
  doc.fontSize(22).font('Helvetica-Bold').fillColor(BLUE).text('LuminaDx AIH', 50, 50);
  doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_MUTED)
     .text('AUTOIMMUNE HEPATITIS DIAGNOSTIC REPORT', 50, 76, { characterSpacing: 1 });

  doc.fontSize(9).font('Helvetica').fillColor(TEXT_MUTED)
     .text(`Date: ${new Date(generatedAt || Date.now()).toLocaleString('en-GB')}`, 0, 54, { align: 'right', width: doc.page.width - 50 })
     .text(`SID: ${(sessionId || '').slice(0, 8).toUpperCase()}`, 0, 68, { align: 'right', width: doc.page.width - 50 });

  doc.moveTo(50, 95).lineTo(50 + W, 95).lineWidth(1).stroke(BORDER);
  doc.y = 110;

  // ── Classification Banner ──
  const bannerColor = classColor(r.classification);
  doc.rect(50, doc.y, W, 40).fill(bannerColor + '15'); // 15 is hex opacity (approx 8%)
  doc.fontSize(14).font('Helvetica-Bold').fillColor(bannerColor)
     .text((r.classification || 'UNCLASSIFIED').toUpperCase(), 60, doc.y + 12);
  doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_MAIN)
     .text(`IAIHG Score: ${r.iaihgScore ?? '—'}`, 0, doc.y - 14, { align: 'right', width: doc.page.width - 60 });
  doc.fontSize(9).font('Helvetica').fillColor(TEXT_MUTED)
     .text(`Confidence: ${r.confidence ?? '—'}%`, 0, doc.y, { align: 'right', width: doc.page.width - 60 });
  doc.y += 30;

  // ── Section Helper ──
  const section = (title) => {
    doc.moveDown(1.5);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_MAIN)
       .text(title.toUpperCase(), 50, doc.y, { characterSpacing: 0.5 });
    doc.moveTo(50, doc.y + 4).lineTo(50 + W, doc.y + 4).lineWidth(0.5).stroke(BORDER);
    doc.moveDown(1);
  };

  // ── Patient Info ──
  section('Patient Information');
  doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_MUTED).text('Name:', 50, doc.y, { continued: true })
     .font('Helvetica').fillColor(TEXT_MAIN).text(`  ${patient.name || '—'}`);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fillColor(TEXT_MUTED).text('Age:', 50, doc.y, { continued: true })
     .font('Helvetica').fillColor(TEXT_MAIN).text(`  ${patient.age ? `${patient.age} yrs` : '—'}`, { continued: true })
     .font('Helvetica-Bold').fillColor(TEXT_MUTED).text('    Sex: ', { continued: true })
     .font('Helvetica').fillColor(TEXT_MAIN).text(`${patient.sex || '—'}`);

  // ── Serology Grid ──
  section('Serological Markers');
  let startY = doc.y;
  const drawCell = (label, value, xOffset, yOffset) => {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_MUTED).text(label, 50 + xOffset, startY + yOffset);
    doc.fontSize(10).font('Helvetica').fillColor(TEXT_MAIN).text(value || '—', 50 + xOffset, startY + yOffset + 14);
  };

  drawCell('ANA Titer', patient.anaTiter, 0, 0);
  drawCell('ASMA Titer', patient.asmaTiter, 120, 0);
  drawCell('Anti-LKM1', patient.antiLkm1, 240, 0);
  drawCell('IgG (g/L)', patient.igg, 360, 0);

  drawCell('ALT (U/L)', patient.alt, 0, 40);
  drawCell('AST (U/L)', patient.ast, 120, 40);
  drawCell('HBsAg', patient.hbsag, 240, 40);
  drawCell('Anti-HCV', patient.antiHcv, 360, 40);
  doc.y = startY + 80;

  // ── Score Breakdown ──
  section('IAIHG Score Breakdown');
  if (Array.isArray(r.scoreBreakdown)) {
    r.scoreBreakdown.forEach(item => {
      const pts = item.points >= 0 ? `+${item.points}` : `${item.points}`;
      const color = item.points > 0 ? BLUE : (item.points < 0 ? RED : TEXT_MUTED);

      doc.fontSize(10).font('Helvetica').fillColor(TEXT_MAIN)
         .text(item.criterion, 50, doc.y, { width: W - 50 });
      doc.font('Helvetica-Bold').fillColor(color)
         .text(pts, 0, doc.y - doc.currentLineHeight(), { align: 'right', width: doc.page.width - 50 });
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).lineWidth(0.5).stroke('#f8fafc');
      doc.moveDown(0.3);
    });
  }

  // ── Narrative & Recommendations ──
  section('AI Clinical Narrative');
  doc.fontSize(10).font('Helvetica').fillColor(TEXT_MAIN)
     .text(r.narrative || '—', 50, doc.y, { width: W, lineGap: 4, align: 'justify' });

  section('Clinical Recommendations');
  if (Array.isArray(r.recommendations)) {
    r.recommendations.forEach((rec, i) => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(BLUE).text(`${i + 1}. `, 50, doc.y, { continued: true })
         .font('Helvetica').fillColor(TEXT_MAIN).text(rec, { width: W - 15, lineGap: 3, align: 'justify' });
      doc.moveDown(0.5);
    });
  }

  // ── Footer ──
  const pageHeight = doc.page.height;
  doc.rect(50, pageHeight - 90, W, 40).fill('#fffbeb');
  doc.moveTo(50, pageHeight - 90).lineTo(50, pageHeight - 50).lineWidth(3).stroke(AMBER);
  doc.fontSize(8).font('Helvetica-Bold').fillColor(AMBER)
     .text('CLINICAL DECISION SUPPORT ONLY', 60, pageHeight - 82);
  doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED)
     .text('Generated by AI. Does not constitute a definitive medical diagnosis. Do not replace physician judgment.', 60, pageHeight - 70, { width: W - 20 });

  doc.end();
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).sendFile(join(PUBLIC_DIR, 'home.html'));
});

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[LuminaDx Error]', err.stack);
  const status = err instanceof multer.MulterError ? 400 : 500;
  res.status(status).json({ error: err.message || 'Internal server error.' });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`LuminaDx is running → http://localhost:${PORT}`);
  console.log(`LuminaDx key loaded:    ${process.env.GEMINI_API_KEY ? 'YES' : 'MISSING ⚠'}`);
});