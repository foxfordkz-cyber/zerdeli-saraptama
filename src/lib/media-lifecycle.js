export function stopMediaStream(stream) {
  for (const track of stream?.getTracks() || []) {
    try { track.stop(); } catch { /* release the other tracks too */ }
  }
}

// getUserMedia cannot be aborted. Discard and stop a late permission result
// before constructing a recorder if its component/request is no longer active.
export async function acquireMediaStream(request, isCurrent) {
  const stream = await request();
  if (isCurrent()) return stream;
  stopMediaStream(stream);
  return null;
}

export function disposeAudioElement(audio) {
  if (!audio) return;
  for (const event of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'error']) audio[`on${event}`] = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}
