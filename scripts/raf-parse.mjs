// Reads the public Real Ale Finder pub list (https://www.realalefinder.com/pubs/).
// Each entry is a link to a beer board whose text looks like:
//   "Crown Inn Beeston, NG9 1FY - Updated Today"
// Written without sight of the page's raw HTML, so it is deliberately tolerant about
// markup (nested tags, entities, relative links) and strict about what counts as an entry.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', minus: '-', middot: '·', bull: '•',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', pound: '£',
  eacute: 'é', egrave: 'è', agrave: 'à', ocirc: 'ô', uuml: 'ü', ouml: 'ö', ntilde: 'ñ',
};

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] ?? m));
}

export function bucket(label) {
  const l = label.toLowerCase();
  if (/\btoday\b/.test(l)) return 'today';
  if (/\byesterday\b/.test(l)) return 'yesterday';
  if (/\bthis week\b/.test(l)) return 'week';
  return 'older';
}

function tidyPostcode(pc) {
  return pc.toUpperCase().replace(/\s+/g, '').replace(/(\d[A-Z]{2})$/, ' $1');
}

const ANCHOR = /<a\b[^>]*?href\s*=\s*["']([^"']*beerboard\/?\?([^"'#\s]+))["'][^>]*>([\s\S]*?)<\/a>/gi;
const ENTRY = /^(.*?),\s*([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*[-–—:|]?\s*Updated\s+(.+)$/i;

// Returns { pubs, seenAnchors } so a failed run can show what the page actually contained.
export function parseRaf(html) {
  const pubs = [];
  const seen = new Set();
  const samples = [];
  let anchors = 0;
  for (const m of html.matchAll(ANCHOR)) {
    anchors++;
    const text = decodeEntities(m[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (samples.length < 5) samples.push(text);
    const t = text.match(ENTRY);
    if (!t) continue;
    let slug;
    try { slug = decodeURIComponent(decodeEntities(m[2])).trim(); } catch { continue; }
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    pubs.push({
      title: t[1].trim(),
      postcode: tidyPostcode(t[2]),
      url: 'https://www.realalefinder.com/beerboard/?' + encodeURIComponent(slug),
      updated: bucket(t[3]),
    });
  }
  return { pubs, anchors, samples };
}
