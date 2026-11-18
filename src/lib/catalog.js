import data from '../generated/catalog.json';

export const SUBJECTS = data.subjects;
export const DOCUMENTS = data.documents;

const subjectById = new Map(SUBJECTS.map((s) => [s.id, s]));
const documentById = new Map(DOCUMENTS.map((d) => [d.id, d]));

// Metadata only: retired sources are never included in the public catalog or
// reader. Existing feedback retains its original document and section IDs.
export const RETIRED_DOCUMENTS = [
  {
    id: 'dombyra-appendix',
    subject: 'dombyra',
    kind: 'appendix',
    grade: '1–4',
    lang: 'kk',
    title: { kk: 'Қосымшалар жинағы', ru: 'Сборник приложений' },
    retired: true,
    replacementId: 'dombyra',
  },
];
const retiredById = new Map(RETIRED_DOCUMENTS.map((d) => [d.id, d]));

export const getSubject = (id) => subjectById.get(id) || null;
export const getDocument = (id) => documentById.get(id) || null;
// For administrative feedback labels and filters, not for displaying a source.
export const getCommentDocument = (id) => getDocument(id) || retiredById.get(id) || null;
export const getDocumentReplacement = (id) => getDocument(retiredById.get(id)?.replacementId);

export function docsBySubject(subjectId) {
  return DOCUMENTS.filter((d) => d.subject === subjectId);
}

// "Ағылшын тілі · 5-сынып бағдарламасы" — used wherever a document is named alone.
export function documentLabel(doc, lang) {
  if (!doc) return '';
  const subject = getSubject(doc.subject);
  const langMark = doc.lang === 'ru' ? (lang === 'ru' ? ' (рус.)' : ' (орыс.)')
    : doc.lang === 'en' ? (lang === 'ru' ? ' (англ.)' : ' (ағылш.)') : '';
  return `${subject ? subject.title[lang] + ' · ' : ''}${doc.title[lang]}${langMark}`;
}

export function gradeSpan() {
  let min = Infinity;
  let max = -Infinity;
  for (const doc of DOCUMENTS) {
    for (const n of (String(doc.grade ?? '').match(/\d+/g) ?? []).map(Number)) {
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }
  if (!Number.isFinite(min)) return '—';
  return min === max ? String(min) : `${min}–${max}`;
}
