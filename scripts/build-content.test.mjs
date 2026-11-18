import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'node-html-parser';
import { postProcess, validateCatalog, readDocument } from './build-content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loadJson = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));

test('system chapter remains a commentable heading even when uppercase', () => {
  const result = postProcess('<p>Title</p><h2>І БӨЛІМ. НЕГІЗДЕРІ</h2><h3>1.1. Жалпы ережелер</h3><p>Мәтін</p>', { keepTopHeadings: true });
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0].id, 's1');
  assert.match(result.html, /class="doc-front"/);
});

test('existing title-page conversion keeps its section identifiers', () => {
  const result = postProcess('<h2>7-СЫНЫП</h2><h2>Түсінік хат</h2><h3>Мақсаты</h3>');
  assert.deepEqual(result.sections.map(({ id, title }) => [id, title]), [['s1', 'Түсінік хат'], ['s2', 'Мақсаты']]);
});

test('tables retain merged cells and wrap for horizontal scrolling', () => {
  const result = postProcess('<h2>Жоспар</h2><table><tr><th colspan="2">Жоспар</th></tr><tr><td rowspan="2">А</td><td>Б</td></tr><tr><td>В</td></tr></table>');
  const doc = parse(result.html);
  assert.ok(doc.querySelector('.table-wrap table'));
  assert.equal(doc.querySelector('th').getAttribute('colspan'), '2');
  assert.equal(doc.querySelector('td').getAttribute('rowspan'), '2');
});

test('imported content strips active HTML while preserving local PDF previews', () => {
  const result = postProcess('<script>alert(1)</script><p onclick="evil()">Text</p><a href="javascript:evil()">bad</a><a href="https://example.com">safe</a><img src="content/assets/example/page-01.webp" onerror="evil()"><img src="https://tracker.invalid/x"><details><summary>Text</summary><pre>Content</pre></details>');
  assert.doesNotMatch(result.html, /<script|onclick|onerror|javascript:|tracker.invalid/);
  assert.match(result.html, /content\/assets\/example\/page-01.webp/);
  assert.match(result.html, /https:\/\/example.com/);
  assert.ok(parse(result.html).querySelector('details pre'));
});

test('catalog rejects draft folders, duplicate IDs and extension mismatches', () => {
  const entry = { id: 'example', subject: 'math', source: 'math/test.docx', title: { kk: 'Тест', ru: 'Тест' } };
  const make = (...documents) => ({ subjects: [{ id: 'math' }], documents });
  assert.throws(() => validateCatalog(make({ ...entry, source: 'math/черновик/test.docx' })), /Draft/);
  assert.throws(() => validateCatalog(make(entry, entry)), /Duplicate/);
  assert.throws(() => validateCatalog(make({ ...entry, format: 'pdf' })), /mismatch/);
});

test('every generated document has matching original, readable sections and working media', async () => {
  const source = await loadJson('content/catalog.json');
  const generated = await loadJson('src/generated/catalog.json');
  validateCatalog(source);
  assert.equal(generated.documents.length, source.documents.length);
  assert.equal(source.documents.some((d) => d.id === 'dombyra-appendix'), false);
  assert.deepEqual(source.documents.filter((d) => d.subject === 'education-system').map((d) => d.part), ['I', 'II–V']);
  for (const d of generated.documents) {
    const original = await fs.readFile(path.join(root, 'content', 'docs', `${d.id}.${d.format}`));
    const download = await fs.readFile(path.join(root, 'public', 'content', 'files', `${d.id}.${d.format}`));
    assert.equal(createHash('sha256').update(original).digest('hex'), createHash('sha256').update(download).digest('hex'), d.id);
    const doc = parse(await fs.readFile(path.join(root, 'public', 'content', 'docs', `${d.id}.html`), 'utf8'));
    assert.ok(doc.textContent.trim().length > 0, `${d.id}: empty reader`);
    assert.equal(new Set(d.sections.map((s) => s.id)).size, d.sections.length, d.id);
    for (const s of d.sections) assert.ok(doc.querySelector(`#${s.id}`), `${d.id}: missing ${s.id}`);
    for (const img of doc.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      assert.ok(src, `${d.id}: image without source`);
      if (!src.startsWith('data:')) await fs.access(path.join(root, 'public', src));
    }
    if (d.format !== 'docx') await readDocument(d);
    if (d.format === 'pdf') assert.equal(doc.querySelectorAll('.pdf-page-image').length, d.pages, `${d.id}: lost PDF pages`);
  }
});
