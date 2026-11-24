export const DEFAULT_CATALOG_FILTERS = Object.freeze({
  query: '', subject: 'all', grade: 'all', kind: 'all', format: 'all',
});

const CHAPTERS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

function chaptersInVolume(part) {
  if (!part) return '';
  const [first, last = first] = part.split(/[–—-]/);
  const start = CHAPTERS.indexOf(first);
  const end = CHAPTERS.indexOf(last);
  return start >= 0 && end >= start ? CHAPTERS.slice(start, end + 1).join(' ') : part;
}

export function normalizeSearch(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('kk')
    .replace(/ё/g, 'е')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Treat 1–9 as nine grades, not just the two written endpoints.
export function gradesInRange(value) {
  const result = new Set();
  const text = String(value ?? '');
  for (const match of text.matchAll(/(\d+)(?:\s*[–—-]\s*(\d+))?/g)) {
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end > 12 || start > end) continue;
    for (let grade = start; grade <= end; grade += 1) result.add(grade);
  }
  return [...result].sort((a, b) => a - b);
}

export function buildCatalogIndex(documents, subjects, labels = {}) {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  return documents.map((doc) => {
    const subject = byId.get(doc.subject);
    const grades = gradesInRange(doc.grade);
    const text = normalizeSearch([
      subject?.title.kk, subject?.title.ru, doc.title.kk, doc.title.ru,
      doc.note?.kk, doc.note?.ru,
      grades.length ? `${grades.join(' ')} сынып класс` : '',
      doc.part ? `${chaptersInVolume(doc.part)} бөлім бөлімдер раздел разделы` : '',
      labels[`kind_${doc.kind}`], labels[`lang_${doc.lang}`],
      doc.kind, doc.format || 'docx',
    ].join(' '));
    return { doc, grades, text, tokens: new Set(text.split(' ')) };
  });
}

export function filterCatalogIndex(index, filters) {
  const selected = { ...DEFAULT_CATALOG_FILTERS, ...filters };
  const words = normalizeSearch(selected.query).split(' ').filter(Boolean);
  return index.filter(({ doc, grades, text, tokens }) => {
    if (selected.subject !== 'all' && doc.subject !== selected.subject) return false;
    if (selected.grade === 'none' && grades.length) return false;
    if (!['all', 'none'].includes(selected.grade) && !grades.includes(Number(selected.grade))) return false;
    if (selected.kind !== 'all' && doc.kind !== selected.kind) return false;
    if (selected.format !== 'all' && (doc.format || 'docx') !== selected.format) return false;
    return words.every((word) => {
      if (/^[iіvx]+$/u.test(word)) return tokens.has(word.replaceAll('і', 'i'));
      return /^\d+$/.test(word) ? tokens.has(word) : text.includes(word);
    });
  }).map(({ doc }) => doc);
}

// Persisted values may belong to an older catalog or be malformed.
export function sanitizeCatalogFilters(value, choices) {
  const next = { ...DEFAULT_CATALOG_FILTERS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return next;
  if (typeof value.query === 'string') next.query = value.query.slice(0, 200);
  for (const key of ['subject', 'grade', 'kind', 'format']) {
    if (choices[key].includes(value[key])) next[key] = value[key];
  }
  return next;
}
