import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Room, RoomEvent, Track, createLocalAudioTrack, createLocalVideoTrack } from 'livekit-client';
import { people, profiles, interviewers, PROGRAM_TRACK, PROGRAM_VIDEO } from '../shared/protocol.js';
import { audioContext, unlockAudio } from './audio.js';
import './style.css';

const defaultApi = import.meta.env.VITE_API_BASE_URL || (window.Capacitor?.isNativePlatform?.() ? 'https://pwo-esr1.onrender.com' : '');

async function api(path, token, body) {
  const base = (localStorage.getItem('pwoApiBaseUrl') || defaultApi).replace(/\/+$/, '');
  const response = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(path === 'session' ? 75000 : 10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha de comunicação com o servidor.');
  return data;
}
const emptyState = { routing: [], audioReturnRouting: [], videoRouting: [], requests: [], participants: [], program: {} };

function VideoTile({ track }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; track.attach(el); return () => track.detach(el); }, [track]);
  return <video className="program-video" ref={ref} autoPlay playsInline muted/>;
}

function SignalMeter({ track, label }) {
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState('Aguardando faixa');
  useEffect(() => {
    setLevel(0);
    if (!track) { setStatus('Aguardando faixa'); return; }
    let source, analyser, timer;
    try {
      const ctx = audioContext();
      analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      source = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      timer = setInterval(() => {
        if (ctx.state !== 'running') { setStatus('Toque em Ativar áudio'); setLevel(0); return; }
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
        const db = 20 * Math.log10(Math.max(rms, 0.000001));
        setLevel(Math.max(0, Math.min(100, (db + 60) / 60 * 100)));
        setStatus(track.mediaStreamTrack.readyState === 'ended' ? 'Dispositivo desconectado' : db > -55 ? 'Sinal detectado' : 'Silêncio / sem sinal');
      }, 150);
    } catch { setStatus('Medidor indisponível'); }
    return () => { clearInterval(timer); source?.disconnect(); analyser?.disconnect(); };
  }, [track]);
  return <div className="meter"><div><span>{label}</span><small>{status}</small></div><div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level)}><i style={{ width: `${level}%` }}/></div></div>;
}
function Volume({ label, value, onChange }) {
  return <label className="volume"><span>{label}</span><b>{Math.round(value * 100)}%</b><input aria-label={label} type="range" min="0" max="1" step="0.05" value={value} onChange={e => onChange(Number(e.target.value))}/></label>;
}
function App() {
  const [session, setSession] = useState(null);
  const [apiBase, setApiBase] = useState(() => localStorage.getItem('pwoApiBaseUrl') || defaultApi);
  const [profile, setProfile] = useState('director'), [code, setCode] = useState('');
  const [error, setError] = useState(''), [syncError, setSyncError] = useState('');
  const [busy, setBusy] = useState(false), [actionBusy, setActionBusy] = useState(false);
  const [connection, setConnection] = useState('disconnected');
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [state, setState] = useState(emptyState);
  const [micOn, setMicOn] = useState(false), [micTrack, setMicTrack] = useState(null);
  const [inputs, setInputs] = useState([]), [micInput, setMicInput] = useState(''), [programInput, setProgramInput] = useState('');
  const [programTrack, setProgramTrack] = useState(null), [received, setReceived] = useState([]);
  const [programBusy, setProgramBusy] = useState(false), [deviceBusy, setDeviceBusy] = useState(false);
  const [videoInputs, setVideoInputs] = useState([]), [videoInput, setVideoInput] = useState('');
  const [videoTrack, setVideoTrack] = useState(null), [remoteVideo, setRemoteVideo] = useState(null), [videoBusy, setVideoBusy] = useState(false);
  const [personVolumes, setPersonVolumes] = useState({ interviewer1: 1, interviewer2: 1, producer: 1 });
  const personVolumesRef = useRef({ interviewer1: 1, interviewer2: 1, producer: 1 });
  const videoRef = useRef(null), videoBusyRef = useRef(false);
  const [programVolume, setProgramVolume] = useState(0.6), [voiceVolume, setVoiceVolume] = useState(1);
  const roomRef = useRef(null), programRef = useRef(null), tracksRef = useRef(new Map());
  const levelsRef = useRef({ program: 0.6, voice: 1 });
  const activeRef = useRef(false), publishBusyRef = useRef(false), micBusyRef = useRef(false), sessionRef = useRef(null);
  sessionRef.current = session;
  const isDirector = session?.role === 'director', isStation = session?.role === 'obs';
  const isInterviewer = interviewers.includes(session?.role);
  const connected = connection === 'connected';
  const roster = new Map(state.participants.map(p => [p.identity, p]));
  const canSpeak = connected && !isStation && (!isInterviewer || !!roster.get(session.role)?.canPublish);
  const receivedProgram = received.find(t => t.channel === 'program')?.track;

  async function refresh(token = session?.appToken) {
    if (!token) return;
    try {
      const next = await api('state', token);
      if (activeRef.current && sessionRef.current?.appToken === token) { setState(next); setSyncError(''); }
    } catch (e) { if (activeRef.current && sessionRef.current?.appToken === token) setSyncError(e.message); }
  }
  useEffect(() => {
    if (!session) return;
    activeRef.current = true;
    let disposed = false, timer;
    async function poll() { await refresh(session.appToken); if (!disposed) timer = setTimeout(poll, 2500); }
    poll();
    return () => { disposed = true; activeRef.current = false; clearTimeout(timer); };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const room = new Room({ webAudioMix: { audioContext: audioContext() } });
    room.localParticipant.setTrackSubscriptionPermissions(false, []);
    roomRef.current = room;
    let disposed = false;
    setConnection('connecting');
    const updateTracks = () => setReceived([...tracksRef.current.values()]);
    const updateMic = () => {
      setMicOn(room.localParticipant.isMicrophoneEnabled);
      setMicTrack(room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track || null);
    };
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === Track.Kind.Video && participant.identity === 'obs' && publication.trackName === PROGRAM_VIDEO && session.role !== 'obs') { setRemoteVideo(track); return; }
      if (track.kind !== Track.Kind.Audio || session.role === 'obs') return;
      const channel = participant.identity === 'obs' && publication.trackName === PROGRAM_TRACK ? 'program' : 'voice';
      const element = track.attach(); element.autoplay = true; element.playsInline = true;
      element.dataset.pwoAudio = 'true'; document.body.appendChild(element);
      track.setVolume(levelsRef.current[channel] * (channel === 'voice' ? personVolumesRef.current[participant.identity] ?? 1 : 1));
      tracksRef.current.set(publication.trackSid, { track, channel, identity: participant.identity, element });
      updateTracks();
    });
    room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      if (track.kind === Track.Kind.Video) { track.detach(); setRemoteVideo(current => current === track ? null : current); return; }
      track.detach().forEach(el => el.remove()); tracksRef.current.delete(publication.trackSid); updateTracks();
    });
    room.on(RoomEvent.ConnectionStateChanged, value => setConnection(value));
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => setPlaybackBlocked(!room.canPlaybackAudio));
    room.on(RoomEvent.TrackSubscriptionFailed, () => setError('Falha ao receber uma faixa. Confira a rede e reconecte à sala.'));
    room.on(RoomEvent.LocalTrackPublished, updateMic);
    room.on(RoomEvent.LocalTrackUnpublished, updateMic);
    room.on(RoomEvent.TrackMuted, updateMic);
    room.on(RoomEvent.TrackUnmuted, updateMic);
    room.on(RoomEvent.ParticipantPermissionsChanged, (_previous, participant) => {
      if (participant.identity !== room.localParticipant.identity) return;
      if (participant.permissions?.canPublish === false) {
        setMicOn(false);
        room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      } else updateMic();
    });
    room.on(RoomEvent.Disconnected, () => {
      videoRef.current?.stop(); videoRef.current = null; setVideoTrack(null); setRemoteVideo(null);
      setMicOn(false); setMicTrack(null); setProgramTrack(null); programRef.current?.stop(); programRef.current = null;
      tracksRef.current.forEach(t => t.track.detach().forEach(el => el.remove())); tracksRef.current.clear(); updateTracks();
    });
    room.on(RoomEvent.Reconnected, () => refresh(session.appToken));
    room.connect(session.livekitUrl, session.livekitToken, { autoSubscribe: false })
      .then(async () => {
        if (disposed) { await room.disconnect(); return; }
        try { await unlockAudio(room); } catch { setPlaybackBlocked(true); }
        refresh(session.appToken);
      }).catch(e => { if (!disposed) { setConnection('disconnected'); setError(`Não foi possível conectar ao áudio: ${e.message}`); } });
    return () => {
      disposed = true; room.removeAllListeners(); programRef.current?.stop(); programRef.current = null;
      videoRef.current?.stop(); videoRef.current = null;
      tracksRef.current.forEach(t => t.track.detach().forEach(el => el.remove())); tracksRef.current.clear();
      room.disconnect(); roomRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !session || !connected) return;
    if (isStation) {
      const audioSid = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.trackSid;
      const videoSid = room.localParticipant.getTrackPublication(Track.Source.Camera)?.trackSid;
      const recipients = [...new Set([...state.audioReturnRouting, ...state.videoRouting])];
      room.localParticipant.setTrackSubscriptionPermissions(false, recipients.map(participantIdentity => ({ participantIdentity, allowAll: false, allowedTrackSids: [state.audioReturnRouting.includes(participantIdentity) && audioSid, state.videoRouting.includes(participantIdentity) && videoSid].filter(Boolean) })));
    } else {
      const recipients = isDirector ? state.routing : session.role === 'producer' ? ['director'] : ['director', ...interviewers.filter(id => id !== session.role)];
      room.localParticipant.setTrackSubscriptionPermissions(false, recipients.map(participantIdentity => ({ participantIdentity, allowAll: true })));
    }
  }, [session, connection, state.routing, state.audioReturnRouting, state.videoRouting, programTrack, videoTrack]);

  async function login(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const normalized = apiBase.trim().replace(/\/+$/, '');
      if (normalized) {
        const url = new URL(normalized);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Informe somente o endereço HTTPS do servidor PWO, sem senha ou parâmetros.');
        localStorage.setItem('pwoApiBaseUrl', normalized);
      } else {
        if (window.Capacitor?.isNativePlatform?.()) throw new Error('Informe o endereço HTTPS do servidor PWO no campo Servidor.');
        localStorage.removeItem('pwoApiBaseUrl');
      }
      if (!window.isSecureContext || !navigator.mediaDevices) throw new Error('Abra o PWO por HTTPS. No computador do servidor, localhost também funciona.');
      await unlockAudio();
      const data = await api('session', null, { role: profile, code });
      setState(emptyState); setReceived([]); setProgramTrack(null); setMicTrack(null); setMicOn(false); setSyncError(''); setSession(data); setCode('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  function logout() {
    setRemoteVideo(null); setVideoTrack(null);
    activeRef.current = false; setSession(null); setConnection('disconnected'); setError(''); setSyncError('');
    setProgramTrack(null); setMicTrack(null); setReceived([]); setMicOn(false); setPlaybackBlocked(false);
  }
  async function activateAudio() {
    try { await unlockAudio(roomRef.current); setPlaybackBlocked(false); }
    catch (e) { setError(`Não foi possível liberar o áudio: ${e.message}`); }
  }
  async function action(path, body) {
    setActionBusy(true); setError('');
    try { await api(path, session.appToken, body); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setActionBusy(false); }
  }
  async function loadInputs() {
    setDeviceBusy(true); setError('');
    try {
      await unlockAudio(roomRef.current);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(t => t.stop());
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      setInputs(devices);
      if (isStation && !programInput) {
        const cable = devices.find(d => /cable output|vb-audio|virtual.*audio/i.test(d.label));
        if (cable) setProgramInput(cable.deviceId);
      }
      if (!devices.length) throw new Error('Nenhuma entrada de áudio encontrada.');
    } catch (e) { setError(`Não foi possível buscar entradas: ${e.message}`); }
    finally { setDeviceBusy(false); }
  }
  async function toggleMic() {
    if (!roomRef.current || !canSpeak || micBusyRef.current) return;
    const room = roomRef.current;
    if (room.localParticipant.permissions?.canPublish === false) { setError('Aguarde a autorização do Diretor.'); return; }
    micBusyRef.current = true;
    setActionBusy(true); setError('');
    try {
      await unlockAudio(room);
      await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled, { ...(micInput ? { deviceId: { exact: micInput } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      setMicOn(room.localParticipant.isMicrophoneEnabled);
      setMicTrack(room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track || null);
    } catch (e) { setError(`Microfone indisponível: ${e.message}`); }
    finally { micBusyRef.current = false; setActionBusy(false); }
  }
  async function toggleProgram() {
    const room = roomRef.current;
    if (!room || !isStation || publishBusyRef.current) return;
    publishBusyRef.current = true; setProgramBusy(true); setError('');
    let pendingTrack;
    try {
      await unlockAudio(room);
      if (programRef.current) {
        const track = programRef.current;
        try { await room.localParticipant.unpublishTrack(track); }
        finally { track.stop(); programRef.current = null; setProgramTrack(null); }
      } else {
        if (!programInput) throw new Error('Selecione CABLE Output ou a entrada da interface que recebe o programa.');
        pendingTrack = await createLocalAudioTrack({ deviceId: { exact: programInput }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } });
        if (roomRef.current !== room || room.state !== 'connected') throw new Error('A conexão mudou. Entre novamente antes de enviar o retorno.');
        // Distinct from the intercom microphone, restricted by the OBS token.
        await room.localParticipant.publishTrack(pendingTrack, { name: PROGRAM_TRACK, source: Track.Source.ScreenShareAudio });
        if (roomRef.current !== room || room.state !== 'connected') throw new Error('A conexão foi encerrada durante a captura.');
        programRef.current = pendingTrack; setProgramTrack(pendingTrack);
        pendingTrack.mediaStreamTrack.addEventListener('ended', () => {
          if (programRef.current === pendingTrack) {
            room.localParticipant.unpublishTrack(pendingTrack).catch(() => {});
            programRef.current = null; setProgramTrack(null); setError('A entrada do retorno foi desconectada. Reconecte o dispositivo e inicie o retorno novamente.');
          }
        }, { once: true });
      }
      await refresh();
    } catch (e) {
      if (pendingTrack) { await room.localParticipant.unpublishTrack(pendingTrack).catch(() => {}); pendingTrack.stop(); }
      setError(`Retorno: ${e.message}`);
    } finally { publishBusyRef.current = false; setProgramBusy(false); }
  }
  async function loadVideoInputs() {
    setVideoBusy(true); setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach(t => t.stop());
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      setVideoInputs(devices); setVideoInput(devices.find(d => /obs.*virtual|virtual.*obs/i.test(d.label))?.deviceId || devices[0]?.deviceId || '');
      if (!devices.length) throw new Error('Inicie a Câmera Virtual no OBS e busque novamente.');
    } catch (e) { setError(e.message); }
    finally { setVideoBusy(false); }
  }
  async function toggleVideo() {
    const room = roomRef.current;
    if (!room || !isStation || videoBusyRef.current) return;
    videoBusyRef.current = true; setVideoBusy(true); setError('');
    let track;
    try {
      if (videoRef.current) {
        const old = videoRef.current;
        try { await room.localParticipant.unpublishTrack(old); }
        finally { old.stop(); videoRef.current = null; setVideoTrack(null); }
      } else {
        track = await createLocalVideoTrack({ deviceId: { exact: videoInput }, resolution: { width: 640, height: 360 }, frameRate: 15 });
        if (roomRef.current !== room || room.state !== 'connected') throw new Error('Reconecte à sala antes de enviar vídeo.');
        await room.localParticipant.publishTrack(track, { source: Track.Source.Camera, name: PROGRAM_VIDEO });
        if (roomRef.current !== room || room.state !== 'connected') throw new Error('A conexão foi encerrada.');
        videoRef.current = track; setVideoTrack(track);
        track.mediaStreamTrack.addEventListener('ended', () => {
          if (videoRef.current === track) {
            room.localParticipant.unpublishTrack(track).catch(() => {});
            videoRef.current = null; setVideoTrack(null); setError('A câmera virtual foi desconectada. Inicie o retorno de vídeo novamente.');
          }
        }, { once: true });
      }
      await refresh();
    } catch (e) { if (track) { await room.localParticipant.unpublishTrack(track).catch(() => {}); track.stop(); } setError(`Vídeo: ${e.message}`); }
    finally { videoBusyRef.current = false; setVideoBusy(false); }
  }
  function personVolume(identity, value) {
    personVolumesRef.current = { ...personVolumesRef.current, [identity]: value };
    setPersonVolumes(personVolumesRef.current);
    tracksRef.current.forEach(t => { if (t.channel === 'voice' && t.identity === identity) t.track.setVolume(value * levelsRef.current.voice); });
  }
  function volume(channel, value) {
    levelsRef.current[channel] = value;
    if (channel === 'program') setProgramVolume(value); else setVoiceVolume(value);
    tracksRef.current.forEach(t => { if (t.channel === channel) t.track.setVolume(value * (channel === 'voice' ? personVolumesRef.current[t.identity] ?? 1 : 1)); });
  }
  function recipients(kind, id, checked) {
    const key = kind === 'voice' ? 'routing' : kind === 'video' ? 'videoRouting' : 'audioReturnRouting';
    const ids = checked ? [...new Set([...state[key], id])] : state[key].filter(x => x !== id);
    action(kind === 'voice' ? 'routing' : kind === 'video' ? 'video-routing' : 'audio-return/routing', { recipients: ids });
  }
  const connectionLabel = { connected: 'Conectado', connecting: 'Conectando…', reconnecting: 'Reconectando…', signalReconnecting: 'Reconectando…', disconnected: 'Desconectado' }[connection] || connection;
  const programStatus = syncError ? 'Estado indisponível' : !state.program.stationConnected ? 'Estação OBS offline' : !state.program.published ? 'Estação online · retorno parado' : state.program.muted ? 'Faixa silenciada' : 'Faixa publicada pela estação';

  if (!session) return <main className="login"><div className="brand"><img src="/logo-pwo.png" alt="Pod PWO" onError={e => { e.currentTarget.style.display = 'none'; }}/>PWO<span>INTERCOM</span></div><section className="card login-card"><p className="eyebrow">FÓRMULA TRUCK · EQUIPE</p><h1>Conecte sua equipe.</h1><p className="muted">Direção, entrevistadores e retorno do programa em uma sala.</p><form onSubmit={login}><label>Servidor HTTPS (obrigatório no APK)<input type="url" placeholder="Neste navegador, deixe vazio para usar este site" value={apiBase} onChange={e => setApiBase(e.target.value)}/></label><label>Perfil<select value={profile} onChange={e => setProfile(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.label}{p.id.startsWith('interviewer') ? ` · ${p.detail}` : ''}</option>)}</select></label><p className="hint">{profiles.find(p => p.id === profile).detail}</p><label>Código de acesso<input type="password" autoComplete="current-password" value={code} onChange={e => setCode(e.target.value)} required/></label><button className="primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar na sala'}</button></form>{error && <p className="alert" role="alert">{error}</p>}<p className="hint">Use fones. No celular, mantenha o app em primeiro plano e a tela ligada.</p></section><footer>Ensaios · 30/11 e 02/12 de 2026</footer></main>;
  return <main className="app-shell"><header><div className="brand"><img src="/logo-pwo.png" alt="Pod PWO" onError={e => { e.currentTarget.style.display = 'none'; }}/>PWO<span>INTERCOM</span></div><div className="user"><span className={`dot ${connected ? 'online' : ''}`}/><b>{session.name}</b><button className="quiet" onClick={logout}>Sair</button></div></header><div className="eventbar"><div><p className="eyebrow">FÓRMULA TRUCK · OPERAÇÃO</p><h1>{isStation ? 'Retorno do programa' : isDirector ? 'Sua equipe, conectada.' : `Olá, ${session.name}.`}</h1><p className="muted">{isStation ? 'Envie o áudio deste computador. As cenas continuam no OBS.' : 'Voz da direção e áudio do programa com controles separados.'}</p></div><span className="tag">{connectionLabel}</span></div>
    {(error || syncError) && <div className="alert" role="alert">{error || syncError}{error && <button className="quiet" onClick={() => setError('')}>Fechar</button>}</div>}
    {playbackBlocked && !isStation && <div className="alert">O navegador bloqueou o som. Toque em <b>Ativar áudio</b> para ouvir a equipe e o retorno.</div>}
    <section className="card status-card"><div><p className="eyebrow">SUA CONEXÃO</p><h2><span className={`dot ${connected ? 'online' : ''}`}/>{connectionLabel}</h2><p className="hint">{connection === 'disconnected' ? 'Saia e entre novamente para reconectar.' : isStation ? 'Esta estação apenas envia retorno e não recebe o áudio privado da equipe.' : 'Fones conectados · página aberta · tela ligada'}</p></div><div className="actions"><button className="secondary" disabled={!connected} onClick={activateAudio}>Ativar áudio</button>{!isStation && <button disabled={!canSpeak || actionBusy} className={micOn ? 'danger' : 'primary'} onClick={toggleMic}>{micOn ? 'Desligar microfone' : 'Ligar microfone'}</button>}{isInterviewer && <button className="secondary" disabled={!connected || actionBusy} onClick={() => action('requests', {})}>Solicitar fala</button>}</div></section>
    <div className="grid">
      {isStation && <section className="card wide"><p className="eyebrow">VÍDEO OPCIONAL</p><h2>Retorno da Câmera Virtual</h2><p className="hint">No OBS, inicie a Câmera Virtual com saída Programa. O áudio é enviado separadamente no cartão abaixo.</p><div className="input-row"><button className="secondary" disabled={videoBusy || !!videoTrack} onClick={loadVideoInputs}>Buscar câmeras</button><label>Câmera<select value={videoInput} onChange={e => setVideoInput(e.target.value)} disabled={videoBusy || !!videoTrack}><option value="">Selecione a câmera</option>{videoInputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Câmera ${i + 1}`}</option>)}</select></label><button className={videoTrack ? 'danger' : 'primary'} disabled={!connected || videoBusy || (!videoTrack && !videoInput)} onClick={toggleVideo}>{videoBusy ? 'Aguarde…' : videoTrack ? 'Parar vídeo' : 'Iniciar vídeo'}</button></div>{videoTrack && <VideoTile track={videoTrack}/>}</section>}
      {!isStation && remoteVideo && <section className="card wide"><p className="eyebrow">PROGRAMA</p><h2>Retorno de vídeo</h2><VideoTile track={remoteVideo}/></section>}
      {isStation ? <section className="card wide"><p className="eyebrow">ESTAÇÃO OBS</p><h2>Enviar áudio para o PWO</h2><p className="muted">No OBS: monitoramento em <b>CABLE Input</b>. Aqui: entrada <b>CABLE Output</b>. O cabo virtual deve estar instalado nesta máquina.</p><div className="input-row"><button className="secondary" disabled={deviceBusy || !!programTrack || programBusy} onClick={loadInputs}>{deviceBusy ? 'Buscando…' : 'Buscar entradas'}</button><label>Entrada do programa<select value={programInput} onChange={e => setProgramInput(e.target.value)} disabled={!!programTrack || programBusy}><option value="">Selecione a entrada</option>{inputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Entrada ${i + 1}`}</option>)}</select></label><button className={programTrack ? 'danger' : 'primary'} disabled={!connected || programBusy || (!programTrack && !programInput)} onClick={toggleProgram}>{programBusy ? 'Aguarde…' : programTrack ? 'Parar retorno' : 'Iniciar retorno'}</button></div><SignalMeter track={programTrack} label="Sinal capturado nesta máquina"/><p className="hint">{programTrack ? 'Faixa enviada. O medidor deve se mover quando houver som no OBS. O Diretor escolhe os destinatários.' : 'Busque a entrada e inicie o retorno. Nenhum áudio é capturado automaticamente.'}</p><details><summary>Como configurar e conferir</summary><ol><li>No OBS, selecione CABLE Input como dispositivo de monitoramento.</li><li>Nas fontes desejadas, selecione Monitorar e enviar para a saída.</li><li>Aqui, selecione CABLE Output e inicie o retorno.</li><li>Se o medidor ficar parado com som no OBS, revise a entrada e o monitoramento.</li><li>Se o medidor mover, confira os destinatários no Diretor e o botão Ativar áudio nos celulares.</li></ol><p>O som do PWO não deve entrar na captura de áudio do OBS. Mix-minus ainda precisa ser configurado na mixagem, caso o entrevistador ouça a própria voz com atraso.</p></details></section>
      : <><section className="card"><p className="eyebrow">SEU MICROFONE</p><h2>{isInterviewer ? canSpeak ? 'Fala autorizada' : 'Somente escuta' : 'Comunicação da equipe'}</h2><SignalMeter track={micOn ? micTrack : null} label="Seu microfone"/><div className="input-row"><button className="secondary small" disabled={deviceBusy || micOn || actionBusy} onClick={loadInputs}>Buscar microfones</button><label>Entrada<select value={micInput} onChange={e => setMicInput(e.target.value)} disabled={micOn || actionBusy}><option value="">Padrão do aparelho</option>{inputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Entrada ${i + 1}`}</option>)}</select></label></div><p className="hint">{isInterviewer ? 'A autorização permite responder à equipe. Ela não coloca sua voz na transmissão.' : 'Use seu microfone. O cabo virtual fica na máquina do OBS.'}</p></section>
      <section className="card"><p className="eyebrow">O QUE VOCÊ ESCUTA</p><h2>Áudio recebido</h2><Volume label="Voz da equipe" value={voiceVolume} onChange={v => volume('voice', v)}/><Volume label="Retorno do programa" value={programVolume} onChange={v => volume('program', v)}/><SignalMeter track={receivedProgram} label="Retorno recebido neste aparelho"/><p className="hint">{programStatus}{receivedProgram ? ' · faixa recebida aqui' : state.audioReturnRouting.includes(session.role) ? ' · aguardando faixa neste aparelho' : ' · retorno não selecionado para você'}</p><p className="hint">O medidor confirma sinal recebido; confira também o volume do aparelho e seus fones.</p></section></>}
      {isDirector && <><section className="card"><p className="eyebrow">COMUNICAÇÃO</p><h2>Quem recebe sua voz</h2>{people.map(p => <label className="recipient" key={p.id}><span><b>{p.label}</b><small>{p.detail} · {roster.has(p.id) ? 'Online' : 'Offline'}</small></span><input type="checkbox" checked={state.routing.includes(p.id)} disabled={actionBusy || !connected || !!syncError} onChange={e => recipients('voice', p.id, e.target.checked)}/></label>)}</section>
      <section className="card"><p className="eyebrow">RETORNO DO OBS</p><h2>Quem recebe o programa</h2><p className="hint">{programStatus}</p>{profiles.filter(p => p.id !== 'obs').map(p => <label className="recipient" key={p.id}><span><b>{p.id === 'director' ? 'Você · Diretor' : p.label}</b><small>{roster.has(p.id) ? 'Online' : 'Offline'}</small></span><input type="checkbox" checked={state.audioReturnRouting.includes(p.id)} disabled={actionBusy || !connected || !!syncError} onChange={e => recipients('program', p.id, e.target.checked)}/></label>)}</section>
      <section className="card"><p className="eyebrow">AUTORIZAÇÃO DE FALA</p><h2>Otávio e João</h2>{people.filter(p => interviewers.includes(p.id)).map(p => <div className="recipient" key={p.id}><span><b>{p.label}</b><small>{roster.get(p.id)?.canPublish ? 'Pode ligar o microfone' : 'Somente escuta'}</small></span><button className={roster.get(p.id)?.canPublish ? 'danger small' : 'secondary small'} disabled={!roster.has(p.id) || actionBusy || !!syncError} onClick={() => action('permission', { identity: p.id, allow: !roster.get(p.id)?.canPublish })}>{roster.get(p.id)?.canPublish ? 'Encerrar fala' : 'Autorizar'}</button></div>)}</section>
      <section className="card"><p className="eyebrow">PEDIDOS DA EQUIPE</p><h2>Solicitações de fala</h2>{state.requests.filter(r => r.status === 'pending').length === 0 && <p className="muted">Nenhum pedido pendente.</p>}{state.requests.filter(r => r.status === 'pending').map(r => <div className="recipient" key={r.id}><b>{r.name}</b><div className="actions"><button className="primary small" disabled={actionBusy || !roster.has(r.identity)} onClick={() => action('permission', { identity: r.identity, allow: true })}>Autorizar</button><button className="quiet" disabled={actionBusy} onClick={() => action(`requests/${encodeURIComponent(r.id)}/close`, {})}>Dispensar</button></div></div>)}</section></>}
      {isDirector && <><section className="card"><p className="eyebrow">ESCUTA INDIVIDUAL</p><h2>Volume de cada pessoa</h2>{people.map(p => <Volume key={p.id} label={p.label} value={personVolumes[p.id]} onChange={value => personVolume(p.id, value)}/>)}</section><section className="card"><p className="eyebrow">RETORNO DE VÍDEO</p><h2>Quem recebe a imagem</h2><p className="hint">{state.program.videoPublished ? 'Vídeo publicado pela Estação OBS' : 'Sem vídeo publicado'}</p>{profiles.filter(p => p.id !== 'obs').map(p => <label className="recipient" key={p.id}><b>{p.label}</b><input type="checkbox" checked={state.videoRouting.includes(p.id)} disabled={actionBusy || !connected || !!syncError} onChange={e => recipients('video', p.id, e.target.checked)}/></label>)}</section></>}
      <section className="card wide"><p className="eyebrow">NA SALA</p><h2>Equipe e estação</h2><div className="roster">{profiles.map(p => <div className="roster-item" key={p.id}><span className={`dot ${roster.has(p.id) && !syncError ? 'online' : ''}`}/><span><b>{p.label}</b><small>{syncError ? 'Estado indisponível' : roster.has(p.id) ? 'Online' : 'Offline'}</small></span></div>)}</div></section>
    </div><footer>PWO Intercom · Ensaios em 30/11 e 02/12/2026 · Um aparelho por perfil</footer></main>;
}
createRoot(document.getElementById('root')).render(<App/>);


