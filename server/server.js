import express from 'express';
import session from 'express-session';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import dotenv from 'dotenv';
import crypto from 'crypto';
import createMemoryStore from 'memorystore';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { calculateIAIHG } from './scoring.js';
import { buildDiagnosticPrompt } from './diagnosticPrompt.js';
import { buildInfoPrompt, infoFallback } from './infoPrompt.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'client');
const UPLOADS_DIR = join(ROOT, 'uploads');
const REPORTS_DIR = join(ROOT, 'reports');

[UPLOADS_DIR, REPORTS_DIR].forEach(dir => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

// gemini api setup
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported type'));
    }
  },
});

const app = express();
const PORT = process.env.PORT || 3000;

// prod ready memory store so devi in mumbai doesnt drop sessions during load balancing across pune and gondiya
const MemoryStore = createMemoryStore(session);

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'https://your-production-domain.com' : 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

app.set('trust proxy', 1);

// session
app.use(session({
  store: new MemoryStore({ checkPeriod: 86400000 }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 2,
  },
}));

app.use((req, res, next) => {
  if (!req.session.clinicalData) {
    req.session.clinicalData = { patient: {}, symptoms: [], uploadedFiles: [], diagnosticResults: null, createdAt: new Date().toISOString() };
  }
  next();
});

// static
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, path) => {
    if (path.match(/\.(css|js|html)$/)) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

app.get('/', (req, res) => res.sendFile(join(PUBLIC_DIR, 'home.html')));
app.get('/intake', (req, res) => res.sendFile(join(PUBLIC_DIR, 'intake.html')));
app.get('/analysis', (req, res) => res.sendFile(join(PUBLIC_DIR, 'analysis.html')));
app.get('/report', (req, res) => res.sendFile(join(PUBLIC_DIR, 'report.html')));

app.get('/api/session', (req, res) => res.json({ clinicalData: req.session.clinicalData }));

app.post('/api/session', (req, res) => {
  const { patient, diagnosticResults, iaihgScore } = req.body;
  const currentData = req.session.clinicalData || {};
  const updatedData = { ...currentData, updatedAt: new Date().toISOString() };

  // basic xss stripping
  const sanitize = (str) => String(str || '').replace(/[<>]/g, '');

  if (patient && typeof patient === 'object' && !Array.isArray(patient)) {
    updatedData.patient = updatedData.patient || {};
    ['name', 'age', 'sex', 'anaTiter', 'asmaTiter', 'antiLkm1', 'igg', 'alt', 'ast', 'hbsag', 'antiHcv', 'dili', 'interfaceHepatitis', 'rosette', 'histoNotes', 'clinicalNotes', 'ama', 'alp', 'alcohol', 'alcoholIntake', 'otherAutoimmune', 'plasmaCells', 'biliaryChanges', 'atypicalHistology'].forEach(k => {
      if (patient[k] != null) updatedData.patient[k] = sanitize(patient[k]).trim();
    });
  }

  if (diagnosticResults && typeof diagnosticResults === 'object') {
    updatedData.diagnosticResults = {
      iaihgScore: Number(diagnosticResults.iaihgScore) || null,
      classification: sanitize(diagnosticResults.classification),
      confidence: Number(diagnosticResults.confidence) || null,
      treatmentIndication: sanitize(diagnosticResults.treatmentIndication),
      narrative: sanitize(diagnosticResults.narrative),
      recommendations: Array.isArray(diagnosticResults.recommendations) ? diagnosticResults.recommendations.map(sanitize) : [],
      scoreBreakdown: Array.isArray(diagnosticResults.scoreBreakdown) ? diagnosticResults.scoreBreakdown.map(i => ({ criterion: sanitize(i.criterion), points: Number(i.points) || 0 })) : []
    };
  }

  if (iaihgScore != null) updatedData.iaihgScore = Number(iaihgScore);

  req.session.clinicalData = updatedData;
  res.json({ ok: true, clinicalData: req.session.clinicalData });
});

app.delete('/api/session', (req, res) => {
  req.session.clinicalData = { patient: {}, symptoms: [], uploadedFiles: [], diagnosticResults: null, createdAt: new Date().toISOString() };
  res.json({ ok: true });
});

app.post('/api/upload', upload.array('files', 10), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files received' });
  const meta = req.files.map(f => ({ originalName: f.originalname, storedName: f.filename, size: f.size, mimetype: f.mimetype, path: f.path }));
  req.session.clinicalData.uploadedFiles = [...(req.session.clinicalData.uploadedFiles || []), ...meta];
  res.json({ ok: true, files: meta });
});

app.post('/api/analyse', async (req, res) => {
  const { patient, sessionId } = req.body;
  if (!patient || !patient.name) return res.status(400).json({ error: 'Patient required' });

  let enrichedPatient = { ...patient };
  const uploads = req.session.clinicalData?.uploadedFiles || [];
  const geminiPayloadParts = [];

  if (uploads.length > 0) {
    try {

      const pdfTexts = [];
      for (const file of uploads) {
        if (!existsSync(file.path)) continue;
        if (file.mimetype === 'application/pdf') {
          const buffer = await readFile(file.path);
          const parsed = await pdfParse(buffer);
          pdfTexts.push(parsed.text.slice(0, 2000));
        } else if (file.mimetype.startsWith('image/')) {
          // for simplicity, buffering to ram kiya hai. I should use genai file api for large files to prevent v8 heap crashing
          const base64Data = (await readFile(file.path)).toString('base64');
          geminiPayloadParts.push({ inlineData: { data: base64Data, mimeType: file.mimetype } });
        }
      }
      if (pdfTexts.length) enrichedPatient.clinicalNotes = (enrichedPatient.clinicalNotes || '') + '\n\n--- PDFs ---\n' + pdfTexts.join('\n\n');
    } catch (err) {
      console.warn('File err:', err.message);
    }
  }

  const scoringResult = calculateIAIHG(enrichedPatient);
  geminiPayloadParts.unshift({ text: buildDiagnosticPrompt(enrichedPatient, scoringResult) });

  try {
    // strict schema logic prevents json parsing failure
    const response = await genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: geminiPayloadParts,
      config: {
        systemInstruction: "You are an AIH diagnostic engine...",
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            iaihgScore: { type: "INTEGER" },
            classification: { type: "STRING" },
            confidence: { type: "INTEGER" },
            treatmentIndication: { type: "STRING" },
            scoreBreakdown: { type: "ARRAY", items: { type: "OBJECT", properties: { criterion: { type: "STRING" }, points: { type: "INTEGER" } } } },
            narrative: { type: "STRING" },
            recommendations: { type: "ARRAY", items: { type: "STRING" } }
          },
          required: ["iaihgScore", "classification", "confidence", "treatmentIndication", "scoreBreakdown", "narrative", "recommendations"]
        }
      }
    });

    const llmResult = JSON.parse(response.candidates[0].content.parts[0].text);
    const result = {
      ...llmResult,
      iaihgScore: scoringResult.score,
      classification: scoringResult.classification,
      scoreBreakdown: scoringResult.breakdown
    };

    req.session.clinicalData.diagnosticResults = result;
    req.session.clinicalData.iaihgScore = result.iaihgScore;
    res.json(result);

  } catch (err) {
    console.error('API err:', err);
    res.status(502).json({ error: err.message || 'Gemini call failed' });
  }
});

app.post('/api/info', async (req, res) => {
  const { message, history } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

const { system, turns } = buildInfoPrompt(message, history || [], req.session.clinicalData);
  const promptContents = [{ text: system }, ...(turns || []).map(t => ({ text: typeof t === 'string' ? t : JSON.stringify(t) }))];

  try {
    // corrected instantiation
    const response = await genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: promptContents,
      config: {
        systemInstruction: "You are an AIH diagnostic engine...",
        responseMimeType: "application/json",
        responseSchema: {
           type: "OBJECT",
           properties: {
             iaihgScore: { type: "INTEGER" },
             classification: { type: "STRING" },
             confidence: { type: "INTEGER" },
             treatmentIndication: { type: "STRING" },
             scoreBreakdown: { type: "ARRAY", items: { type: "OBJECT", properties: { criterion: { type: "STRING" }, points: { type: "INTEGER" } } } },
             narrative: { type: "STRING" },
             recommendations: { type: "ARRAY", items: { type: "STRING" } }
           },
           required: ["iaihgScore", "classification", "confidence", "treatmentIndication", "scoreBreakdown", "narrative", "recommendations"]
        }
      }
    });
    
    res.json({ reply: response.candidates[0].content.parts[0].text });
  } catch (err) {
    console.error('Info err:', err);
    res.status(502).json({ error: err.message || 'Assistant down' });
  }
});

app.post('/api/report/pdf', async (req, res) => {
  const data = req.session?.clinicalData;
  const { generatedAt, sessionId } = req.body; 

  if (!data || !data.patient || !data.diagnosticResults) {
    return res.status(400).json({ error: 'No validated session data' });
  }

  const { patient, diagnosticResults: r } = data;
  const safeName = (patient.name || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const filename = `LuminaDx_AIH_${safeName}_${Date.now()}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  doc.pipe(res);

  const W = doc.page.width - 100;
  const TEXT_MAIN = '#0f172a', TEXT_MUTED = '#64748b', BORDER = '#e2e8f0', BLUE = '#2563eb', GREEN = '#059669', AMBER = '#d97706', RED = '#dc2626';

  const classColor = (c = '') => c.toLowerCase().includes('definite') ? GREEN : c.toLowerCase().includes('probable') ? AMBER : TEXT_MUTED;

  doc.fontSize(22).font('Helvetica-Bold').fillColor(BLUE).text('LuminaDx AIH', 50, 50);
  doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_MUTED).text('AUTOIMMUNE HEPATITIS REPORT', 50, 76, { characterSpacing: 1 });

  // extract variables directly from req.body mapping instead of raw scoping
  doc.fontSize(9).font('Helvetica').fillColor(TEXT_MUTED)
     .text(`Date: ${new Date(generatedAt || Date.now()).toLocaleString('en-GB')}`, 0, 54, { align: 'right', width: doc.page.width - 50 })
     .text(`SID: ${(sessionId || req.sessionID || '').slice(0, 8).toUpperCase()}`, 0, 68, { align: 'right', width: doc.page.width - 50 });

  doc.moveTo(50, 95).lineTo(50 + W, 95).lineWidth(1).stroke(BORDER);
  doc.y = 110;

  const bannerColor = classColor(r.classification);
  doc.rect(50, doc.y, W, 40).fill(bannerColor + '15');
  doc.fontSize(14).font('Helvetica-Bold').fillColor(bannerColor).text((r.classification || 'UNCLASSIFIED').toUpperCase(), 60, doc.y + 12);
  doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_MAIN).text(`IAIHG Score: ${r.iaihgScore ?? '—'}`, 0, doc.y - 14, { align: 'right', width: doc.page.width - 60 });
  doc.fontSize(9).font('Helvetica').fillColor(TEXT_MUTED).text(`Confidence: ${r.confidence ?? '—'}%`, 0, doc.y, { align: 'right', width: doc.page.width - 60 });
  doc.y += 30;

  const section = (title) => {
    doc.moveDown(1.5);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_MAIN).text(title.toUpperCase(), 50, doc.y, { characterSpacing: 0.5 });
    doc.moveTo(50, doc.y + 4).lineTo(50 + W, doc.y + 4).lineWidth(0.5).stroke(BORDER);
    doc.moveDown(1);
  };

  section('Patient Information');
  doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_MUTED).text('Name:', 50, doc.y, { continued: true }).font('Helvetica').fillColor(TEXT_MAIN).text(`  ${patient.name || '—'}`);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fillColor(TEXT_MUTED).text('Age:', 50, doc.y, { continued: true }).font('Helvetica').fillColor(TEXT_MAIN).text(`  ${patient.age ? `${patient.age} yrs` : '—'}`, { continued: true }).font('Helvetica-Bold').fillColor(TEXT_MUTED).text('    Sex: ', { continued: true }).font('Helvetica').fillColor(TEXT_MAIN).text(`${patient.sex || '—'}`);

  section('Serological Markers');
  let startY = doc.y;
  const drawCell = (label, value, xOffset, yOffset) => {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_MUTED).text(label, 50 + xOffset, startY + yOffset);
    doc.fontSize(10).font('Helvetica').fillColor(TEXT_MAIN).text(value || '—', 50 + xOffset, startY + yOffset + 14);
  };

  drawCell('ANA Titer', patient.anaTiter, 0, 0); drawCell('ASMA Titer', patient.asmaTiter, 120, 0); drawCell('Anti-LKM1', patient.antiLkm1, 240, 0); drawCell('IgG (g/L)', patient.igg, 360, 0);
  drawCell('ALT (U/L)', patient.alt, 0, 40); drawCell('AST (U/L)', patient.ast, 120, 40); drawCell('HBsAg', patient.hbsag, 240, 40); drawCell('Anti-HCV', patient.antiHcv, 360, 40);
  doc.y = startY + 80;

  section('IAIHG Score Breakdown');
  if (Array.isArray(r.scoreBreakdown)) {
    r.scoreBreakdown.forEach(item => {
      const pts = item.points >= 0 ? `+${item.points}` : `${item.points}`;
      const color = item.points > 0 ? BLUE : (item.points < 0 ? RED : TEXT_MUTED);
      doc.fontSize(10).font('Helvetica').fillColor(TEXT_MAIN).text(item.criterion, 50, doc.y, { width: W - 50 });
      doc.font('Helvetica-Bold').fillColor(color).text(pts, 0, doc.y - doc.currentLineHeight(), { align: 'right', width: doc.page.width - 50 });
      doc.moveDown(0.3); doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).lineWidth(0.5).stroke('#f8fafc'); doc.moveDown(0.3);
    });
  }

  section('AI Clinical Narrative');
  doc.fontSize(10).font('Helvetica').fillColor(TEXT_MAIN).text(r.narrative || '—', 50, doc.y, { width: W, lineGap: 4, align: 'justify' });

  section('Clinical Recommendations');
  if (Array.isArray(r.recommendations)) {
    r.recommendations.forEach((rec, i) => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(BLUE).text(`${i + 1}. `, 50, doc.y, { continued: true }).font('Helvetica').fillColor(TEXT_MAIN).text(rec, { width: W - 15, lineGap: 3, align: 'justify' });
      doc.moveDown(0.5);
    });
  }

  const pageHeight = doc.page.height;
  doc.rect(50, pageHeight - 90, W, 40).fill('#fffbeb');
  doc.moveTo(50, pageHeight - 90).lineTo(50, pageHeight - 50).lineWidth(3).stroke(AMBER);
  doc.fontSize(8).font('Helvetica-Bold').fillColor(AMBER).text('CLINICAL DECISION SUPPORT ONLY', 60, pageHeight - 82);
  doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED).text('Generated by AI. Does not constitute a definitive medical diagnosis. Do not replace physician judgment.', 60, pageHeight - 70, { width: W - 20 });

  doc.end();
});

app.use((req, res) => res.status(404).sendFile(join(PUBLIC_DIR, 'home.html')));

app.use((err, req, res, next) => {
  console.error('[LuminaDx Error]', err.stack);
  res.status(err instanceof multer.MulterError ? 400 : 500).json({ error: err.message || 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`LuminaDx running on port ${PORT}`);
});