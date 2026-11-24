import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import CommentForm from '../components/CommentForm.jsx';
import { useI18n } from '../i18n.js';
import { docsBySubject, documentLabel, getDocument, getDocumentReplacement, getSubject } from '../lib/catalog.js';
import { formatFileSize } from '../lib/format.js';
import { sectionHref } from '../lib/routing.js';
import { useModalFocus } from '../lib/modal-focus.js';
import '../reader.css';

const BASE = import.meta.env.BASE_URL;
const MOBILE_QUERY = '(max-width: 959px)';

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia?.(MOBILE_QUERY).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(MOBILE_QUERY);
    if (!mq) return undefined;
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export default function DocumentPage({ id, initialSection = '' }) {
  const { t, lang } = useI18n();
  const doc = getDocument(id);
  const downloadUrl = doc ? `${BASE}content/files/${doc.id}.${doc.format}?v=${doc.revision}` : '';
  const subject = doc ? getSubject(doc.subject) : null;
  const isMobile = useIsMobile();

  const [html, setHtml] = useState('');
  const [loadState, setLoadState] = useState('loading');
  const [sectionId, setSectionId] = useState('');
  const [activeId, setActiveId] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reading, setReading] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const articleRef = useRef(null);
  const panelRef = useRef(null);
  const flashTimer = useRef(null);
  useModalFocus(panelRef, isMobile && sheetOpen);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  useEffect(() => {
    if (!doc) return undefined;
    const controller = new AbortController();
    setLoadState('loading');
    setHtml('');
    setSectionId('');
    fetch(`${BASE}content/docs/${doc.id}.html?v=${doc.revision}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((text) => {
        if (controller.signal.aborted) return;
        if (!text.trim() || /<(?:!doctype|html|script)\b/i.test(text)) throw new Error('Invalid document response');
        setHtml(text);
        setLoadState('ready');
      })
      .catch(() => !controller.signal.aborted && setLoadState('error'));
    return () => controller.abort();
  }, [doc, retry]);

  useEffect(() => {
    if (!initialSection || loadState !== 'ready') return undefined;
    const frame = requestAnimationFrame(() => {
      const heading = articleRef.current?.querySelector(`#${initialSection}`);
      if (!heading) return;
      heading.tabIndex = -1;
      heading.scrollIntoView({ block: 'start' });
      heading.focus({ preventScroll: true });
      setActiveId(initialSection);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSection, loadState]);

  // Add a "comment on this section" button to every numbered heading.
  useEffect(() => {
    const root = articleRef.current;
    if (!root || loadState !== 'ready') return;
    root.querySelectorAll('.sec-btn').forEach((b) => b.remove());
    root.querySelectorAll('h2[id], h3[id]').forEach((h) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sec-btn';
      b.dataset.section = h.id;
      b.setAttribute('aria-label', `${t('commentOnSection')}: ${h.textContent}`);
      b.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5z"/></svg>';
      const label = document.createElement('span');
      label.textContent = t('commentOnSection');
      b.appendChild(label);
      h.appendChild(b);
    });
    // Open an original PDF at the selected page for native zoom and printing.
    if (doc?.format === 'pdf') {
      root.querySelectorAll('.pdf-page-text > summary').forEach((summary) => {
        summary.textContent = t('pdfExtractedText');
      });
      root.querySelectorAll('.pdf-page-image').forEach((img, index) => {
        img.alt = t('pdfPageLabel', { n: index + 1 });
        let link = img.closest('.pdf-page-link');
        if (!link) {
          link = document.createElement('a');
          link.className = 'pdf-page-link';
          img.replaceWith(link);
          link.appendChild(img);
        }
        link.href = `${downloadUrl}#page=${index + 1}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', t('openPdfPage', { n: index + 1 }));
        link.title = t('openPdfPage', { n: index + 1 });
      });
    }
    root.querySelectorAll('.table-wrap').forEach((table) => {
      table.tabIndex = 0;
      table.setAttribute('role', 'region');
      table.setAttribute('aria-label', t('scrollableTable'));
    });
  }, [html, loadState, t, doc, downloadUrl]);

  // Highlight the section being read in the table of contents.
  useEffect(() => {
    const root = articleRef.current;
    if (!root || loadState !== 'ready') return undefined;
    const headings = [...root.querySelectorAll('h2[id], h3[id]')];
    if (!headings.length) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = window.innerHeight * 0.3;
      let current = headings[0].id;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= line) current = h.id;
        else break;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [html, loadState]);

  // A live microphone must be stopped or cancelled before hiding the sheet.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !recordingBusy) setSheetOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, recordingBusy]);

  useEffect(() => {
    if (!isMobile) setSheetOpen(false);
    else if (recordingBusy) setSheetOpen(true);
  }, [isMobile, recordingBusy]);

  const openFormFor = useCallback(
    (sid) => {
      setSectionId(sid);
      if (isMobile) {
        setSheetOpen(true);
      } else {
        setReading(false);
        panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        setFlash(true);
        clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlash(false), 900);
      }
    },
    [isMobile],
  );

  function onArticleClick(e) {
    const btn = e.target.closest?.('.sec-btn');
    if (btn) openFormFor(btn.dataset.section);
    const link = e.target.closest?.('a[href^="#"]:not([href^="#/"])');
    if (link) {
      e.preventDefault();
      let targetId;
      try { targetId = decodeURIComponent(link.getAttribute('href').slice(1)); } catch { return; }
      const target = document.getElementById(targetId);
      if (target && articleRef.current?.contains(target)) {
        target.tabIndex = -1;
        target.scrollIntoView({ block: 'start' });
        target.focus({ preventScroll: true });
      }
    }
  }

  function jumpTo(e, sid) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const el = document.getElementById(sid);
    if (!el) return;
    e.currentTarget.closest('details')?.removeAttribute('open');
    el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
    window.history.replaceState(null, '', sectionHref(doc.id, sid));
    setActiveId(sid);
  }

  if (!doc) {
    const replacement = getDocumentReplacement(id);
    return (
      <div className="page">
        <div className="empty">
          <Icon name="doc" size={28} />
          <h1>{t(replacement ? 'docReplaced' : 'docNotFound')}</h1>
          <p>{t(replacement ? 'docReplacedHint' : 'docNotFoundHint')}</p>
          <a className="btn btn-primary" href={replacement ? `#/doc/${replacement.id}` : '#/'}>
            {t(replacement ? 'openCurrentDocument' : 'backToCatalog')}
          </a>
        </div>
      </div>
    );
  }

  const docTitle = documentLabel(doc, lang);
  const systemParts = doc.subject === 'education-system'
    ? docsBySubject(doc.subject).filter((d) => d.part)
    : [];
  const format = doc.format || 'docx';

  return (
    <div className={`page doc-page${reading && !isMobile && !recordingBusy ? ' is-reading' : ''}`}>
      <nav className="crumbs" aria-label={t('backToCatalog')}>
        <a href="#/">
          <Icon name="back" size={16} /> {t('backToCatalog')}
        </a>
      </nav>

      <header className="doc-head">
        <p className="eyebrow">
          {subject.title[lang]}
          {doc.grade ? <> · {/[–-]/.test(doc.grade) ? t('gradesLabel', { g: doc.grade }) : t('gradeLabel', { g: doc.grade })}</> : null}
        </p>
        <h1 className="doc-title-main">{doc.title[lang]}</h1>
        {doc.note ? <p className="doc-note">{doc.note[lang]}</p> : null}
        <div className="doc-meta">
          <span className={`kind kind-${doc.kind}`}>{t(`kind_${doc.kind}`)}</span>
          {doc.part ? <span className="tag">{t(/[–-]/.test(doc.part) ? 'partsLabel' : 'partLabel', { p: doc.part })}</span> : null}
          <span className="tag">{t(`lang_${doc.lang}`)}</span>
          {doc.load?.[lang] ? <span className="doc-meta-text">{doc.load[lang]}</span> : null}
          {doc.minutes ? <span className="doc-meta-text">{t('minutesRead', { n: doc.minutes })}</span> : null}
          <a
            className="btn btn-secondary btn-sm doc-download"
            href={downloadUrl}
            download={doc.fileName}
          >
            <Icon name="download" size={16} /> {t('download', { format })}
            <span className="muted-inline">{formatFileSize(doc.fileSize)}</span>
          </a>
        </div>
        <div className="reader-actions">
          {!isMobile ? <button type="button" className="btn btn-secondary btn-sm" disabled={recordingBusy} aria-pressed={reading} onClick={() => setReading((value) => !value)}>{t(reading ? 'showReviewPanel' : 'readingMode')}</button> : null}
          {format === 'pdf' ? <a className="btn btn-ghost btn-sm" href={downloadUrl} target="_blank" rel="noopener noreferrer">{t('openPdf')}</a> : null}
          {format === 'pdf' ? <span className="field-note">{t('pdfZoomHint')}</span> : null}
        </div>
      </header>

      {systemParts.length > 1 ? (
        <nav className="system-parts" aria-label={t('systemParts')}>
          {systemParts.map((part) => (
            <a
              key={part.id}
              className={`system-part${part.id === doc.id ? ' is-active' : ''}`}
              href={`#/doc/${part.id}`}
              aria-label={part.title[lang]}
              title={part.title[lang]}
              aria-current={part.id === doc.id ? 'page' : undefined}
            >
              {t(/[–-]/.test(part.part) ? 'partsLabel' : 'partLabel', { p: part.part })}
            </a>
          ))}
        </nav>
      ) : null}

      <div className="doc-layout">
        <aside className="toc" aria-label={t('contents')}>
          {doc.sections.length ? (
            <>
              <p className="toc-title">{t('contents')}</p>
              <ol className="toc-list">
                {doc.sections.map((s) => (
                  <li key={s.id} className={`toc-l${s.level}${activeId === s.id ? ' is-active' : ''}`}>
                    <a href={sectionHref(doc.id, s.id)} aria-current={activeId === s.id ? 'location' : undefined} onClick={(e) => jumpTo(e, s.id)}>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </aside>

        <div className="doc-body">
          {doc.sections.length > 0 && loadState === 'ready' ? (
            <details className="compact-contents">
              <summary>{t('contents')}</summary>
              <ol className="toc-list">
                {doc.sections.map((s) => (
                  <li key={s.id} className={`toc-l${s.level}${activeId === s.id ? ' is-active' : ''}`}>
                    <a href={sectionHref(doc.id, s.id)} aria-current={activeId === s.id ? 'location' : undefined} onClick={(e) => jumpTo(e, s.id)}>{s.title}</a>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          {loadState === 'loading' ? (
            <div className="doc-loading" aria-live="polite">
              <span className="spinner" aria-hidden="true" /> {t('loadingDoc')}
              <div className="skeleton" />
              <div className="skeleton short" />
              <div className="skeleton" />
            </div>
          ) : null}
          {loadState === 'error' ? (
            <div className="reader-error">
              <p className="field-error" role="alert"><Icon name="alert" size={16} /> {t('docLoadError')}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetry((value) => value + 1)}>{t('retryDocument')}</button>
            </div>
          ) : null}
          <article
            ref={articleRef}
            className="prose"
            lang={doc.lang}
            onClick={onArticleClick}
            hidden={loadState !== 'ready'}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>

        <div
          className={`review-scrim${sheetOpen ? ' is-open' : ''}`}
          onClick={() => !recordingBusy && setSheetOpen(false)}
          aria-hidden="true"
        />
        <aside
          className={`review-panel${sheetOpen ? ' is-open' : ''}${flash ? ' is-flash' : ''}`}
          ref={panelRef}
          tabIndex={-1}
          aria-label={t('formTitle')}
          {...(isMobile ? { role: 'dialog', 'aria-modal': sheetOpen ? 'true' : undefined } : {})}
          inert={isMobile && !sheetOpen ? true : undefined}
        >
          {isMobile ? (
            <div className="sheet-bar">
              <span className="sheet-handle" aria-hidden="true" />
              <button type="button" className="icon-btn" disabled={recordingBusy} onClick={() => setSheetOpen(false)} aria-label={t('close')}>
                <Icon name="close" size={18} />
              </button>
            </div>
          ) : null}
          <CommentForm doc={doc} sectionId={sectionId} onSectionChange={setSectionId} docTitle={docTitle} onRecordingChange={setRecordingBusy} />
        </aside>
      </div>

      {isMobile && !sheetOpen ? (
        <button type="button" className="fab" onClick={() => setSheetOpen(true)}>
          <Icon name="mic" size={20} /> {t('openForm')}
        </button>
      ) : null}
    </div>
  );
}
