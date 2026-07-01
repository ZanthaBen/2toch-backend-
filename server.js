// ════════════════════════════════════════════════════════════
// 2TOCH — Backend API (deepfake audio + émotion visage)
// Attend uniquement vos clés API dans .env pour fonctionner.
// ════════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const fetch   = require('node-fetch');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.json());

// CORS minimal (à restreindre à votre domaine en prod)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const REALITY_DEFENDER_KEY = process.env.REALITY_DEFENDER_API_KEY;
const FACE_EMOTION_SERVICE_URL = process.env.FACE_EMOTION_SERVICE_URL || 'http://localhost:5001';

// ── Healthcheck ──
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── POST /api/ai/deepfake-check ────────────────────────────────
// Reçoit un fichier audio (multipart/form-data, champ "audio"),
// renvoie { isDeepfake, deepfakeScore, raw }.
app.post('/api/ai/deepfake-check', upload.single('audio'), async (req, res) => {
  if (!REALITY_DEFENDER_KEY) {
    return res.status(503).json({
      error: { code: 'MISSING_API_KEY', message: 'REALITY_DEFENDER_API_KEY absente du .env' }
    });
  }
  if (!req.file) {
    return res.status(400).json({ error: { code: 'NO_FILE', message: 'Champ "audio" manquant' } });
  }

  try {
    // 1) Upload du fichier à Reality Defender
    const uploadRes = await fetch('https://api.realitydefender.com/api/files', {
      method: 'POST',
      headers: { 'X-API-KEY': REALITY_DEFENDER_KEY },
      body: (() => {
        const form = new (require('form-data'))();
        form.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.wav' });
        return form;
      })()
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return res.status(uploadRes.status).json({
        error: { code: 'RD_UPLOAD_FAILED', message: errText }
      });
    }
    const uploadData = await uploadRes.json();
    const requestId = uploadData.request_id || uploadData.requestId;

    // 2) Poll du résultat (Reality Defender traite de manière asynchrone)
    let result = null;
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`https://api.realitydefender.com/api/results/${requestId}`, {
        headers: { 'X-API-KEY': REALITY_DEFENDER_KEY }
      });
      const data = await r.json();
      if (data.status && data.status !== 'PENDING' && data.status !== 'PROCESSING') {
        result = data;
        break;
      }
      await new Promise(r => setTimeout(r, 1500)); // attend 1.5s avant nouvelle tentative
    }

    if (!result) {
      return res.status(202).json({ status: 'PROCESSING', requestId, message: 'Résultat pas encore prêt, réessayer plus tard avec requestId' });
    }

    const score = result.score ?? result.probability ?? null;
    return res.json({
      isDeepfake: result.status === 'MANIPULATED' || result.status === 'FAKE',
      deepfakeScore: score,
      raw: result
    });

  } catch (err) {
    return res.status(500).json({ error: { code: 'RD_ERROR', message: err.message } });
  }
});

// ── POST /api/ai/face-emotion ──────────────────────────────────
// Proxy vers le micro-service Python DeepFace (voir face_emotion_service.py).
app.post('/api/ai/face-emotion', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: { code: 'NO_FILE', message: 'Champ "image" manquant' } });
  }
  try {
    const form = new (require('form-data'))();
    form.append('image', req.file.buffer, { filename: 'frame.jpg' });

    const r = await fetch(`${FACE_EMOTION_SERVICE_URL}/analyze`, { method: 'POST', body: form });
    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: { code: 'FACE_SERVICE_ERROR', message: errText } });
    }
    const data = await r.json();
    return res.json(data); // { dominant_emotion, scores: {...}, faceScore }
  } catch (err) {
    return res.status(502).json({
      error: { code: 'FACE_SERVICE_UNREACHABLE', message: 'Micro-service DeepFace injoignable. Lancez face_emotion_service.py.' }
    });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`[2TOCH backend] en écoute sur http://localhost:${PORT}`));
