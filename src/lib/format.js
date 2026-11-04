import { localeFor } from '../i18n.js';

export function formatDuration(totalSec) {
  const s = Math.max(0, Math.round(totalSec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Browsers ship incomplete Kazakh month names ("М11"), so spell them out.
const KK_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function formatDateTime(iso, lang) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const month = (lang === 'ru' ? RU_MONTHS : KK_MONTHS)[d.getMonth()];
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const year = sameYear ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${month}${year}, ${time}`;
}

// "2026-11-04 14:03" in the viewer's local time, for spreadsheets.
export function formatSortable(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatTotalAudio(totalSec) {
  const s = Math.round(totalSec || 0);
  return s < 60 ? `${s} сек` : `${Math.round(s / 60)} мин`;
}

export function formatTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatNumber(n, lang) {
  return new Intl.NumberFormat(localeFor(lang)).format(n);
}

export function formatFileSize(bytes) {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function initials(first, last) {
  return `${(first || '').trim().charAt(0)}${(last || '').trim().charAt(0)}`.toUpperCase();
}

// Lowercase, strip punctuation; used by both search boxes.
export function normalize(s) {
  return (s || '').toLocaleLowerCase('kk').replace(/[«»"'.,:;()·•|–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
