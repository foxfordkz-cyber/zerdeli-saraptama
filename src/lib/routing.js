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
