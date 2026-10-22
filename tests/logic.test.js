const assert = require('assert');
const L = require('../logic.js');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

// Saturday 24 Oct 2026, local time. getDay() = 6.
const sat = (h, m) => new Date(2026, 9, 24, h, m || 0, 0, 0);
const fri = (h, m) => new Date(2026, 9, 23, h, m || 0, 0, 0);
const sun = (h, m) => new Date(2026, 9, 25, h, m || 0, 0, 0);

// Pub: Fri 12:00-23:00, Sat 12:00-01:00 (closes Sun 01:00), Sun 12:00-22:30.
const pubPeriods = [
  { open: { day: 5, hour: 12, minute: 0 }, close: { day: 5, hour: 23, minute: 0 } },
  { open: { day: 6, hour: 12, minute: 0 }, close: { day: 0, hour: 1, minute: 0 } },
  { open: { day: 0, hour: 12, minute: 0 }, close: { day: 0, hour: 22, minute: 30 } }
];

t('distance: one degree of latitude is about 111 km', () => {
  const d = L.distanceM({ lat: 54, lng: -1 }, { lat: 55, lng: -1 });
  assert(d > 110500 && d < 111800, d);
});

t('openAt: open mid-evening on Saturday until 01:00', () => {
  const r = L.openAt(pubPeriods, sat(19, 30));
  assert.strictEqual(r.open, true);
  assert.strictEqual(r.until, '01:00');
  assert.strictEqual(r.minsLeft, 5 * 60 + 30);
});
t('openAt: still open at 00:30 early Sunday (Saturday period spills over)', () => {
  const r = L.openAt(pubPeriods, sun(0, 30));
  assert.strictEqual(r.open, true);
  assert.strictEqual(r.minsLeft, 30);
});
t('openAt: shut Friday morning', () => {
  assert.strictEqual(L.openAt(pubPeriods, fri(10, 0)).open, false);
});
t('openAt: shut Sunday 01:30 and Sunday 23:00', () => {
  assert.strictEqual(L.openAt(pubPeriods, sun(1, 30)).open, false);
  assert.strictEqual(L.openAt(pubPeriods, sun(23, 0)).open, false);
});
t('openAt: week wrap, Saturday night period closing Sunday handled; Sunday period closing Monday', () => {
  const p = [{ open: { day: 6, hour: 20 }, close: { day: 0, hour: 2 } }];
  assert.strictEqual(L.openAt(p, new Date(2026, 9, 25, 1, 0)).open, true);
});
t('openAt: 24 hours (no close)', () => {
  const r = L.openAt([{ open: { day: 0, hour: 0, minute: 0 } }], sat(3, 0));
  assert.strictEqual(r.open, true); assert.strictEqual(r.always, true);
});

t('openInfo: now uses the live flag (bank holiday shut) over the weekly hours', () => {
  const p = { regularOpeningHours: { periods: pubPeriods }, currentOpeningHours: { openNow: false } };
  assert.strictEqual(L.openInfo(p, { mode: 'now', date: sat(19, 30) }).state, 'closed');
});
t('openInfo: at-mode computes from weekly hours', () => {
  const p = { regularOpeningHours: { periods: pubPeriods } };
  assert.strictEqual(L.openInfo(p, { mode: 'at', date: sat(18, 0) }).state, 'open');
  assert.strictEqual(L.openInfo(p, { mode: 'at', date: fri(9, 0) }).state, 'closed');
});
t('openInfo: no hours means unknown', () => {
  assert.strictEqual(L.openInfo({}, { mode: 'at', date: sat(18) }).state, 'unknown');
  assert.strictEqual(L.openInfo({}, { mode: 'now', date: sat(18) }).state, 'unknown');
});

t('targetDate: Saturday from a Thursday is two days on, time applied', () => {
  const thu = new Date(2026, 9, 22, 9, 15);
  const d = L.targetDate('sat', '18:30', thu);
  assert.strictEqual(d.getDay(), 6); assert.strictEqual(d.getDate(), 24);
  assert.strictEqual(d.getHours(), 18); assert.strictEqual(d.getMinutes(), 30);
});
t('targetDate: Saturday on a Saturday is today; tomorrow adds a day', () => {
  assert.strictEqual(L.targetDate('sat', '12:00', sat(9)).getDate(), 24);
  assert.strictEqual(L.targetDate('tomorrow', '12:00', sat(9)).getDate(), 25);
});

t('etaText: walk under 1.5 miles, car beyond', () => {
  assert(/min walk$/.test(L.etaText(800)));
  assert(/by car$/.test(L.etaText(5000)));
});
t('miles: formats to one decimal with a floor', () => {
  assert.strictEqual(L.miles(1609.344), '1.0');
  assert.strictEqual(L.miles(20), '0.1');
});

// ---- ranking
const centre = { lat: 54.4858, lng: -0.6206 };
const at = (dLat, dLng) => ({ latitude: centre.lat + dLat, longitude: centre.lng + dLng });
function mk(id, name, over) {
  return Object.assign({
    id, displayName: { text: name }, primaryType: 'pub', types: ['pub', 'bar'],
    primaryTypeDisplayName: { text: 'Pub' }, location: at(0.002, 0.002),
    rating: 4.5, userRatingCount: 100, businessStatus: 'OPERATIONAL',
    currentOpeningHours: { openNow: true },
    regularOpeningHours: { periods: pubPeriods }
  }, over || {});
}
const ctx = (catId, mode) => ({
  cat: L.categoryById(catId), center: centre, radiusM: 1609, when: { mode: mode || 'now', date: sat(19, 30) }
});

t('rank: thin 5.0 rating does not beat a well-reviewed 4.7', () => {
  const r = L.rank([mk('a', 'Thin Five', { rating: 5, userRatingCount: 3 }), mk('b', 'Solid', { rating: 4.7, userRatingCount: 220 })], ctx('pub'));
  assert.strictEqual(r[0].id, 'b');
});
t('rank: micropub keyword lifts a match above a slightly better-rated plain pub', () => {
  const r = L.rank([
    mk('plain', 'The Crown', { rating: 4.6, userRatingCount: 300 }),
    mk('micro', 'The Cask Corner Micropub', { rating: 4.4, userRatingCount: 120, primaryTypeDisplayName: { text: 'Micropub' } })
  ], ctx('micropub'));
  assert.strictEqual(r[0].id, 'micro');
  assert.strictEqual(r[0].keyword, 'micropub');
});
t('rank: chain is penalised for micropubs but not for real ale', () => {
  const spoons = mk('s', 'The Moon Under Water (Wetherspoon)', { rating: 4.4, userRatingCount: 900 });
  const indie = mk('i', 'The Crown', { rating: 4.3, userRatingCount: 150 });
  assert.strictEqual(L.rank([spoons, indie], ctx('micropub'))[0].id, 'i');
  const real = L.rank([spoons, indie], ctx('realale'));
  assert(real.find(o => o.id === 's').chain === true);
  assert.strictEqual(real[0].id, 's'); // no chain penalty for real ale, better rating and volume wins
});
t('rank: closed places are dropped in now mode, kept in any-time mode', () => {
  const shut = mk('x', 'Shut Inn', { currentOpeningHours: { openNow: false } });
  const ok = mk('y', 'Open Inn');
  assert.deepStrictEqual(L.rank([shut, ok], ctx('pub')).map(o => o.id), ['y']);
  assert.strictEqual(L.rank([shut, ok], ctx('pub', 'any')).length, 2);
});
t('rank: at-mode drops a place that closes within 30 minutes', () => {
  const c = ctx('pub', 'at'); c.when.date = sat(0 + 24 - 24 + 12, 0); // Saturday noon, opens at 12:00, plenty of time
  assert.strictEqual(L.rank([mk('o', 'Opens Noon')], c).length, 1);
  const late = ctx('pub', 'at'); late.when.date = sun(0, 40); // closes 01:00 Sunday, 20 min left
  assert.strictEqual(L.rank([mk('l', 'Closing')], late).length, 0);
});
t('rank: closing soon in now mode is demoted below an otherwise equal place', () => {
  const soon = [{ open: { day: 6, hour: 12 }, close: { day: 6, hour: 20 } }];
  const a = mk('a', 'Soon Inn', { regularOpeningHours: { periods: soon } });
  const b = mk('b', 'Later Inn');
  const r = L.rank([a, b], ctx('pub'));
  assert.strictEqual(r[0].id, 'b');
  assert.strictEqual(r.find(o => o.id === 'a').closingSoon, true);
});
t('rank: places past the radius come after those inside and are flagged', () => {
  const far = mk('far', 'Far Inn', { rating: 4.9, userRatingCount: 500, location: at(0.02, 0) }); // ~2.2 km
  const near = mk('near', 'Near Inn', { rating: 4.0, userRatingCount: 40 });
  const r = L.rank([far, near], ctx('pub'));
  assert.deepStrictEqual(r.map(o => o.id), ['near', 'far']);
  assert.strictEqual(r[1].outside, true);
});
t('rank: places far beyond 1.6x radius are dropped', () => {
  const very = mk('v', 'Very Far', { location: at(0.1, 0) });
  assert.strictEqual(L.rank([very], ctx('pub')).length, 0);
});
t('rank: wrong-type places drop out once there are three proper matches', () => {
  const hotel = mk('h', 'Grand Hotel', { primaryType: 'lodging', types: ['lodging'], primaryTypeDisplayName: { text: 'Hotel' }, rating: 4.9, userRatingCount: 900 });
  const pubs = ['p1', 'p2', 'p3'].map(i => mk(i, 'Pub ' + i));
  assert(!L.rank(pubs.concat(hotel), ctx('pub')).some(o => o.id === 'h'));
  // but with fewer than three real matches the fallback keeps it
  assert(L.rank([pubs[0], hotel], ctx('pub')).some(o => o.id === 'h'));
});
t('rank: de-duplicates by id and skips closed-down businesses', () => {
  const a = mk('same', 'Dup'), b = mk('same', 'Dup'), gone = mk('g', 'Gone', { businessStatus: 'CLOSED_PERMANENTLY' });
  assert.strictEqual(L.rank([a, b, gone], ctx('pub')).length, 1);
});
t('rank: walks ignore opening hours entirely', () => {
  const park = { id: 'w', displayName: { text: 'Mulgrave Woods' }, primaryType: 'park', types: ['park'], location: at(0.003, 0), rating: 4.7, userRatingCount: 80 };
  const r = L.rank([park], ctx('walks'));
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].info.state, 'na');
});
t('rank: every category has queries, types and a unique id', () => {
  const ids = new Set();
  L.CATEGORIES.forEach(c => {
    assert(c.queries.length >= 1 && c.queries.length <= 2, c.id);
    assert(c.types.length >= 1, c.id);
    assert(!ids.has(c.id)); ids.add(c.id);
  });
});

t('daily allowance: dayKey uses local date with zero padding', () => {
  assert.strictEqual(L.dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.strictEqual(L.dayKey(new Date(2026, 9, 24, 0, 0)), '2026-10-24');
});
t('daily allowance: readUsage keeps today, resets on a new day, survives rubbish', () => {
  const now = sat(12);
  assert.deepStrictEqual(L.readUsage(JSON.stringify({ d: '2026-10-24', n: 7 }), now), { d: '2026-10-24', n: 7 });
  assert.strictEqual(L.readUsage(JSON.stringify({ d: '2026-10-23', n: 99 }), now).n, 0);
  assert.strictEqual(L.readUsage(null, now).n, 0);
  assert.strictEqual(L.readUsage('not json', now).n, 0);
  assert.strictEqual(L.readUsage(JSON.stringify({ d: '2026-10-24', n: -5 }), now).n, 0);
  assert.strictEqual(L.readUsage(JSON.stringify({ d: '2026-10-24', n: 'x' }), now).n, 0);
  assert.strictEqual(L.readUsage(JSON.stringify({ d: '2026-10-24', n: 3.9 }), now).n, 3);
});
t('daily allowance: clampCap bounds and defaults', () => {
  assert.strictEqual(L.DEFAULT_CAP, 80);
  assert.strictEqual(L.clampCap(3), 10); assert.strictEqual(L.clampCap(5000), 1000);
  assert.strictEqual(L.clampCap('45'), 45); assert.strictEqual(L.clampCap(44.6), 45);
  assert.strictEqual(L.clampCap('abc'), 80); assert.strictEqual(L.clampCap(''), 10);
});

t('rank: family mode gives a small lift to places good for children; couple mode does not', () => {
  const centre = { lat: 54.4858, lng: -0.6206 };
  const mkp = (id, kids) => ({ id, displayName: { text: 'Pub ' + id }, formattedAddress: 'X', primaryType: 'pub', types: ['pub'],
    location: { latitude: centre.lat + 0.002, longitude: centre.lng }, rating: 4.5, userRatingCount: 150, businessStatus: 'OPERATIONAL',
    goodForChildren: kids, currentOpeningHours: { openNow: true } });
  const ctx = fam => ({ cat: L.categoryById('pub'), center: centre, radiusM: 1609, when: { mode: 'any', date: sat(12) }, now: sat(12), rafIndex: null, family: fam });
  const f = L.rank([mkp('a', false), mkp('b', true)], ctx(true));
  assert.strictEqual(f[0].id, 'b');
  assert(Math.abs(f[0].score - f[1].score - 0.06) < 1e-9, String(f[0].score - f[1].score));
  const c = L.rank([mkp('a', false), mkp('b', true)], ctx(false));
  assert(Math.abs(c[0].score - c[1].score) < 1e-9);
});

t('travel: a 10 minute walk is about 615 m and a card at that distance says 10 min walk', () => {
  const r = L.radiusFor('walk', 10);
  assert(Math.abs(r - 615.4) < 0.5, String(r));
  assert.strictEqual(L.etaFor('walk', r), '10 min walk');
});
t('travel: radius and ETA agree for every option in both modes', () => {
  ['walk', 'car'].forEach(mode => L.TRAVEL[mode].mins.forEach(m => {
    const eta = L.etaFor(mode, L.radiusFor(mode, m));
    assert(eta.indexOf(String(m)) > -1, mode + ' ' + m + ' -> ' + eta);
  }));
});
t('travel: driving 20 minutes reaches about 8 km and says by car', () => {
  const r = L.radiusFor('car', 20);
  assert(r > 8000 && r < 8500, String(r));
  assert(/by car$/.test(L.etaFor('car', r)));
  assert.strictEqual(L.etaFor('walk', 20000).split(' ')[1], 'min');
});
t('travel: defaults exist in their own lists and labels read naturally', () => {
  Object.keys(L.TRAVEL).forEach(k => assert(L.TRAVEL[k].mins.indexOf(L.TRAVEL[k].dflt) > -1, k));
  assert.strictEqual(L.travelOptionLabel('walk', 10), '10 min walk');
  assert.strictEqual(L.travelOptionLabel('car', 30), '30 min drive');
});

console.log('\n' + n + ' tests passed');
