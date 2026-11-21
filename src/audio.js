let context;
export function audioContext() {
  if (!context || context.state === 'closed') {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('Este navegador não oferece áudio compatível. Use Chrome, Edge ou Safari atualizado.');
    context = new Context();
  }
  return context;
}
export async function unlockAudio(room) {
  await audioContext().resume();
  if (room) await room.startAudio();
}
