// Converts the curriculum .docx files listed in content/catalog.json into
// readable HTML fragments, copies the originals for download, and writes a
// catalog (with each document's section list) that the app imports.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import { parse } from 'node-html-parser';
import { createHash } from 'node:crypto';

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

// Imported files are content, never executable instructions or active HTML.
function sanitize(container) {
  for (const el of container.querySelectorAll('script, style, iframe, object, embed, form, input, button, link, meta, base, svg, math')) el.remove();
  for (const el of container.querySelectorAll('*')) {
    for (const name of Object.keys(el.attributes)) {
      if (/^on/i.test(name) || ['style', 'srcdoc', 'srcset', 'formaction'].includes(name.toLowerCase())) el.removeAttribute(name);
    }
    if (el.hasAttribute('href')) {
      const href = el.getAttribute('href').trim();
      if (!/^(?:https?:\/\/|mailto:|#)/i.test(href)) el.removeAttribute('href');
    }
    if (el.hasAttribute('src')) {
      const src = el.getAttribute('src').trim();
      const embedded = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src);
      const pageAsset = /^content\/assets\/[a-z0-9-]+\/page-\d+\.(?:png|webp)$/i.test(src);
      if (!embedded && !pageAsset) el.removeAttribute('src');
    }
  }
}

export function postProcess(html, { keepTopHeadings = false, numberedHeadingsOnly = false } = {}) {
  const doc = parse(`<div id="root">${html}</div>`);
  const container = doc.querySelector('#root');
  sanitize(container);

  // Some revised concepts apply Word heading styles to body paragraphs too.
  // Keep only numbered chapters/subsections in the reader's section list.
  if (numberedHeadingsOnly) {
    for (const h of container.querySelectorAll('h2, h3')) {
      const text = cleanText(h.textContent);
      if (!/^(?:[IVXІ]+\s+бөлім(?=[\s.:]|$)|\d+\.\d+\.?\s)/iu.test(text)) {
        h.replaceWith(parse(`<p>${h.innerHTML}</p>`));
      }
    }
  }

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
  for (const h of keepTopHeadings ? [] : container.querySelectorAll('h2, h3')) {
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

export function validateCatalog(catalog) {
  const subjectIds = new Set();
  for (const s of catalog.subjects) {
    if (!/^[a-z0-9-]+$/.test(s.id) || subjectIds.has(s.id)) throw new Error(`Invalid or duplicate subject id: ${s.id}`);
    subjectIds.add(s.id);
  }
  const seen = new Set();
  for (const d of catalog.documents) {
    if (seen.has(d.id)) throw new Error(`Duplicate document id: ${d.id}`);
    if (!/^[a-z0-9-]+$/.test(d.id)) throw new Error(`Document id must be lowercase ASCII: ${d.id}`);
    if (!subjectIds.has(d.subject)) throw new Error(`Unknown subject "${d.subject}" in ${d.id}`);
    if (/(^|[\\/])черновик([\\/]|$)/i.test(d.source)) throw new Error(`Draft source excluded: ${d.source}`);
    const format = d.format || 'docx';
    if (!['docx', 'pdf', 'xlsx'].includes(format)) throw new Error(`Unsupported format: ${format}`);
    if (path.extname(d.source).toLowerCase() !== `.${format}`) throw new Error(`Source format mismatch: ${d.id}`);
    if (!d.title?.kk || !d.title?.ru) throw new Error(`Missing translated title: ${d.id}`);
    seen.add(d.id);
  }
}

export async function readDocument(d) {
  const format = d.format || 'docx';
  const src = path.join(docsDir, `${d.id}.${format}`);
  if (format === 'docx') {
    const { value, messages } = await mammoth.convertToHtml({ path: src }, { styleMap });
    const errors = messages.filter((m) => m.type === 'error');
    if (errors.length) throw new Error(`${d.id}: ${errors.map((e) => e.message).join('; ')}`);
    return { src, value };
  }
  const extracted = path.join(root, 'content', 'extracted', d.id);
  const manifest = JSON.parse(await fs.readFile(`${extracted}.json`, 'utf8'));
  const digest = createHash('sha256').update(await fs.readFile(src)).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Stale extracted content for ${d.id}; run prepare-supplemental.py`);
  return { src, value: await fs.readFile(`${extracted}.html`, 'utf8'), pages: manifest.pages ?? null };
}

export async function main() {
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  validateCatalog(catalog);
  const outputRoot = path.resolve(root, 'public', 'content');
  if (path.relative(root, outputRoot) !== path.join('public', 'content')) throw new Error('Unsafe content output path');
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(outHtmlDir, { recursive: true });
  await fs.mkdir(outFileDir, { recursive: true });
  await fs.mkdir(path.dirname(outCatalog), { recursive: true });
  const assets = path.join(root, 'content', 'extracted', 'assets');
  try {
    await fs.cp(assets, path.join(outputRoot, 'assets'), { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const documents = [];

  for (const d of catalog.documents) {
    const format = d.format || 'docx';
    const { src, value, pages } = await readDocument(d);
    const { html, sections, words } = postProcess(value, d);
    if (!words) throw new Error(`Empty document: ${d.id}`);
    await fs.writeFile(path.join(outHtmlDir, `${d.id}.html`), html);
    await fs.copyFile(src, path.join(outFileDir, `${d.id}.${format}`));
    const { size } = await fs.stat(src);

    documents.push({
      id: d.id,
      subject: d.subject,
      kind: d.kind,
      format,
      part: d.part ?? null,
      pages: pages ?? null,
      grade: d.grade,
      lang: d.lang,
      title: d.title,
      load: d.load ?? null,
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
