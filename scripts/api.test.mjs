import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { api, createSupabaseApi, csvCell, idbOp, parseDemoRows } from '../src/lib/api.js';

const row = (id = '1') => ({
  id, document_id: 'math-1', first_name: 'A', last_name: 'B', school: 'School',
  created_at: '2026-11-17T10:00:00.000Z', status: 'new', body: 'Feedback', audio_path: null,
});

test('pagination loads beyond 5000 rows and survives a lower server page limit', async () => {
  const initial = Array.from({ length: 5103 }, (_, i) => row(String(i + 1).padStart(5, '0'))).reverse();
  let calls = 0;
  const sb = { from(table) {
    assert.equal(table, 'comments');
    const state = {};
    return {
      select() { return this; },
      order(field, options) { assert.equal(options.ascending, false); return this; },
      limit(n) { assert.equal(n, 1000); return this; },
      or(filter) { state.filter = filter; return this; },
      then(resolve, reject) {
        calls += 1;
        let data = initial;
        if (state.filter) {
          const match = /created_at\.lt\.(.*),and\(created_at\.eq\.(.*),id\.lt\.([^)]*)\)/.exec(state.filter);
          assert.ok(match, 'cursor handles equal timestamps using id');
          assert.equal(match[1], match[2]);
          data = initial.filter((item) => item.created_at < match[1] || (item.created_at === match[1] && item.id < match[3]));
        }
        return Promise.resolve({ data: data.slice(0, 127), error: null }).then(resolve, reject);
      },
    };
  } };
  const rows = await createSupabaseApi(() => sb).listComments();
  assert.equal(rows.length, 5103);
  assert.deepEqual(rows, initial);
  assert.ok(calls > 40);
});

test('an intermediate page error rejects rather than returning partial feedback', async () => {
  let calls = 0;
  const sb = { from() { return {
    select() { return this; }, order() { return this; }, limit() { return this; }, or() { return this; },
    then(resolve) { return Promise.resolve(++calls === 1 ? { data: [row()] } : { error: new Error('offline') }).then(resolve); },
  }; } };
  await assert.rejects(createSupabaseApi(() => sb).listComments(), /offline/);
});

test('failed database delete leaves the recording untouched', async () => {
  let removed = false;
  const sb = {
    from() { return { delete() { return this; }, eq() { return this; }, select() { return this; }, async single() { return { error: new Error('access denied') }; } }; },
    storage: { from() { return { async remove() { removed = true; return {}; } }; } },
  };
  await assert.rejects(createSupabaseApi(() => sb).deleteComment({ id: 'a', audio_path: 'audio' }), /access denied/);
  assert.equal(removed, false);
});

test('successful row delete reports storage cleanup failure without pretending the row remains', async () => {
  const operations = [];
  const sb = {
    from() { return { delete() { return this; }, eq() { return this; }, select() { return this; }, async single() { operations.push('row'); return { data: { id: 'a' } }; } }; },
    storage: { from() { return { async remove() { operations.push('audio'); return { error: new Error('storage unavailable') }; } }; } },
  };
  const result = await createSupabaseApi(() => sb).deleteComment({ id: 'a', audio_path: 'audio' });
  assert.deepEqual(operations, ['row', 'audio']);
  assert.equal(result.audioCleanupFailed, true);
});

test('session and logout errors propagate', async () => {
  const sb = { auth: {
    async getSession() { return { data: {}, error: new Error('session failure') }; },
    async signOut() { return { error: new Error('logout failure') }; },
  } };
  const remote = createSupabaseApi(() => sb);
  await assert.rejects(remote.getSession(), /session failure/);
  await assert.rejects(remote.signOut(), /logout failure/);
});

test('audio export batches unique paths and refuses missing signed links', async () => {
  const batches = [];
  const remote = createSupabaseApi(() => ({ storage: { from() { return {
    async createSignedUrls(paths) {
      batches.push(paths);
      return { data: paths.map((path) => ({ path, signedUrl: `https://audio.test/${path}` })) };
    },
  }; } } }));
  const paths = Array.from({ length: 205 }, (_, i) => `audio-${i}`);
  const result = await remote.exportAudioUrls([...paths, paths[0]]);
  assert.equal(Object.keys(result).length, 205);
  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 5]);
  const partial = createSupabaseApi(() => ({ storage: { from() { return {
    async createSignedUrls() { return { data: [{ path: 'ok', signedUrl: 'https://audio.test/ok' }, { path: 'missing', error: 'not found' }] }; },
  }; } } }));
  await assert.rejects(partial.exportAudioUrls(['ok', 'missing']), /could not be created/);
});

test('CSV keeps untrusted formulas as text while preserving numbers and escaping delimiters', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('\t@SUM(A1)'), "'\t@SUM(A1)");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell(-2), '-2');
  assert.equal(csvCell('name; "quote"\nnext'), '"name; ""quote""\nnext"');
  assert.equal(csvCell('Қазақ тілі'), 'Қазақ тілі');
});

test('damaged browser feedback fails visibly and is not overwritten on submit', async () => {
  assert.throws(() => parseDemoRows('{}'), /Invalid demo comments/);
  assert.throws(() => parseDemoRows('[null]'), /Invalid demo comments/);
  assert.throws(() => parseDemoRows(JSON.stringify([{ ...row(), audio_duration_sec: '5' }])), /Invalid demo comments/);
  assert.deepEqual(parseDemoRows(JSON.stringify([row()])), [row()]);
  const previous = globalThis.localStorage;
  let writes = 0;
  globalThis.localStorage = { getItem: () => '{broken', setItem() { writes += 1; } };
  try {
    assert.equal(api.demo, true);
    await assert.rejects(api.submitComment({}), SyntaxError);
    assert.equal(writes, 0);
  } finally { globalThis.localStorage = previous; }
});

test('IndexedDB closes after completion, abort and synchronous failure', async () => {
  const previous = globalThis.indexedDB;
  for (const outcome of ['complete', 'abort', 'throw']) {
    let closes = 0;
    globalThis.indexedDB = { open() {
      const request = {};
      const tx = { objectStore: () => ({ get: () => ({ result: 'blob' }) }) };
      const db = { close() { closes += 1; }, transaction() {
        if (outcome === 'throw') throw new Error('unavailable');
        queueMicrotask(() => outcome === 'abort' ? tx.onabort() : tx.oncomplete());
        return tx;
      } };
      request.result = db;
      queueMicrotask(() => request.onsuccess());
      return request;
    } };
    try {
      if (outcome === 'complete') assert.equal(await idbOp('readonly', (store) => store.get('a')), 'blob');
      else await assert.rejects(idbOp('readonly', (store) => store.get('a')), /aborted|unavailable/);
      assert.equal(closes, 1);
    } finally { globalThis.indexedDB = previous; }
  }
});

test('a lost insert response never triggers deletion of a potentially committed recording', async () => {
  const previous = globalThis.window;
  globalThis.window = { crypto: webcrypto };
  let removals = 0;
  const sb = {
    from() { return { async insert() { return { error: { message: 'network lost', code: '' } }; } }; },
    storage: { from() { return { async upload() { return {}; }, async remove() { removals += 1; return {}; } }; } },
  };
  try {
    await assert.rejects(createSupabaseApi(() => sb).submitComment({
      documentId: 'math-1', firstName: 'A', lastName: 'B', school: 'School', uiLang: 'kk',
      audio: { blob: new Blob(['audio']), duration: 1, ext: 'webm', mime: 'audio/webm' },
    }));
    assert.equal(removals, 0);
  } finally { globalThis.window = previous; }
});
