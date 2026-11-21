import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from './dispatch.js';
import jwt from 'jsonwebtoken';
import { createApp } from '../server/app.js';
import { PROGRAM_TRACK, PROGRAM_VIDEO, desiredTracks, createSubscriptionReconciler } from '../shared/protocol.js';
const track = (sid, name = '', type = 0) => ({ sid, name, type });
const fixture = () => [
  { identity: 'director', sid: 'PA_D', tracks: [track('D')] },
  { identity: 'obs', sid: 'PA_O', tracks: [track('P', PROGRAM_TRACK), track('BAD'), track('V', PROGRAM_TRACK, 1)] },
  { identity: 'interviewer1', sid: 'PA_1', tracks: [track('I1')] },
  { identity: 'interviewer2', sid: 'PA_2', tracks: [track('I2')] },
  { identity: 'producer', sid: 'PA_PR', tracks: [track('PROD')] },
  { identity: 'unknown', sid: 'PA_U', tracks: [track('U')] },
];
test('station and unknown participants never receive private audio', () => {
  for (const recipient of ['obs', 'unknown']) assert.deepEqual(desiredTracks(fixture(), recipient, ['obs', 'unknown'], ['obs', 'unknown']), []);
});
test('director voice and station return have independent recipients', () => {
  assert.deepEqual(desiredTracks(fixture(), 'interviewer1', ['interviewer1'], ['interviewer2']), ['D', 'I2']);
  assert.deepEqual(desiredTracks(fixture(), 'interviewer2', ['interviewer1'], ['interviewer2']), ['P', 'I1']);
  assert.deepEqual(desiredTracks(fixture(), 'director', [], ['director']), ['P', 'I1', 'I2', 'PROD']);
  assert.deepEqual(desiredTracks(fixture(), 'producer', [], ['producer']), ['P']);
});
test('legacy director program and unknown station track are not delivered', () => {
  const participants = fixture(); participants[0].tracks.push(track('LEGACY', PROGRAM_TRACK));
  assert.deepEqual(desiredTracks(participants, 'interviewer1', ['interviewer1'], ['interviewer1']), ['D', 'P', 'I2']);
});
test('reconciliation removes targets and re-subscribes a rejoined identity', async () => {
  const participants = fixture().slice(0, 3), calls = [];
  const service = { listParticipants: async () => participants, updateSubscriptions: async (...args) => calls.push(args) };
  const sync = createSubscriptionReconciler(service, 'test');
  await sync(['interviewer1'], ['interviewer1']);
  assert.ok(calls.some(c => c[1] === 'interviewer1' && c[2].includes('P') && c[3]));
  calls.length = 0; await sync(['interviewer1'], ['interviewer1']); assert.equal(calls.length, 0);
  participants[2].sid = 'PA_REJOIN'; await sync(['interviewer1'], ['interviewer1']);
  assert.ok(calls.some(c => c[1] === 'interviewer1' && c[2].includes('D') && c[3]));
  calls.length = 0; await sync([], []);
  assert.ok(calls.some(c => c[1] === 'interviewer1' && c[2].includes('P') && c[3] === false));
});
test('failed subscriptions are retried and concurrent syncs are serialized', async () => {
  let fail = true, concurrent = 0, peak = 0, attempts = 0;
  const service = {
    listParticipants: async () => { concurrent++; peak = Math.max(peak, concurrent); await new Promise(r => setTimeout(r, 5)); concurrent--; return fixture(); },
    updateSubscriptions: async () => { attempts++; if (fail) { fail = false; throw new Error('network'); } },
  };
  const sync = createSubscriptionReconciler(service, 'test');
  await assert.rejects(sync(['interviewer1'], []));
  await Promise.all([sync(['interviewer1'], []), sync(['interviewer1'], []), sync([], [])]);
  assert.equal(peak, 1); assert.ok(attempts > 1);
});
const env = { LIVEKIT_URL: 'wss://example.test', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: 'test-secret-32-characters-long-value', APP_JWT_SECRET: 'app-secret-32-characters-long-value', DIRECTOR_CODE: 'test-director', INTERVIEWER1_CODE: 'test-one', INTERVIEWER2_CODE: 'test-two', PRODUCER_CODE: 'test-producer', OBS_CODE: 'test-station' };
test('HTTP access, grants, return routing, requests and failure reporting', async t => {
  let fail = false;
  const live = fixture().slice(0, 5).map(p => ({ ...p, permission: { canPublish: !p.identity.startsWith('interviewer') } }));
  const service = {
    listParticipants: async () => { if (fail) throw new Error('offline'); return live; },
    updateSubscriptions: async () => {},
    updateParticipant: async (room, identity, value) => { live.find(p => p.identity === identity).permission = value.permission; },
  };
  const app = createApp(env, service);
  const request = (path, token, body) => dispatch(app, path, token, body);
  assert.equal((await request('state')).status, 401);
  assert.equal((await request('session', null, { role: '__proto__', code: '' })).status, 401);
  assert.equal((await request('session', null, { role: 'obs', code: 'wrong' })).status, 401);
  const station = (await request('session', null, { role: 'obs', code: env.OBS_CODE })).data;
  const director = (await request('session', null, { role: 'director', code: env.DIRECTOR_CODE })).data;
  const one = (await request('session', null, { role: 'interviewer1', code: env.INTERVIEWER1_CODE })).data;
  const grants = jwt.verify(station.livekitToken, env.LIVEKIT_API_SECRET).video;
  assert.equal(grants.canSubscribe, false); assert.equal(grants.canPublish, true); assert.deepEqual(grants.canPublishSources, ['screen_share_audio', 'camera']);
  assert.equal(jwt.decode(one.livekitToken).video.canPublish, false);
  assert.equal((await request('audio-return/routing', station.appToken, { recipients: [] })).status, 403);
  assert.equal((await request('permission', one.appToken, { identity: 'interviewer1', allow: true })).status, 403);
  assert.equal((await request('permission', director.appToken, { identity: 'obs', allow: true })).status, 400);
  assert.equal((await request('routing', director.appToken, { recipients: ['obs'] })).status, 400);
  assert.equal((await request('video-routing', station.appToken, { recipients: [] })).status, 403);
  assert.equal((await request('video-routing', director.appToken, { recipients: ['director'] })).status, 200);
  assert.equal((await request('audio-return/routing', director.appToken, { recipients: ['director', 'interviewer1'] })).status, 200);
  const state = (await request('state', director.appToken)).data;
  assert.equal(state.program.published, true); assert.deepEqual(state.audioReturnRouting, ['director', 'interviewer1']);
  const a = await request('requests', one.appToken, {}), b = await request('requests', one.appToken, {});
  assert.equal(a.data.id, b.data.id); assert.equal(a.data.name, 'Otávio');
  assert.equal((await request('permission', director.appToken, { identity: 'interviewer1', allow: true })).status, 200);
  assert.equal(live[2].permission.canPublish, true);
  assert.equal((await request('permission', director.appToken, { identity: 'interviewer1', allow: false })).status, 200);
  assert.equal(live[2].permission.canPublish, false);
  fail = true; assert.equal((await request('state', director.appToken)).status, 503);
});

test('video uses independent selection and only the OBS station can provide it', () => {
  const participants = fixture();
  participants[1].tracks.push(track('PROGRAM_VIDEO', PROGRAM_VIDEO, 1));
  participants[0].tracks.push(track('DIRECTOR_CAMERA', PROGRAM_VIDEO, 1));
  assert.deepEqual(desiredTracks(participants, 'interviewer1', [], [], ['interviewer1']), ['PROGRAM_VIDEO', 'I2']);
  assert.deepEqual(desiredTracks(participants, 'interviewer2', [], [], ['interviewer1']), ['I1']);
});

test('missing station code is explicit and desktop health reports production', async () => {
  const app = createApp({ ...env, OBS_CODE: undefined, NODE_ENV: 'production' }, {});
  assert.equal((await dispatch(app, 'session', null, { role: 'obs', code: 'anything' })).status, 503);
  assert.equal((await dispatch(app, 'health')).data.production, true);
});
