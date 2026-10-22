import assert from 'node:assert';
import { createRequire } from 'node:module';
import { parseRaf, bucket, decodeEntities } from '../scripts/raf-parse.mjs';
const require = createRequire(import.meta.url);
const L = require('../logic.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

// ---------- parser
t('parses the entry format the page was described with', () => {
  const html = `<h1>Pubs using Real Ale Finder</h1>
    <a href="https://www.realalefinder.com/beerboard/?crown-inn-beeston">Crown Inn Beeston, NG9 1FY - Updated Today</a>
    <a href="https://www.realalefinder.com/beerboard/?brew-cavern-nottingham">Brew Cavern Nottingham, NG1 1DX - Updated Yesterday</a>
    <a href="https://www.realalefinder.com/beerboard/?the-royal-oak-castor">The Royal Oak Castor, PE5 7AX - Updated This Week</a>`;
  const { pubs } = parseRaf(html);
  assert.strictEqual(pubs.length, 3);
  assert.deepStrictEqual(pubs[0], { title: 'Crown Inn Beeston', postcode: 'NG9 1FY', url: 'https://www.realalefinder.com/beerboard/?crown-inn-beeston', updated: 'today' });
  assert.strictEqual(pubs[1].updated, 'yesterday');
  assert.strictEqual(pubs[2].updated, 'week');
});
t('copes with nested tags, entities, relative links and extra attributes', () => {
  const html = `<li><a class="x" href='/beerboard/?the-fox-&-hounds' data-a="1"><span>The Fox &amp; Hounds</span> Leeds, <b>LS1&nbsp;4AB</b> &ndash; Updated <i>Today</i></a></li>`;
  const { pubs } = parseRaf(html);
  assert.strictEqual(pubs.length, 1, JSON.stringify(pubs));
  assert.strictEqual(pubs[0].title, 'The Fox & Hounds Leeds');
  assert.strictEqual(pubs[0].postcode, 'LS1 4AB');
  assert.strictEqual(pubs[0].updated, 'today');
});
t('postcode without a space is tidied; unusual shapes like SW1A work', () => {
  const { pubs } = parseRaf(`<a href="https://www.realalefinder.com/beerboard/?a">The Red Lion London, SW1A2AA - Updated Today</a>`);
  assert.strictEqual(pubs[0].postcode, 'SW1A 2AA');
});
t('ignores unrelated links and entries without a postcode or update label', () => {
  const { pubs, anchors } = parseRaf(`
    <a href="/download">Download the app</a>
    <a href="https://www.realalefinder.com/beerboard/?nolabel">Some Pub Town</a>
    <a href="https://www.realalefinder.com/beerboard/?ok">Good Pub Town, AB1 2CD - Updated Today</a>`);
  assert.strictEqual(anchors, 2);
  assert.strictEqual(pubs.length, 1);
});
t('de-duplicates repeated slugs', () => {
  const a = `<a href="https://www.realalefinder.com/beerboard/?dup">Dup Pub X, AB1 2CD - Updated Today</a>`;
  assert.strictEqual(parseRaf(a + a).pubs.length, 1);
});
t('unknown labels fall into "older"; known ones bucket correctly', () => {
  assert.strictEqual(bucket('Today'), 'today');
  assert.strictEqual(bucket('yesterday'), 'yesterday');
  assert.strictEqual(bucket('This Week'), 'week');
  assert.strictEqual(bucket('Last Month'), 'older');
  assert.strictEqual(bucket('2 weeks ago'), 'older');
});
t('encoded slugs survive and are re-encoded safely', () => {
  const { pubs } = parseRaf(`<a href="https://www.realalefinder.com/beerboard/?caf%C3%A9-bar">Cafe Bar Town, AB1 2CD - Updated Today</a>`);
  assert.strictEqual(pubs[0].url, 'https://www.realalefinder.com/beerboard/?caf%C3%A9-bar');
});
t('a page that is not what we expect yields no entries and keeps samples for diagnosis', () => {
  const r = parseRaf(`<a href="https://www.realalefinder.com/beerboard/?x">Pub only, no label</a><p>hello</p>`);
  assert.strictEqual(r.pubs.length, 0);
  assert.deepStrictEqual(r.samples, ['Pub only, no label']);
});
t('decodeEntities handles named, decimal and hex', () => {
  assert.strictEqual(decodeEntities('A &amp; B &#38; C &#x26; D &nbsp;E'), 'A & B & C & D  E');
});

// ---------- matching and ranking
const asOf = new Date(2026, 9, 24, 5, 17);
const now = new Date(2026, 9, 24, 19, 30);
const raf = {
  asOf: asOf.toISOString(),
  pubs: [
    { title: 'Harbour Tap Whitby', postcode: 'YO21 3PU', url: 'https://www.realalefinder.com/beerboard/?harbour-tap-whitby', updated: 'today' },
    { title: 'The Cask Corner Whitby', postcode: 'YO22 4DE', url: 'https://www.realalefinder.com/beerboard/?cask-corner-whitby', updated: 'older' },
    { title: 'Royal Oak Whitby', postcode: 'YO21 1AA', url: 'https://www.realalefinder.com/beerboard/?royal-oak-whitby', updated: 'week' },
    { title: 'Evil Link', postcode: 'YO21 9ZZ', url: 'https://evil.example.com/beerboard/?x', updated: 'today' },
    { title: 'Another Pub Whitby', postcode: 'YO21 3PU', url: 'https://www.realalefinder.com/beerboard/?another-pub-whitby', updated: 'yesterday' }
  ]
};
const idx = L.buildRafIndex(raf);

t('normPostcode finds a postcode inside a Google address', () => {
  assert.strictEqual(L.normPostcode('Quay St, Whitby YO21 3PU, UK'), 'YO213PU');
  assert.strictEqual(L.normPostcode('no postcode here'), null);
});
t('buildRafIndex rejects bad input and links to other sites', () => {
  assert.strictEqual(L.buildRafIndex(null), null);
  assert.strictEqual(L.buildRafIndex({ asOf: null, pubs: [] }), null);
  assert.strictEqual(L.buildRafIndex({ asOf: 'nonsense', pubs: [] }), null);
  assert(!idx.by['YO219ZZ'], 'link to another host is dropped');
});
t('matches on postcode plus name words, ignoring "The" and "Inn"', () => {
  const m = L.matchRaf(idx, 'Quay St, Whitby YO21 3PU, UK', 'Harbour Tap', now);
  assert(m && m.fresh && m.label === 'Updated today', JSON.stringify(m));
  assert.strictEqual(m.url, 'https://www.realalefinder.com/beerboard/?harbour-tap-whitby');
});
t('same postcode, different pub: picks the right entry', () => {
  const m = L.matchRaf(idx, 'Pier Rd, Whitby YO21 3PU, UK', 'Another Pub', now);
  assert.strictEqual(m.label, 'Updated yesterday');
});
t('no match on a different postcode or a different name', () => {
  assert.strictEqual(L.matchRaf(idx, 'X, Whitby YO21 3PU, UK', 'Totally Different Name', now), null);
  assert.strictEqual(L.matchRaf(idx, 'X, Whitby YO99 9ZZ, UK', 'Harbour Tap', now), null);
  assert.strictEqual(L.matchRaf(idx, 'no postcode', 'Harbour Tap', now), null);
  assert.strictEqual(L.matchRaf(null, 'YO21 3PU', 'Harbour Tap', now), null);
});
t('listed but not updated recently scores low and is labelled so', () => {
  const m = L.matchRaf(idx, 'Church St, Whitby YO22 4DE, UK', 'The Cask Corner', now);
  assert.strictEqual(m.label, 'Not updated recently'); assert(m.old && !m.fresh);
  assert(m.r < 0.25);
});
t('freshness ordering: today > yesterday > this week > not updated', () => {
  const r = a => L.matchRaf(idx, a[0], a[1], now).r;
  const today = r(['Q YO21 3PU', 'Harbour Tap']), yest = r(['Q YO21 3PU', 'Another Pub']);
  const week = r(['Q YO21 1AA', 'Royal Oak']), old = r(['Q YO22 4DE', 'Cask Corner']);
  assert(today > yest && yest > week && week > old, [today, yest, week, old].join(' '));
});
t('a stale snapshot ages the signal and flags itself', () => {
  const later = new Date(2026, 9, 29, 12, 0); // five days after the snapshot
  const m = L.matchRaf(idx, 'Q YO21 3PU', 'Harbour Tap', later);
  assert(m.stale && !m.fresh && m.label === 'Updated 5 days ago', JSON.stringify(m));
  assert(m.r < L.matchRaf(idx, 'Q YO21 3PU', 'Harbour Tap', now).r);
});

const centre = { lat: 54.4858, lng: -0.6206 };
const pubPeriods = [0, 1, 2, 3, 4, 5, 6].map(d => ({ open: { day: d, hour: 11 }, close: { day: d, hour: 23 } }));
const mk = (id, name, addr, over) => Object.assign({
  id, displayName: { text: name }, formattedAddress: addr, primaryType: 'pub', types: ['pub'],
  primaryTypeDisplayName: { text: 'Pub' }, location: { latitude: centre.lat + 0.002, longitude: centre.lng },
  rating: 4.5, userRatingCount: 150, businessStatus: 'OPERATIONAL',
  currentOpeningHours: { openNow: true }, regularOpeningHours: { periods: pubPeriods }
}, over || {});
const ctx = (cat, withRaf) => ({ cat: L.categoryById(cat), center: centre, radiusM: 1609, when: { mode: 'now', date: now }, now, rafIndex: withRaf ? idx : null });

t('rank: a freshly updated Real Ale Finder pub beats an equal pub that is not on it', () => {
  const a = mk('a', 'Plain Pub', 'X, Whitby YO30 1AA, UK');
  const b = mk('b', 'Harbour Tap', 'Quay St, Whitby YO21 3PU, UK');
  assert.strictEqual(L.rank([a, b], ctx('realale', true))[0].id, 'b');
});
t('rank: not being on Real Ale Finder is neutral, not a penalty', () => {
  const a = mk('a', 'Plain Pub', 'X, Whitby YO30 1AA, UK', { rating: 4.8, userRatingCount: 400 });
  const b = mk('b', 'The Harbour', 'Quay St, Whitby YO21 3PU, UK', { rating: 4.0, userRatingCount: 30 });
  const without = L.rank([a, b], ctx('realale', false)).map(o => o.id);
  const withRaf = L.rank([a, b], ctx('realale', true)).find(o => o.id === 'a');
  assert.strictEqual(without[0], 'a');
  assert.strictEqual(withRaf.raf, null);
  assert.strictEqual(L.rank([a], ctx('realale', true))[0].score, L.rank([a], ctx('realale', false))[0].score);
});
t('rank: listed-but-old pub gets only a small lift, well below a fresh one', () => {
  const fresh = L.rank([mk('f', 'The Harbour', 'Quay St, Whitby YO21 3PU, UK')], ctx('realale', true))[0].score;
  const old = L.rank([mk('o', 'The Corner House', 'Church St, Whitby YO22 4DE, UK')], ctx('realale', true))[0].score;
  const none = L.rank([mk('n', 'Plain Pub', 'X, Whitby YO30 1AA, UK')], ctx('realale', true))[0].score;
  assert(fresh - none > 0.2 && old - none < 0.07 && old - none > 0, [fresh - none, old - none].join(' '));
});
t('rank: categories that are not about beer ignore the signal', () => {
  const b = mk('b', 'Harbour Tap', 'Quay St, Whitby YO21 3PU, UK', { primaryType: 'restaurant', types: ['restaurant'] });
  assert.strictEqual(L.rank([b], ctx('dinner', true))[0].score, L.rank([b], ctx('dinner', false))[0].score);
});

console.log('\n' + n + ' tests passed');
