// Converts the curriculum .docx files listed in content/catalog.json into
// readable HTML fragments, copies the originals for download, and writes a
// catalog (with each document's section list) that the app imports.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import { parse } from 'node-html-parser';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'content', 'catalog.json');
const docsDir = path.join(root, 'content', 'docs');
const outHtmlDir = path.join(root, 'public', 'content', 'docs');
const outFileDir = path.join(root, 'public', 'content', 'files');
const outCatalog = path.join(root, 'src', 'generated', 'catalog.json');

const styleMap = [
  "p[style-name='Title'] => p.doc-title:fresh",
  "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
  "p[style-name='Heading 1'] => h2:fresh",
  "p[style-name='Heading 2'] => h3:fresh",
  "p[style-name='Heading 3'] => h4:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
];

const WORDS_PER_MINUTE = 180;

function cleanText(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function postProcess(html) {
  const doc = parse(`<div id="root">${html}</div>`);
  const container = doc.querySelector('#root');

  // Drop empty paragraphs left by spacing in Word.
  for (const p of container.querySelectorAll('p')) {
    if (!cleanText(p.textContent) && !p.querySelector('img')) p.remove();
  }

  // Wrap wide tables so they scroll on their own instead of the page.
  for (const table of container.querySelectorAll('table')) {
    const wrap = parse('<div class="table-wrap"></div>').firstChild;
    table.replaceWith(wrap);
    wrap.appendChild(table);
  }

  // All-caps headings at the very top are title-page lines ("7-СЫНЫП"), not
  // sections an expert would comment on: turn them into title paragraphs.
  for (const h of container.querySelectorAll('h2, h3')) {
    const text = cleanText(h.textContent);
    if (text && /\p{Ll}/u.test(text)) break;
    h.replaceWith(parse(`<p class="doc-title">${h.innerHTML}</p>`));
  }

  // Number headings and collect the section list for the comment form.
  const sections = [];
  let n = 0;
  for (const h of container.querySelectorAll('h2, h3')) {
    const text = cleanText(h.textContent);
    if (!text) { h.remove(); continue; }
    n += 1;
    const id = `s${n}`;
    h.setAttribute('id', id);
    sections.push({ id, level: h.tagName === 'H2' ? 2 : 3, title: text.slice(0, 200) });
  }

  // Everything before the first heading is the title page: style it apart.
  const nodes = [...container.childNodes];
  const firstHeading = nodes.findIndex((el) => el.tagName === 'H2' || el.tagName === 'H3');
  if (firstHeading > 0) {
    const frontNodes = nodes.slice(0, firstHeading);
    const frontHtml = frontNodes.map((el) => el.toString()).join('');
    for (const el of frontNodes) el.remove();
    container.insertAdjacentHTML('afterbegin', `<div class="doc-front">${frontHtml}</div>`);
  }

  const words = cleanText(container.textContent).split(' ').filter(Boolean).length;
  return { html: container.innerHTML, sections, words };
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  await fs.rm(path.join(root, 'public', 'content'), { recursive: true, force: true });
  await fs.mkdir(outHtmlDir, { recursive: true });
  await fs.mkdir(outFileDir, { recursive: true });
  await fs.mkdir(path.dirname(outCatalog), { recursive: true });

  const subjectIds = new Set(catalog.subjects.map((s) => s.id));
  const seen = new Set();
  const documents = [];

  for (const d of catalog.documents) {
    if (seen.has(d.id)) throw new Error(`Duplicate document id: ${d.id}`);
    if (!/^[a-z0-9-]+$/.test(d.id)) throw new Error(`Document id must be lowercase ASCII: ${d.id}`);
    if (!subjectIds.has(d.subject)) throw new Error(`Unknown subject "${d.subject}" in ${d.id}`);
    seen.add(d.id);

    const src = path.join(docsDir, `${d.id}.docx`);
    const { value, messages } = await mammoth.convertToHtml({ path: src }, { styleMap });
    const errors = messages.filter((m) => m.type === 'error');
    if (errors.length) throw new Error(`${d.id}: ${errors.map((e) => e.message).join('; ')}`);

    const { html, sections, words } = postProcess(value);
    await fs.writeFile(path.join(outHtmlDir, `${d.id}.html`), html);
    await fs.copyFile(src, path.join(outFileDir, `${d.id}.docx`));
    const { size } = await fs.stat(src);

    documents.push({
      id: d.id,
      subject: d.subject,
      kind: d.kind,
      grade: d.grade,
      lang: d.lang,
      title: d.title,
      load: d.load,
      note: d.note ?? null,
      fileName: path.basename(d.source),
      fileSize: size,
      words,
      minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
      sections,
    });
  }

  await fs.writeFile(outCatalog, JSON.stringify({ subjects: catalog.subjects, documents }, null, 2));
  console.log(`content: ${documents.length} documents, ${catalog.subjects.length} subjects`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
