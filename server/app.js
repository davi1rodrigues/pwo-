import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { fileURLToPath } from 'node:url';
import { profiles, audience, returnAudience, interviewers, PROGRAM_TRACK, PROGRAM_VIDEO, createSubscriptionReconciler } from '../shared/protocol.js';

export function createApp(env, service) {
  const app = express();
  const room = env.ROOM_NAME || 'pwo-formula-truck-2026';
  const codes = { director: env.DIRECTOR_CODE, interviewer1: env.INTERVIEWER1_CODE, interviewer2: env.INTERVIEWER2_CODE, producer: env.PRODUCER_CODE, obs: env.OBS_CODE };
  let routing = [...audience], audioReturnRouting = [...returnAudience], videoRouting = [...returnAudience], requests = [];
  const reconcile = createSubscriptionReconciler(service, room);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    if (origin && (allowed.includes(origin) || origin === 'https://localhost' || origin === 'capacitor://localhost' || (env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/session', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));
  const auth = (req, res, next) => {
    try {
      req.user = jwt.verify(req.headers.authorization?.replace(/^Bearer\s+/i, ''), env.APP_JWT_SECRET, { issuer: 'pwo-intercom', algorithms: ['HS256'] });
      if (req.user.room !== room || !Object.hasOwn(codes, req.user.role)) throw new Error();
      next();
    } catch { res.status(401).json({ error: 'Sessão inválida. Saia e entre novamente.' }); }
  };
  const directorOnly = (req, res, next) => req.user.role === 'director' ? next() : res.status(403).json({ error: 'Somente o Diretor pode alterar este controle.' });
  const sync = () => reconcile([...routing], [...audioReturnRouting], [...videoRouting]);
  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'PWO Intercom', version: '1.1.0', production: env.NODE_ENV === 'production' }));
  app.post('/api/session', async (req, res, next) => {
    try {
      const { role, code } = req.body || {};
      if (role === 'obs' && !codes.obs) return res.status(503).json({ error: 'Defina OBS_CODE no servidor e reinicie para habilitar a Estação OBS.' });
      if (!Object.hasOwn(codes, role) || typeof code !== 'string' || !code || code.length > 200 || code !== codes[role]) return res.status(401).json({ error: 'Perfil ou código incorreto.' });
      const name = profiles.find(p => p.id === role).label;
      const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity: role, name, ttl: '10m', metadata: JSON.stringify({ role }) });
      token.addGrant({ roomJoin: true, room, canSubscribe: role !== 'obs', canPublish: !interviewers.includes(role), canPublishData: false, canPublishSources: role === 'obs' ? [TrackSource.SCREEN_SHARE_AUDIO, TrackSource.CAMERA] : [TrackSource.MICROPHONE] });
      res.json({ role, name, livekitUrl: env.LIVEKIT_URL, livekitToken: await token.toJwt(), appToken: jwt.sign({ role, room }, env.APP_JWT_SECRET, { expiresIn: '12h', issuer: 'pwo-intercom' }) });
    } catch (e) { next(e); }
  });
  app.get('/api/state', auth, async (req, res) => {
    try {
      const live = await sync();
      const station = live.find(p => p.identity === 'obs');
      const program = station?.tracks?.find(t => t.name === PROGRAM_TRACK);
      res.json({ routing, audioReturnRouting, videoRouting, requests, participants: live.map(p => ({ identity: p.identity, name: p.name, connected: true, canPublish: !!p.permission?.canPublish })), program: { stationConnected: !!station, published: !!program, muted: !!program?.muted, videoPublished: !!station?.tracks?.some(t => t.name === PROGRAM_VIDEO) } });
    } catch { res.status(503).json({ error: 'Não foi possível consultar a sala de áudio. Confira a conexão do servidor com o LiveKit.' }); }
  });
  function routingHandler(kind, allowed) {
    return async (req, res) => {
      const recipients = req.body?.recipients;
      if (!Array.isArray(recipients) || recipients.some(r => !allowed.includes(r))) return res.status(400).json({ error: 'Destinatários inválidos.' });
      if (kind === 'routing') routing = [...new Set(recipients)];
      else if (kind === 'video') videoRouting = [...new Set(recipients)];
      else audioReturnRouting = [...new Set(recipients)];
      try { await sync(); res.json({ ok: true }); }
      catch { res.status(503).json({ error: 'Seleção salva, mas ainda não aplicada à sala. O servidor tentará novamente na próxima atualização.' }); }
    };
  }
  app.post('/api/routing', auth, directorOnly, routingHandler('routing', audience));
  app.post('/api/audio-return/routing', auth, directorOnly, routingHandler('return', returnAudience));
  app.post('/api/video-routing', auth, directorOnly, routingHandler('video', returnAudience));
  app.post('/api/permission', auth, directorOnly, async (req, res) => {
    const { identity, allow } = req.body || {};
    if (!interviewers.includes(identity) || typeof allow !== 'boolean') return res.status(400).json({ error: 'Entrevistador ou autorização inválida.' });
    try {
      await service.updateParticipant(room, identity, { permission: { canPublish: allow, canSubscribe: true, canPublishData: false, canPublishSources: [TrackSource.MICROPHONE] } });
      requests = requests.map(r => r.identity === identity && r.status === 'pending' ? { ...r, status: allow ? 'authorized' : 'denied' } : r);
      await sync(); res.json({ identity, allow });
    } catch { res.status(409).json({ error: 'Não foi possível aplicar a autorização. Confira se o entrevistador está conectado e tente novamente.' }); }
  });
  app.post('/api/requests', auth, (req, res) => {
    if (!interviewers.includes(req.user.role)) return res.status(403).json({ error: 'Somente entrevistadores podem solicitar fala.' });
    const existing = requests.find(r => r.identity === req.user.role && r.status === 'pending');
    if (existing) return res.json(existing);
    const request = { id: randomUUID(), identity: req.user.role, name: profiles.find(p => p.id === req.user.role).label, status: 'pending', createdAt: Date.now() };
    requests = [...requests, request].slice(-30); res.status(201).json(request);
  });
  app.post('/api/requests/:id/close', auth, directorOnly, (req, res) => {
    requests = requests.map(r => r.id === req.params.id && r.status === 'pending' ? { ...r, status: 'closed' } : r);
    res.json({ ok: true });
  });
  if (env.NODE_ENV === 'production') {
    const dist = fileURLToPath(new URL('../dist/', import.meta.url));
    app.use(express.static(dist));
    app.get('*', (req, res) => res.sendFile(`${dist}/index.html`));
  }
  app.use((error, req, res, next) => res.status(500).json({ error: 'Falha no servidor. Tente novamente.' }));
  return app;
}
