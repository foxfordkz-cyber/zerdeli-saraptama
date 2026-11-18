// One interface, two backends: Supabase in production, browser storage in
// demo mode (no keys configured) so the site can be tried before setup.
import { AUDIO_BUCKET, IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from '../config.js';

const SIGNED_URL_TTL_SEC = 60 * 60;
const EXPORT_URL_TTL_SEC = 7 * 24 * 60 * 60;

export function csvCell(value) {
  let text = value == null ? '' : String(value);
  // Expert-entered text must remain text when opened in Excel/LibreOffice.
  if (typeof value !== 'number' && /^[\s\x00-\x1f]*[=+@-]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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

export function createSupabaseApi(getClient = client) {
  return {
    demo: false,

    async submitComment(c) {
      const sb = await getClient();
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
      if (error) {
        // Only clean up after a definite database rejection. A lost response can
        // mean the insert succeeded; deleting its recording would lose feedback.
        // Anonymous users intentionally have no delete permission, so abandoned
        // uploads still require server-side retention/cleanup in production.
        if (audioPath && /^(22|23|42)/.test(error.code || '') && error.code !== '23505') {
          try {
            const cleanup = await sb.storage.from(AUDIO_BUCKET).remove([audioPath]);
            if (cleanup.error) error.audioCleanupFailed = true;
          } catch {
            error.audioCleanupFailed = true;
          }
        }
        throw error;
      }
      return id;
    },

    async getSession() {
      const sb = await getClient();
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      return data.session ? { email: data.session.user.email } : null;
    },

    async signIn(email, password) {
      const sb = await getClient();
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    },

    async signOut() {
      const sb = await getClient();
      const { error } = await sb.auth.signOut();
      if (error) throw error;
    },

    async isAdmin() {
      const sb = await getClient();
      const { data, error } = await sb.rpc('is_admin');
      if (error) throw error;
      return data === true;
    },

    async listComments() {
      const sb = await getClient();
      const rows = [];
      let cursor = null;
      // Keyset pagination prevents incoming comments from shifting page offsets.
      // Stop on an empty page, so a lower server row limit cannot truncate export.
      for (;;) {
        let query = sb.from('comments').select('*')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }).limit(1000);
        if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
        const { data, error } = await query;
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error('Invalid comments response');
        if (!data.length) return rows;
        const last = data[data.length - 1];
        if (!last.id || !last.created_at || (cursor?.id === last.id)) throw new Error('Comments pagination did not advance');
        rows.push(...data);
        cursor = last;
      }
    },

    async setStatus(id, status) {
      const sb = await getClient();
      const { error } = await sb.from('comments').update({ status }).eq('id', id).select('id').single();
      if (error) throw error;
    },

    async deleteComment(comment) {
      const sb = await getClient();
      const { error } = await sb.from('comments').delete().eq('id', comment.id).select('id').single();
      if (error) throw error;
      if (comment.audio_path) {
        try {
          const cleanup = await sb.storage.from(AUDIO_BUCKET).remove([comment.audio_path]);
          return { audioCleanupFailed: Boolean(cleanup.error) };
        } catch {
          return { audioCleanupFailed: true };
        }
      }
      return { audioCleanupFailed: false };
    },

    async audioUrl(path, { download } = {}) {
      const sb = await getClient();
      const { data, error } = await sb.storage
        .from(AUDIO_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SEC, download ? { download } : undefined);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('Missing signed audio URL');
      return data.signedUrl;
    },

    async exportAudioUrls(paths) {
      if (!paths.length) return {};
      const sb = await getClient();
      const uniquePaths = [...new Set(paths)];
      const urls = {};
      for (let i = 0; i < uniquePaths.length; i += 100) {
        const batch = uniquePaths.slice(i, i + 100);
        const { data, error } = await sb.storage.from(AUDIO_BUCKET).createSignedUrls(batch, EXPORT_URL_TTL_SEC);
        if (error) throw error;
        for (const item of data || []) {
          if (item.error || !item.signedUrl || !item.path) throw new Error('An audio export link could not be created');
          urls[item.path] = item.signedUrl;
        }
        if (batch.some((path) => !urls[path])) throw new Error('An audio export link is missing');
      }
      return urls;
    },
  };
}

const supabaseApi = createSupabaseApi();

/* ---------------------------------------------------------------- Demo */

const DEMO_KEY = 'zerdeli.demo.comments';
const DEMO_SESSION = 'zerdeli.demo.session';

export function parseDemoRows(raw) {
  const value = JSON.parse(raw || '[]');
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== 'object'
    || !['id', 'document_id', 'first_name', 'last_name', 'school', 'created_at'].every((key) => typeof row[key] === 'string')
    || !['new', 'done'].includes(row.status)
    || !Number.isFinite(Date.parse(row.created_at))
    || (row.body != null && typeof row.body !== 'string')
    || (row.audio_path != null && typeof row.audio_path !== 'string')
    || (row.audio_duration_sec != null && !Number.isFinite(row.audio_duration_sec)))) {
    throw new Error('Invalid demo comments. Existing browser data was not overwritten.');
  }
  return value;
}
function demoRows() {
  // Fail visibly instead of silently replacing damaged saved feedback with [].
  return parseDemoRows(localStorage.getItem(DEMO_KEY));
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
export async function idbOp(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('audio', mode);
      const req = fn(tx.objectStore('audio'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onabort = () => reject(tx.error || new Error('Audio storage transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('Audio storage failed'));
    });
  } finally {
    db.close();
  }
}

const demoApi = {
  demo: true,

  async submitComment(c) {
    demoRows(); // Validate saved data before storing a new recording.
    const id = newId();
    let audioPath = null;
    if (c.audio) {
      audioPath = `${c.documentId}/${id}.${c.audio.ext}`;
      await idbOp('readwrite', (s) => s.put(c.audio.blob, audioPath));
    }
    const row = { ...toRow(id, c, audioPath), created_at: new Date().toISOString(), status: 'new' };
    try {
      saveDemoRows([row, ...demoRows()]);
    } catch (error) {
      if (audioPath) await idbOp('readwrite', (s) => s.delete(audioPath)).catch(() => {});
      throw error;
    }
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
    saveDemoRows(demoRows().filter((r) => r.id !== comment.id));
    if (comment.audio_path) {
      try {
        await idbOp('readwrite', (s) => s.delete(comment.audio_path));
      } catch {
        return { audioCleanupFailed: true };
      }
    }
    return { audioCleanupFailed: false };
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
