/* Round the Corner: pure logic (no DOM). Loaded by the page and by the Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTCLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // National chains. Penalised for the independent-leaning categories only.
  var CHAINS = /wetherspoon|harvester|toby carvery|hungry horse|beefeater|brewers fayre|table table|ember inns|all bar one|slug (and|&) lettuce|o'?neill|walkabout|nicholson'?s|chef (and|&) brewer|vintage inns|sizzling pub|flaming grill|greene king|premier inn/i;

  // queries: text searches run in parallel and merged.
  // types: Google place types that count as the right kind of place.
  // keywords: words in the name, summary or type label that match what you asked for.
  // chain: score penalty for a national chain.
  // hours: false for things that have no opening hours (walks).
  var CATEGORIES = [
    { id: 'micropub', group: 'Drink', label: 'Micropubs',
      queries: ['micropub', 'craft beer taproom'],
      types: ['pub', 'bar', 'brewery', 'brewpub'],
      keywords: /micro-?\s?pub|taproom|tap room|brewery tap|real ale|cask|craft|ale ?house/i, chain: 0.2 },
    { id: 'realale', group: 'Drink', label: 'Real ale',
      queries: ['real ale pub', 'traditional pub cask ale'],
      types: ['pub', 'bar', 'brewery', 'brewpub'],
      keywords: /real ale|cask|camra|ale ?house|free house|brewery|\btap\b|micro-?\s?pub/i, chain: 0 },
    { id: 'craft', group: 'Drink', label: 'Craft beer',
      queries: ['craft beer bar', 'brewery taproom'],
      types: ['bar', 'pub', 'brewery', 'brewpub'],
      keywords: /craft|taproom|tap room|brewery|brewpub|\bipa\b|micro-?\s?pub/i, chain: 0.2 },
    { id: 'pub', group: 'Drink', label: 'Any pub',
      queries: ['pub', 'traditional pub'],
      types: ['pub'], keywords: null, chain: 0.1 },
    { id: 'wine', group: 'Drink', label: 'Wine or cocktails',
      queries: ['wine bar', 'cocktail bar'],
      types: ['bar', 'wine_bar', 'cocktail_bar'], keywords: /wine|cocktail/i, chain: 0.1 },

    { id: 'pubfood', group: 'Eat', label: 'Pub food',
      queries: ['pub serving food', 'gastropub'],
      types: ['pub', 'gastropub'], keywords: /gastro|kitchen|dining|food/i, chain: 0.1 },
    { id: 'roast', group: 'Eat', label: 'Sunday roast',
      queries: ['Sunday roast pub', 'Sunday roast'],
      types: ['pub', 'restaurant', 'gastropub'], keywords: /roast|carvery/i, chain: 0.1 },
    { id: 'dinner', group: 'Eat', label: 'Dinner',
      queries: ['restaurant for dinner', 'independent restaurant'],
      types: ['restaurant'], keywords: null, chain: 0.1 },
    { id: 'lunch', group: 'Eat', label: 'Lunch',
      queries: ['lunch', 'cafe or pub lunch'],
      types: ['restaurant', 'cafe', 'pub', 'sandwich_shop'], keywords: /lunch|deli|kitchen/i, chain: 0.1 },
    { id: 'coffee', group: 'Eat', label: 'Coffee and cake',
      queries: ['independent coffee shop', 'cafe cake'],
      types: ['cafe', 'coffee_shop', 'bakery'], keywords: /cake|bakery|coffee/i, chain: 0.1 },
    { id: 'icecream', group: 'Eat', label: 'Ice cream',
      queries: ['ice cream', 'gelato'],
      types: ['ice_cream_shop', 'dessert_shop', 'gelato_shop'],
      keywords: /ice cream|gelato|gelateria|dairy|creamery/i, chain: 0 },

    { id: 'walks', group: 'Out', label: 'Walks',
      queries: ['country park or nature reserve', 'scenic walk viewpoint'],
      types: ['park', 'national_park', 'hiking_area', 'state_park', 'garden', 'wildlife_park'],
      keywords: /trail|walk|nature reserve|country park|wood|common|heath|moor|valley|coast|path|viewpoint|lookout|hill|fell|cliff|gorge|beach/i,
      chain: 0, hours: false }
  ];

  // ---- Real Ale Finder list (refreshed daily into raf.json)
  // How much the Real Ale Finder signal counts, by category. Absence is neutral, never a penalty.
  var RAF_WEIGHT = { micropub: 0.22, realale: 0.26, craft: 0.15, pub: 0.10, pubfood: 0.05, roast: 0.05 };
  var RAF_STOP = { the: 1, pub: 1, inn: 1, and: 1, of: 1, ltd: 1, limited: 1, bar: 1, club: 1 };
  var RAF_URL = /^https:\/\/www\.realalefinder\.com\/beerboard\/\?[A-Za-z0-9._~%-]+$/;
  // Days since last update implied by the list's label. "week" is somewhere in the last seven days.
  var RAF_BASE_DAYS = { today: 0, yesterday: 1, week: 4, older: 14 };

  function normPostcode(s) {
    var m = String(s || '').toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
    return m ? m[1] + m[2] : null;
  }
  function tokens(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

  // raf = { asOf: ISO string, pubs: [{ title, postcode, url, updated }] }
  function buildRafIndex(raf) {
    if (!raf || !raf.asOf || !Array.isArray(raf.pubs)) return null;
    var asOf = new Date(raf.asOf);
    if (isNaN(asOf.getTime())) return null;
    var by = {};
    raf.pubs.forEach(function (e) {
      var pc = normPostcode(e && e.postcode);
      if (!pc || !e.title || !RAF_URL.test(e.url || '')) return;
      (by[pc] = by[pc] || []).push({ e: e, tok: tokens(e.title) });
    });
    return { asOf: asOf, by: by };
  }

  function rafStatus(entry, asOf, now) {
    var snapAge = Math.max(0, Math.round((dayStart(now) - dayStart(asOf)) / 86400000));
    var base = RAF_BASE_DAYS.hasOwnProperty(entry.updated) ? RAF_BASE_DAYS[entry.updated] : RAF_BASE_DAYS.older;
    var eff = base + snapAge;
    var r = 0.2 + 0.8 * clamp(1 - eff / 10, 0, 1);
    var label;
    if (entry.updated === 'older') label = 'Not updated recently';
    else if (entry.updated === 'week') label = snapAge === 0 ? 'Updated this week' : 'Updated about ' + eff + ' days ago';
    else if (eff === 0) label = 'Updated today';
    else if (eff === 1) label = 'Updated yesterday';
    else label = 'Updated ' + eff + ' days ago';
    return { url: entry.url, label: label, r: r, fresh: eff <= 1 && entry.updated !== 'older', old: entry.updated === 'older', stale: snapAge >= 3 };
  }

  // Match one Google place to the list: same postcode, and at least half the name's words in the list title.
  function matchRaf(index, address, name, now) {
    if (!index) return null;
    var pc = normPostcode(address);
    if (!pc || !index.by[pc]) return null;
    var gt = tokens(name).filter(function (t) { return !RAF_STOP[t]; });
    if (!gt.length) gt = tokens(name);
    if (!gt.length) return null;
    var best = null, bestHit = 0;
    index.by[pc].forEach(function (c) {
      var hit = gt.filter(function (t) { return c.tok.indexOf(t) > -1; }).length / gt.length;
      if (hit > bestHit) { bestHit = hit; best = c.e; }
    });
    return bestHit >= 0.5 ? rafStatus(best, index.asOf, now || new Date()) : null;
  }

  // When several keywords match, show the most specific one.
  var KEYWORD_PRIORITY = ['micropub', 'micro pub', 'micro-pub', 'taproom', 'tap room', 'brewery tap', 'real ale',
    'camra', 'cask', 'brewpub', 'brewery', 'craft', 'gelato', 'gelateria', 'ice cream', 'roast', 'carvery'];
  function bestKeyword(hay, re) {
    var low = hay.toLowerCase();
    for (var i = 0; i < KEYWORD_PRIORITY.length; i++) {
      if (low.indexOf(KEYWORD_PRIORITY[i]) > -1 && re.test(KEYWORD_PRIORITY[i])) return KEYWORD_PRIORITY[i];
    }
    var m = hay.match(re);
    return m ? m[0].toLowerCase() : null;
  }

  function categoryById(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
    return CATEGORIES[0];
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(h, m) { return pad(h || 0) + ':' + pad(m || 0); }
  function toRad(x) { return x * Math.PI / 180; }

  // Straight-line distance in metres.
  function distanceM(a, b) {
    var R = 6371000;
    var dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    var s = Math.pow(Math.sin(dLat / 2), 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function miles(m) { return Math.max(0.1, m / 1609.344).toFixed(1); }

  // Rough time to get there. Straight line is padded for real streets.
  function etaText(m) {
    if (m <= 2400) return Math.max(1, Math.round(m * 1.3 / 80)) + ' min walk';
    var mins = Math.max(2, Math.round(m * 1.4 / (35000 / 60)));
    return 'about ' + mins + ' min by car';
  }

  // Is a place open at `date`, from Google's regularOpeningHours.periods?
  // Google days: 0 = Sunday. A period with no close means open all the time.
  function openAt(periods, date) {
    var t = date.getDay() * 1440 + date.getHours() * 60 + date.getMinutes();
    var WEEK = 10080;
    for (var i = 0; i < periods.length; i++) {
      var p = periods[i];
      if (!p.open) continue;
      if (!p.close) return { open: true, until: null, minsLeft: null, always: true };
      var o = p.open.day * 1440 + (p.open.hour || 0) * 60 + (p.open.minute || 0);
      var c = p.close.day * 1440 + (p.close.hour || 0) * 60 + (p.close.minute || 0);
      if (c <= o) c += WEEK;
      for (var s = 0; s <= WEEK; s += WEEK) {
        var tt = t + s;
        if (tt >= o && tt < c) {
          return { open: true, until: hhmm(p.close.hour, p.close.minute), minsLeft: c - tt, always: false };
        }
      }
    }
    return { open: false };
  }

  // when = { mode: 'now' | 'at' | 'any', date: Date }
  function openInfo(place, when) {
    var periods = place.regularOpeningHours && place.regularOpeningHours.periods;
    var hasP = Array.isArray(periods) && periods.length > 0;
    if (when.mode === 'at') {
      if (!hasP) return { state: 'unknown' };
      var r = openAt(periods, when.date);
      return r.open
        ? { state: 'open', until: r.until, minsLeft: r.minsLeft, always: r.always }
        : { state: 'closed' };
    }
    // 'now' and 'any' read the live flag first, because it knows about bank holidays.
    var flag = null;
    if (place.currentOpeningHours && typeof place.currentOpeningHours.openNow === 'boolean') flag = place.currentOpeningHours.openNow;
    else if (place.regularOpeningHours && typeof place.regularOpeningHours.openNow === 'boolean') flag = place.regularOpeningHours.openNow;
    var calc = hasP ? openAt(periods, when.date) : null;
    var open = flag !== null ? flag : (calc ? calc.open : null);
    if (open === null) return { state: 'unknown' };
    if (!open) return { state: 'closed' };
    return {
      state: 'open',
      until: calc && calc.open ? calc.until : null,
      minsLeft: calc && calc.open ? calc.minsLeft : null,
      always: !!(calc && calc.always)
    };
  }

  // dayKey: today | tomorrow | sun | mon | ... ; time: "HH:MM"
  function targetDate(dayKey, time, now) {
    var d = new Date(now.getTime());
    var parts = (time || '18:00').split(':');
    var idx = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    if (dayKey === 'tomorrow') d.setDate(d.getDate() + 1);
    else if (idx.hasOwnProperty(dayKey)) d.setDate(d.getDate() + ((idx[dayKey] - d.getDay() + 7) % 7));
    d.setHours(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, 0, 0);
    return d;
  }

  // ctx = { cat, center:{lat,lng}, radiusM, when }
  function rank(places, ctx) {
    var cat = ctx.cat, seen = {}, out = [];
    places.forEach(function (p) {
      if (!p || !p.id || seen[p.id] || !p.location) return;
      seen[p.id] = true;
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return;

      var d = distanceM(ctx.center, { lat: p.location.latitude, lng: p.location.longitude });
      var usesHours = cat.hours !== false;
      var info = usesHours ? openInfo(p, ctx.when) : { state: 'na' };
      if (usesHours && ctx.when.mode !== 'any') {
        if (info.state === 'closed') return;
        if (ctx.when.mode === 'at' && info.minsLeft != null && info.minsLeft < 30) return;
      }

      var name = (p.displayName && p.displayName.text) || '';
      var typeName = (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '';
      var summary = (p.editorialSummary && p.editorialSummary.text) || '';
      var hay = [name, typeName, summary].join(' ');
      var types = p.types || [];
      var typeMatch = (p.primaryType && cat.types.indexOf(p.primaryType) > -1) ||
        types.some(function (t) { return cat.types.indexOf(t) > -1; }) ? 1 : 0;
      var kword = cat.keywords ? bestKeyword(hay, cat.keywords) : null;
      var kw = kword ? 1 : 0;
      var isChain = CHAINS.test(name);
      var chain = isChain ? cat.chain : 0;

      var n = p.userRatingCount || 0, r = p.rating;
      // Pulls a 5.0 from 4 reviews back towards 4.0, so thin ratings do not top the list.
      var q = r ? clamp(((r * n + 4 * 15) / (n + 15) - 3.2) / 1.8, 0, 1) : 0.3;
      var near = clamp(1 - d / ctx.radiusM, 0, 1);
      var closing = ctx.when.mode === 'now' && info.minsLeft != null && info.minsLeft < 45 ? 0.15 : 0;
      var raf = ctx.rafIndex ? matchRaf(ctx.rafIndex, p.formattedAddress, name, ctx.now) : null;
      var rafBoost = raf ? (RAF_WEIGHT[cat.id] || 0) * raf.r : 0;
      var score = 0.42 * q + 0.2 * near + 0.2 * typeMatch + 0.18 * kw - chain -
        (info.state === 'unknown' ? 0.08 : 0) - closing + rafBoost;

      out.push({
        id: p.id, place: p, name: name, typeName: typeName, summary: summary,
        dist: d, info: info, keyword: kword,
        typeMatch: typeMatch, kw: kw, chain: isChain, raf: raf, score: score,
        outside: d > ctx.radiusM, closingSoon: closing > 0
      });
    });

    var strong = out.filter(function (o) { return o.typeMatch || o.kw; });
    var pool = strong.length >= 3 ? strong : out;
    function byScore(a, b) { return b.score - a.score; }
    var inside = pool.filter(function (o) { return !o.outside; }).sort(byScore);
    var outside = pool.filter(function (o) { return o.outside && o.dist <= ctx.radiusM * 1.6; }).sort(byScore);
    return inside.concat(outside).slice(0, 15);
  }

  /* ---------- daily search allowance (a guard against runaway Google spend) ---------- */
  var DEFAULT_CAP = 80, MIN_CAP = 10, MAX_CAP = 1000;
  function dayKey(now) {
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return now.getFullYear() + '-' + z(now.getMonth() + 1) + '-' + z(now.getDate());
  }
  // raw is the stored JSON text; a new day, or anything unreadable, starts at zero.
  function readUsage(raw, now) {
    var today = dayKey(now), u = null;
    try { u = JSON.parse(raw); } catch (e) {}
    if (u && u.d === today && typeof u.n === 'number' && isFinite(u.n) && u.n >= 0) return { d: today, n: Math.floor(u.n) };
    return { d: today, n: 0 };
  }
  function clampCap(v) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return DEFAULT_CAP;
    return Math.min(MAX_CAP, Math.max(MIN_CAP, n));
  }

  return {
    DEFAULT_CAP: DEFAULT_CAP, MIN_CAP: MIN_CAP, MAX_CAP: MAX_CAP, dayKey: dayKey, readUsage: readUsage, clampCap: clampCap,
    CATEGORIES: CATEGORIES, categoryById: categoryById, CHAINS: CHAINS,
    distanceM: distanceM, miles: miles, etaText: etaText,
    openAt: openAt, openInfo: openInfo, targetDate: targetDate, rank: rank,
    normPostcode: normPostcode, buildRafIndex: buildRafIndex, matchRaf: matchRaf, RAF_WEIGHT: RAF_WEIGHT
  };
});
