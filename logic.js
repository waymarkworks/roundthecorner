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
    // One Pub choice. Micropubs, real ale and craft beer are preferences that work behind the
    // scenes: the second query goes looking for them, the keywords and the Real Ale Finder
    // signal lift them in the ranking, and chains are penalised. Two searches, same as any category.
    { id: 'pub', group: 'Drink', label: 'Pub',
      queries: ['pub', 'micropub real ale craft beer taproom'],
      types: ['pub', 'bar', 'brewery', 'brewpub'],
      keywords: /micro-?\s?pub|taproom|tap room|brewery tap|real ale|cask|camra|ale ?house|free house|craft|brewery|brewpub|\bipa\b|\btap\b/i, chain: 0.2 },
    { id: 'wine', group: 'Drink', label: 'Wine',
      queries: ['wine bar', 'bar serving wine by the glass'],
      types: ['wine_bar', 'bar'], keywords: /wine|vino|enoteca/i, chain: 0.1 },
    { id: 'cocktails', group: 'Drink', label: 'Cocktails',
      queries: ['cocktail bar', 'craft cocktails'],
      types: ['cocktail_bar', 'bar'], keywords: /cocktail|mixolog|speakeasy/i, chain: 0.1 },

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

    // Attractions: museums, zoos, castles, gardens, rides. The two searches are a judgment call,
    // not tested against live Google results. The profile's interests (see INTERESTS) nudge this
    // category only.
    { id: 'attractions', group: 'Out', label: 'Attractions',
      queries: ['tourist attraction', 'museum zoo castle or historic house'],
      types: ['tourist_attraction', 'museum', 'art_gallery', 'zoo', 'aquarium', 'amusement_park', 'water_park',
        'historical_landmark', 'historical_place', 'castle', 'cultural_landmark', 'garden', 'botanical_garden',
        'wildlife_park', 'visitor_center', 'planetarium', 'indoor_playground', 'adventure_sports_center',
        'miniature_golf_course', 'go_karting_venue'],
      keywords: /museum|gallery|zoo\b|aquarium|castle|abbey|priory|palace|manor|historic|heritage|gardens?\b|farm park|wildlife|adventure|theme park|soft play|railway|steam|maze|visitor cent|safari|sealife|planetarium/i,
      chain: 0 },
    { id: 'walks', group: 'Out', label: 'Walks',
      queries: ['country park or nature reserve', 'scenic walk viewpoint'],
      types: ['park', 'national_park', 'hiking_area', 'state_park', 'garden', 'wildlife_park'],
      keywords: /trail|walk|nature reserve|country park|wood|common|heath|moor|valley|coast|path|viewpoint|lookout|hill|fell|cliff|gorge|beach/i,
      chain: 0, hours: false }
  ];

  // ---- Real Ale Finder list (refreshed daily into raf.json)
  // How much the Real Ale Finder signal counts, by category. Absence is neutral, never a penalty.
  var RAF_WEIGHT = { pub: 0.22, pubfood: 0.05, roast: 0.05 };
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

  // Categories that were merged into Pub. Phones that saved one of these keep working.
  var LEGACY_IDS = { micropub: 'pub', realale: 'pub', craft: 'pub' };
  function categoryById(id) {
    if (Object.prototype.hasOwnProperty.call(LEGACY_IDS, id)) id = LEGACY_IDS[id];
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

  // Travel mode and minutes -> straight-line radius, using the same speeds and street padding as etaText,
  // so a "10 min walk" limit and the time shown on a card agree.
  var WALK_M_PER_MIN = 80, WALK_PAD = 1.3, CAR_M_PER_MIN = 35000 / 60, CAR_PAD = 1.4;
  var TRAVEL = {
    walk: { label: 'On foot', mins: [5, 10, 15, 20, 30], dflt: 10 },
    car: { label: 'By car or bus', mins: [10, 15, 20, 30, 45], dflt: 20 }
  };
  function radiusFor(mode, mins) {
    return mode === 'car' ? mins * CAR_M_PER_MIN / CAR_PAD : mins * WALK_M_PER_MIN / WALK_PAD;
  }
  function etaFor(mode, m) {
    if (mode === 'car') return 'about ' + Math.max(2, Math.round(m * CAR_PAD / CAR_M_PER_MIN)) + ' min by car';
    return Math.max(1, Math.round(m * WALK_PAD / WALK_M_PER_MIN)) + ' min walk';
  }
  function travelOptionLabel(mode, mins) { return mins + ' min ' + (mode === 'car' ? 'drive' : 'walk'); }

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

  /* ---------- profile: who is travelling and what they like ---------- */
  // Everything here nudges the ranking by a small amount. Nothing hides a place, because Google
  // leaves many of these fields blank and a blank field must never remove a good place.
  var KID_AGES = [
    { id: 'under5', label: 'Under 5' },
    { id: '5to11', label: '5 to 11' },
    { id: '12plus', label: '12 and over' }
  ];
  // Interests apply to Attractions only. A place fits an interest when Google gives it one of the
  // listed place types, or its name, type label or summary contains one of the words.
  // The word lists are judgment calls, not tested against live Google results.
  var INTERESTS = [
    { id: 'animals', label: 'Animals and wildlife', short: 'animals',
      types: ['zoo', 'aquarium', 'wildlife_park', 'wildlife_refuge', 'farm'],
      re: /\b(zoo|aquarium|wildlife|animals?|farm|safari|sealife|aviary|butterfl\w*|falconry|alpacas?|donkeys?)\b/i },
    { id: 'history', label: 'History and castles', short: 'history',
      types: ['castle', 'historical_landmark', 'historical_place', 'history_museum', 'cultural_landmark', 'monument'],
      re: /\b(castle|abbey|priory|palace|manor|fort|roman|medieval|heritage|historic\w*|cathedral|ruins?|tudor)\b/i },
    { id: 'museums', label: 'Museums and galleries', short: 'museums',
      types: ['museum', 'art_gallery', 'art_museum', 'history_museum', 'planetarium'],
      re: /\b(museum|gallery|galleries|exhibition|science cent(er|re)|planetarium)\b/i },
    { id: 'gardens', label: 'Gardens and nature', short: 'gardens',
      types: ['garden', 'botanical_garden', 'nature_preserve'],
      re: /\b(gardens?|arboretum|nature reserve|woodland|orchard|lake)\b/i },
    { id: 'play', label: 'Rides and play', short: 'rides and play',
      types: ['amusement_park', 'water_park', 'indoor_playground', 'playground', 'amusement_center', 'go_karting_venue',
        'miniature_golf_course', 'adventure_sports_center', 'roller_coaster', 'bowling_alley', 'video_arcade'],
      re: /\b(theme park|adventure|soft play|play ?(area|centre|center|ground|park)|trampoline|bowling|go.?kart\w*|funfair|fairground|miniature golf|crazy golf|splash|climbing|zip ?wire|maze|rides?)\b/i },
    { id: 'transport', label: 'Trains and transport', short: 'trains and transport',
      types: [],
      re: /\b(railway|steam|train|locomotive|tram|transport|vintage|aviation|aircraft|heritage line)\b/i }
  ];
  var BUDGET_LABELS = { 1: '£', 2: '££', 3: '£££' };
  var PRICE_LEVELS = { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
  // Score nudges. The rating part of the score can reach 0.42, so these are small on purpose.
  var PROFILE_WEIGHT = { love: 0.08, skip: -0.10, outside: 0.04, vegetarian: 0.05, chain: -0.10, overBudget: -0.06, kidsMenu: 0.03 };

  function defaultProfile() {
    return { party: 'family', kids: [], vegetarian: false, avoidChains: false, outside: false, budget: 0, love: [], skip: [] };
  }
  // Accepts stored JSON text or an object. Anything unreadable or unknown is dropped, never trusted.
  function normProfile(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object') o = {};
    function pick(arr, allowed) {
      return allowed.filter(function (id) { return Array.isArray(arr) && arr.indexOf(id) > -1; });
    }
    var party = o.party === 'couple' ? 'couple' : 'family';
    var ids = INTERESTS.map(function (i) { return i.id; });
    var love = pick(o.love, ids);
    var skip = pick(o.skip, ids).filter(function (id) { return love.indexOf(id) < 0; });   // love wins if both
    var b = Math.round(Number(o.budget));
    return {
      party: party,
      kids: party === 'family' ? pick(o.kids, KID_AGES.map(function (k) { return k.id; })) : [],
      vegetarian: o.vegetarian === true, avoidChains: o.avoidChains === true, outside: o.outside === true,
      budget: b >= 1 && b <= 3 ? b : 0, love: love, skip: skip
    };
  }

  function interestFits(interest, p, hay) {
    var types = (p.types || []).concat(p.primaryType ? [p.primaryType] : []);
    return interest.types.some(function (t) { return types.indexOf(t) > -1; }) || interest.re.test(hay || '');
  }

  // o = { place, cat, hay, isChain, family }. Returns the total nudge, the reasons, and the loved interest if any.
  function profileAdjust(profile, o) {
    var out = { total: 0, notes: [], loved: null };
    if (!profile) return out;
    var pf = normProfile(profile), p = o.place, W = PROFILE_WEIGHT;
    if (o.cat && o.cat.id === 'attractions') {
      var like = INTERESTS.filter(function (i) { return pf.love.indexOf(i.id) > -1 && interestFits(i, p, o.hay); });
      var dislike = INTERESTS.filter(function (i) { return pf.skip.indexOf(i.id) > -1 && interestFits(i, p, o.hay); });
      var shorts = function (l) { return l.map(function (i) { return i.short; }).join(' and '); };
      if (like.length) { out.total += W.love; out.loved = like[0].short; out.notes.push('likes ' + shorts(like)); }
      else if (dislike.length) { out.total += W.skip; out.notes.push('not keen on ' + shorts(dislike)); }
    }
    if (pf.outside && p.outdoorSeating === true) { out.total += W.outside; out.notes.push('outside seating'); }
    if (pf.vegetarian && o.cat && o.cat.group === 'Eat' && p.servesVegetarianFood === true) { out.total += W.vegetarian; out.notes.push('vegetarian options'); }
    if (pf.avoidChains && o.isChain) { out.total += W.chain; out.notes.push('national chain'); }
    var lvl = Object.prototype.hasOwnProperty.call(PRICE_LEVELS, p.priceLevel) ? PRICE_LEVELS[p.priceLevel] : null;
    if (pf.budget && lvl !== null && lvl > pf.budget) { out.total += W.overBudget; out.notes.push('over your budget'); }
    var youngKids = pf.kids.indexOf('under5') > -1 || pf.kids.indexOf('5to11') > -1;
    if (o.family && youngKids && p.menuForChildren === true) { out.total += W.kidsMenu; out.notes.push('kids menu'); }
    return out;
  }

  // One plain paragraph for the Settings screen.
  function profileSummary(profile) {
    var pf = normProfile(profile), bits = [];
    if (pf.party === 'couple') bits.push('Just the two of us');
    else {
      var ages = KID_AGES.filter(function (k) { return pf.kids.indexOf(k.id) > -1; }).map(function (k) { return k.label.toLowerCase(); });
      bits.push('Family with the kids' + (ages.length ? ' (' + ages.join(', ') + ')' : ''));
    }
    var likes = [];
    if (pf.vegetarian) likes.push('vegetarian options');
    if (pf.outside) likes.push('outside seating');
    if (pf.avoidChains) likes.push('avoids national chains');
    if (pf.budget) likes.push('budget up to ' + BUDGET_LABELS[pf.budget]);
    if (likes.length) bits.push(likes.join(', ').replace(/^./, function (c) { return c.toUpperCase(); }));
    var names = function (ids) { return INTERESTS.filter(function (i) { return ids.indexOf(i.id) > -1; }).map(function (i) { return i.label.toLowerCase(); }).join(', '); };
    if (pf.love.length) bits.push('Likes ' + names(pf.love));
    if (pf.skip.length) bits.push('Not keen on ' + names(pf.skip));
    return bits.join('. ') + '.';
  }

  // ctx = { cat, center:{lat,lng}, radiusM, when }
  function rank(places, ctx) {
    var cat = ctx.cat, seen = {}, out = [];
    var pf = ctx.profile ? normProfile(ctx.profile) : null;
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
      var smoothed = r ? (r * n + 4 * 15) / (n + 15) : null;
      var q = r ? clamp((smoothed - 3.2) / 1.8, 0, 1) : 0.3;
      var near = clamp(1 - d / ctx.radiusM, 0, 1);
      var closing = ctx.when.mode === 'now' && info.minsLeft != null && info.minsLeft < 45 ? 0.15 : 0;
      var raf = ctx.rafIndex ? matchRaf(ctx.rafIndex, p.formattedAddress, name, ctx.now) : null;
      var rafBoost = raf ? (RAF_WEIGHT[cat.id] || 0) * raf.r : 0;
      var famBoost = ctx.family && p.goodForChildren ? 0.06 : 0;
      var pa = pf ? profileAdjust(pf, { place: p, cat: cat, hay: hay, isChain: isChain, family: !!ctx.family })
        : { total: 0, notes: [], loved: null };
      // The score is the sum of these, kept apart so the "why here" line can show them.
      var parts = {
        rating: 0.42 * q, near: 0.2 * near, type: 0.2 * typeMatch, kw: 0.18 * kw,
        chain: -chain, noHours: info.state === 'unknown' ? -0.08 : 0, closing: -closing,
        raf: rafBoost, family: famBoost, profile: pa.total
      };
      var score = parts.rating + parts.near + parts.type + parts.kw + parts.chain +
        parts.noHours + parts.closing + parts.raf + parts.family + parts.profile;

      out.push({
        id: p.id, place: p, name: name, typeName: typeName, summary: summary,
        dist: d, info: info, keyword: kword,
        typeMatch: typeMatch, kw: kw, chain: isChain, raf: raf, score: score,
        parts: parts, smoothed: smoothed, profileNotes: pa.notes, loved: pa.loved,
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

  // One plain line saying how a ranked result got its score. Shown when "why here" is switched on.
  // o is an item from rank(); cat is the category it was ranked under.
  function whyText(o, cat) {
    var pt = o.parts, p = o.place, bits = [];
    function f(x) { return (Math.round(x * 100) / 100).toFixed(2); }
    function sg(x) { return (x < 0 ? '-' : '+') + f(Math.abs(x)); }
    var rating = 'rating ' + f(pt.rating);
    if (!p.rating) rating += ' (not rated yet)';
    else if (o.smoothed != null && Math.abs(o.smoothed - p.rating) >= 0.05) {
      var c = p.userRatingCount || 0;
      rating += ' (' + p.rating.toFixed(1) + ' from ' + c + (c === 1 ? ' review' : ' reviews') + ' counts as ' + o.smoothed.toFixed(1) + ')';
    }
    bits.push(rating, 'nearness ' + f(pt.near), 'place type ' + f(pt.type) + (o.typeMatch ? '' : ' (no match)'));
    if (!cat || cat.keywords) bits.push('keyword ' + f(pt.kw) + (o.kw ? '' : ' (no match)'));
    if (pt.chain) bits.push('chain ' + sg(pt.chain));
    if (pt.noHours) bits.push('hours not listed ' + sg(pt.noHours));
    if (pt.closing) bits.push('closing soon ' + sg(pt.closing));
    if (pt.raf) bits.push('Real Ale Finder ' + sg(pt.raf));
    if (pt.family) bits.push('good for children ' + sg(pt.family));
    if (pt.profile) bits.push('your profile ' + sg(pt.profile) + (o.profileNotes && o.profileNotes.length ? ' (' + o.profileNotes.join(', ') + ')' : ''));
    return 'Why here (score ' + f(o.score) + '): ' + bits.join(', ') + '.' +
      (o.outside ? ' Past your limit, so it is listed after places inside it.' : '');
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

  // Google's priceRange is { startPrice, endPrice } of Money ({ currencyCode, units (string), nanos }).
  // Either end can be missing. Returns e.g. "£10-20", "£20+", "up to £15", or null.
  function moneyNum(m) {
    if (!m || m.units === undefined && m.nanos === undefined) return null;
    var v = Number(m.units || 0) + Number(m.nanos || 0) / 1e9;
    return isFinite(v) && v >= 0 ? v : null;
  }
  function moneyStr(v) { return Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : v.toFixed(2); }
  function priceRangeText(pr) {
    if (!pr) return null;
    var a = moneyNum(pr.startPrice), b = moneyNum(pr.endPrice);
    if (a === null && b === null) return null;
    var cur = (pr.startPrice || pr.endPrice || {}).currencyCode;
    var sym = cur === 'GBP' || !cur ? '£' : cur + ' ';
    if (a !== null && b !== null) return sym + moneyStr(a) + '–' + moneyStr(b);
    if (a !== null) return sym + moneyStr(a) + '+';
    return 'up to ' + sym + moneyStr(b);
  }

  // Google's parkingOptions is a set of true/false flags. Only a true flag counts; absent or false says nothing.
  function parkingTag(po) {
    if (!po) return null;
    if (po.freeParkingLot || po.freeStreetParking || po.freeGarageParking) return 'Free parking';
    if (po.paidParkingLot || po.paidStreetParking || po.paidGarageParking) return 'Paid parking';
    if (po.valetParking) return 'Valet parking';
    return null;
  }

  return {
    KID_AGES: KID_AGES, INTERESTS: INTERESTS, BUDGET_LABELS: BUDGET_LABELS, PROFILE_WEIGHT: PROFILE_WEIGHT,
    defaultProfile: defaultProfile, normProfile: normProfile, profileAdjust: profileAdjust, profileSummary: profileSummary,
    priceRangeText: priceRangeText, parkingTag: parkingTag,
    DEFAULT_CAP: DEFAULT_CAP, MIN_CAP: MIN_CAP, MAX_CAP: MAX_CAP, dayKey: dayKey, readUsage: readUsage, clampCap: clampCap,
    CATEGORIES: CATEGORIES, categoryById: categoryById, CHAINS: CHAINS,
    distanceM: distanceM, miles: miles, etaText: etaText,
    TRAVEL: TRAVEL, radiusFor: radiusFor, etaFor: etaFor, travelOptionLabel: travelOptionLabel,
    openAt: openAt, openInfo: openInfo, targetDate: targetDate, rank: rank, whyText: whyText,
    normPostcode: normPostcode, buildRafIndex: buildRafIndex, matchRaf: matchRaf, RAF_WEIGHT: RAF_WEIGHT
  };
});
