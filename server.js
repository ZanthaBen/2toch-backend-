// ════════════════════════════════════════════════════════════
// 2TOCH — Backend (signalisation WebSocket + Push + AI APIs)
// ════════════════════════════════════════════════════════════
require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { WebSocketServer } = require('ws');
const webpush   = require('web-push');
const multer    = require('multer');
const fetch     = require('node-fetch');
const FormData  = require('form-data');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── VAPID (notifications Push) ──
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL   = process.env.VAPID_EMAIL || 'mailto:contact@2toch.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ── Registre en mémoire uid → { ws, pushSub } ──
const clients = new Map(); // uid → { ws, pushSub }

// ════════════════════════════════════════════════════════════
//  WEBSOCKET — signalisation temps réel
// ════════════════════════════════════════════════════════════
wss.on('connection', (ws) => {
  let uid = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'register':
        uid = msg.uid;
        const existing = clients.get(uid);
        clients.set(uid, { ws, pushSub: existing ? existing.pushSub : null });
        ws.send(JSON.stringify({ type: 'registered', uid }));
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      // Tous les autres messages sont relayés au destinataire
      case 'call-invite':
      case 'call-accept':
      case 'call-decline':
      case 'call-unavailable':
      case 'hangup':
      case 'hangup-request':
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const dest = clients.get(msg.to);
        if (dest && dest.ws && dest.ws.readyState === 1) {
          dest.ws.send(JSON.stringify({ ...msg, from: uid }));
        } else {
          // Destinataire hors-ligne
          if (msg.type === 'call-invite') {
            // Notification Push si subscription disponible
            _sendPushIfAvailable(msg.to, {
              title: '📞 Appel entrant 2TOCH',
              body: `${uid} vous appelle`,
              data: { type: 'call-invite', from: uid, isVideo: msg.isVideo, verdictMode: msg.verdictMode }
            });
            // Informer l'appelant que le destinataire est hors-ligne WebSocket
            ws.send(JSON.stringify({ type: 'call-unavailable', from: msg.to }));
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (uid) {
      const c = clients.get(uid);
      if (c) clients.set(uid, { ws: null, pushSub: c.pushSub });
    }
  });
});

async function _sendPushIfAvailable(uid, payload) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const c = clients.get(uid);
  if (!c || !c.pushSub) return;
  try {
    await webpush.sendNotification(c.pushSub, JSON.stringify(payload));
  } catch (e) {
    if (e.statusCode === 410) {
      // Subscription expirée : on la supprime
      clients.set(uid, { ws: c.ws, pushSub: null });
    }
  }
}

// ════════════════════════════════════════════════════════════
//  REST — Push subscription
// ════════════════════════════════════════════════════════════
app.post('/api/push/subscribe', (req, res) => {
  const { uid, subscription } = req.body;
  if (!uid || !subscription) return res.status(400).json({ error: 'uid et subscription requis' });
  const existing = clients.get(uid) || { ws: null, pushSub: null };
  clients.set(uid, { ...existing, pushSub: subscription });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  REST — Healthcheck
// ════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => res.json({ status: 'ok', clients: clients.size }));

// ════════════════════════════════════════════════════════════
//  REST — Deepfake audio (Reality Defender)
// ════════════════════════════════════════════════════════════
const REALITY_DEFENDER_KEY = process.env.REALITY_DEFENDER_API_KEY;

app.post('/api/ai/deepfake-check', upload.single('audio'), async (req, res) => {
  if (!REALITY_DEFENDER_KEY) return res.status(503).json({ error: { code: 'MISSING_API_KEY', message: 'REALITY_DEFENDER_API_KEY absente' } });
  if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'Champ "audio" manquant' } });
  try {
    const form = new FormData();
    form.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.wav' });
    const uploadRes = await fetch('https://api.realitydefender.com/api/files', {
      method: 'POST', headers: { 'X-API-KEY': REALITY_DEFENDER_KEY }, body: form
    });
    if (!uploadRes.ok) return res.status(uploadRes.status).json({ error: { code: 'RD_UPLOAD_FAILED', message: await uploadRes.text() } });
    const { request_id, requestId } = await uploadRes.json();
    const rid = request_id || requestId;
    let result = null;
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`https://api.realitydefender.com/api/results/${rid}`, { headers: { 'X-API-KEY': REALITY_DEFENDER_KEY } });
      const data = await r.json();
      if (data.status && data.status !== 'PENDING' && data.status !== 'PROCESSING') { result = data; break; }
      await new Promise(r => setTimeout(r, 1500));
    }
    if (!result) return res.status(202).json({ status: 'PROCESSING', requestId: rid });
    const score = result.score ?? result.probability ?? null;
    return res.json({ isDeepfake: result.status === 'MANIPULATED' || result.status === 'FAKE', deepfakeScore: score, raw: result });
  } catch (err) {
    return res.status(500).json({ error: { code: 'RD_ERROR', message: err.message } });
  }
});

// ════════════════════════════════════════════════════════════
//  REST — Émotion visage (DeepFace)
// ════════════════════════════════════════════════════════════
const FACE_EMOTION_SERVICE_URL = process.env.FACE_EMOTION_SERVICE_URL || 'http://localhost:5001';

app.post('/api/ai/face-emotion', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'Champ "image" manquant' } });
  try {
    const form = new FormData();
    form.append('image', req.file.buffer, { filename: 'frame.jpg' });
    const r = await fetch(`${FACE_EMOTION_SERVICE_URL}/analyze`, { method: 'POST', body: form });
    if (!r.ok) return res.status(r.status).json({ error: { code: 'FACE_SERVICE_ERROR', message: await r.text() } });
    return res.json(await r.json());
  } catch (err) {
    return res.status(502).json({ error: { code: 'FACE_SERVICE_UNREACHABLE', message: 'Micro-service DeepFace injoignable.' } });
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`[2TOCH backend] http://localhost:${PORT}`));
