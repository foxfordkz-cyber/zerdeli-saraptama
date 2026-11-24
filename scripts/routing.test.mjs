import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, sectionHref, commentHref } from '../src/lib/routing.js';

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

test('old comments follow a moved heading rather than a reused positional ID', () => {
  const comment = { document_id: 'education-system', section_id: 's9', section_title: 'ІІ БӨЛІМ. ҚҰРЫЛЫМЫ' };
  const sections = [{ id: 's9', title: '1.8 Терминдер' }, { id: 's10', title: 'ІІ бөлім. Құрылымы' }];
  assert.equal(commentHref(comment, sections), '#/doc/education-system?section=s10');
  assert.equal(commentHref({ ...comment, section_id: 's10' }, sections), '#/doc/education-system?section=s10');
});

test('removed, unknown or ambiguous comment sections link to the document', () => {
  const comment = { document_id: 'education-system', section_id: 's9', section_title: 'Old section' };
  assert.equal(commentHref(comment, [{ id: 's9', title: 'New section' }]), '#/doc/education-system');
  assert.equal(commentHref({ ...comment, section_title: null }, [{ id: 's9', title: 'New section' }]), '#/doc/education-system');
  assert.equal(commentHref(comment), '#/doc/education-system');
  assert.equal(commentHref(comment, [{ id: 's10', title: 'Old section' }, { id: 's11', title: 'Old section' }]), '#/doc/education-system');
});
