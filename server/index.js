import 'dotenv/config';
import { RoomServiceClient } from 'livekit-server-sdk';
import { createApp } from './app.js';
const required = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'APP_JWT_SECRET', 'DIRECTOR_CODE', 'INTERVIEWER1_CODE', 'INTERVIEWER2_CODE', 'PRODUCER_CODE'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) { console.error(`Configure as variáveis ausentes: ${missing.join(', ')}`); process.exit(1); }
if (process.env.APP_JWT_SECRET.length < 32) { console.error('APP_JWT_SECRET precisa ter pelo menos 32 caracteres.'); process.exit(1); }
if (!process.env.OBS_CODE) console.warn('Estação OBS indisponível: defina OBS_CODE no .env e reinicie.');
const host = process.env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
const service = new RoomServiceClient(host, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
export const httpServer = createApp(process.env, service).listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log(`PWO Intercom ativo na porta ${process.env.PORT || 3000}.`));
