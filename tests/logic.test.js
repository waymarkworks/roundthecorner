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
t('rank: Pub lifts a micropub match above a slightly better-rated plain pub', () => {
  const r = L.rank([
    mk('plain', 'The Crown', { rating: 4.6, userRatingCount: 300 }),
    mk('micro', 'The Cask Corner Micropub', { rating: 4.4, userRatingCount: 120, primaryTypeDisplayName: { text: 'Micropub' } })
  ], ctx('pub'));
  assert.strictEqual(r[0].id, 'micro');
  assert.strictEqual(r[0].keyword, 'micropub');
});
t('rank: Pub lifts real ale and craft beer matches too', () => {
  const plain = mk('plain', 'The Crown', { rating: 4.5, userRatingCount: 200 });
  const ale = mk('ale', 'The Hop Pole', { rating: 4.4, userRatingCount: 200, editorialSummary: { text: 'Real ale pub with changing guest beers.' } });
  const craft = mk('craft', 'Quay Beer Hall', { rating: 4.4, userRatingCount: 200, editorialSummary: { text: 'Craft beer on keg and cask.' } });
  const r = L.rank([plain, ale, craft], ctx('pub'));
  assert.strictEqual(r[2].id, 'plain');
  assert.strictEqual(r.find(o => o.id === 'ale').keyword, 'real ale');
  assert(r.find(o => o.id === 'craft').keyword, 'craft beer place should match a keyword');
});
t('rank: chain pubs are penalised in Pub', () => {
  const spoons = mk('s', 'The Moon Under Water (Wetherspoon)', { rating: 4.4, userRatingCount: 900 });
  const indie = mk('i', 'The Crown', { rating: 4.3, userRatingCount: 150 });
  const r = L.rank([spoons, indie], ctx('pub'));
  assert.strictEqual(r[0].id, 'i');
  assert.strictEqual(r.find(o => o.id === 's').chain, true);
  assert.strictEqual(r.find(o => o.id === 's').parts.chain, -0.2);
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

t('categories: Drink offers Pub, Wine and Cocktails and nothing else', () => {
  const drink = L.CATEGORIES.filter(c => c.group === 'Drink');
  assert.deepStrictEqual(drink.map(c => c.label), ['Pub', 'Wine', 'Cocktails']);
  assert.deepStrictEqual(drink.map(c => c.id), ['pub', 'wine', 'cocktails']);
});
t('categories: the old beer choices still resolve, to Pub', () => {
  ['micropub', 'realale', 'craft'].forEach(id => assert.strictEqual(L.categoryById(id).id, 'pub', id));
  assert.strictEqual(L.categoryById('wine').id, 'wine');
  assert.strictEqual(L.categoryById('cocktails').id, 'cocktails');
  assert.strictEqual(L.categoryById(undefined).id, 'pub');
  assert.strictEqual(L.categoryById('constructor').id, 'pub');
});
t('categories: Pub searches for micropubs, real ale and craft beer behind the scenes', () => {
  const pub = L.categoryById('pub');
  assert.strictEqual(pub.queries.length, 2);
  ['micropub', 'real ale', 'craft beer'].forEach(w => assert(pub.queries[1].indexOf(w) > -1, w));
  ['The Cask Corner Micropub', 'The Real Ale House', 'Craft Beer Co', 'Harbour Taproom', 'Brewery Tap'].forEach(n => assert(pub.keywords.test(n), n));
  ['The Crown', 'The Red Lion'].forEach(n => assert(!pub.keywords.test(n), n));
  assert.strictEqual(L.RAF_WEIGHT.pub, 0.22);
  ['micropub', 'realale', 'craft'].forEach(id => assert.strictEqual(L.RAF_WEIGHT[id], undefined, id));
});
t('rank: wine and cocktails are separate and each matches its own kind of bar', () => {
  const vag = mk('v', 'Vagabond Wines', { primaryType: 'wine_bar', types: ['wine_bar', 'bar'], primaryTypeDisplayName: { text: 'Wine bar' } });
  const cock = mk('c', 'The Gilded Shaker', { primaryType: 'cocktail_bar', types: ['cocktail_bar', 'bar'], primaryTypeDisplayName: { text: 'Cocktail bar' } });
  const w = L.rank([vag, cock], ctx('wine'));
  assert.strictEqual(w[0].id, 'v');
  assert.strictEqual(w[0].typeMatch, 1);
  assert.strictEqual(w[0].keyword, 'wine');
  assert.strictEqual(w.find(o => o.id === 'c').keyword, null);
  const k = L.rank([vag, cock], ctx('cocktails'));
  assert.strictEqual(k[0].id, 'c');
  assert.strictEqual(k[0].keyword, 'cocktail');
  assert.strictEqual(k.find(o => o.id === 'v').keyword, null);
});

t('why here: the parts add up to the score, for every kind of adjustment', () => {
  const soon = [{ open: { day: 6, hour: 12 }, close: { day: 6, hour: 20 } }];
  const c = ctx('pub'); c.family = true;
  const items = [
    mk('a', 'The Cask Corner Micropub', { goodForChildren: true }),
    mk('b', 'Soon Inn', { regularOpeningHours: { periods: soon } }),
    mk('c', 'No Hours Inn', { regularOpeningHours: undefined, currentOpeningHours: undefined }),
    mk('d', 'The Moon Under Water (Wetherspoon)'),
    mk('e', 'Unrated Inn', { rating: undefined, userRatingCount: undefined })
  ];
  const r = L.rank(items, c);
  assert.strictEqual(r.length, 5);
  r.forEach(o => {
    const sum = Object.keys(o.parts).reduce((s, k) => s + o.parts[k], 0);
    assert(Math.abs(sum - o.score) < 1e-12, o.name + ' ' + sum + ' vs ' + o.score);
  });
  const by = id => r.find(o => o.id === id).parts;
  assert.strictEqual(by('a').family, 0.06);
  assert.strictEqual(by('b').closing, -0.15);
  assert.strictEqual(by('c').noHours, -0.08);
  assert.strictEqual(by('d').chain, -0.2);
  assert(Math.abs(by('e').rating - 0.42 * 0.3) < 1e-12);
});
t('why here: says how a thin 4.9 is counted, and drops the note when the count is high', () => {
  const thin = L.rank([mk('v', 'Vagabond Wines', { primaryType: 'wine_bar', types: ['wine_bar', 'bar'], rating: 4.9, userRatingCount: 12 })], ctx('wine'))[0];
  const txt = L.whyText(thin, L.categoryById('wine'));
  assert(/^Why here \(score \d\.\d\d\): rating 0\.\d\d \(4\.9 from 12 reviews counts as 4\.4\), nearness 0\.\d\d, place type 0\.20, keyword 0\.18\.$/.test(txt), txt);
  const solid = L.rank([mk('s', 'The Crown', { rating: 4.5, userRatingCount: 500 })], ctx('pub'))[0];
  assert(L.whyText(solid, L.categoryById('pub')).indexOf('counts as') === -1);
  const one = L.rank([mk('o', 'One Review Inn', { rating: 4.9, userRatingCount: 1 })], ctx('pub'))[0];
  assert(L.whyText(one, L.categoryById('pub')).indexOf('from 1 review counts as 4.1') > -1);
  const none = L.rank([mk('n', 'Unrated Inn', { rating: undefined, userRatingCount: undefined })], ctx('pub'))[0];
  assert(L.whyText(none, L.categoryById('pub')).indexOf('(not rated yet)') > -1);
});
t('why here: names penalties, boosts, no matches and the past-your-limit rule', () => {
  const soon = [{ open: { day: 6, hour: 12 }, close: { day: 6, hour: 20 } }];
  const c = ctx('pub'); c.family = true;
  const a = L.rank([mk('a', 'Soon Inn', { regularOpeningHours: { periods: soon }, goodForChildren: true })], c)[0];
  const ta = L.whyText(a, L.categoryById('pub'));
  assert(ta.indexOf('closing soon -0.15') > -1 && ta.indexOf('good for children +0.06') > -1 && ta.indexOf('keyword 0.00 (no match)') > -1, ta);
  const far = L.rank([mk('f', 'Far Inn', { location: at(0.02, 0) })], ctx('pub'))[0];
  assert(L.whyText(far, L.categoryById('pub')).indexOf('Past your limit, so it is listed after places inside it.') > -1);
  const spoons = L.rank([mk('s', 'The Moon Under Water (Wetherspoon)')], ctx('pub'))[0];
  assert(L.whyText(spoons, L.categoryById('pub')).indexOf('chain -0.20') > -1);
  const bistro = L.rank([mk('r', 'Bistro', { primaryType: 'restaurant', types: ['restaurant'] })], ctx('dinner'))[0];
  assert(L.whyText(bistro, L.categoryById('dinner')).indexOf('keyword') === -1, 'dinner has no keywords to show');
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

t('priceRange: both ends, one end, decimals, missing', () => {
  const g = (u, n) => ({ currencyCode: 'GBP', units: String(u), nanos: n });
  assert.strictEqual(L.priceRangeText({ startPrice: g(10), endPrice: g(20) }), '£10–20');
  assert.strictEqual(L.priceRangeText({ startPrice: g(20) }), '£20+');
  assert.strictEqual(L.priceRangeText({ endPrice: g(15) }), 'up to £15');
  assert.strictEqual(L.priceRangeText({ startPrice: g(7, 500000000), endPrice: g(12) }), '£7.50–12');
  assert.strictEqual(L.priceRangeText({ startPrice: { currencyCode: 'GBP' }, endPrice: g(30) }), 'up to £30');  // Google omits a zero amount
  assert.strictEqual(L.priceRangeText({}), null);
  assert.strictEqual(L.priceRangeText(undefined), null);
});
t('parkingOptions: only true flags count, free beats paid', () => {
  assert.strictEqual(L.parkingTag({ freeParkingLot: true, paidStreetParking: true }), 'Free parking');
  assert.strictEqual(L.parkingTag({ paidGarageParking: true }), 'Paid parking');
  assert.strictEqual(L.parkingTag({ valetParking: true }), 'Valet parking');
  assert.strictEqual(L.parkingTag({ freeParkingLot: false, paidParkingLot: false }), null);
  assert.strictEqual(L.parkingTag({}), null);
  assert.strictEqual(L.parkingTag(undefined), null);
});
t('rank: kids menu, price range and parking do not change the score', () => {
  const centre = { lat: 54.4858, lng: -0.6206 };
  const mkp = (id, extra) => Object.assign({ id, displayName: { text: 'Pub ' + id }, formattedAddress: 'X', primaryType: 'pub', types: ['pub'],
    location: { latitude: centre.lat + 0.002, longitude: centre.lng }, rating: 4.5, userRatingCount: 150, businessStatus: 'OPERATIONAL',
    currentOpeningHours: { openNow: true } }, extra);
  const ctx = { cat: L.categoryById('pub'), center: centre, radiusM: 1609, when: { mode: 'any', date: sat(12) }, now: sat(12), rafIndex: null, family: true, mode: 'car' };
  const r = L.rank([mkp('a', {}), mkp('b', { menuForChildren: true, parkingOptions: { freeParkingLot: true },
    priceRange: { startPrice: { currencyCode: 'GBP', units: '5' } } })], ctx);
  assert(Math.abs(r[0].score - r[1].score) < 1e-12, String(r[0].score - r[1].score));
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

// ---- attractions and the profile
const ids = o => o.map(x => x.id);
t('categories: Attractions sits in Out before Walks, has two searches, and uses opening hours', () => {
  const out = L.CATEGORIES.filter(c => c.group === 'Out');
  assert.deepStrictEqual(out.map(c => c.id), ['attractions', 'walks']);
  const a = L.categoryById('attractions');
  assert.strictEqual(a.queries.length, 2);
  assert.notStrictEqual(a.hours, false);
  assert.strictEqual(a.chain, 0);
  ['tourist_attraction', 'museum', 'zoo', 'castle', 'amusement_park'].forEach(ty => assert(a.types.indexOf(ty) > -1, ty));
  ['Natural History Museum', 'Chester Zoo', 'Warwick Castle', 'Kew Gardens', 'Sea Life Centre aquarium'].forEach(nm => assert(a.keywords.test(nm), nm));
  assert(!a.keywords.test('The Crown Inn'));
});
t('rank: attractions use opening hours (a shut museum is dropped in now mode)', () => {
  const mus = (id, over) => mk(id, 'Town Museum ' + id, Object.assign({ primaryType: 'museum', types: ['museum', 'tourist_attraction'], primaryTypeDisplayName: { text: 'Museum' } }, over));
  const r = L.rank([mus('a'), mus('b', { currentOpeningHours: { openNow: false } })], ctx('attractions'));
  assert.deepStrictEqual(ids(r), ['a']);
  assert.strictEqual(r[0].typeMatch, 1);
  assert.strictEqual(r[0].keyword, 'museum');
});

t('profile: defaults, and anything unreadable becomes the default', () => {
  const d = L.defaultProfile();
  assert.deepStrictEqual(d, { party: 'family', kids: [], vegetarian: false, avoidChains: false, outside: false, budget: 0, love: [], skip: [] });
  [undefined, null, '', 'not json', '[]', 42, true, '{"party":'].forEach(x => assert.deepStrictEqual(L.normProfile(x), d, String(x)));
  assert.deepStrictEqual(L.normProfile(JSON.stringify(d)), d);
});
t('profile: unknown values are dropped, order is canonical, duplicates collapse', () => {
  const p = L.normProfile({ party: 'gang', kids: ['12plus', 'toddler', 'under5', 'under5'], love: ['play', 'nonsense', 'animals'], skip: ['history', 'constructor'],
    vegetarian: 'yes', avoidChains: 1, outside: true, budget: 9 });
  assert.strictEqual(p.party, 'family');
  assert.deepStrictEqual(p.kids, ['under5', '12plus']);
  assert.deepStrictEqual(p.love, ['animals', 'play']);
  assert.deepStrictEqual(p.skip, ['history']);
  assert.strictEqual(p.vegetarian, false); assert.strictEqual(p.avoidChains, false); assert.strictEqual(p.outside, true);
  assert.strictEqual(p.budget, 0);
});
t('profile: love wins over skip, a couple keeps no kids ages, budget is 0 to 3', () => {
  const p = L.normProfile({ party: 'couple', kids: ['under5'], love: ['museums'], skip: ['museums', 'play'] });
  assert.deepStrictEqual(p.love, ['museums']); assert.deepStrictEqual(p.skip, ['play']); assert.deepStrictEqual(p.kids, []);
  assert.strictEqual(L.normProfile({ budget: 2 }).budget, 2);
  assert.strictEqual(L.normProfile({ budget: '3' }).budget, 3);
  assert.strictEqual(L.normProfile({ budget: 0 }).budget, 0);
  assert.strictEqual(L.normProfile({ budget: 4 }).budget, 0);
  assert.strictEqual(L.normProfile({ budget: -1 }).budget, 0);
  assert.strictEqual(L.normProfile({ budget: 'abc' }).budget, 0);
});

const attr = (id, name, ty, over) => mk(id, name, Object.assign({ primaryType: ty, types: [ty], primaryTypeDisplayName: { text: name } }, over || {}));
t('profile: interests match on place type or on words, and do not match by accident', () => {
  const fits = (interest, place, hay) => L.INTERESTS.find(i => i.id === interest).re.test(hay) ||
    L.INTERESTS.find(i => i.id === interest).types.some(ty => (place.types || []).indexOf(ty) > -1);
  assert(fits('animals', { types: ['zoo'] }, 'x'));
  assert(fits('animals', { types: [] }, 'Willow Farm Park'));
  assert(!fits('animals', { types: ['bowling_alley'] }, 'Strike Bowling'), 'bowling must not look like owls');
  assert(fits('play', { types: [] }, 'Strike Bowling'));
  assert(fits('history', { types: [] }, 'Ruined Abbey'));
  assert(fits('museums', { types: ['museum'] }, 'x'));
  assert(fits('transport', { types: [] }, 'Bluebell Steam Railway'));
  assert(!fits('transport', { types: [] }, 'Constraint Gallery'), 'train must not match inside another word');
  assert(fits('gardens', { types: ['botanical_garden'] }, 'x'));
});
t('profile: loving an interest lifts Attractions that fit it, skipping one lowers them, love wins when both fit', () => {
  const c = ctx('attractions');
  const zoo = attr('z', 'Coastal Wildlife Park', 'zoo'), mus = attr('m', 'Maritime Museum', 'museum'), plain = attr('p', 'Viewing Tower', 'tourist_attraction');
  const run = prof => { const x = Object.assign({}, c, { profile: prof }); const r = L.rank([zoo, mus, plain], x); return id => r.find(o => o.id === id); };
  const none = run(null);
  const lov = run({ love: ['animals'], skip: ['museums'] });
  assert(Math.abs(lov('z').score - none('z').score - 0.08) < 1e-9);
  assert(Math.abs(lov('m').score - none('m').score + 0.10) < 1e-9);
  assert(Math.abs(lov('p').score - none('p').score) < 1e-12);
  assert.strictEqual(lov('z').loved, 'animals');
  assert.strictEqual(lov('m').loved, null);
  // a zoo that is also a museum: love wins, no double effect
  const both = attr('b', 'Zoological Museum', 'museum', { types: ['museum', 'zoo'] });
  const r2 = L.rank([both], Object.assign({}, c, { profile: { love: ['animals'], skip: ['museums'] } }))[0];
  assert(Math.abs(r2.parts.profile - 0.08) < 1e-12, String(r2.parts.profile));
});
t('profile: interests only count in Attractions', () => {
  const zooPub = mk('zp', 'Zoo Tap', { primaryType: 'pub', types: ['pub', 'zoo'] });
  const r = L.rank([zooPub], Object.assign({}, ctx('pub'), { profile: { love: ['animals'] } }))[0];
  assert.strictEqual(r.parts.profile, 0);
});
t('profile: outside seating, vegetarian, chains, budget and kids menu each nudge by their own amount', () => {
  const W = L.PROFILE_WEIGHT;
  const eat = id => Object.assign(ctx('pubfood'), { family: true });
  const base = mk('b', 'The Plain Inn', { menuForChildren: false });
  const withProf = (over, prof, c) => L.rank([mk('x', over.name || 'The Plain Inn', over)], Object.assign({}, c || eat(), { profile: prof }))[0];
  assert(Math.abs(withProf({ outdoorSeating: true }, { outside: true }).parts.profile - W.outside) < 1e-12);
  assert.strictEqual(withProf({ outdoorSeating: false }, { outside: true }).parts.profile, 0, 'a no, or a blank, says nothing');
  assert.strictEqual(withProf({}, { outside: true }).parts.profile, 0);
  assert(Math.abs(withProf({ servesVegetarianFood: true }, { vegetarian: true }).parts.profile - W.vegetarian) < 1e-12);
  assert.strictEqual(withProf({ servesVegetarianFood: true }, { vegetarian: true }, ctx('pub')).parts.profile, 0, 'vegetarian counts when eating, not when drinking');
  assert.strictEqual(withProf({ servesVegetarianFood: false }, { vegetarian: true }).parts.profile, 0);
  assert(Math.abs(withProf({ name: 'The Moon Under Water (Wetherspoon)' }, { avoidChains: true }).parts.profile - W.chain) < 1e-12);
  assert.strictEqual(withProf({ name: 'The Moon Under Water (Wetherspoon)' }, { avoidChains: false }).parts.profile, 0);
  assert(Math.abs(withProf({ priceLevel: 'PRICE_LEVEL_EXPENSIVE' }, { budget: 2 }).parts.profile - W.overBudget) < 1e-12);
  assert.strictEqual(withProf({ priceLevel: 'PRICE_LEVEL_MODERATE' }, { budget: 2 }).parts.profile, 0, 'at budget is fine');
  assert.strictEqual(withProf({}, { budget: 1 }).parts.profile, 0, 'unknown price says nothing');
  assert.strictEqual(withProf({ priceLevel: 'PRICE_LEVEL_VERY_EXPENSIVE' }, { budget: 0 }).parts.profile, 0, 'no budget set means no nudge');
  assert(Math.abs(withProf({ menuForChildren: true }, { kids: ['under5'] }).parts.profile - W.kidsMenu) < 1e-12);
  assert(Math.abs(withProf({ menuForChildren: true }, { kids: ['5to11'] }).parts.profile - W.kidsMenu) < 1e-12);
  assert.strictEqual(withProf({ menuForChildren: true }, { kids: ['12plus'] }).parts.profile, 0, 'teenagers do not need a kids menu');
  assert.strictEqual(withProf({ menuForChildren: true }, { kids: ['under5'] }, ctx('pubfood')).parts.profile, 0, 'couple mode ignores the kids menu');
});
t('profile: effects add up and every nudge is small next to the rating part', () => {
  const W = L.PROFILE_WEIGHT;
  Object.keys(W).forEach(k => assert(Math.abs(W[k]) <= 0.10, k));
  const c = Object.assign(ctx('pubfood'), { family: true, profile: { kids: ['under5'], vegetarian: true, outside: true, avoidChains: true, budget: 1 } });
  const r = L.rank([mk('a', 'Greene King Plain Inn', { outdoorSeating: true, servesVegetarianFood: true, menuForChildren: true, priceLevel: 'PRICE_LEVEL_EXPENSIVE' })], c)[0];
  assert(Math.abs(r.parts.profile - (W.outside + W.vegetarian + W.chain + W.overBudget + W.kidsMenu)) < 1e-12, String(r.parts.profile));
  assert.deepStrictEqual(r.profileNotes, ['outside seating', 'vegetarian options', 'national chain', 'over your budget', 'kids menu']);
});
t('profile: the parts still add up to the score, and a profile never removes a place', () => {
  const items = [attr('z', 'Coastal Wildlife Park', 'zoo'), attr('m', 'Maritime Museum', 'museum'), attr('p', 'Viewing Tower', 'tourist_attraction'), attr('g', 'Walled Gardens', 'garden')];
  const loud = { party: 'family', kids: ['under5'], love: ['animals'], skip: ['museums', 'gardens', 'history', 'play', 'transport'], vegetarian: true, outside: true, avoidChains: true, budget: 1 };
  const c = Object.assign(ctx('attractions'), { family: true, profile: loud });
  const r = L.rank(items, c);
  assert.strictEqual(r.length, L.rank(items, ctx('attractions')).length);
  r.forEach(o => {
    const sum = Object.keys(o.parts).reduce((s, k) => s + o.parts[k], 0);
    assert(Math.abs(sum - o.score) < 1e-12, o.name);
  });
});
t('profile: a missing, damaged or text profile ranks exactly like no profile', () => {
  const items = [attr('z', 'Coastal Wildlife Park', 'zoo'), attr('m', 'Maritime Museum', 'museum')];
  const base = L.rank(items, ctx('attractions')).map(o => o.score);
  ['{not json', '', null, undefined, '{}'].forEach(p => {
    const r = L.rank(items, Object.assign(ctx('attractions'), { profile: p }));
    assert.deepStrictEqual(r.map(o => o.score), base, String(p));
  });
});
t('why here: shows the profile part with its reasons, and nothing when there is none', () => {
  const c = Object.assign(ctx('attractions'), { profile: { love: ['animals'] } });
  const zoo = L.rank([attr('z', 'Coastal Wildlife Park', 'zoo')], c)[0];
  assert(L.whyText(zoo, L.categoryById('attractions')).indexOf('your profile +0.08 (likes animals)') > -1, L.whyText(zoo, L.categoryById('attractions')));
  const mus = L.rank([attr('m', 'Maritime Museum', 'museum')], Object.assign(ctx('attractions'), { profile: { skip: ['museums'] } }))[0];
  assert(L.whyText(mus, L.categoryById('attractions')).indexOf('your profile -0.10 (not keen on museums)') > -1);
  const none = L.rank([attr('z', 'Coastal Wildlife Park', 'zoo')], ctx('attractions'))[0];
  assert(L.whyText(none, L.categoryById('attractions')).indexOf('your profile') === -1);
});
t('profileSummary: reads naturally for a family, a couple and an empty profile', () => {
  assert.strictEqual(L.profileSummary(null), 'Family with the kids.');
  assert.strictEqual(L.profileSummary({ party: 'couple' }), 'Just the two of us.');
  const s = L.profileSummary({ party: 'family', kids: ['under5', '5to11'], vegetarian: true, outside: true, avoidChains: true, budget: 2, love: ['animals', 'history'], skip: ['museums'] });
  assert.strictEqual(s, 'Family with the kids (under 5, 5 to 11). Vegetarian options, outside seating, avoids national chains, budget up to ££. Likes animals and wildlife, history and castles. Not keen on museums and galleries.');
  assert.strictEqual(L.profileSummary({ kids: ['12plus'] }), 'Family with the kids (12 and over).');
});
t('profile: every interest has an id, a label, a short name and a way to match', () => {
  const seen = new Set();
  L.INTERESTS.forEach(i => {
    assert(i.id && i.label && i.short && i.re instanceof RegExp && Array.isArray(i.types), i.id);
    assert(!seen.has(i.id)); seen.add(i.id);
    assert(!i.re.global && !i.re.sticky, i.id + ' must not be a stateful regex');
  });
  assert.strictEqual(L.KID_AGES.length, 3);
});

console.log('\n' + n + ' tests passed');
