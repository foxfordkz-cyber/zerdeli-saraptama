import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useI18n } from '../i18n.js';
import { formatDuration } from '../lib/format.js';

const RATES = [1, 1.5, 2];
const PLAY_EVENT = 'zerdeli:audio-play';

// Plays one recording. `duration` comes from our own metadata because
// MediaRecorder WebM files often report an unknown (Infinity) duration.
export default function AudioPlayer({ src, loadSrc, duration, showRate = false }) {
  const { t } = useI18n();
  const audioRef = useRef(null);
  const idRef = useRef(Math.random().toString(36).slice(2));
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [rate, setRate] = useState(1);

  // A new source (e.g. a fresh recording) replaces the old element.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(false);
      setCurrent(0);
      setMediaDuration(0);
      setError(false);
    };
  }, [src]);

  // Only one recording plays at a time across the page.
  useEffect(() => {
    const onOther = (e) => {
      if (e.detail !== idRef.current) audioRef.current?.pause();
    };
    window.addEventListener(PLAY_EVENT, onOther);
    return () => window.removeEventListener(PLAY_EVENT, onOther);
  }, []);

  const total = mediaDuration > 0 ? mediaDuration : duration || 0;

  async function ensureAudio() {
    if (audioRef.current) return audioRef.current;
    let url = src;
    if (!url && loadSrc) {
      setLoading(true);
      try {
        url = await loadSrc();
      } finally {
        setLoading(false);
      }
    }
    const a = new Audio(url);
    a.preload = 'auto';
    a.playbackRate = rate;
    a.addEventListener('timeupdate', () => setCurrent(a.currentTime));
    a.addEventListener('play', () => setPlaying(true));
    a.addEventListener('pause', () => setPlaying(false));
    a.addEventListener('ended', () => {
      setPlaying(false);
      setCurrent(0);
    });
    a.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(a.duration) && a.duration > 0) setMediaDuration(a.duration);
    });
    a.addEventListener('error', () => {
      setError(true);
      setPlaying(false);
    });
    audioRef.current = a;
    return a;
  }

  async function toggle() {
    setError(false);
    try {
      const a = await ensureAudio();
      if (a.paused) {
        window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: idRef.current }));
        await a.play();
      } else {
        a.pause();
      }
    } catch {
      setError(true);
      setLoading(false);
    }
  }

  async function seek(e) {
    const value = Number(e.target.value);
    setCurrent(value);
    try {
      const a = await ensureAudio();
      a.currentTime = value;
    } catch {
      setError(true);
    }
  }

  function cycleRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
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
          aria-label={t('play')}
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
