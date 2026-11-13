import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Room, RoomEvent, Track } from 'livekit-client';
import './style.css';
import './legacy-look.css';

const people = [
  { id:'interviewer1', label:'Entrevistador 1' },
  { id:'interviewer2', label:'Entrevistador 2' },
  { id:'producer', label:'Produção' },
];
const profiles = [{id:'director', label:'Diretor'}, ...people];
const api = async (path, token, body) => {
  const response = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type':'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha de comunicação com o servidor.');
  return data;
};

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState('director');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [state, setState] = useState({ routing: people.map(p=>p.id), requests: [], participants: [] });
  const roomRef = useRef(null);
  const attached = useRef(new Set());
  const isDirector = session?.role === 'director';
  const me = session?.role;
  const myName = profiles.find(p=>p.id===me)?.label || '';
  const roster = useMemo(() => new Map(state.participants.map(p=>[p.identity,p])), [state.participants]);

  const refresh = async (token=session?.appToken) => {
    if (!token) return;
    try { setState(await api('state', token)); } catch (e) { setError(e.message); }
  };
  useEffect(() => {
    if (!session) return;
    refresh(session.appToken);
    const timer = setInterval(()=>refresh(session.appToken), 1500);
    return ()=>clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const room = new Room({ adaptiveStream: true, dynacast: true, autoSubscribe: false });
    roomRef.current = room;
    const onTrack = (track, publication, participant) => {
      if (track.kind !== Track.Kind.Audio || participant.identity === me) return;
      const audio = track.attach(); audio.autoplay = true; audio.playsInline = true;
      audio.dataset.identity = participant.identity;
      document.body.appendChild(audio); attached.current.add(audio);
    };
    room.on(RoomEvent.TrackSubscribed, onTrack);
    room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach(el=>{ attached.current.delete(el); el.remove(); }));
    room.on(RoomEvent.Connected, ()=>setConnected(true));
    room.on(RoomEvent.Disconnected, ()=>{setConnected(false);setMicOn(false);});
    room.on(RoomEvent.Reconnecting, ()=>setConnected(false));
    room.on(RoomEvent.Reconnected, ()=>setConnected(true));
    room.connect(session.livekitUrl, session.livekitToken).then(()=>room.startAudio().catch(()=>{})).catch(e=>setError(`Áudio indisponível: ${e.message}`));
    return ()=>{ room.removeAllListeners(); room.disconnect(); attached.current.forEach(el=>el.remove()); attached.current.clear(); roomRef.current=null; };
  }, [session?.livekitToken]);

  const login = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const data = await api('session', null, { role: profile, code }); setSession(data); setCode(''); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    setError('');
    try {
      await room.startAudio().catch(()=>{});
      await room.localParticipant.setMicrophoneEnabled(!micOn, { echoCancellation:true, noiseSuppression:true, autoGainControl:true });
      setMicOn(!micOn);
    } catch (e) { setError(`Não foi possível acessar o microfone. Confira a permissão do navegador e o KZ: ${e.message}`); }
  };
  const setRecipient = async (id, checked) => {
    const recipients = checked ? [...new Set([...state.routing,id])] : state.routing.filter(x=>x!==id);
    try { await api('routing',session.appToken,{recipients}); await refresh(); } catch(e) { setError(e.message); }
  };
  const grant = async (identity, allow) => {
    try { await api('permission',session.appToken,{identity,allow}); await refresh(); }
    catch(e) { setError(e.message); }
  };
  const requestSpeak = async () => { try { await api('requests',session.appToken,{}); await refresh(); } catch(e) { setError(e.message); } };
  const closeRequest = async (id) => { try { await api(`requests/${encodeURIComponent(id)}/close`,session.appToken,{}); await refresh(); } catch(e) { setError(e.message); } };

  if (!session) return <main className="login"><div className="brand">PWO <span>INTERCOM</span></div><section className="card login-card"><p className="eyebrow">EQUIPE DE TRANSMISSÃO</p><h1>Entrar na sala</h1><p className="muted">Acesso por perfil para comunicação privada.</p><form onSubmit={login}><label>Seu perfil<select value={profile} onChange={e=>setProfile(e.target.value)}>{profiles.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>Código de acesso<input value={code} onChange={e=>setCode(e.target.value)} type="password" autoComplete="current-password" required placeholder="Informe seu código"/></label><button className="primary full" disabled={busy}>{busy?'Conectando…':'Conectar'}</button></form>{error&&<p className="error">{error}</p>}<p className="hint">Use um código individual fornecido pela produção.</p></section><footer>Áudio privado da equipe • OBS não conectado</footer></main>;

  return <main className="app-shell"><header><div className="brand">PWO <span>INTERCOM</span></div><div className="user"><span className={`dot ${connected?'online':''}`}></span><b>{myName}</b><span className="connection">{connected?'Conectado':'Conectando…'}</span><button className="quiet" onClick={()=>{roomRef.current?.disconnect();setSession(null);setConnected(false);}}>Sair</button></div></header>
    <div className="eventbar"><div><p className="eyebrow">CANAL DE OPERAÇÃO</p><h1>Fórmula Truck <span>•</span> Intercom</h1></div><span className="secure">ÁUDIO PRIVADO</span></div>
    {error&&<div className="alert" role="alert">{error}<button onClick={()=>setError('')}>Fechar</button></div>}
    <section className="card status-card"><div><p className="eyebrow">SUA CONEXÃO</p><strong className={`state-line`}><span className={`dot ${connected?'online':''}`}></span>{connected?'Conectado ao intercom':'Estabelecendo conexão…'}</strong><p className="muted">Mantenha esta página aberta e o celular desbloqueado durante a cobertura.</p></div><div className="actions"><button disabled={!connected} className={micOn?'danger':'primary'} onClick={toggleMic}>{micOn?'Desligar microfone':'Ligar microfone'}</button>{!isDirector&&me!=='producer'&&<button className="secondary" onClick={requestSpeak}>Solicitar fala</button>}</div></section>
    {isDirector?<div className="grid"><section className="card"><div className="section-head"><div><p className="eyebrow">COMUNICAÇÃO</p><h2>Quem recebe sua voz</h2></div><span className="tag">Selecione um ou mais</span></div><div className="recipient-list">{people.map(p=><label className="recipient" key={p.id}><div><b>{p.label}</b><small>{roster.get(p.id)?.connected?'Online':'Aguardando conexão'}</small></div><input type="checkbox" checked={state.routing.includes(p.id)} onChange={e=>setRecipient(p.id,e.target.checked)}/></label>)}</div><p className="hint">A seleção limita pelo servidor quais celulares recebem o áudio do diretor.</p></section>
    <section className="card"><div className="section-head"><div><p className="eyebrow">AUTORIZAÇÃO</p><h2>Fala dos entrevistadores</h2></div><span className="tag">A direção controla</span></div><div className="recipient-list">{people.filter(p=>p.id!=='producer').map(p=>{const member=roster.get(p.id);return <div className="recipient" key={p.id}><div><b>{p.label}</b><small>{member?.connected?(member.canPublish?'Pode falar':'Somente escuta'):'Offline'}</small></div><button className={member?.canPublish?'danger small':'secondary small'} disabled={!member?.connected} onClick={()=>grant(p.id,!member?.canPublish)}>{member?.canPublish?'Encerrar fala':'Autorizar fala'}</button></div>})}</div><p className="hint">A permissão é aplicada pelo servidor LiveKit. Ao entrar, entrevistadores ficam sem permissão para publicar áudio.</p></section>
    <section className="card requests-card"><div className="section-head"><div><p className="eyebrow">PEDIDOS DA EQUIPE</p><h2>Solicitações de fala</h2></div></div>{state.requests.filter(r=>r.status==='pending').length===0?<p className="muted empty">Nenhuma solicitação pendente.</p>:state.requests.filter(r=>r.status==='pending').map(r=><div className="request" key={r.id}><div><b>{r.name}</b><small>Solicitou a palavra</small></div><div className="actions"><button className="primary small" onClick={()=>grant(r.identity,true)}>Autorizar</button><button className="quiet" onClick={()=>closeRequest(r.id)}>Dispensar</button></div></div>)}</section></div>
    :<div className="grid"><section className="card"><p className="eyebrow">ESTADO DA FALA</p><h2>{me==='producer'?'Canal da produção':roster.get(me)?.canPublish?'Você está autorizado a falar':'Aguardando autorização'}</h2><p className="muted">{me==='producer'?'O microfone da produção fica disponível para a direção.':roster.get(me)?.canPublish?'Ligue o microfone quando receber a deixa.':'O diretor libera seu microfone quando for sua vez.'}</p><div className={`permission ${roster.get(me)?.canPublish?'allowed':''}`}>{roster.get(me)?.canPublish?'MICROFONE DISPONÍVEL':'SOMENTE ESCUTA'}</div></section><section className="card"><p className="eyebrow">EQUIPE CONECTADA</p><h2>Participantes</h2>{profiles.map(p=><div className="roster-row" key={p.id}><span className={`dot ${roster.get(p.id)?.connected?'online':''}`}></span><span>{p.label}{p.id===me?' (você)':''}</span><small>{roster.get(p.id)?.connected?(roster.get(p.id)?.canPublish?'Autorizado':'Conectado'):'Offline'}</small></div>)}</section></div>}
    <footer>Canal de equipe separado do áudio do OBS • Retorno do programa e mix-minus: fase posterior</footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App/>);
