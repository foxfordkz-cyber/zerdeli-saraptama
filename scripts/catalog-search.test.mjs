import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCatalogIndex, DEFAULT_CATALOG_FILTERS, filterCatalogIndex,
  gradesInRange, normalizeSearch, sanitizeCatalogFilters,
} from '../src/lib/catalog-search.js';

const subjects = [
  { id: 'math', title: { kk: 'Математика', ru: 'Математика' } },
  { id: 'system', title: { kk: 'Білім беру жүйесі', ru: 'Образовательная система' } },
];
const documents = [
  { id: 'range', subject: 'math', grade: '1–9', kind: 'program', lang: 'kk', title: { kk: 'Жалпы бағдарлама', ru: 'Общая программа' } },
  { id: 'senior', subject: 'math', grade: '10–11', kind: 'guide', format: 'pdf', lang: 'ru', title: { kk: 'Нұсқаулық', ru: 'Руководство' } },
  { id: 'plan', subject: 'math', grade: '5', kind: 'plan', format: 'xlsx', lang: 'kk', title: { kk: 'Оқу жоспары', ru: 'Учебный план' } },
  { id: 'general', subject: 'system', grade: null, load: null, kind: 'concept', part: 'II–V', lang: 'kk', title: { kk: 'Тұжырымдама', ru: 'Концепция' } },
];
const index = buildCatalogIndex(documents, subjects, { kind_guide: 'Нұсқаулық руководство', lang_ru: 'Орысша на русском' });
const ids = (filters) => filterCatalogIndex(index, filters).map((doc) => doc.id);

test('grade ranges include intermediate grades and handle lists and dash variants', () => {
  assert.deepEqual(gradesInRange('1–4'), [1, 2, 3, 4]);
  assert.deepEqual(gradesInRange('5, 7-9, 11'), [5, 7, 8, 9, 11]);
  assert.deepEqual(gradesInRange('8 — 10'), [8, 9, 10]);
  assert.deepEqual(gradesInRange(null), []);
  assert.deepEqual(gradesInRange('9–1'), []);
});

test('grade filter returns range programs and excludes general documents', () => {
  assert.deepEqual(ids({ grade: '5' }), ['range', 'plan']);
  assert.deepEqual(ids({ grade: '10' }), ['senior']);
  assert.deepEqual(ids({ grade: 'none' }), ['general']);
});

test('subject, grade, kind, format and query filters intersect', () => {
  assert.deepEqual(ids({ subject: 'math', grade: '5', kind: 'plan', format: 'xlsx', query: 'план' }), ['plan']);
  assert.deepEqual(ids({ subject: 'system', grade: '5' }), []);
  assert.deepEqual(ids({ format: 'docx' }), ['range', 'general']);
});

test('bilingual search normalizes punctuation, case and Russian ё', () => {
  assert.equal(normalizeSearch('  «ОҚУ» —  Ёлка  '), 'оқу елка');
  assert.deepEqual(ids({ query: 'математика оқу' }), ['plan']);
  assert.deepEqual(ids({ query: 'НА РУССКОМ руководство' }), ['senior']);
  assert.deepEqual(ids({ query: 'II–V' }), ['general']);
});

test('numeric searches find intermediate grades but do not confuse 1 with 10', () => {
  assert.deepEqual(ids({ query: '5 класс' }), ['range', 'plan']);
  assert.deepEqual(ids({ query: '1 класс' }), ['range']);
  assert.deepEqual(ids({ query: '10 класс' }), ['senior']);
});

test('a chapter search finds its volume in either language without matching longer Roman numerals', () => {
  const chapters = buildCatalogIndex(['I–IV', 'V', 'VI', 'VII', 'VIII', 'IX'].map((part) => ({
    id: part, part, subject: 'system', title: { kk: part, ru: part },
  })), subjects);
  for (const [query, part] of [['Раздел III', 'I–IV'], ['ІІ бөлім', 'I–IV'], ['V', 'V'], ['VI бөлім', 'VI'], ['Раздел IX', 'IX']]) {
    assert.deepEqual(filterCatalogIndex(chapters, { query }).map((d) => d.part), [part]);
  }
});

test('persisted filters reject stale and malformed values while preserving valid selections', () => {
  const choices = { subject: ['all', 'math'], grade: ['all', 'none', '5'], kind: ['all', 'plan'], format: ['all', 'xlsx'] };
  assert.deepEqual(sanitizeCatalogFilters(null, choices), DEFAULT_CATALOG_FILTERS);
  assert.deepEqual(sanitizeCatalogFilters({ query: 'план', subject: 'removed', grade: 5, kind: 'plan', format: 'xlsx' }, choices), {
    query: 'план', subject: 'all', grade: 'all', kind: 'plan', format: 'xlsx',
  });
  assert.equal(sanitizeCatalogFilters({ query: 'a'.repeat(300) }, choices).query.length, 200);
});
