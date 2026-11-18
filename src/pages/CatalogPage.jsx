import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { translate, useI18n } from '../i18n.js';
import { DOCUMENTS, SUBJECTS, gradeSpan } from '../lib/catalog.js';
import { buildCatalogIndex, DEFAULT_CATALOG_FILTERS, filterCatalogIndex, sanitizeCatalogFilters } from '../lib/catalog-search.js';
import { sentCounts } from '../components/CommentForm.jsx';
import '../catalog.css';

const STORAGE_KEY = 'zerdeli.catalog.filters.v1';
const labels = Object.fromEntries(
  [...new Set(DOCUMENTS.flatMap((d) => [`kind_${d.kind}`, `lang_${d.lang}`]))]
    .map((key) => [key, `${translate('kk', key)} ${translate('ru', key)}`]),
);
const searchIndex = buildCatalogIndex(DOCUMENTS, SUBJECTS, labels);
const choices = {
  subject: ['all', ...SUBJECTS.map((s) => s.id)],
  grade: ['all', 'none', ...[...new Set(searchIndex.flatMap((entry) => entry.grades))].sort((a, b) => a - b).map(String)],
  kind: ['all', ...new Set(DOCUMENTS.map((d) => d.kind))],
  format: ['all', ...[...new Set(DOCUMENTS.map((d) => d.format || 'docx'))].sort()],
};

// Each direction gets its own hue; the golden angle keeps neighbours in the
// list visually distinct. Lightness and chroma come from the theme in CSS.
const subjectHue = new Map(SUBJECTS.map((s, i) => [s.id, Math.round(200 + i * 137.508) % 360]));
const hueStyle = (subjectId) => ({ '--hue': subjectHue.get(subjectId) ?? 190 });

function restoredFilters() {
  try {
    return sanitizeCatalogFilters(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)), choices);
  } catch {
    return { ...DEFAULT_CATALOG_FILTERS };
  }
}

export default function CatalogPage() {
  const { t, lang } = useI18n();
  const [filters, setFilters] = useState(restoredFilters);
  const sent = useMemo(() => sentCounts(), []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch { /* Search remains usable when browser storage is blocked. */ }
  }, [filters]);

  const matches = useMemo(() => filterCatalogIndex(searchIndex, filters), [filters]);
  const groups = useMemo(() => {
    return SUBJECTS.map((s) => ({ subject: s, docs: matches.filter((d) => d.subject === s.id) })).filter(
      (g) => g.docs.length > 0,
    );
  }, [matches]);
  // Counts in the direction list follow every filter except the direction
  // itself, so the list shows where the current search has results.
  const { query, grade, kind, format } = filters;
  const subjectCounts = useMemo(() => {
    const counts = new Map();
    for (const d of filterCatalogIndex(searchIndex, { query, grade, kind, format, subject: 'all' })) {
      counts.set(d.subject, (counts.get(d.subject) || 0) + 1);
    }
    return counts;
  }, [query, grade, kind, format]);
  const countAll = [...subjectCounts.values()].reduce((sum, n) => sum + n, 0);
  const resultsRef = useRef(null);
  const scrollPending = useRef(false);

  // After choosing a direction far down the page, bring the top of the new
  // results back into view. This runs after the list has re-rendered, so the
  // shorter page cannot interrupt the scroll.
  useEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    const target = resultsRef.current;
    if (!target) return;
    // The page's scroll padding already leaves room for the sticky top bar.
    const topbar = parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    if (target.getBoundingClientRect().top < topbar) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    }
  }, [filters]);

  const filtered = Object.keys(DEFAULT_CATALOG_FILTERS).some((key) => filters[key] !== DEFAULT_CATALOG_FILTERS[key]);
  const updateFilter = (key) => (event) => {
    const value = event.target.value;
    setFilters((previous) => ({ ...previous, [key]: value }));
  };
  const chooseSubject = (subject) => {
    scrollPending.current = true;
    setFilters((previous) => ({ ...previous, subject }));
  };

  return (
    <div className="page catalog">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{t('heroEyebrow')}</p>
          <h1 className="hero-title">{t('heroTitle')}</h1>
          <p className="hero-lead">{t('heroLead')}</p>
          <ol className="steps">
            {[t('step1'), t('step2'), t('step3')].map((label, i) => (
              <li key={label}>
                <span className="step-num">{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
        </div>
        <dl className="hero-stats">
          <div>
            <dt>{t('statDocs', { n: DOCUMENTS.length })}</dt>
            <dd>{DOCUMENTS.length}</dd>
          </div>
          <div>
            <dt>{t('statSubjects', { n: SUBJECTS.length })}</dt>
            <dd>{SUBJECTS.length}</dd>
          </div>
          <div>
            <dt>{t('statGrades')}</dt>
            <dd>{gradeSpan()}</dd>
          </div>
        </dl>
      </section>

      <div className="catalog-layout">
        <nav className="subject-nav" aria-labelledby="subject-nav-title">
          <h2 id="subject-nav-title" className="subject-nav-title">{t('catalogSubjectNav')}</h2>
          <ul className="subject-nav-list">
            <li>
              <button
                type="button"
                className="subject-nav-item"
                aria-pressed={filters.subject === 'all'}
                onClick={() => chooseSubject('all')}
              >
                <span className="subject-dot subject-dot-all" aria-hidden="true" />
                <span className="subject-nav-name">{t('catalogAllSubjects')}</span>
                <span className="subject-nav-count">{countAll}</span>
              </button>
            </li>
            {SUBJECTS.map((s) => {
              const n = subjectCounts.get(s.id) || 0;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`subject-nav-item${n ? '' : ' is-empty'}`}
                    style={hueStyle(s.id)}
                    aria-pressed={filters.subject === s.id}
                    onClick={() => chooseSubject(s.id)}
                  >
                    <span className="subject-dot" aria-hidden="true" />
                    <span className="subject-nav-name">{s.title[lang]}</span>
                    <span className="subject-nav-count">{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="catalog-main" ref={resultsRef}>
          <div className="toolbar catalog-toolbar">
            <label className="search">
              <Icon name="search" size={18} />
              <span className="sr-only">{t('searchPlaceholder')}</span>
              <input
                id="catalog-search"
                type="search"
                value={filters.query}
                onChange={updateFilter('query')}
                placeholder={t('searchPlaceholder')}
                maxLength={200}
                aria-describedby="catalog-result-count"
              />
            </label>
            <div className="catalog-filters" role="group" aria-label={t('catalogFiltersLabel')}>
              <label className="catalog-filter catalog-filter-subject" htmlFor="catalog-subject">
                <span>{t('filterSubject')}</span>
                <select id="catalog-subject" className="input" value={filters.subject} onChange={updateFilter('subject')}>
                  <option value="all">{t('catalogAllSubjects')}</option>
                  {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.title[lang]}</option>)}
                </select>
              </label>
              <label className="catalog-filter" htmlFor="catalog-grade">
                <span>{t('catalogGrade')}</span>
                <select id="catalog-grade" className="input" value={filters.grade} onChange={updateFilter('grade')}>
                  <option value="all">{t('catalogAllGrades')}</option>
                  <option value="none">{t('catalogGeneralDocs')}</option>
                  {choices.grade.filter((g) => !['all', 'none'].includes(g)).map((g) => <option key={g} value={g}>{t('gradeLabel', { g })}</option>)}
                </select>
              </label>
              <label className="catalog-filter" htmlFor="catalog-kind">
                <span>{t('catalogDocumentType')}</span>
                <select id="catalog-kind" className="input" value={filters.kind} onChange={updateFilter('kind')}>
                  <option value="all">{t('catalogAllTypes')}</option>
                  {choices.kind.filter((kind) => kind !== 'all').map((kind) => <option key={kind} value={kind}>{t(`kind_${kind}`)}</option>)}
                </select>
              </label>
              <label className="catalog-filter" htmlFor="catalog-format">
                <span>{t('catalogFormat')}</span>
                <select id="catalog-format" className="input" value={filters.format} onChange={updateFilter('format')}>
                  <option value="all">{t('catalogAllFormats')}</option>
                  {choices.format.filter((format) => format !== 'all').map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
                </select>
              </label>
            </div>
            <div className="catalog-results">
              <span id="catalog-result-count" role="status" aria-live="polite" aria-atomic="true">
                {t('catalogResults', { n: matches.length, total: DOCUMENTS.length })}
              </span>
              <button className="link-btn" type="button" disabled={!filtered} onClick={() => setFilters({ ...DEFAULT_CATALOG_FILTERS })}>
                {t('catalogReset')}
              </button>
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="empty">
              <Icon name="search" size={28} />
              <h2>{t('nothingFound')}</h2>
              <p>{t('catalogEmptyHint')}</p>
            </div>
          ) : (
            <div className="groups">
              {groups.map(({ subject, docs }) => (
                <section key={subject.id} className="group" style={hueStyle(subject.id)} aria-labelledby={`g-${subject.id}`}>
                  <header className="group-head">
                    <h2 id={`g-${subject.id}`}>
                      <span className="subject-dot" aria-hidden="true" />
                      {subject.title[lang]}
                    </h2>
                    <span className="group-meta">
                      {subject.grades ? <>{t('gradesLabel', { g: subject.grades })} · </> : null}
                      {t('docsCount', { n: docs.length })}
                    </span>
                  </header>
                  <ul className="doc-grid">
                    {docs.map((d) => (
                      <li key={d.id}>
                        <a className="doc-card" href={`#/doc/${d.id}`}>
                          <span className="doc-card-top">
                            <span className={`kind kind-${d.kind}`}>{t(`kind_${d.kind}`)}</span>
                            {d.part ? <span className="tag">{t(/[–-]/.test(d.part) ? 'partsLabel' : 'partLabel', { p: d.part })}</span> : null}
                            {d.lang === 'ru' ? <span className="tag" title={t('lang_ru')} aria-label={t('lang_ru')}>РУС</span> : null}
                            {d.lang === 'en' ? <span className="tag" title={t('lang_en')} aria-label={t('lang_en')}>ENG</span> : null}
                            {d.format && d.format !== 'docx' ? <span className="tag">{d.format.toUpperCase()}</span> : null}
                            {sent[d.id] ? (
                              <span className="sent-tag" title={t('sentBadge')}>
                                <Icon name="check" size={14} /> {sent[d.id]}
                              </span>
                            ) : null}
                          </span>
                          <span className="doc-card-title">{d.title[lang]}</span>
                          {d.note ? <span className="doc-card-note">{d.note[lang]}</span> : null}
                          {d.load?.[lang] || d.minutes ? (
                            <span className="doc-card-meta">
                              {d.load?.[lang] ? <span>{d.load[lang]}</span> : null}
                              {d.load?.[lang] && d.minutes ? <span aria-hidden="true">·</span> : null}
                              {d.minutes ? <span>{t('minutesRead', { n: d.minutes })}</span> : null}
                            </span>
                          ) : null}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
