export function parseHash(hash) {
  const [routePath, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = routePath.split('/').filter(Boolean);
  if (parts[0] === 'doc' && parts[1]) {
    let id;
    try { id = decodeURIComponent(parts[1]); } catch { id = ''; }
    const section = new URLSearchParams(search).get('section') || '';
    return { name: 'doc', id, section: /^s\d+$/.test(section) ? section : '' };
  }
  if (parts[0] === 'admin') return { name: 'admin' };
  return { name: 'catalog' };
}

export function sectionHref(documentId, sectionId) {
  return `#/doc/${encodeURIComponent(documentId)}?section=${encodeURIComponent(sectionId)}`;
}

export function commentHref(comment, sections = []) {
  const documentHref = `#/doc/${encodeURIComponent(comment.document_id)}`;
  const normalizeTitle = (title) => (title || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const title = normalizeTitle(comment.section_title);
  if (!title) return documentHref;
  // Positional sN identifiers can refer to different sections after a revision.
  const matches = sections.filter((section) => normalizeTitle(section.title) === title);
  const section = matches.find((candidate) => candidate.id === comment.section_id)
    || (matches.length === 1 ? matches[0] : null);
  return section && /^s\d+$/.test(section.id)
    ? sectionHref(comment.document_id, section.id)
    : documentHref;
}
