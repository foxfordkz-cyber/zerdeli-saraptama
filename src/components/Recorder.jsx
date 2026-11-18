import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import AudioPlayer from './AudioPlayer.jsx';
import { useI18n } from '../i18n.js';
import { MAX_RECORDING_SEC } from '../config.js';
import { formatDuration } from '../lib/format.js';
import { acquireMediaStream, stopMediaStream } from '../lib/media-lifecycle.js';

const BARS = 28;
const CANDIDATE_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg' };

function pickMimeType() {
  if (typeof window.MediaRecorder === 'undefined') return null;
  return CANDIDATE_TYPES.find((type) => window.MediaRecorder.isTypeSupported?.(type)) || '';
}

function isInAppBrowser() {
  return /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/i.test(navigator.userAgent || '');
}

// Voice capture: record → listen → keep or redo. Emits
// { blob, url, mime, ext, duration } through onChange, or null when cleared.
export default function Recorder({ value, onChange, onBusyChange, disabled = false }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState('idle'); // idle | requesting | recording | stopping
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const rec = useRef(null);
  const barsRef = useRef(null);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const phaseRef = useRef('idle');
  const onChangeRef = useRef(onChange);
  const onBusyChangeRef = useRef(onBusyChange);
  onChangeRef.current = onChange;
  onBusyChangeRef.current = onBusyChange;

  const unsupported = typeof window.MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia;
  const insecure = !window.isSecureContext;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      teardown();
    };
  }, []);

  function changePhase(next) {
    phaseRef.current = next;
    onBusyChangeRef.current?.(next !== 'idle');
    setPhase(next);
  }

  function teardown() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    clearInterval(r.timer);
    cancelAnimationFrame(r.raf);
    if (r.recorder) {
      r.recorder.ondataavailable = null;
      r.recorder.onstop = null;
      r.recorder.onerror = null;
    }
    if (r.recorder && r.recorder.state !== 'inactive') {
      try { r.recorder.stop(); } catch { /* still release the microphone */ }
    }
    stopMediaStream(r.stream);
    r.ctx?.close().catch(() => {});
  }

  function clearValue() {
    if (disabled || phaseRef.current !== 'idle') return;
    onChangeRef.current(null);
  }

  async function start() {
    if (disabled || phaseRef.current !== 'idle') return;
    setError('');
    setNotice('');
    if (insecure) return setError('recInsecure');
    if (unsupported) return setError('recUnsupported');
    changePhase('requesting');
    const request = ++requestRef.current;
    const isCurrent = () => mountedRef.current && requestRef.current === request;

    let stream;
    try {
      stream = await acquireMediaStream(() => navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }), isCurrent);
      if (!stream) return;
    } catch (err) {
      if (!isCurrent()) return;
      changePhase('idle');
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') setError('recDenied');
      else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') setError('recNoMic');
      else setError('recFailed');
      return;
    }

    let recorder;
    try {
      const mimeType = pickMimeType();
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48000 });
    } catch {
      stopMediaStream(stream);
      changePhase('idle');
      setError('recUnsupported');
      return;
    }

    const chunks = [];
    const startedAt = performance.now();
    const state = { stream, recorder, chunks, startedAt, timer: 0, raf: 0, ctx: null };
    rec.current = state;

    recorder.ondataavailable = (e) => {
      if (isCurrent() && e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      if (!isCurrent() || rec.current !== state) return;
      const seconds = Math.min(MAX_RECORDING_SEC, Math.max(1, Math.round(((state.stoppedAt || performance.now()) - startedAt) / 1000)));
      const mime = (recorder.mimeType || 'audio/webm').split(';')[0] || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      teardown();
      changePhase('idle');
      if (blob.size === 0) {
        setError('recFailed');
        return;
      }
      onChangeRef.current({ blob, url: URL.createObjectURL(blob), mime, ext: EXT[mime] || 'webm', duration: seconds });
    };
    recorder.onerror = () => {
      if (!isCurrent() || rec.current !== state) return;
      teardown();
      changePhase('idle');
      setError('recFailed');
    };

    // Live input level, drawn straight to the bar elements (no re-render per frame).
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      state.ctx = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const levels = new Array(BARS).fill(0);
      let last = 0;
      const tick = (now) => {
        if (!isCurrent() || rec.current !== state) return;
        if (now - last > 70) {
          last = now;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i += 1) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.min(1, Math.sqrt(sum / buf.length) * 4);
          levels.shift();
          levels.push(rms);
          const nodes = barsRef.current?.children;
          if (nodes) for (let i = 0; i < nodes.length; i += 1) nodes[i].style.transform = `scaleY(${0.12 + levels[i] * 0.88})`;
        }
        state.raf = requestAnimationFrame(tick);
      };
      state.raf = requestAnimationFrame(tick);
    } catch {
      /* the meter is optional */
    }

    state.timer = setInterval(() => {
      if (!isCurrent() || phaseRef.current !== 'recording') return;
      const sec = (performance.now() - startedAt) / 1000;
      setElapsed(sec);
      if (sec >= MAX_RECORDING_SEC) {
        setNotice('recMaxReached');
        stop();
      }
    }, 200);

    try {
      recorder.start(1000);
    } catch {
      teardown();
      changePhase('idle');
      setError('recFailed');
      return;
    }
    // Keep the previous take if requesting permission or starting fails.
    onChangeRef.current(null);
    setElapsed(0);
    changePhase('recording');
  }

  function stop() {
    const r = rec.current;
    if (!r?.recorder || phaseRef.current !== 'recording') return;
    r.stoppedAt = performance.now();
    clearInterval(r.timer);
    changePhase('stopping');
    try {
      if (r.recorder.state !== 'inactive') r.recorder.stop();
    } catch {
      teardown();
      changePhase('idle');
      setError('recFailed');
    } finally {
      stopMediaStream(r.stream);
    }
  }

  function cancelRequest() {
    requestRef.current += 1;
    changePhase('idle');
  }

  if (phase === 'requesting') {
    return (
      <div className="recorder" role="group" aria-label={t('feedbackMicRequest')}>
        <p className="field-note" role="status"><span className="spinner" aria-hidden="true" /> {t('feedbackMicRequest')}</p>
        <button type="button" className="btn btn-secondary btn-block" onClick={cancelRequest}>{t('cancel')}</button>
      </div>
    );
  }

  if (phase === 'recording' || phase === 'stopping') {
    return (
      <div className="recorder is-recording" role="group" aria-label={t('recRecording')}>
        <div className="rec-live">
          <span className="rec-dot" aria-hidden="true" />
          <span className="rec-label">{t('recRecording')}</span>
          <span className="rec-time">
            {formatDuration(elapsed)} <span className="rec-max">/ {formatDuration(MAX_RECORDING_SEC)}</span>
          </span>
        </div>
        <div className="rec-meter" ref={barsRef} aria-hidden="true">
          {Array.from({ length: BARS }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <button type="button" className="btn btn-danger btn-block" onClick={stop} disabled={phase === 'stopping'}>
          <Icon name="stop" size={18} /> {t(phase === 'stopping' ? 'feedbackSavingRecording' : 'recStop')}
        </button>
      </div>
    );
  }

  if (value) {
    return (
      <div className="recorder has-take">
        <AudioPlayer src={value.url} duration={value.duration} />
        <div className="rec-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={start} disabled={disabled}>
            <Icon name="redo" size={16} /> {t('recRedo')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearValue} disabled={disabled}>
            <Icon name="trash" size={16} /> {t('recDelete')}
          </button>
        </div>
        {notice ? <p className="field-note">{t(notice)}</p> : null}
        {error ? <p className="field-error" role="alert">{t(error)}</p> : null}
      </div>
    );
  }

  return (
    <div className="recorder">
      <button type="button" className="rec-start" onClick={start} disabled={disabled}>
        <span className="rec-start-icon">
          <Icon name="mic" size={24} />
        </span>
        <span className="rec-start-text">
          <strong>{t('recStart')}</strong>
          <span>{t('recHint')}</span>
        </span>
      </button>
      {error ? (
        <p className="field-error" role="alert">
          <Icon name="alert" size={16} /> {t(error)}
        </p>
      ) : isInAppBrowser() ? (
        <p className="field-note">{t('recInApp')}</p>
      ) : null}
    </div>
  );
}
