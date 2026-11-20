import { useCallback, useEffect, useMemo, useState } from 'react';
import { LangContext, translate } from './i18n.js';
import { IS_DEMO } from './config.js';
import { readString, writeString } from './lib/storage.js';
import Icon from './components/Icon.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import DocumentPage from './pages/DocumentPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { parseHash } from './lib/routing.js';
import { documentLabel, getDocument } from './lib/catalog.js';

function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export default function App() {
  const route = useRoute();
  const [lang, setLangState] = useState(() => (readString('zerdeli.lang') === 'ru' ? 'ru' : 'kk'));
  const [theme, setTheme] = useState(() => {
    const saved = readString('zerdeli.theme');
    return saved === 'dark' || saved === 'light' ? saved : null;
  });

  const setLang = useCallback((next) => {
    setLangState(next);
    writeString('zerdeli.lang', next);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
    const currentDoc = route.name === 'doc' ? getDocument(route.id) : null;
    const title = currentDoc ? documentLabel(currentDoc, lang)
      : route.name === 'admin' ? translate(lang, 'adminTitle') : translate(lang, 'heroTitle');
    document.title = `${title} · ${translate(lang, 'brand')}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', translate(lang, 'heroLead'));
  }, [lang, route.name, route.id]);

  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }, [theme]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.name, route.id]);

  const isDark = theme ? theme === 'dark' : systemPrefersDark();
  function toggleTheme() {
    const next = isDark ? 'light' : 'dark';
    setTheme(next);
    writeString('zerdeli.theme', next);
  }

  const i18n = useMemo(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  const { t } = i18n;

  return (
    <LangContext.Provider value={i18n}>
      <a className="skip-link" href="#main" onClick={(e) => {
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        {t('skipToContent')}
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/" aria-label={`${t('brand')} ${t('brandSub')}`}>
            <span className="brand-mark" aria-hidden="true">
              Z
            </span>
            <span className="brand-text">
              <span className="brand-name">{t('brand')}</span>
              <span className="brand-sub">{t('brandSub')}</span>
            </span>
          </a>
          <div className="topbar-actions">
            <a
              className="btn btn-secondary manager-link"
              href="#/admin"
              aria-label={t('adminTitle')}
              aria-current={route.name === 'admin' ? 'page' : undefined}
            >
              <Icon name="lock" size={16} />
              <span className="manager-full">{t('adminTitle')}</span>
              <span className="manager-short">{t('adminShort')}</span>
            </a>
            <div className="lang-switch" role="group" aria-label={t('languageLabel')}>
              {['kk', 'ru'].map((code) => (
                <button
                  key={code}
                  type="button"
                  className={lang === code ? 'is-active' : ''}
                  aria-pressed={lang === code}
                  aria-label={t(code === 'kk' ? 'switchToKk' : 'switchToRu')}
                  title={t(code === 'kk' ? 'switchToKk' : 'switchToRu')}
                  onClick={() => setLang(code)}
                >
                  {code === 'kk' ? t('langKk') : t('langRu')}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              aria-label={isDark ? t('themeLight') : t('themeDark')}
              title={isDark ? t('themeLight') : t('themeDark')}
            >
              <Icon name={isDark ? 'sun' : 'moon'} size={18} />
            </button>
          </div>
        </div>
      </header>

      {IS_DEMO ? (
        <div className="demo-banner" role="note">
          <div className="demo-banner-inner">{t('demoBanner')}</div>
        </div>
      ) : null}

      <main id="main" tabIndex={-1} className={`main main-${route.name}`}>
        {route.name === 'doc' ? <DocumentPage key={route.id} id={route.id} initialSection={route.section} /> : null}
        {route.name === 'admin' ? <AdminPage /> : null}
        {route.name === 'catalog' ? <CatalogPage /> : null}
      </main>

      {route.name !== 'admin' ? (
        <footer className="footer">
          <div className="footer-inner">
            <span>Zerdeli Group · 2026–2027 · {t('footerNote')}</span>
            <a href="#/admin">{t('footerAdmin')}</a>
          </div>
        </footer>
      ) : null}
    </LangContext.Provider>
  );
}
