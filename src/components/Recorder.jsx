import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import AudioPlayer from './AudioPlayer.jsx';
import { useI18n } from '../i18n.js';
import { MAX_RECORDING_SEC } from '../config.js';
import { formatDuration } from '../lib/format.js';

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
export default function Recorder({ value, onChange }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState('idle'); // idle | requesting | recording
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const rec = useRef(null);
  const barsRef = useRef(null);

  const unsupported = typeof window.MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia;
  const insecure = !window.isSecureContext;

  useEffect(() => () => teardown(), []);

  function teardown() {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    cancelAnimationFrame(r.raf);
    r.stream?.getTracks().forEach((tr) => tr.stop());
    r.ctx?.close().catch(() => {});
    if (r.recorder && r.recorder.state !== 'inactive') {
      r.recorder.onstop = null;
      r.recorder.stop();
    }
    rec.current = null;
  }

  function clearValue() {
    if (value?.url) URL.revokeObjectURL(value.url);
    onChange(null);
  }

  async function start() {
    setError('');
    setNotice('');
    if (insecure) return setError(t('recInsecure'));
    if (unsupported) return setError(t('recUnsupported'));
    clearValue();
    setPhase('requesting');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      setPhase('idle');
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') setError(t('recDenied'));
      else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') setError(t('recNoMic'));
      else setError(t('recFailed'));
      return;
    }

    let recorder;
    try {
      const mimeType = pickMimeType();
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48000 });
    } catch {
      stream.getTracks().forEach((tr) => tr.stop());
      setPhase('idle');
      setError(t('recUnsupported'));
      return;
    }

    const chunks = [];
    const startedAt = performance.now();
    const state = { stream, recorder, chunks, startedAt, timer: 0, raf: 0, ctx: null };
    rec.current = state;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const seconds = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
      const mime = (recorder.mimeType || 'audio/webm').split(';')[0] || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      teardown();
      setPhase('idle');
      if (blob.size === 0) {
        setError(t('recFailed'));
        return;
      }
      onChange({ blob, url: URL.createObjectURL(blob), mime, ext: EXT[mime] || 'webm', duration: seconds });
    };

    // Live input level, drawn straight to the bar elements (no re-render per frame).
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      state.ctx = ctx;
      const buf = new Uint8Array(analyser.fftSize);
      const levels = new Array(BARS).fill(0);
      let last = 0;
      const tick = (now) => {
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
      const sec = (performance.now() - startedAt) / 1000;
      setElapsed(sec);
      if (sec >= MAX_RECORDING_SEC) {
        setNotice(t('recMaxReached'));
        stop();
      }
    }, 200);

    recorder.start(1000);
    setElapsed(0);
    setPhase('recording');
  }

  function stop() {
    const r = rec.current;
    if (r?.recorder && r.recorder.state !== 'inactive') r.recorder.stop();
  }

  if (phase === 'recording') {
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
        <button type="button" className="btn btn-danger btn-block" onClick={stop}>
          <Icon name="stop" size={18} /> {t('recStop')}
        </button>
      </div>
    );
  }

  if (value) {
    return (
      <div className="recorder has-take">
        <AudioPlayer src={value.url} duration={value.duration} />
        <div className="rec-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={start}>
            <Icon name="redo" size={16} /> {t('recRedo')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearValue}>
            <Icon name="trash" size={16} /> {t('recDelete')}
          </button>
        </div>
        {notice ? <p className="field-note">{notice}</p> : null}
      </div>
    );
  }

  return (
    <div className="recorder">
      <button type="button" className="rec-start" onClick={start} disabled={phase === 'requesting'}>
        <span className="rec-start-icon">
          {phase === 'requesting' ? <span className="spinner" aria-hidden="true" /> : <Icon name="mic" size={24} />}
        </span>
        <span className="rec-start-text">
          <strong>{t('recStart')}</strong>
          <span>{t('recHint')}</span>
        </span>
      </button>
      {error ? (
        <p className="field-error" role="alert">
          <Icon name="alert" size={16} /> {error}
        </p>
      ) : isInAppBrowser() ? (
        <p className="field-note">{t('recInApp')}</p>
      ) : null}
    </div>
  );
}
