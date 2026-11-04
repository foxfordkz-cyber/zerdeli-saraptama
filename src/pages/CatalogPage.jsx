import { useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { useI18n } from '../i18n.js';
import { DOCUMENTS, SUBJECTS, gradeSpan } from '../lib/catalog.js';
import { normalize } from '../lib/format.js';
import { sentCounts } from '../components/CommentForm.jsx';

function haystack(doc, subject) {
  return normalize(
    [
      subject.title.kk,
      subject.title.ru,
      doc.title.kk,
      doc.title.ru,
      doc.note?.kk,
      doc.note?.ru,
      `${doc.grade} сынып`,
      `${doc.grade} класс`,
      doc.kind === 'program' ? 'бағдарлама программа' : doc.kind === 'appendix' ? 'қосымша приложение' : 'тұжырымдама концепция',
      doc.lang === 'ru' ? 'рус орыс' : '',
    ].join(' '),
  );
}

export default function CatalogPage() {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const sent = useMemo(() => sentCounts(), []);

  const index = useMemo(
    () => DOCUMENTS.map((d) => ({ doc: d, text: haystack(d, SUBJECTS.find((s) => s.id === d.subject)) })),
    [],
  );

  const groups = useMemo(() => {
    const words = normalize(query).split(' ').filter(Boolean);
    const matches = index
      .filter(({ doc }) => subjectFilter === 'all' || doc.subject === subjectFilter)
      .filter(({ text }) => words.every((w) => text.includes(w)))
      .map(({ doc }) => doc);
    return SUBJECTS.map((s) => ({ subject: s, docs: matches.filter((d) => d.subject === s.id) })).filter(
      (g) => g.docs.length > 0,
    );
  }, [index, query, subjectFilter]);

  return (
    <div className="page catalog">
      <section className="hero">
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

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={18} />
          <span className="sr-only">{t('searchPlaceholder')}</span>
          <input
            id="catalog-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
          />
        </label>
        <div className="chips" role="group" aria-label={t('filterSubject')}>
          <button
            type="button"
            className={`chip${subjectFilter === 'all' ? ' is-active' : ''}`}
            aria-pressed={subjectFilter === 'all'}
            onClick={() => setSubjectFilter('all')}
          >
            {t('allSubjects')}
          </button>
          {SUBJECTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip${subjectFilter === s.id ? ' is-active' : ''}`}
              aria-pressed={subjectFilter === s.id}
              onClick={() => setSubjectFilter(subjectFilter === s.id ? 'all' : s.id)}
            >
              {s.title[lang]}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          <Icon name="search" size={28} />
          <h2>{t('nothingFound')}</h2>
          <p>{t('nothingFoundHint')}</p>
        </div>
      ) : (
        <div className="groups">
          {groups.map(({ subject, docs }) => (
            <section key={subject.id} className="group" aria-labelledby={`g-${subject.id}`}>
              <header className="group-head">
                <h2 id={`g-${subject.id}`}>{subject.title[lang]}</h2>
                <span className="group-meta">
                  {t('gradesLabel', { g: subject.grades })} · {t('docsCount', { n: docs.length })}
                </span>
              </header>
              <ul className="doc-grid">
                {docs.map((d) => (
                  <li key={d.id}>
                    <a className="doc-card" href={`#/doc/${d.id}`}>
                      <span className="doc-card-top">
                        <span className={`kind kind-${d.kind}`}>{t(`kind_${d.kind}`)}</span>
                        {d.lang === 'ru' ? <span className="tag">РУС</span> : null}
                        {sent[d.id] ? (
                          <span className="sent-tag" title={t('sentBadge')}>
                            <Icon name="check" size={14} /> {sent[d.id]}
                          </span>
                        ) : null}
                      </span>
                      <span className="doc-card-title">{d.title[lang]}</span>
                      {d.note ? <span className="doc-card-note">{d.note[lang]}</span> : null}
                      <span className="doc-card-meta">
                        <span>{d.load[lang]}</span>
                        <span aria-hidden="true">·</span>
                        <span>{t('minutesRead', { n: d.minutes })}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
