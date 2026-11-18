import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, sectionHref } from '../src/lib/routing.js';

test('document and section URLs survive navigation without changing document ID', () => {
  assert.deepEqual(parseHash(sectionHref('education-matrix', 's5')), {name:'doc',id:'education-matrix',section:'s5'});
  assert.deepEqual(parseHash('#/doc/math-1'), {name:'doc',id:'math-1',section:''});
  assert.deepEqual(parseHash('#/admin'), {name:'admin'});
});

test('malformed links display a missing document instead of crashing the app', () => {
  assert.deepEqual(parseHash('#/doc/%E0%A4'), {name:'doc',id:'',section:''});
  assert.deepEqual(parseHash('#/doc/math-1?section=%22onclick%3D'), {name:'doc',id:'math-1',section:''});
  assert.deepEqual(parseHash('#/'), {name:'catalog'});
});
