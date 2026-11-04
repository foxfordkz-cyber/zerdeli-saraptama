import data from '../generated/catalog.json';

export const SUBJECTS = data.subjects;
export const DOCUMENTS = data.documents;

const subjectById = new Map(SUBJECTS.map((s) => [s.id, s]));
const documentById = new Map(DOCUMENTS.map((d) => [d.id, d]));

export const getSubject = (id) => subjectById.get(id) || null;
export const getDocument = (id) => documentById.get(id) || null;

export function docsBySubject(subjectId) {
  return DOCUMENTS.filter((d) => d.subject === subjectId);
}

// "Ағылшын тілі · 5-сынып бағдарламасы" — used wherever a document is named alone.
export function documentLabel(doc, lang) {
  if (!doc) return '';
  const subject = getSubject(doc.subject);
  const langMark = doc.lang === 'ru' ? (lang === 'ru' ? ' (рус.)' : ' (орыс.)') : '';
  return `${subject ? subject.title[lang] + ' · ' : ''}${doc.title[lang]}${langMark}`;
}

export function gradeSpan() {
  let min = Infinity;
  let max = -Infinity;
  for (const s of SUBJECTS) {
    for (const n of s.grades.split('–').map(Number)) {
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }
  return `${min}–${max}`;
}
