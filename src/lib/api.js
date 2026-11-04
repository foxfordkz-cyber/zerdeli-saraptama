// One interface, two backends: Supabase in production, browser storage in
// demo mode (no keys configured) so the site can be tried before setup.
import { AUDIO_BUCKET, IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from '../config.js';

const SIGNED_URL_TTL_SEC = 60 * 60;
const EXPORT_URL_TTL_SEC = 7 * 24 * 60 * 60;

function newId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  // Fallback for older browsers: RFC 4122 v4 from getRandomValues.
  const b = window.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function toRow(id, c, audioPath) {
  return {
    id,
    document_id: c.documentId,
    section_id: c.sectionId || null,
    section_title: c.sectionTitle || null,
    first_name: c.firstName.trim(),
    last_name: c.lastName.trim(),
    school: c.school.trim(),
    body: c.body?.trim() ? c.body.trim() : null,
    audio_path: audioPath,
    audio_duration_sec: c.audio ? Math.min(330, Math.max(1, Math.round(c.audio.duration))) : null,
    audio_mime: c.audio ? c.audio.mime : null,
    ui_lang: c.uiLang,
  };
}

/* ---------------------------------------------------------------- Supabase */

let clientPromise = null;
function client() {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'zerdeli.admin.session' },
      }),
    );
  }
  return clientPromise;
}

const supabaseApi = {
  demo: false,

  async submitComment(c) {
    const sb = await client();
    const id = newId();
    let audioPath = null;
    if (c.audio) {
      audioPath = `${c.documentId}/${id}.${c.audio.ext}`;
      const { error } = await sb.storage
        .from(AUDIO_BUCKET)
        .upload(audioPath, c.audio.blob, { contentType: c.audio.mime, upsert: false });
      if (error) throw error;
    }
    const { error } = await sb.from('comments').insert(toRow(id, c, audioPath));
    if (error) throw error;
    return id;
  },

  async getSession() {
    const sb = await client();
    const { data } = await sb.auth.getSession();
    return data.session ? { email: data.session.user.email } : null;
  },

  async signIn(email, password) {
    const sb = await client();
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  },

  async signOut() {
    const sb = await client();
    await sb.auth.signOut();
  },

  async isAdmin() {
    const sb = await client();
    const { data, error } = await sb.rpc('is_admin');
    if (error) throw error;
    return data === true;
  },

  async listComments() {
    const sb = await client();
    const { data, error } = await sb
      .from('comments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) throw error;
    return data;
  },

  async setStatus(id, status) {
    const sb = await client();
    const { error } = await sb.from('comments').update({ status }).eq('id', id);
    if (error) throw error;
  },

  async deleteComment(comment) {
    const sb = await client();
    if (comment.audio_path) await sb.storage.from(AUDIO_BUCKET).remove([comment.audio_path]);
    const { error } = await sb.from('comments').delete().eq('id', comment.id);
    if (error) throw error;
  },

  async audioUrl(path, { download } = {}) {
    const sb = await client();
    const { data, error } = await sb.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SEC, download ? { download } : undefined);
    if (error) throw error;
    return data.signedUrl;
  },

  async exportAudioUrls(paths) {
    if (!paths.length) return {};
    const sb = await client();
    const { data, error } = await sb.storage.from(AUDIO_BUCKET).createSignedUrls(paths, EXPORT_URL_TTL_SEC);
    if (error) throw error;
    return Object.fromEntries(data.filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
  },
};

/* ---------------------------------------------------------------- Demo */

const DEMO_KEY = 'zerdeli.demo.comments';
const DEMO_SESSION = 'zerdeli.demo.session';

function demoRows() {
  try {
    return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveDemoRows(rows) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(rows));
}

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('zerdeli-demo', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('audio');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audio', mode);
    const req = fn(tx.objectStore('audio'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const demoApi = {
  demo: true,

  async submitComment(c) {
    const id = newId();
    let audioPath = null;
    if (c.audio) {
      audioPath = `${c.documentId}/${id}.${c.audio.ext}`;
      await idbOp('readwrite', (s) => s.put(c.audio.blob, audioPath));
    }
    const row = { ...toRow(id, c, audioPath), created_at: new Date().toISOString(), status: 'new' };
    saveDemoRows([row, ...demoRows()]);
    return id;
  },
  async getSession() {
    return localStorage.getItem(DEMO_SESSION) ? { email: 'demo' } : null;
  },
  async signIn() {
    localStorage.setItem(DEMO_SESSION, '1');
  },
  async signOut() {
    localStorage.removeItem(DEMO_SESSION);
  },
  async isAdmin() {
    return true;
  },
  async listComments() {
    return demoRows();
  },
  async setStatus(id, status) {
    saveDemoRows(demoRows().map((r) => (r.id === id ? { ...r, status } : r)));
  },
  async deleteComment(comment) {
    if (comment.audio_path) await idbOp('readwrite', (s) => s.delete(comment.audio_path));
    saveDemoRows(demoRows().filter((r) => r.id !== comment.id));
  },
  async audioUrl(path) {
    const blob = await idbOp('readonly', (s) => s.get(path));
    if (!blob) throw new Error('missing audio');
    return URL.createObjectURL(blob);
  },
  async exportAudioUrls() {
    return {};
  },
};

export const api = IS_DEMO ? demoApi : supabaseApi;
