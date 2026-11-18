import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dictionaries, translate } from '../src/i18n.js';

test('Kazakh and Russian interfaces have the same nonempty translation keys', () => {
  assert.deepEqual(Object.keys(dictionaries.kk).sort(), Object.keys(dictionaries.ru).sort());
  for (const [lang, dictionary] of Object.entries(dictionaries)) {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string', `${lang}.${key}`);
      assert.ok(value.trim(), `${lang}.${key} must not be empty`);
    }
  }
});

test('both locales use matching interpolation placeholders', () => {
  const variables = (value) => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
  for (const key of Object.keys(dictionaries.kk)) {
    assert.deepEqual(variables(dictionaries.kk[key]), variables(dictionaries.ru[key]), key);
  }
});

test('UI and stored message keys resolve in both languages', () => {
  const files = ['src/App.jsx', ...['src/pages', 'src/components'].flatMap((directory) =>
    fs.readdirSync(directory).filter((name) => name.endsWith('.jsx')).map((name) => `${directory}/${name}`),
  )];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const keys = [
      ...source.matchAll(/\bt\(['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bset(?:Error|Notice|LoadError|ActionError)\(['"]([^'"]+)['"]\)/g),
    ].map((match) => match[1]);
    for (const key of keys) {
      for (const lang of ['kk', 'ru']) assert.ok(Object.hasOwn(dictionaries[lang], key), `${file}: missing ${lang}.${key}`);
    }
  }
});

test('every catalog type and source language has both UI labels', () => {
  const catalog = JSON.parse(fs.readFileSync('content/catalog.json', 'utf8'));
  for (const doc of catalog.documents) {
    for (const key of [`kind_${doc.kind}`, `lang_${doc.lang}`]) {
      for (const lang of ['kk', 'ru']) assert.ok(Object.hasOwn(dictionaries[lang], key), `${doc.id}: missing ${lang}.${key}`);
    }
  }
});

test('Russian counts use appropriate plural forms and PDF controls localize', () => {
  assert.equal(translate('ru', 'docsCount', { n: 1 }), '1 документ');
  assert.equal(translate('ru', 'docsCount', { n: 2 }), '2 документа');
  assert.equal(translate('ru', 'docsCount', { n: 11 }), '11 документов');
  assert.equal(translate('kk', 'docsCount', { n: 11 }), '11 құжат');
  assert.equal(translate('kk', 'pdfPageLabel', { n: 3 }), '3-бет');
  assert.equal(translate('ru', 'pdfPageLabel', { n: 3 }), 'Страница 3');
});
