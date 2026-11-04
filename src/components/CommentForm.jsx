import { useEffect, useId, useState } from 'react';
import Icon from './Icon.jsx';
import Recorder from './Recorder.jsx';
import { useI18n } from '../i18n.js';
import { api } from '../lib/api.js';
import { HEAD_OFFICE, HEAD_OFFICE_ID, OTHER_ID, SCHOOLS } from '../data/schools.js';
import { MAX_TEXT_LENGTH } from '../config.js';
import { readJSON, readString, writeJSON, writeString } from '../lib/storage.js';

const IDENTITY_KEY = 'zerdeli.expert';
const SENT_KEY = 'zerdeli.sent';

export function sentCounts() {
  return readJSON(SENT_KEY, {});
}

function schoolName(identity) {
  if (identity.schoolId === OTHER_ID) return identity.otherName.trim();
  if (identity.schoolId === HEAD_OFFICE_ID) return HEAD_OFFICE.kk;
  return SCHOOLS.find((s) => s.id === identity.schoolId)?.name || '';
}

function loadIdentity() {
  return { firstName: '', lastName: '', schoolId: '', otherName: '', ...readJSON(IDENTITY_KEY, {}) };
}

function identityComplete(identity) {
  return Boolean(identity.firstName.trim() && identity.lastName.trim() && schoolName(identity));
}

export default function CommentForm({ doc, sectionId, onSectionChange, docTitle }) {
  const { t, lang } = useI18n();
  const uid = useId();
  const draftKey = `zerdeli.draft.${doc.id}`;

  const [identity, setIdentity] = useState(loadIdentity);
  const [editingIdentity, setEditingIdentity] = useState(() => !identityComplete(loadIdentity()));
  const [mode, setMode] = useState('voice');
  const [text, setText] = useState(() => readString(draftKey, ''));
  const [audio, setAudio] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | sending | sent
  const [error, setError] = useState('');
  const [honey, setHoney] = useState('');
  const [sentHere, setSentHere] = useState(() => sentCounts()[doc.id] || 0);

  useEffect(() => {
    writeString(draftKey, text);
  }, [draftKey, text]);

  const update = (field) => (e) => setIdentity((prev) => ({ ...prev, [field]: e.target.value }));
  const section = doc.sections.find((s) => s.id === sectionId) || null;
  const hasContent = Boolean(text.trim()) || Boolean(audio);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!identityComplete(identity)) {
      setEditingIdentity(true);
      setError(t('needIdentity'));
      return;
    }
    if (!hasContent) {
      setError(t('needContent'));
      return;
    }
    setStatus('sending');
    try {
      if (!honey) {
        await api.submitComment({
          documentId: doc.id,
          sectionId: section?.id || null,
          sectionTitle: section?.title || null,
          firstName: identity.firstName,
          lastName: identity.lastName,
          school: schoolName(identity),
          body: text,
          audio,
          uiLang: lang,
        });
      }
      writeJSON(IDENTITY_KEY, identity);
      const counts = sentCounts();
      counts[doc.id] = (counts[doc.id] || 0) + 1;
      writeJSON(SENT_KEY, counts);
      setSentHere(counts[doc.id]);
      if (audio?.url) URL.revokeObjectURL(audio.url);
      setAudio(null);
      setText('');
      setEditingIdentity(false);
      setStatus('sent');
    } catch (err) {
      console.error(err);
      setStatus('idle');
      setError(t('sendError'));
    }
  }

  function another() {
    setStatus('idle');
    onSectionChange('');
  }

  if (status === 'sent') {
    return (
      <div className="cform cform-sent" role="status">
        <span className="sent-mark">
          <Icon name="checkCircle" size={28} />
        </span>
        <h2 className="cform-title">{t('sentTitle')}</h2>
        <p className="muted">{t('sentText', { doc: docTitle })}</p>
        <p className="sent-count">{t('sentHere', { n: sentHere })}</p>
        <button type="button" className="btn btn-primary btn-block" onClick={another}>
          {t('sentAnother')}
        </button>
      </div>
    );
  }

  const school = schoolName(identity);

  return (
    <form className="cform" onSubmit={submit} noValidate>
      <div className="cform-head">
        <h2 className="cform-title">{t('formTitle')}</h2>
        <p className="cform-privacy">
          <Icon name="lock" size={14} /> {t('formPrivacy')}
        </p>
      </div>

      {editingIdentity ? (
        <fieldset className="field-group">
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('firstName')}</span>
              <input
                id={`${uid}-first`}
                className="input"
                value={identity.firstName}
                onChange={update('firstName')}
                autoComplete="given-name"
                maxLength={80}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">{t('lastName')}</span>
              <input
                id={`${uid}-last`}
                className="input"
                value={identity.lastName}
                onChange={update('lastName')}
                autoComplete="family-name"
                maxLength={80}
                required
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">{t('school')}</span>
            <select id={`${uid}-school`} className="input" value={identity.schoolId} onChange={update('schoolId')} required>
              <option value="" disabled>
                {t('schoolPlaceholder')}
              </option>
              {SCHOOLS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value={HEAD_OFFICE_ID}>{HEAD_OFFICE[lang]}</option>
              <option value={OTHER_ID}>{t('otherOrg')}</option>
            </select>
          </label>
          {identity.schoolId === OTHER_ID ? (
            <label className="field">
              <span className="field-label">{t('otherOrgName')}</span>
              <input
                id={`${uid}-other`}
                className="input"
                value={identity.otherName}
                onChange={update('otherName')}
                maxLength={160}
              />
            </label>
          ) : null}
        </fieldset>
      ) : (
        <div className="identity">
          <span className="avatar" aria-hidden="true">
            {(identity.firstName.charAt(0) + identity.lastName.charAt(0)).toUpperCase()}
          </span>
          <span className="identity-text">
            <span className="identity-name">
              {identity.firstName} {identity.lastName}
            </span>
            <span className="identity-school">
              {identity.schoolId === HEAD_OFFICE_ID ? HEAD_OFFICE[lang] : school}
            </span>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingIdentity(true)}>
            {t('change')}
          </button>
        </div>
      )}

      <label className="field">
        <span className="field-label">{t('section')}</span>
        <select
          id={`${uid}-section`}
          className="input"
          value={sectionId}
          onChange={(e) => onSectionChange(e.target.value)}
        >
          <option value="">{t('wholeDocument')}</option>
          {doc.sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.level === 3 ? ' ' : ''}
              {s.title.length > 70 ? `${s.title.slice(0, 68)}…` : s.title}
            </option>
          ))}
        </select>
      </label>

      <div className="segmented" role="tablist" aria-label={t('formTitle')}>
        {[
          ['voice', 'mic', t('modeVoice'), Boolean(audio)],
          ['text', 'text', t('modeText'), Boolean(text.trim())],
        ].map(([key, icon, label, filled]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            className={`segmented-item${mode === key ? ' is-active' : ''}`}
            onClick={() => setMode(key)}
          >
            <Icon name={icon} size={16} /> {label}
            {filled ? <span className="filled-dot" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>

      {mode === 'voice' ? (
        <Recorder value={audio} onChange={setAudio} />
      ) : (
        <label className="field">
          <span className="sr-only">{t('modeText')}</span>
          <textarea
            id={`${uid}-text`}
            className="input textarea"
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_LENGTH))}
            placeholder={t('textPlaceholder')}
          />
          {text.length > MAX_TEXT_LENGTH - 500 ? (
            <span className="field-note">{t('charsLeft', { n: MAX_TEXT_LENGTH - text.length })}</span>
          ) : null}
        </label>
      )}

      <input
        className="hp"
        tabIndex={-1}
        autoComplete="off"
        name="website"
        value={honey}
        onChange={(e) => setHoney(e.target.value)}
        aria-hidden="true"
      />

      {error ? (
        <p className="field-error" role="alert">
          <Icon name="alert" size={16} /> {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={status === 'sending'}>
        {status === 'sending' ? (
          <>
            <span className="spinner" aria-hidden="true" /> {t('sending')}
          </>
        ) : (
          t('submit')
        )}
      </button>
      {sentHere > 0 ? <p className="sent-count">{t('sentHere', { n: sentHere })}</p> : null}
    </form>
  );
}
