import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Room, RoomEvent, Track } from 'livekit-client';
import { OBSWebSocket } from 'obs-websocket-js';
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

function VideoTile({ track, name, muted=false }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (!videoRef.current || !track) return;
    track.attach(videoRef.current);
    return () => { track.detach(videoRef.current); };
  }, [track]);
  return <div className="video-tile"><video ref={videoRef} autoPlay playsInline muted={muted}/><span>{name}</span></div>;
}

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState('director');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [state, setState] = useState({ routing: people.map(p=>p.id), videoRouting: people.map(p=>p.id), requests: [], participants: [] });
  const [directorTab, setDirectorTab] = useState('general');
  const [volumeValues, setVolumeValues] = useState({ interviewer1:1, interviewer2:1, producer:1 });
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState('');
  const [videoOn, setVideoOn] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [remoteVideoTracks, setRemoteVideoTracks] = useState([]);
  const [obsState, setObsState] = useState({ status:'disconnected', address:'ws://127.0.0.1:4455', password:'', scenes:[], programScene:'', streaming:false, recording:false, studioMode:false, error:'' });
  const roomRef = useRef(null);
  const obsRef = useRef(null);
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
      if (participant.identity === me) return;
      if (track.kind === Track.Kind.Video) {
        setRemoteVideoTracks(items => [...items.filter(item => item.track !== track), { identity:participant.identity, name:participant.name, track }]);
        return;
      }
      if (track.kind !== Track.Kind.Audio) return;
      const audio = track.attach(); audio.autoplay = true; audio.playsInline = true;
      audio.dataset.identity = participant.identity;
      audio.volume = volumeValues[participant.identity] ?? 1;
      document.body.appendChild(audio); attached.current.add(audio);
    };
    const onUntrack = (track) => {
      track.detach().forEach(el=>{ attached.current.delete(el); el.remove(); });
      if (track.kind === Track.Kind.Video) setRemoteVideoTracks(items => items.filter(item => item.track !== track));
    };
    room.on(RoomEvent.TrackSubscribed, onTrack);
    room.on(RoomEvent.TrackUnsubscribed, onUntrack);
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
  useEffect(() => {
    attached.current.forEach(el => { el.volume = volumeValues[el.dataset.identity] ?? 1; });
  }, [volumeValues]);
  const loadVideoDevices = async () => {
    setVideoBusy(true); setError('');
    let permissionStream;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
      permissionStream.getTracks().forEach(track => track.stop());
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      setVideoDevices(devices);
      const obsVirtualCamera = devices.find(device => /obs.*virtual|virtual.*obs/i.test(device.label));
      if (!devices.some(device => device.deviceId === selectedVideoDevice)) {
        setSelectedVideoDevice(obsVirtualCamera?.deviceId || devices[0]?.deviceId || '');
      }
      if (!devices.length) setError('Nenhuma fonte de vídeo foi encontrada. No OBS, clique em Iniciar Câmera Virtual e tente novamente.');
      else if (!obsVirtualCamera) setError('Não encontrei a OBS Virtual Camera. No OBS, clique em Iniciar Câmera Virtual, depois busque as fontes novamente.');
    } catch(e) {
      setError('Não foi possível listar as fontes de vídeo. Autorize a câmera no navegador e tente novamente: ' + e.message);
    } finally {
      permissionStream?.getTracks().forEach(track => track.stop());
      setVideoBusy(false);
    }
  };
  const toggleReturnVideo = async () => {
    const room = roomRef.current;
    if (!room || !connected) return;
    setVideoBusy(true); setError('');
    try {
      if (videoOn) {
        await room.localParticipant.setCameraEnabled(false);
        setVideoOn(false); setLocalVideoTrack(null);
      } else {
        if (!selectedVideoDevice) throw new Error('Clique em Buscar fontes e escolha OBS Virtual Camera.');
        const publication = await room.localParticipant.setCameraEnabled(true, {
          deviceId:selectedVideoDevice,
          resolution:{ width:640, height:360 },
          frameRate:15,
        });
        setLocalVideoTrack(publication?.track || null);
        setVideoOn(true);
      }
    } catch(e) {
      setError('Não foi possível iniciar o retorno de vídeo: ' + e.message);
    } finally { setVideoBusy(false); }
  };
  const setVideoRecipient = async (id, checked) => {
    const recipients = checked ? [...new Set([...(state.videoRouting || people.map(p=>p.id)),id])] : (state.videoRouting || []).filter(x=>x!==id);
    try { await api('video-routing',session.appToken,{recipients}); await refresh(); } catch(e) { setError(e.message); }
  };
  const setReturnVolume = (id, value) => setVolumeValues(previous => ({...previous,[id]:Number(value)/100}));
  const volumeControls = (compact=false) => <div className={'volume-list' + (compact?' compact':'')}>{people.map(person=><label className="volume-row" key={person.id}><span><b>{person.label}</b><small>{Math.round((volumeValues[person.id] ?? 1)*100)}%</small></span><input type="range" min="0" max="100" value={Math.round((volumeValues[person.id] ?? 1)*100)} onChange={event=>setReturnVolume(person.id,event.target.value)} aria-label={'Volume de ' + person.label}/></label>)}</div>;

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
  const disconnectObs = () => { obsRef.current?.disconnect(); obsRef.current=null; setObsState(s=>({...s,status:'disconnected',password:'',scenes:[],programScene:'',streaming:false,recording:false,studioMode:false})); };
  const connectObs = async (event) => {
    event.preventDefault();
    setObsState(s=>({...s,status:'connecting',error:''}));
    const obs = new OBSWebSocket();
    obsRef.current=obs;
    obs.on('ConnectionClosed',()=>{ if(obsRef.current===obs){obsRef.current=null;setObsState(s=>({...s,status:'disconnected',password:'',scenes:[],programScene:'',streaming:false,recording:false,studioMode:false}));} });
    try {
      await obs.connect(obsState.address.trim() || 'ws://127.0.0.1:4455',obsState.password || undefined);
      const [sceneData,streamData,recordData,studioData]=await Promise.all([obs.call('GetSceneList'),obs.call('GetStreamStatus'),obs.call('GetRecordStatus'),obs.call('GetStudioModeEnabled')]);
      if(obsRef.current!==obs) return;
      setObsState(s=>({...s,status:'connected',password:'',scenes:sceneData.scenes||[],programScene:sceneData.currentProgramSceneName||'',streaming:!!streamData.outputActive,recording:!!recordData.outputActive,studioMode:!!studioData.studioModeEnabled,error:''}));
    } catch(e) {
      if(obsRef.current===obs) { obsRef.current=null; obs.disconnect(); setObsState(s=>({...s,status:'disconnected',password:'',error:`Não foi possível conectar ao OBS: ${e.message}`})); }
    }
  };
  const obsCall = async (requestType, requestData={}) => {
    if(!obsRef.current) return;
    try { return await obsRef.current.call(requestType,requestData); }
    catch(e) { setObsState(s=>({...s,error:`O OBS recusou o comando: ${e.message}`})); return null; }
  };
  useEffect(()=>{
    const obs=obsRef.current;
    if(!obs) return;
    const scene=e=>setObsState(s=>({...s,programScene:e.sceneName}));
    const stream=e=>setObsState(s=>({...s,streaming:e.outputActive}));
    const record=e=>setObsState(s=>({...s,recording:e.outputActive}));
    obs.on('CurrentProgramSceneChanged',scene); obs.on('StreamStateChanged',stream); obs.on('RecordStateChanged',record);
    return ()=>{obs.off('CurrentProgramSceneChanged',scene);obs.off('StreamStateChanged',stream);obs.off('RecordStateChanged',record);};
  },[obsState.status]);
  useEffect(()=>()=>{obsRef.current?.disconnect();},[]);


  if (!session) return <main className="login"><div className="brand"><img className="brand-mark" src="/logo-pwo.png" alt="Pod PWO Podcast" /> PWO <span>INTERCOM</span></div><section className="card login-card"><p className="eyebrow">EQUIPE DE TRANSMISSÃO</p><h1>Entrar na sala</h1><p className="muted">Acesso por perfil para comunicação privada.</p><form onSubmit={login}><label>Seu perfil<select value={profile} onChange={e=>setProfile(e.target.value)}>{profiles.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>Código de acesso<input value={code} onChange={e=>setCode(e.target.value)} type="password" autoComplete="current-password" required placeholder="Informe seu código"/></label><button className="primary full" disabled={busy}>{busy?'Conectando…':'Conectar'}</button></form>{error&&<p className="error">{error}</p>}<p className="hint">Use um código individual fornecido pela produção.</p></section><footer>Áudio privado da equipe • OBS não conectado</footer></main>;

  const obsPanel = <section className="card obs-card"><div className="section-head"><div><p className="eyebrow">CONTROLE DA TRANSMISSÃO</p><h2>OBS Studio</h2></div><span className={'tag ' + (obsState.status==='connected'?'obs-online':'')}><span className={'dot ' + (obsState.status==='connected'?'online':'')}></span> {obsState.status==='connected'?'CONECTADO':obsState.status==='connecting'?'CONECTANDO…':'DESCONECTADO'}</span></div>
    {obsState.status!=='connected'?<form className="obs-connect" onSubmit={connectObs}><label>Endereço do OBS<input value={obsState.address} onChange={e=>setObsState(s=>({...s,address:e.target.value}))} placeholder="ws://127.0.0.1:4455" autoComplete="url"/></label><label>Senha do WebSocket<input type="password" value={obsState.password} onChange={e=>setObsState(s=>({...s,password:e.target.value}))} autoComplete="new-password" placeholder="Senha configurada no OBS"/></label><button className="primary" disabled={obsState.status==='connecting'}>{obsState.status==='connecting'?'Conectando…':'Conectar ao OBS'}</button></form>:<><div className="obs-status-grid"><div><small>TRANSMISSÃO</small><b className={obsState.streaming?'obs-active':''}>{obsState.streaming?'AO VIVO':'PARADA'}</b></div><div><small>GRAVAÇÃO</small><b className={obsState.recording?'obs-active':''}>{obsState.recording?'GRAVANDO':'PARADA'}</b></div><div><small>CENA NO AR</small><b>{obsState.programScene||'—'}</b></div><div><small>MODO ESTÚDIO</small><b>{obsState.studioMode?'ATIVADO':'DESATIVADO'}</b></div></div><div className="obs-controls"><label>Trocar cena no ar<select value={obsState.programScene} onChange={async e=>{await obsCall('SetCurrentProgramScene',{sceneName:e.target.value});setObsState(s=>({...s,programScene:e.target.value}));}}>{obsState.scenes.map(x=><option key={x.sceneUuid||x.sceneName} value={x.sceneName}>{x.sceneName}</option>)}</select></label><div className="actions"><button className={obsState.streaming?'danger small':'secondary small'} onClick={async()=>{if(!window.confirm(obsState.streaming?'Parar a transmissão ao vivo no OBS?':'Iniciar a transmissão ao vivo no OBS?'))return;const r=await obsCall(obsState.streaming?'StopStream':'StartStream');if(r!==null){const d=await obsCall('GetStreamStatus');if(d)setObsState(s=>({...s,streaming:!!d.outputActive}));}}}>{obsState.streaming?'Encerrar live':'Iniciar live'}</button><button className={obsState.recording?'danger small':'secondary small'} onClick={async()=>{if(!window.confirm(obsState.recording?'Parar a gravação no OBS?':'Iniciar gravação no OBS?'))return;const r=await obsCall(obsState.recording?'StopRecord':'StartRecord');if(r!==null){const d=await obsCall('GetRecordStatus');if(d)setObsState(s=>({...s,recording:!!d.outputActive}));}}}>{obsState.recording?'Parar gravação':'Gravar'}</button><button className="quiet" onClick={disconnectObs}>Desconectar</button></div></div></>}
    {obsState.error&&<p className="error">{obsState.error}</p>}<p className="hint">Conexão local com o OBS. A senha fica nesta sessão do navegador. Para retorno de vídeo, inicie no OBS a Câmera Virtual com saída Programa.</p>
  </section>;

  const talkPanel = <><section className="card"><div className="section-head"><div><p className="eyebrow">AUTORIZAÇÃO</p><h2>Fala dos entrevistadores</h2></div><span className="tag">A direção controla</span></div><div className="recipient-list">{people.filter(p=>p.id!=='producer').map(p=>{const member=roster.get(p.id);return <div className="recipient" key={p.id}><div><b>{p.label}</b><small>{member?.connected?(member.canPublish?'Pode falar':'Somente escuta'):'Offline'}</small></div><button className={member?.canPublish?'danger small':'secondary small'} disabled={!member?.connected} onClick={()=>grant(p.id,!member?.canPublish)}>{member?.canPublish?'Encerrar fala':'Autorizar fala'}</button></div>})}</div><p className="hint">O entrevistador fica no modo escuta até receber autorização.</p></section><section className="card"><div className="section-head"><div><p className="eyebrow">PEDIDOS DA EQUIPE</p><h2>Solicitações de fala</h2></div></div>{state.requests.filter(r=>r.status==='pending').length===0?<p className="muted empty">Nenhuma solicitação pendente.</p>:state.requests.filter(r=>r.status==='pending').map(r=><div className="request" key={r.id}><div><b>{r.name}</b><small>Solicitou a palavra</small></div><div className="actions"><button className="primary small" onClick={()=>grant(r.identity,true)}>Autorizar</button><button className="quiet" onClick={()=>closeRequest(r.id)}>Dispensar</button></div></div>)}</section></>;

  return <main className="app-shell"><header><div className="brand"><img className="brand-mark" src="/logo-pwo.png" alt="Pod PWO Podcast" /> PWO <span>INTERCOM</span></div><div className="user"><span className={'dot ' + (connected?'online':'')}></span><b>{myName}</b><span className="connection">{connected?'Conectado':'Conectando…'}</span><button className="quiet" onClick={()=>{roomRef.current?.disconnect();setSession(null);setConnected(false);}}>Sair</button></div></header>
    <div className="eventbar"><div><p className="eyebrow">CANAL DE OPERAÇÃO</p><h1>Fórmula Truck <span>•</span> Intercom</h1></div><span className="secure">ÁUDIO PRIVADO</span></div>
    {error&&<div className="alert" role="alert">{error}<button onClick={()=>setError('')}>Fechar</button></div>}
    <section className="card status-card"><div><p className="eyebrow">SUA CONEXÃO</p><strong className="state-line"><span className={'dot ' + (connected?'online':'')}></span>{connected?'Conectado ao intercom':'Estabelecendo conexão…'}</strong><p className="muted">Mantenha esta página aberta e o celular desbloqueado durante a cobertura.</p></div><div className="actions"><button disabled={!connected} className={micOn?'danger':'primary'} onClick={toggleMic}>{micOn?'Desligar microfone':'Ligar microfone'}</button>{!isDirector&&me!=='producer'&&<button className="secondary" onClick={requestSpeak}>Solicitar fala</button>}</div></section>
    {isDirector?<div className="director-workspace"><nav className="director-sidebar" aria-label="Painel do Diretor"><p className="eyebrow">DIREÇÃO</p><button className={directorTab==='general'?'active':''} onClick={()=>setDirectorTab('general')}>Geral</button><button className={directorTab==='obs'?'active':''} onClick={()=>setDirectorTab('obs')}>OBS Studio</button><button className={directorTab==='volumes'?'active':''} onClick={()=>setDirectorTab('volumes')}>Volumes de retorno</button><button className={directorTab==='talk'?'active':''} onClick={()=>setDirectorTab('talk')}>Fala</button></nav><div className="director-panel">
      {directorTab==='general'&&<><section className="card"><div className="section-head"><div><p className="eyebrow">VOZ DO DIRETOR</p><h2>Quem recebe sua fala</h2></div><span className="tag">Canal privado</span></div><div className="recipient-list">{people.map(p=><label className="recipient" key={p.id}><div><b>{p.label}</b><small>{roster.get(p.id)?.connected?'Online':'Aguardando conexão'}</small></div><input type="checkbox" checked={state.routing.includes(p.id)} onChange={e=>setRecipient(p.id,e.target.checked)}/></label>)}</div><p className="hint">Escolha os celulares que recebem a voz do Diretor.</p><div className="director-mic"><span>Microfone do Diretor</span><button disabled={!connected} className={micOn?'danger small':'primary small'} onClick={toggleMic}>{micOn?'Desligar microfone':'Ligar microfone'}</button></div></section>
      <section className="card"><div className="section-head"><div><p className="eyebrow">RETORNO VISUAL</p><h2>Vídeo do OBS para a equipe</h2></div><span className={'tag ' + (videoOn?'obs-online':'')}>{videoOn?'ENVIANDO':'DESLIGADO'}</span></div><p className="muted">No OBS, inicie a Câmera Virtual e escolha a saída Programa. O retorno envia somente imagem.</p><div className="video-controls"><button className="secondary small" onClick={loadVideoDevices} disabled={videoBusy}>{videoBusy?'Buscando…':'Buscar fontes de vídeo'}</button><label>Fonte<select value={selectedVideoDevice} onChange={e=>setSelectedVideoDevice(e.target.value)} disabled={!videoDevices.length||videoOn}>{videoDevices.map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||('Câmera ' + (i+1))}</option>)}</select></label><button disabled={!connected||videoBusy||!selectedVideoDevice} className={videoOn?'danger':'primary'} onClick={toggleReturnVideo}>{videoBusy?'Aguarde…':videoOn?'Parar retorno de vídeo':'Iniciar retorno de vídeo'}</button></div>{videoOn&&localVideoTrack&&<div className="video-preview"><VideoTile track={localVideoTrack} name="Prévia local do OBS" muted/></div>}<div className="recipient-list video-recipients">{people.map(p=><label className="recipient" key={p.id}><div><b>{p.label}</b><small>{roster.get(p.id)?.connected?'Receber vídeo':'Offline'}</small></div><input type="checkbox" checked={(state.videoRouting||[]).includes(p.id)} onChange={e=>setVideoRecipient(p.id,e.target.checked)}/></label>)}</div><p className="hint">Selecione quem recebe a imagem. A senha e o áudio do intercom não são enviados no retorno de vídeo.</p></section><section className="card"><div className="section-head"><div><p className="eyebrow">VOLUME RÁPIDO</p><h2>Retorno da equipe</h2></div><button className="quiet" onClick={()=>setDirectorTab('volumes')}>Abrir ajustes</button></div>{volumeControls(true)}</section></>}
      {directorTab==='obs'&&obsPanel}
      {directorTab==='volumes'&&<section className="card"><p className="eyebrow">MONITOR DE ÁUDIO</p><h2>Volume por pessoa</h2><p className="muted">Estes níveis ajustam somente o que você ouve no computador do Diretor.</p>{volumeControls()}<button className="secondary small" onClick={()=>setVolumeValues({interviewer1:1,interviewer2:1,producer:1})}>Restaurar volumes</button></section>}
      {directorTab==='talk'&&talkPanel}
    </div></div>
    :<div className="grid"><section className="card"><p className="eyebrow">ESTADO DA FALA</p><h2>{me==='producer'?'Canal da produção':roster.get(me)?.canPublish?'Você está autorizado a falar':'Aguardando autorização'}</h2><p className="muted">{me==='producer'?'O microfone da produção fica disponível para a direção.':roster.get(me)?.canPublish?'Ligue o microfone quando receber a deixa.':'O Diretor libera seu microfone quando for sua vez.'}</p><div className={'permission ' + (roster.get(me)?.canPublish?'allowed':'')}>{roster.get(me)?.canPublish?'MICROFONE DISPONÍVEL':'SOMENTE ESCUTA'}</div></section><section className="card"><p className="eyebrow">RETORNO DO PROGRAMA</p><h2>Vídeo da transmissão</h2>{remoteVideoTracks.length?remoteVideoTracks.map(item=><VideoTile key={item.track.sid} track={item.track} name="Programa OBS"/>):<p className="muted">Aguardando o Diretor iniciar o retorno de vídeo.</p>}</section><section className="card"><p className="eyebrow">EQUIPE CONECTADA</p><h2>Participantes</h2>{profiles.map(p=><div className="roster-row" key={p.id}><span className={'dot ' + (roster.get(p.id)?.connected?'online':'')}></span><span>{p.label}{p.id===me?' (você)':''}</span><small>{roster.get(p.id)?.connected?(roster.get(p.id)?.canPublish?'Autorizado':'Conectado'):'Offline'}</small></div>)}</section></div>}
    <footer>Intercom e retorno de vídeo são canais separados do áudio transmitido no OBS.</footer>
  </main>;

}

createRoot(document.getElementById('root')).render(<App/>);
