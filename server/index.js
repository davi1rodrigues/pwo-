import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const required = ['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','APP_JWT_SECRET','DIRECTOR_CODE','INTERVIEWER1_CODE','INTERVIEWER2_CODE','PRODUCER_CODE'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) { console.error(`Configure as variáveis ausentes: ${missing.join(', ')}`); process.exit(1); }
if (process.env.APP_JWT_SECRET.length < 32) { console.error('APP_JWT_SECRET precisa ter pelo menos 32 caracteres.'); process.exit(1); }

const app = express();
const port = Number(process.env.PORT || 3000);
const roomName = process.env.ROOM_NAME || 'pwo-formula-truck-2026';
const livekitHost = process.env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
const roomService = new RoomServiceClient(livekitHost, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const members = {
  director: { name: 'Diretor', code: process.env.DIRECTOR_CODE },
  interviewer1: { name: 'Entrevistador 1', code: process.env.INTERVIEWER1_CODE },
  interviewer2: { name: 'Entrevistador 2', code: process.env.INTERVIEWER2_CODE },
  producer: { name: 'Produção', code: process.env.PRODUCER_CODE },
};
const audience = ['interviewer1','interviewer2','producer'];
const interviewers = ['interviewer1','interviewer2'];
let routing = audience;
let videoRouting = audience;
let audioReturnRouting = audience;
let requests = [];
const appliedSubscriptions = new Map();
const appDir = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || '0.0.0.0';

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '16kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use('/api/session', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'PWO Intercom', production: process.env.NODE_ENV === 'production' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && (allowed.includes(origin) || (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    req.user = jwt.verify(token, process.env.APP_JWT_SECRET, { issuer: 'pwo-intercom' });
    if (req.user.room !== roomName || !members[req.user.role]) throw new Error('invalid session');
    next();
  } catch { res.status(401).json({ error: 'Sessão inválida. Entre novamente.' }); }
};
const directorOnly = (req, res, next) => req.user?.role === 'director' ? next() : res.status(403).json({ error: 'Apenas a direção pode alterar esta autorização.' });

// Disable client auto-subscription and explicitly route the director's audio only to selected crew devices.
async function reconcileSubscriptions(participants) {
  const active = new Set(participants.map((p) => p.identity));
  for (const identity of appliedSubscriptions.keys()) if (!active.has(identity)) appliedSubscriptions.delete(identity);
  const tracks = participants.flatMap((p) => (p.tracks || []).filter((t) => {
    const kind = String(t.type).toLowerCase();
    return t.sid && (t.type === 0 || kind === 'audio' || t.type === 1 || kind === 'video');
  }).map((t) => ({ sid: t.sid, owner: p.identity, name: t.name || '', kind: (t.type === 0 || String(t.type).toLowerCase() === 'audio') ? 'audio' : 'video' })));
  for (const recipient of participants) {
    const desired = tracks.filter((t) => {
      if (t.owner === recipient.identity) return false;
      if (t.owner === 'director' && t.name === 'pwo-program-audio') return audioReturnRouting.includes(recipient.identity);
      if (t.owner === 'director') return t.kind === 'audio' ? routing.includes(recipient.identity) : videoRouting.includes(recipient.identity);
      if (t.kind !== 'audio') return false;
      return recipient.identity === 'director' || (recipient.identity !== 'producer' && t.owner !== 'producer');
    }).map((t) => t.sid);
    const previous = appliedSubscriptions.get(recipient.identity) || new Set();
    const next = new Set(desired);
    const remove = [...previous].filter((sid) => !next.has(sid));
    const add = [...next].filter((sid) => !previous.has(sid));
    if (remove.length) await roomService.updateSubscriptions(roomName, recipient.identity, remove, false);
    if (add.length) await roomService.updateSubscriptions(roomName, recipient.identity, add, true);
    appliedSubscriptions.set(recipient.identity, next);
  }
}

app.post('/api/session', async (req, res) => {
  const { role, code } = req.body || {};
  if (!members[role] || typeof code !== 'string' || code.length > 200 || code !== members[role].code) return res.status(401).json({ error: 'Perfil ou código incorreto.' });
  const identity = role;
  const canSpeakInitially = role === 'director' || role === 'producer';
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity, name: members[role].name, ttl: '10m',
    metadata: JSON.stringify({ role }),
  });
  token.addGrant({ roomJoin: true, room: roomName, canSubscribe: true, canPublish: canSpeakInitially, canPublishData: true });
  const livekitToken = await token.toJwt();
  const appToken = jwt.sign({ role, room: roomName }, process.env.APP_JWT_SECRET, { expiresIn: '12h', issuer: 'pwo-intercom' });
  res.json({ livekitUrl: process.env.LIVEKIT_URL, livekitToken, appToken, role, name: members[role].name });
});

app.get('/api/state', auth, async (req, res) => {
  let participants = [];
  try {
    const live = await roomService.listParticipants(roomName);
    await reconcileSubscriptions(live);
    participants = live.map((p) => ({ identity: p.identity, name: p.name, connected: true, canPublish: p.permission?.canPublish ?? false }));
  } catch (e) { if (!String(e?.message).toLowerCase().includes('not found')) console.warn('Roster indisponível:', e.message); }
  res.json({ routing, videoRouting, audioReturnRouting, requests, participants, role: req.user.role });
});

app.post('/api/requests', auth, (req, res) => {
  if (!interviewers.includes(req.user.role)) return res.status(403).json({ error: 'Somente entrevistadores podem solicitar a fala.' });
  const existing = requests.find((r) => r.identity === req.user.role && r.status === 'pending');
  if (existing) return res.json(existing);
  const request = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, identity: req.user.role, name: members[req.user.role].name, status: 'pending', createdAt: Date.now() };
  requests = [...requests, request].slice(-30);
  res.status(201).json(request);
});

app.post('/api/routing', auth, directorOnly, async (req, res) => {
  const recipients = req.body?.recipients;
  if (!Array.isArray(recipients) || recipients.some((r) => !audience.includes(r))) return res.status(400).json({ error: 'Destinatários inválidos.' });
  routing = [...new Set(recipients)];
  try { await reconcileSubscriptions(await roomService.listParticipants(roomName)); } catch (e) { console.warn('Áudio ainda não roteado:', e.message); }
  res.json({ routing });
});

app.post('/api/video-routing', auth, directorOnly, async (req, res) => {
  const recipients = req.body?.recipients;
  if (!Array.isArray(recipients) || recipients.some((r) => !audience.includes(r))) return res.status(400).json({ error: 'Destinatários inválidos.' });
  videoRouting = [...new Set(recipients)];
  try { await reconcileSubscriptions(await roomService.listParticipants(roomName)); } catch (e) { console.warn('Vídeo ainda não roteado:', e.message); }
  res.json({ videoRouting });
});

app.post('/api/audio-return/routing', auth, directorOnly, async (req, res) => {
  const recipients = req.body?.recipients;
  if (!Array.isArray(recipients) || recipients.some((r) => !audience.includes(r))) return res.status(400).json({ error: 'Destinatários inválidos.' });
  audioReturnRouting = [...new Set(recipients)];
  try { await reconcileSubscriptions(await roomService.listParticipants(roomName)); } catch (e) { console.warn('Retorno de áudio ainda não roteado:', e.message); }
  res.json({ audioReturnRouting });
});

app.post('/api/permission', auth, directorOnly, async (req, res) => {
  const { identity, allow } = req.body || {};
  if (!audience.includes(identity) || typeof allow !== 'boolean') return res.status(400).json({ error: 'Participante ou autorização inválida.' });
  try {
    await roomService.updateParticipant(roomName, identity, { permission: { canPublish: allow, canPublishData: true, canSubscribe: true } });
    requests = requests.map((r) => r.identity === identity && r.status === 'pending' ? { ...r, status: allow ? 'authorized' : 'denied' } : r);
    await reconcileSubscriptions(await roomService.listParticipants(roomName));
    res.json({ identity, allow });
  } catch (e) { res.status(409).json({ error: 'A pessoa precisa estar conectada para receber a autorização.' }); }
});

app.post('/api/requests/:id/close', auth, directorOnly, (req, res) => {
  requests = requests.map((r) => r.id === req.params.id && r.status === 'pending' ? { ...r, status: 'closed' } : r);
  res.json({ ok: true });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(appDir, '../dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
export const httpServer = app.listen(port, host, () => console.log(`PWO Intercom ativo em ${host}:${port}.`));
