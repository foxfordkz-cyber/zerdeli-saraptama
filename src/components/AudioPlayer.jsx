import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useI18n } from '../i18n.js';
import { formatDuration } from '../lib/format.js';
import { disposeAudioElement } from '../lib/media-lifecycle.js';

const RATES = [1, 1.5, 2];
const PLAY_EVENT = 'zerdeli:audio-play';

// Plays one recording. `duration` comes from our own metadata because
// MediaRecorder WebM files often report an unknown (Infinity) duration.
export default function AudioPlayer({ src, loadSrc, duration, showRate = false }) {
  const { t } = useI18n();
  const audioRef = useRef(null);
  const idRef = useRef(Math.random().toString(36).slice(2));
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const pendingRef = useRef(null);
  const togglingRef = useRef(false);
  const playIntentRef = useRef(0);
  const ownedUrlRef = useRef(null);
  const rateRef = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [rate, setRate] = useState(1);

  // A new source (e.g. a fresh recording) replaces the old element.
  useEffect(() => {
    mountedRef.current = true;
    setPlaying(false);
    setCurrent(0);
    setMediaDuration(0);
    setError(false);
    setLoading(false);
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      playIntentRef.current += 1;
      pendingRef.current = null;
      togglingRef.current = false;
      disposeAudioElement(audioRef.current);
      audioRef.current = null;
      if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
      ownedUrlRef.current = null;
    };
  }, [src, loadSrc]);

  // Only one recording plays at a time across the page.
  useEffect(() => {
    const onOther = (e) => {
      if (e.detail !== idRef.current) {
        playIntentRef.current += 1;
        audioRef.current?.pause();
      }
    };
    window.addEventListener(PLAY_EVENT, onOther);
    return () => window.removeEventListener(PLAY_EVENT, onOther);
  }, []);

  const total = mediaDuration > 0 ? mediaDuration : duration || 0;

  function isCurrent(generation) {
    return mountedRef.current && generationRef.current === generation;
  }

  async function ensureAudio() {
    if (audioRef.current) return audioRef.current;
    if (pendingRef.current) return pendingRef.current;
    const generation = generationRef.current;
    setLoading(true);
    const pending = (async () => {
      const url = src || await loadSrc?.();
      const ownedUrl = !src && typeof url === 'string' && url.startsWith('blob:') ? url : null;
      if (!isCurrent(generation)) {
        if (ownedUrl) URL.revokeObjectURL(ownedUrl);
        return null;
      }
      if (typeof url !== 'string' || !url) throw new Error('Missing audio URL');
      ownedUrlRef.current = ownedUrl;
      const a = new Audio(url);
      a.preload = 'auto';
      a.playbackRate = rateRef.current;
      const active = () => isCurrent(generation) && audioRef.current === a;
      a.ontimeupdate = () => { if (active()) setCurrent(a.currentTime); };
      a.onplay = () => { if (active()) setPlaying(true); };
      a.onpause = () => { if (active()) setPlaying(false); };
      a.onended = () => {
        if (!active()) return;
        setPlaying(false);
        setCurrent(0);
      };
      a.onloadedmetadata = () => {
        if (active() && Number.isFinite(a.duration) && a.duration > 0) setMediaDuration(a.duration);
      };
      a.onerror = () => {
        if (!active()) return;
        setError(true);
        setPlaying(false);
        // A retry must obtain a fresh signed URL after a network/media error.
        audioRef.current = null;
        disposeAudioElement(a);
        if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
        ownedUrlRef.current = null;
      };
      audioRef.current = a;
      return a;
    })();
    pendingRef.current = pending;
    try {
      return await pending;
    } finally {
      if (pendingRef.current === pending) pendingRef.current = null;
      if (isCurrent(generation)) setLoading(false);
    }
  }

  async function toggle() {
    if (togglingRef.current) return;
    togglingRef.current = true;
    const generation = generationRef.current;
    const intent = ++playIntentRef.current;
    // Claim playback when clicked, so a slow earlier URL cannot cancel a
    // newer request in another player when it eventually finishes loading.
    if (!audioRef.current || audioRef.current.paused) {
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: idRef.current }));
    }
    setError(false);
    try {
      const a = await ensureAudio();
      if (!a || audioRef.current !== a || !isCurrent(generation) || playIntentRef.current !== intent) return;
      if (a.paused) {
        await a.play();
        if (!isCurrent(generation) || playIntentRef.current !== intent) a.pause();
      } else {
        a.pause();
      }
    } catch {
      if (!isCurrent(generation)) return;
      setError(true);
      setLoading(false);
    } finally {
      if (isCurrent(generation)) togglingRef.current = false;
    }
  }

  async function seek(e) {
    const value = Number(e.target.value);
    const generation = generationRef.current;
    setCurrent(value);
    try {
      const a = await ensureAudio();
      if (a && audioRef.current === a && isCurrent(generation)) a.currentTime = value;
    } catch {
      if (isCurrent(generation)) setError(true);
    }
  }

  function cycleRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    rateRef.current = next;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  const progress = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <div className={`player${playing ? ' is-playing' : ''}`}>
      <button
        type="button"
        className="player-btn"
        onClick={toggle}
        aria-label={playing ? t('pause') : t('play')}
        disabled={loading}
      >
        {loading ? <span className="spinner" aria-hidden="true" /> : <Icon name={playing ? 'pause' : 'play'} size={18} />}
      </button>
      <div className="player-track">
        <input
          type="range"
          min="0"
          max={total || 1}
          step="0.1"
          value={Math.min(current, total || 1)}
          onChange={seek}
          style={{ '--p': `${progress}%` }}
          aria-label={t('audioPosition')}
          aria-valuetext={`${formatDuration(current)} / ${formatDuration(total)}`}
        />
        <div className="player-time">
          {error ? (
            <span className="player-error">{t('audioError')}</span>
          ) : (
            <span>
              {formatDuration(current)} / {formatDuration(total)}
            </span>
          )}
        </div>
      </div>
      {showRate ? (
        <button type="button" className="player-rate" onClick={cycleRate} aria-label={`${t('speed')}: ${rate}×`}>
          {rate}×
        </button>
      ) : null}
    </div>
  );
}
