export const PROGRAM_TRACK = 'pwo-program-audio';
export const PROGRAM_VIDEO = 'pwo-program-video';
export const people = [
  { id: 'interviewer1', label: 'Otávio', detail: 'Entrevistador 1' },
  { id: 'interviewer2', label: 'João', detail: 'Entrevistador 2' },
  { id: 'producer', label: 'Produção', detail: 'Apoio à direção' },
];
export const profiles = [
  { id: 'director', label: 'Diretor', detail: 'Sua máquina · comunicação' },
  ...people,
  { id: 'obs', label: 'Estação OBS', detail: 'Outra máquina · envio do retorno' },
];
export const audience = people.map(p => p.id);
export const returnAudience = ['director', ...audience];
export const interviewers = ['interviewer1', 'interviewer2'];

// OBS never receives team audio. Unknown roles/tracks fail closed.
export function desiredTracks(participants, recipient, routing, returnRouting, videoRouting = []) {
  if (!returnAudience.includes(recipient)) return [];
  return participants.flatMap(p => (p.tracks || []).filter(t => {
    if (p.identity === recipient || !t.sid) return false;
    const isVideo = t.type === 1 || String(t.type).toLowerCase() === 'video';
    if (isVideo) return p.identity === 'obs' && t.name === PROGRAM_VIDEO && videoRouting.includes(recipient);
    if (!(t.type === 0 || String(t.type).toLowerCase() === 'audio')) return false;
    if (p.identity === 'obs') return t.name === PROGRAM_TRACK && returnRouting.includes(recipient);
    if (t.name === PROGRAM_TRACK) return false;
    if (p.identity === 'director') return routing.includes(recipient);
    if (p.identity === 'producer') return recipient === 'director';
    if (interviewers.includes(p.identity)) return recipient === 'director' || interviewers.includes(recipient);
    return false;
  }).map(t => t.sid));
}
export function createSubscriptionReconciler(service, room) {
  const applied = new Map();
  let tail = Promise.resolve();
  return (routing, returnRouting, videoRouting = []) => {
    const task = tail.catch(() => {}).then(async () => {
      const participants = await service.listParticipants(room);
      const active = new Set(participants.map(p => p.sid || p.identity));
      for (const key of applied.keys()) if (!active.has(key)) applied.delete(key);
      for (const p of participants) {
        const key = p.sid || p.identity;
        const desired = new Set(desiredTracks(participants, p.identity, routing, returnRouting, videoRouting));
        const previous = applied.get(key) || new Set();
        const remove = [...previous].filter(sid => !desired.has(sid));
        const add = [...desired].filter(sid => !previous.has(sid));
        if (remove.length) await service.updateSubscriptions(room, p.identity, remove, false);
        if (add.length) await service.updateSubscriptions(room, p.identity, add, true);
        applied.set(key, desired);
      }
      return participants;
    });
    tail = task;
    return task;
  };
}
