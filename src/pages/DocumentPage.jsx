import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import CommentForm from '../components/CommentForm.jsx';
import { useI18n } from '../i18n.js';
import { documentLabel, getDocument, getSubject } from '../lib/catalog.js';
import { formatFileSize } from '../lib/format.js';

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

export default function DocumentPage({ id }) {
  const { t, lang } = useI18n();
  const doc = getDocument(id);
  const subject = doc ? getSubject(doc.subject) : null;
  const isMobile = useIsMobile();

  const [html, setHtml] = useState('');
  const [loadState, setLoadState] = useState('loading');
  const [sectionId, setSectionId] = useState('');
  const [activeId, setActiveId] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const articleRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    setLoadState('loading');
    setHtml('');
    setSectionId('');
    fetch(`${BASE}content/docs/${doc.id}.html`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        setHtml(text);
        setLoadState('ready');
      })
      .catch(() => !cancelled && setLoadState('error'));
    return () => {
      cancelled = true;
    };
  }, [doc]);

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
  }, [html, loadState, t]);

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

  // Bottom sheet on phones: lock page scroll, close with Escape.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && setSheetOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (!isMobile) setSheetOpen(false);
  }, [isMobile]);

  const openFormFor = useCallback(
    (sid) => {
      setSectionId(sid);
      if (isMobile) {
        setSheetOpen(true);
      } else {
        panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        setFlash(true);
        window.setTimeout(() => setFlash(false), 900);
      }
    },
    [isMobile],
  );

  function onArticleClick(e) {
    const btn = e.target.closest?.('.sec-btn');
    if (btn) openFormFor(btn.dataset.section);
  }

  function jumpTo(e, sid) {
    e.preventDefault();
    const el = document.getElementById(sid);
    if (!el) return;
    el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setActiveId(sid);
  }

  if (!doc) {
    return (
      <div className="page">
        <div className="empty">
          <Icon name="doc" size={28} />
          <h1>{t('docNotFound')}</h1>
          <p>{t('docNotFoundHint')}</p>
          <a className="btn btn-primary" href="#/">
            {t('backToCatalog')}
          </a>
        </div>
      </div>
    );
  }

  const docTitle = documentLabel(doc, lang);

  return (
    <div className="page doc-page">
      <nav className="crumbs" aria-label={t('backToCatalog')}>
        <a href="#/">
          <Icon name="back" size={16} /> {t('backToCatalog')}
        </a>
      </nav>

      <header className="doc-head">
        <p className="eyebrow">
          {subject.title[lang]} · {doc.grade.includes('–') ? t('gradesLabel', { g: doc.grade }) : t('gradeLabel', { g: doc.grade })}
        </p>
        <h1 className="doc-title-main">{doc.title[lang]}</h1>
        {doc.note ? <p className="doc-note">{doc.note[lang]}</p> : null}
        <div className="doc-meta">
          <span className={`kind kind-${doc.kind}`}>{t(`kind_${doc.kind}`)}</span>
          <span className="tag">{t(`lang_${doc.lang}`)}</span>
          <span className="doc-meta-text">{doc.load[lang]}</span>
          <span className="doc-meta-text">{t('minutesRead', { n: doc.minutes })}</span>
          <a
            className="btn btn-secondary btn-sm doc-download"
            href={`${BASE}content/files/${doc.id}.docx`}
            download={doc.fileName}
          >
            <Icon name="download" size={16} /> {t('download')}
            <span className="muted-inline">{formatFileSize(doc.fileSize)}</span>
          </a>
        </div>
      </header>

      <div className="doc-layout">
        <aside className="toc" aria-label={t('contents')}>
          {doc.sections.length ? (
            <>
              <p className="toc-title">{t('contents')}</p>
              <ol className="toc-list">
                {doc.sections.map((s) => (
                  <li key={s.id} className={`toc-l${s.level}${activeId === s.id ? ' is-active' : ''}`}>
                    <a href={`#${s.id}`} onClick={(e) => jumpTo(e, s.id)}>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </aside>

        <div className="doc-body">
          {loadState === 'loading' ? (
            <div className="doc-loading" aria-live="polite">
              <span className="spinner" aria-hidden="true" /> {t('loadingDoc')}
              <div className="skeleton" />
              <div className="skeleton short" />
              <div className="skeleton" />
            </div>
          ) : null}
          {loadState === 'error' ? (
            <p className="field-error" role="alert">
              <Icon name="alert" size={16} /> {t('docLoadError')}
            </p>
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
          onClick={() => setSheetOpen(false)}
          aria-hidden="true"
        />
        <aside
          className={`review-panel${sheetOpen ? ' is-open' : ''}${flash ? ' is-flash' : ''}`}
          ref={panelRef}
          aria-label={t('formTitle')}
          {...(isMobile ? { role: 'dialog', 'aria-modal': sheetOpen ? 'true' : undefined } : {})}
          inert={isMobile && !sheetOpen ? true : undefined}
        >
          {isMobile ? (
            <div className="sheet-bar">
              <span className="sheet-handle" aria-hidden="true" />
              <button type="button" className="icon-btn" onClick={() => setSheetOpen(false)} aria-label={t('close')}>
                <Icon name="close" size={18} />
              </button>
            </div>
          ) : null}
          <CommentForm doc={doc} sectionId={sectionId} onSectionChange={setSectionId} docTitle={docTitle} />
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
