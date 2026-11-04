import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import AudioPlayer from '../components/AudioPlayer.jsx';
import { useI18n } from '../i18n.js';
import { api } from '../lib/api.js';
import { DOCUMENTS, SUBJECTS, documentLabel, getDocument, getSubject } from '../lib/catalog.js';
import { formatDateTime, formatNumber, formatSortable, formatTime, formatTotalAudio, initials, normalize } from '../lib/format.js';
import { HEAD_OFFICE } from '../data/schools.js';

const EMPTY_FILTERS = { q: '', subject: '', doc: '', school: '', type: '', status: '' };
const UNCOVERED_PREVIEW = 12;

function expertKey(c) {
  return normalize(`${c.first_name} ${c.last_name} ${c.school}`);
}

function schoolLabel(name, lang) {
  return name === HEAD_OFFICE.kk ? HEAD_OFFICE[lang] : name;
}

/* ------------------------------------------------------------ Login */

function LoginCard({ onSignedIn, denied }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(denied ? t('noAccess') : '');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.signIn(email, password);
      await onSignedIn();
    } catch {
      setError(t('signInError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <span className="login-icon">
          <Icon name="lock" size={22} />
        </span>
        <h1>{t('adminTitle')}</h1>
        <p className="muted">{t('adminLoginLead')}</p>
        {api.demo ? (
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {t('demoSignIn')}
          </button>
        ) : (
          <>
            <label className="field">
              <span className="field-label">{t('email')}</span>
              <input
                id="admin-email"
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">{t('password')}</span>
              <input
                id="admin-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
              {busy ? t('signingIn') : t('signIn')}
            </button>
          </>
        )}
        {error ? (
          <p className="field-error" role="alert">
            <Icon name="alert" size={16} /> {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}

/* ------------------------------------------------------------ Figures */

function StatTile({ label, value, sub, meter }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {meter != null ? (
        <span className="meter" role="img" aria-label={`${Math.round(meter * 100)}%`}>
          <span style={{ width: `${Math.round(meter * 100)}%` }} />
        </span>
      ) : null}
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

// Ranked horizontal bars, one hue; a row click filters the feed.
function BarList({ title, hint, rows, activeId, onPick, lang }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        <span className="panel-hint">{hint}</span>
      </header>
      <ul className="bars">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={`bar-row${activeId === r.id ? ' is-active' : ''}${r.count === 0 ? ' is-zero' : ''}`}
              onClick={() => onPick(activeId === r.id ? '' : r.id)}
              aria-pressed={activeId === r.id}
              title={`${r.label}: ${r.count}`}
            >
              <span className="bar-label">{r.label}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
              </span>
              <span className="bar-value">{formatNumber(r.count, lang)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------ Feed item */

function CommentCard({ c, onStatus, onDelete }) {
  const { t, lang } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const doc = getDocument(c.document_id);
  const loadSrc = useCallback(() => api.audioUrl(c.audio_path), [c.audio_path]);

  async function toggleStatus() {
    setBusy(true);
    try {
      await onStatus(c, c.status === 'done' ? 'new' : 'done');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await onDelete(c);
    } finally {
      setBusy(false);
    }
  }

  async function downloadAudio() {
    const ext = c.audio_path.split('.').pop();
    const name = `${c.last_name}_${c.first_name}_${c.document_id}.${ext}`;
    const url = api.demo ? await api.audioUrl(c.audio_path) : await api.audioUrl(c.audio_path, { download: name });
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <article className={`ccard${c.status === 'new' ? ' is-new' : ''}`}>
      <header className="ccard-head">
        <span className="avatar" aria-hidden="true">
          {initials(c.first_name, c.last_name)}
        </span>
        <span className="ccard-who">
          <span className="ccard-name">
            {c.first_name} {c.last_name}
          </span>
          <span className="ccard-school">{schoolLabel(c.school, lang)}</span>
        </span>
        <span className="ccard-side">
          <span className={`pill pill-${c.status}`}>{c.status === 'new' ? t('statusNew') : t('statusDone')}</span>
          <time dateTime={c.created_at}>{formatDateTime(c.created_at, lang)}</time>
        </span>
      </header>

      <a className="ccard-doc" href={`#/doc/${c.document_id}`}>
        <Icon name="doc" size={16} />
        <span>
          {doc ? documentLabel(doc, lang) : c.document_id}
          {c.section_title ? <span className="ccard-section"> › {c.section_title}</span> : null}
        </span>
      </a>

      {c.audio_path ? (
        <div className="ccard-audio">
          <AudioPlayer loadSrc={loadSrc} duration={c.audio_duration_sec} showRate />
        </div>
      ) : null}
      {c.body ? <p className="ccard-body">{c.body}</p> : null}

      <footer className="ccard-actions">
        {confirming ? (
          <>
            <span className="confirm-text">{t('deleteConfirm')}</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={busy}>
              {t('deleteYes')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={toggleStatus} disabled={busy}>
              <Icon name={c.status === 'done' ? 'redo' : 'check'} size={16} />
              {c.status === 'done' ? t('markNew') : t('markDone')}
            </button>
            {c.audio_path ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={downloadAudio}>
                <Icon name="download" size={16} /> {t('downloadAudio')}
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost btn-sm btn-quiet-danger" onClick={() => setConfirming(true)}>
              <Icon name="trash" size={16} /> {t('delete')}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------ CSV */

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv(rows, t, lang) {
  const urls = await api.exportAudioUrls(rows.filter((r) => r.audio_path).map((r) => r.audio_path)).catch(() => ({}));
  const header = [
    t('csvDate'), t('csvFirst'), t('csvLast'), t('csvSchool'), t('csvSubject'), t('csvDoc'),
    t('csvSection'), t('csvType'), t('csvText'), t('csvDuration'), t('csvAudio'), t('csvStatus'),
  ];
  const lines = rows.map((r) => {
    const doc = getDocument(r.document_id);
    const subject = doc ? getSubject(doc.subject) : null;
    const type = [r.audio_path ? t('typeVoice') : '', r.body ? t('typeText') : ''].filter(Boolean).join(' + ');
    return [
      formatSortable(r.created_at),
      r.first_name,
      r.last_name,
      schoolLabel(r.school, lang),
      subject ? subject.title[lang] : '',
      doc ? doc.title[lang] + (doc.lang === 'ru' ? ' (RU)' : '') : r.document_id,
      r.section_title || '',
      type,
      r.body || '',
      r.audio_duration_sec || '',
      r.audio_path ? urls[r.audio_path] || '' : '',
      r.status === 'new' ? t('statusNew') : t('statusDone'),
    ]
      .map(csvCell)
      .join(';');
  });
  const csv = '﻿' + [header.map(csvCell).join(';'), ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `zerdeli-pikirler-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------------------------------------ Page */

export default function AdminPage() {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState('checking'); // checking | login | denied | ready
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showAllUncovered, setShowAllUncovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setComments(await api.listComments());
      setUpdatedAt(new Date());
    } catch (err) {
      console.error(err);
      setLoadError(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const checkAccess = useCallback(async () => {
    const session = await api.getSession();
    if (!session) return setPhase('login');
    const ok = await api.isAdmin().catch(() => false);
    if (!ok) {
      await api.signOut();
      return setPhase('denied');
    }
    setPhase('ready');
    load();
  }, [load]);

  useEffect(() => {
    checkAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const docIds = new Set(DOCUMENTS.map((d) => d.id));
    const covered = new Set(comments.map((c) => c.document_id).filter((id) => docIds.has(id)));
    const voice = comments.filter((c) => c.audio_path);
    const seconds = voice.reduce((sum, c) => sum + (c.audio_duration_sec || 0), 0);
    const bySubject = new Map(SUBJECTS.map((s) => [s.id, 0]));
    const bySchool = new Map();
    for (const c of comments) {
      const doc = getDocument(c.document_id);
      if (doc) bySubject.set(doc.subject, (bySubject.get(doc.subject) || 0) + 1);
      bySchool.set(c.school, (bySchool.get(c.school) || 0) + 1);
    }
    return {
      total: comments.length,
      fresh: comments.filter((c) => c.status === 'new').length,
      voice: voice.length,
      audioTotal: formatTotalAudio(seconds),
      experts: new Set(comments.map(expertKey)).size,
      schools: bySchool.size,
      covered: covered.size,
      uncovered: DOCUMENTS.filter((d) => !covered.has(d.id)),
      subjectRows: SUBJECTS.map((s) => ({ id: s.id, label: s.title[lang], count: bySubject.get(s.id) || 0 })).sort(
        (a, b) => b.count - a.count,
      ),
      schoolRows: [...bySchool.entries()]
        .map(([name, count]) => ({ id: name, label: schoolLabel(name, lang), count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [comments, lang]);

  const schoolOptions = useMemo(() => [...new Set(comments.map((c) => c.school))].sort(), [comments]);
  const docOptions = useMemo(
    () => DOCUMENTS.filter((d) => !filters.subject || d.subject === filters.subject),
    [filters.subject],
  );

  const visible = useMemo(() => {
    const words = normalize(filters.q).split(' ').filter(Boolean);
    return comments.filter((c) => {
      const doc = getDocument(c.document_id);
      if (filters.subject && doc?.subject !== filters.subject) return false;
      if (filters.doc && c.document_id !== filters.doc) return false;
      if (filters.school && c.school !== filters.school) return false;
      if (filters.type === 'voice' && !c.audio_path) return false;
      if (filters.type === 'text' && !c.body) return false;
      if (filters.status && c.status !== filters.status) return false;
      if (words.length) {
        const text = normalize(`${c.first_name} ${c.last_name} ${c.school} ${c.body || ''} ${c.section_title || ''}`);
        if (!words.every((w) => text.includes(w))) return false;
      }
      return true;
    });
  }, [comments, filters]);

  const setFilter = (key) => (value) =>
    setFilters((prev) => ({ ...prev, [key]: value, ...(key === 'subject' ? { doc: '' } : {}) }));
  const filtersActive = Object.values(filters).some(Boolean);

  async function onStatus(c, status) {
    await api.setStatus(c.id, status);
    setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, status } : x)));
  }

  async function onDelete(c) {
    await api.deleteComment(c);
    setComments((prev) => prev.filter((x) => x.id !== c.id));
  }

  async function signOut() {
    await api.signOut();
    setComments([]);
    setPhase('login');
  }

  async function copySiteLink() {
    const link = `${window.location.origin}${window.location.pathname}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt?.(t('copyLink'), link);
    }
  }

  async function onExport() {
    setExporting(true);
    try {
      await exportCsv(visible, t, lang);
    } finally {
      setExporting(false);
    }
  }

  if (phase === 'checking') {
    return (
      <div className="page">
        <div className="doc-loading">
          <span className="spinner" aria-hidden="true" />
        </div>
      </div>
    );
  }
  if (phase === 'login' || phase === 'denied') {
    return <LoginCard onSignedIn={checkAccess} denied={phase === 'denied'} />;
  }

  const uncoveredShown = showAllUncovered ? stats.uncovered : stats.uncovered.slice(0, UNCOVERED_PREVIEW);

  return (
    <div className="page admin">
      <header className="admin-head">
        <div>
          <p className="eyebrow">{t('adminTitle')}</p>
          <h1 className="admin-title">{t('feedbackTitle')}</h1>
          {updatedAt ? <p className="muted">{t('updatedAt', { t: formatTime(updatedAt) })}</p> : null}
        </div>
        <div className="admin-actions">
          <button type="button" className="btn btn-ghost" onClick={copySiteLink}>
            <Icon name={copied ? 'check' : 'copy'} size={18} /> {copied ? t('linkCopied') : t('copyLink')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
            <Icon name="refresh" size={18} /> {t('refresh')}
          </button>
          <button type="button" className="btn btn-primary" onClick={onExport} disabled={exporting || !visible.length}>
            <Icon name="table" size={18} /> {t('exportCsv')}
          </button>
          <button type="button" className="icon-btn" onClick={signOut} aria-label={t('signOut')} title={t('signOut')}>
            <Icon name="logout" size={18} />
          </button>
        </div>
      </header>

      {loadError ? (
        <p className="field-error" role="alert">
          <Icon name="alert" size={16} /> {loadError}
        </p>
      ) : null}

      <div className="stats">
        <StatTile label={t('kpiTotal')} value={formatNumber(stats.total, lang)} sub={t('kpiTotalSub', { n: stats.fresh })} />
        <StatTile label={t('kpiVoice')} value={formatNumber(stats.voice, lang)} sub={t('kpiVoiceSub', { m: stats.audioTotal })} />
        <StatTile
          label={t('kpiExperts')}
          value={formatNumber(stats.experts, lang)}
          sub={t('kpiExpertsSub', { n: stats.schools })}
        />
        <StatTile
          label={t('kpiCoverage')}
          value={`${stats.covered} / ${DOCUMENTS.length}`}
          meter={stats.covered / DOCUMENTS.length}
          sub={t('kpiCoverageSub', { n: stats.uncovered.length })}
        />
      </div>

      <div className="panels">
        <BarList
          title={t('bySubject')}
          hint={t('byHint')}
          rows={stats.subjectRows}
          activeId={filters.subject}
          onPick={setFilter('subject')}
          lang={lang}
        />
        <div className="panel-stack">
          {stats.schoolRows.length ? (
            <BarList
              title={t('bySchool')}
              hint={t('byHint')}
              rows={stats.schoolRows}
              activeId={filters.school}
              onPick={setFilter('school')}
              lang={lang}
            />
          ) : null}
          <section className="panel">
            <header className="panel-head">
              <h2>{t('uncovered')}</h2>
              <span className="panel-hint">{stats.uncovered.length}</span>
            </header>
            {stats.uncovered.length ? (
              <ul className="uncovered">
                {uncoveredShown.map((d) => (
                  <li key={d.id}>
                    <a href={`#/doc/${d.id}`}>{documentLabel(d, lang)}</a>
                  </li>
                ))}
                {stats.uncovered.length > UNCOVERED_PREVIEW ? (
                  <li>
                    <button type="button" className="link-btn" onClick={() => setShowAllUncovered((v) => !v)}>
                      {showAllUncovered
                        ? t('showLess')
                        : t('showMore', { n: stats.uncovered.length - UNCOVERED_PREVIEW })}
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="muted">{t('uncoveredNone')}</p>
            )}
          </section>
        </div>
      </div>

      <section className="feed" aria-labelledby="feed-title">
        <div className="filters">
          <label className="search">
            <Icon name="search" size={18} />
            <span className="sr-only">{t('filterSearch')}</span>
            <input
              id="feed-search"
              type="search"
              value={filters.q}
              onChange={(e) => setFilter('q')(e.target.value)}
              placeholder={t('filterSearch')}
            />
          </label>
          <select id="f-subject" className="input" value={filters.subject} onChange={(e) => setFilter('subject')(e.target.value)} aria-label={t('filterSubject')}>
            <option value="">{t('filterSubject')}: {t('any')}</option>
            {SUBJECTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title[lang]}
              </option>
            ))}
          </select>
          <select id="f-doc" className="input" value={filters.doc} onChange={(e) => setFilter('doc')(e.target.value)} aria-label={t('filterDocument')}>
            <option value="">{t('filterDocument')}: {t('any')}</option>
            {docOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {documentLabel(d, lang)}
              </option>
            ))}
          </select>
          <select id="f-school" className="input" value={filters.school} onChange={(e) => setFilter('school')(e.target.value)} aria-label={t('filterSchool')}>
            <option value="">{t('filterSchool')}: {t('any')}</option>
            {schoolOptions.map((s) => (
              <option key={s} value={s}>
                {schoolLabel(s, lang)}
              </option>
            ))}
          </select>
          <select id="f-type" className="input" value={filters.type} onChange={(e) => setFilter('type')(e.target.value)} aria-label={t('filterType')}>
            <option value="">{t('filterType')}: {t('any')}</option>
            <option value="voice">{t('typeVoice')}</option>
            <option value="text">{t('typeText')}</option>
          </select>
          <select id="f-status" className="input" value={filters.status} onChange={(e) => setFilter('status')(e.target.value)} aria-label={t('filterStatus')}>
            <option value="">{t('filterStatus')}: {t('any')}</option>
            <option value="new">{t('statusNew')}</option>
            <option value="done">{t('statusDone')}</option>
          </select>
        </div>

        <div className="feed-head">
          <h2 id="feed-title">{t('resultsCount', { n: visible.length })}</h2>
          {filtersActive ? (
            <button type="button" className="link-btn" onClick={() => setFilters(EMPTY_FILTERS)}>
              {t('resetFilters')}
            </button>
          ) : null}
        </div>

        {visible.length ? (
          <div className="feed-list">
            {visible.map((c) => (
              <CommentCard key={c.id} c={c} onStatus={onStatus} onDelete={onDelete} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <Icon name="comment" size={28} />
            <h3>{comments.length ? t('emptyFiltered') : t('emptyFeed')}</h3>
            {comments.length ? null : <p>{t('emptyFeedHint')}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

