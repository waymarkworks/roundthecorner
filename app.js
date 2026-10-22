/* Round the Corner: UI. Talks to Google Places (New) and the Maps JavaScript API with the key
   you paste into Settings. The key lives in this browser only. */
(function () {
  'use strict';
  var L = window.RTCLogic;
  var $ = function (id) { return document.getElementById(id); };

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  var FIELDS = [
    'id', 'displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount',
    'regularOpeningHours', 'currentOpeningHours', 'googleMapsUri', 'websiteUri',
    'primaryType', 'primaryTypeDisplayName', 'types', 'priceLevel', 'editorialSummary',
    'outdoorSeating', 'goodForChildren', 'allowsDogs', 'servesBeer', 'businessStatus'
  ].map(function (f) { return 'places.' + f; }).join(',');
  var GEO_FIELDS = 'places.location,places.displayName,places.formattedAddress';
  var GPS_LABEL = 'My location';
  var PRICE = { PRICE_LEVEL_INEXPENSIVE: '£', PRICE_LEVEL_MODERATE: '££', PRICE_LEVEL_EXPENSIVE: '£££', PRICE_LEVEL_VERY_EXPENSIVE: '££££' };

  var state = {
    key: store.get('rtc:key') || '',
    gps: null,            // {lat, lng, acc}
    ranked: [], page: 0, ctx: null, label: '',
    mapsPromise: null, map: null, markers: [], youMarker: null, busy: false, installEvt: null,
    raf: null   // Real Ale Finder list from raf.json, refreshed daily by the GitHub job
  };

  /* ---------- small helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function link(text, href, cls) {
    var a = el('a', cls || null, text);
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }
  function showErr(msg) { var e = $('formErr'); e.textContent = msg; e.hidden = !msg; }

  /* ---------- daily search allowance ---------- */
  // Counts every Google search made from this phone today and refuses to go past the limit.
  // It is a guard against a bug or a stuck loop, not a billing control: Google's own limit
  // for this API cannot be lowered, so this is the cap. It resets at local midnight.
  function getCap() {
    var raw = store.get('rtc:cap');
    return raw == null ? L.DEFAULT_CAP : L.clampCap(raw);
  }
  function getUsage() { return L.readUsage(store.get('rtc:usage'), new Date()); }
  function addUsage() { var u = getUsage(); u.n += 1; store.set('rtc:usage', JSON.stringify(u)); return u.n; }
  function limitError() {
    var e = new Error('Daily search limit reached (' + getCap() + '). It resets at midnight. You can raise it in Settings.');
    e.limit = true;
    return e;
  }
  function showUsage() {
    var u = getUsage(), cap = getCap();
    var t = 'Searches today: ' + u.n + ' of ' + cap + '. A Find uses 2 or 3.';
    $('usageNote').textContent = t;
    $('capNote').textContent = t + ' Resets at midnight.';
  }

  /* ---------- Google calls ---------- */
  async function searchText(body, mask, opts) {
    if (!(opts && opts.free) && getUsage().n >= getCap()) throw limitError();
    addUsage(); showUsage();
    var res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': state.key, 'X-Goog-FieldMask': mask },
      body: JSON.stringify(body)
    });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var err = new Error((data.error && data.error.message) || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data.places || [];
  }

  function explain(err) {
    if (err && err.limit) return err.message;
    var s = err && err.status;
    if (s === 400 && /API key/i.test(err.message)) return 'Google rejected the key. Check it was pasted in full.';
    if (s === 403) return 'Google refused the request. Check Places API (New) is enabled for this key and that the key allows this site address. (' + err.message + ')';
    if (s === 429) return 'Google says you have hit a quota. Try again later.';
    if (err && err.name === 'TypeError') return 'No connection. Check your signal and try again.';
    return 'Something went wrong: ' + ((err && err.message) || 'unknown error');
  }

  function loadMaps() {
    if (state.mapsPromise) return state.mapsPromise;
    state.mapsPromise = new Promise(function (resolve, reject) {
      if (window.google && google.maps && google.maps.importLibrary) return resolve();
      window.__rtcMapsReady = resolve;
      window.gm_authFailure = function () { reject(new Error('auth')); };
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(state.key) +
        '&v=weekly&loading=async&callback=__rtcMapsReady';
      s.async = true;
      s.onerror = function () { reject(new Error('load')); };
      document.head.appendChild(s);
    });
    state.mapsPromise.catch(function () { state.mapsPromise = null; });
    return state.mapsPromise;
  }

  /* ---------- location ---------- */
  function getGps() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error('This browser cannot share a location.'));
      navigator.geolocation.getCurrentPosition(
        function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
        function (e) {
          reject(new Error(e && e.code === 1
            ? 'Location is blocked. Allow it in the browser settings for this site, or type a town.'
            : 'Could not get your location. Type a town instead.'));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
      );
    });
  }

  async function useGps() {
    $('whereNote').textContent = 'Finding you…';
    try {
      state.gps = await getGps();
      $('where').value = GPS_LABEL;
      $('whereNote').textContent = state.gps.acc >= 1
        ? 'Using your location (accurate to about ' + Math.round(state.gps.acc) + ' m).'
        : 'Using your location.';
      return true;
    } catch (e) {
      state.gps = null;
      $('whereNote').textContent = '';
      showErr(e.message);
      return false;
    }
  }

  async function resolveCenter() {
    var text = $('where').value.trim();
    if (state.gps && text === GPS_LABEL) {
      return { lat: state.gps.lat, lng: state.gps.lng, label: 'your location' };
    }
    if (!text) {
      if (await useGps()) return { lat: state.gps.lat, lng: state.gps.lng, label: 'your location' };
      return null;
    }
    var found = await searchText({ textQuery: text, regionCode: 'GB', languageCode: 'en-GB', pageSize: 1 }, GEO_FIELDS);
    if (!found.length || !found[0].location) {
      showErr('Google could not find "' + text + '". Try a town or a postcode.');
      return null;
    }
    var p = found[0];
    store.set('rtc:where', text);
    return { lat: p.location.latitude, lng: p.location.longitude, label: (p.displayName && p.displayName.text) || text };
  }

  /* ---------- search ---------- */
  function currentWhen() {
    var day = $('day').value, now = new Date();
    if (day === 'now') return { mode: 'now', date: now };
    if (day === 'any') return { mode: 'any', date: now };
    return { mode: 'at', date: L.targetDate(day, $('time').value, now) };
  }

  async function run() {
    if (state.busy) return;
    showErr('');
    if (!state.key) { openSetup(true); showErr('Add your Google key in Settings first.'); return; }
    var cat = L.categoryById((document.querySelector('input[name="cat"]:checked') || {}).value);
    var radiusM = parseFloat($('radius').value) * 1609.344;
    var when = currentWhen();
    store.set('rtc:prefs', JSON.stringify({ cat: cat.id, radius: $('radius').value, day: $('day').value, time: $('time').value }));

    var typed = $('where').value.trim();
    var needs = cat.queries.length + (typed && !(state.gps && typed === GPS_LABEL) ? 1 : 0);
    if (getUsage().n + needs > getCap()) { showErr(limitError().message); return; }

    setBusy(true); showSkeleton();
    try {
      var center = await resolveCenter();
      if (!center) { clearResults(); return; }
      var body = function (q) {
        var b = {
          textQuery: q, regionCode: 'GB', languageCode: 'en-GB', pageSize: 20,
          locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(50000, radiusM * 1.6) } }
        };
        if (when.mode === 'now' && cat.hours !== false) b.openNow = true;
        return b;
      };
      var lists = await Promise.all(cat.queries.map(function (q) { return searchText(body(q), FIELDS); }));
      var all = [].concat.apply([], lists);
      state.ctx = { cat: cat, center: center, radiusM: radiusM, when: when, rafIndex: L.buildRafIndex(state.raf), now: new Date() };
      state.label = center.label;
      state.ranked = L.rank(all, state.ctx);
      state.page = 0;
      state.found = all.length;
      render();
      scrollToResults();
    } catch (e) {
      clearResults();
      showErr(explain(e));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- rendering ---------- */
  function setBusy(b) {
    state.busy = b;
    $('go').disabled = b;
    $('go').textContent = b ? 'Looking…' : 'Find 3 places';
  }
  var emptyEl = $('empty');   // kept by reference: rendering removes it from the page
  function scrollToResults() {
    try { $('results').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }
  function clearResults() {
    var r = $('results'); r.textContent = '';
    r.appendChild(emptyEl);
  }
  function showSkeleton() {
    var r = $('results'); r.textContent = '';
    for (var i = 0; i < 3; i++) r.appendChild(el('div', 'skeleton'));
  }

  function openPill(o) {
    var i = o.info;
    if (i.state === 'na') return null;
    if (i.state === 'open') {
      var t = i.always ? 'Open 24 hours' : (i.until ? 'Open until ' + i.until : 'Open');
      return [t, o.closingSoon ? 'warn' : 'open'];
    }
    if (i.state === 'closed') return ['Shut', 'shut'];
    return ['Hours not listed', 'warn'];
  }

  function tags(p) {
    var t = [];
    if (p.allowsDogs) t.push('Dogs welcome');
    if (p.outdoorSeating) t.push('Outside seating');
    if (p.goodForChildren) t.push('Kids OK');
    if (p.servesBeer && state.ctx.cat.group === 'Eat') t.push('Serves beer');
    return t;
  }

  function card(o, idx) {
    var p = o.place;
    var c = el('article', 'card'); c.id = 'card-' + idx;
    var top = el('div', 'card-top');
    top.appendChild(el('div', 'num', String(idx + 1)));
    var mid = el('div');
    mid.appendChild(el('h3', null, o.name));
    var bits = [o.typeName, PRICE[p.priceLevel]].filter(Boolean);
    bits.push(L.miles(o.dist) + ' mi, ' + L.etaText(o.dist));
    mid.appendChild(el('p', 'sub', bits.join(' · ')));
    top.appendChild(mid);
    if (p.rating) top.appendChild(el('div', 'rating', '★ ' + p.rating.toFixed(1) + ' (' + (p.userRatingCount || 0) + ')'));
    c.appendChild(top);

    var pills = el('div', 'pills');
    var op = openPill(o);
    if (op) pills.appendChild(el('span', 'pill ' + op[1], op[0]));
    if (o.outside) pills.appendChild(el('span', 'pill warn', 'A bit past your limit'));
    if (o.raf) pills.appendChild(el('span', 'pill ' + (o.raf.fresh ? 'open' : 'warn'), 'Real Ale Finder: ' + o.raf.label));
    if (o.keyword && state.ctx.cat.keywords) pills.appendChild(el('span', 'pill', 'Matches "' + o.keyword + '"'));
    tags(p).forEach(function (t) { pills.appendChild(el('span', 'pill', t)); });
    if (pills.childNodes.length) c.appendChild(pills);

    if (o.summary) c.appendChild(el('p', 'summary', o.summary));

    var links = el('div', 'links');
    var mode = o.dist <= 2400 ? 'walking' : 'driving';
    var dir = 'https://www.google.com/maps/dir/?api=1&destination=' + p.location.latitude + ',' + p.location.longitude +
      '&destination_place_id=' + encodeURIComponent(p.id) + '&travelmode=' + mode;
    links.appendChild(link('Directions', dir, 'primary'));
    if (p.googleMapsUri) links.appendChild(link('Open in Maps', p.googleMapsUri));
    if (o.raf) links.appendChild(link('Beer board', o.raf.url));
    if (p.websiteUri) links.appendChild(link('Website', p.websiteUri));
    if (state.ctx.cat.group === 'Drink') {
      var q = o.name + ' ' + state.label + ' CAMRA Good Beer Guide';
      links.appendChild(link('CAMRA?', 'https://www.google.com/search?q=' + encodeURIComponent(q)));
    }
    c.appendChild(links);
    return c;
  }

  function render() {
    var r = $('results'); r.textContent = '';
    var cat = state.ctx.cat, list = state.ranked;
    var start = state.page * 3, slice = list.slice(start, start + 3);

    var head = el('div', 'results-head');
    head.appendChild(el('h2', null, slice.length ? cat.label + ' near ' + state.label : 'Nothing fits'));
    if (list.length > start + 3) {
      var more = el('button', 'ghost', 'Show next 3');
      more.type = 'button';
      more.addEventListener('click', function () { state.page++; render(); scrollToResults(); });
      head.appendChild(more);
    }
    r.appendChild(head);

    if (slice.length && state.ctx.rafIndex && L.RAF_WEIGHT[cat.id]) {
      var when = state.ctx.rafIndex.asOf.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      var stale = slice.some(function (o) { return o.raf && o.raf.stale; });
      var matched = list.filter(function (o) { return o.raf; }).length;
      r.appendChild(el('p', stale ? 'notice' : 'fine',
        'Pubs on Real Ale Finder that were updated recently rank higher. List last refreshed ' + when +
        (stale ? ', so the update times may be out of date.' : '.') + ' ' + matched + ' of ' + list.length + ' candidates are on it.'));
    }

    if (!slice.length) {
      var msg = state.found
        ? 'Google returned ' + state.found + ' places, but none were open at that time within ' + $('radius').selectedOptions[0].text.toLowerCase() + '. Widen the distance or set Open to Any time.'
        : 'Google found nothing for that search here. Try a bigger distance or a nearby town.';
      r.appendChild(el('p', 'notice', msg));
      return;
    }

    var mapDiv = el('div'); mapDiv.id = 'map';
    mapDiv.setAttribute('role', 'region'); mapDiv.setAttribute('aria-label', 'Map of results');
    r.appendChild(mapDiv);
    slice.forEach(function (o, i) { r.appendChild(card(o, i)); });

    if (cat.id === 'walks') {
      var box = el('div', 'walks-box');
      box.appendChild(el('h3', null, 'Proper routes'));
      box.appendChild(el('p', 'fine', 'Google lists parks, reserves and viewpoints. For marked routes with length, climb and difficulty, search for "' + state.label + '" in AllTrails.'));
      var ls = el('div', 'links');
      ls.appendChild(link('Open AllTrails', 'https://www.alltrails.com/'));
      box.appendChild(ls);
      r.appendChild(box);
    }
    drawMap(slice);
  }

  /* ---------- map ---------- */
  async function drawMap(slice) {
    var mapDiv = $('map');
    try {
      await loadMaps();
      var libs = await Promise.all([google.maps.importLibrary('maps'), google.maps.importLibrary('marker')]);
      var Map = libs[0].Map, Adv = libs[1].AdvancedMarkerElement, Pin = libs[1].PinElement;
      var c = state.ctx.center;
      var opts = { center: { lat: c.lat, lng: c.lng }, zoom: 15, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy' };
      try { opts.colorScheme = google.maps.ColorScheme.FOLLOW_SYSTEM; } catch (e) {}
      state.map = new Map(mapDiv, opts);
      state.markers = [];

      var dot = el('div', 'you-dot');
      new Adv({ map: state.map, position: { lat: c.lat, lng: c.lng }, content: dot, title: 'You are here', zIndex: 1 });

      var bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: c.lat, lng: c.lng });
      slice.forEach(function (o, i) {
        var pos = { lat: o.place.location.latitude, lng: o.place.location.longitude };
        var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#A84A0B';
        var pin = new Pin({ glyph: String(i + 1), glyphColor: '#FFFFFF', background: accent, borderColor: '#5C2606' });
        var m = new Adv({ map: state.map, position: pos, content: pin.element || pin, title: o.name, zIndex: 2 });
        var go = function () { highlight(i); };
        try { m.addListener('click', go); } catch (e) {}
        try { m.addEventListener('gmp-click', go); } catch (e) {}
        state.markers.push(m);
        bounds.extend(pos);
      });
      state.map.fitBounds(bounds, 48);
    } catch (e) {
      mapDiv.textContent = '';
      var why = e && e.message === 'auth'
        ? 'The map did not load. Check Maps JavaScript API is enabled for your key and the key allows this site address.'
        : 'The map did not load. The results below still work.';
      mapDiv.style.padding = '14px'; mapDiv.style.height = 'auto';
      mapDiv.appendChild(el('p', 'fine', why));
    }
  }

  function highlight(i) {
    var cards = document.querySelectorAll('.card');
    for (var k = 0; k < cards.length; k++) cards[k].classList.toggle('hl', k === i);
    var c = $('card-' + i);
    if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- settings ---------- */
  function openSetup(force) {
    var s = $('setup');
    var show = force === true ? true : s.hidden;
    s.hidden = !show;
    $('settingsBtn').setAttribute('aria-expanded', String(show));
    if (show) $('keyInput').focus();
  }

  async function saveKey() {
    var v = $('keyInput').value.trim();
    var msg = $('keyMsg');
    if (v.length < 20) { msg.textContent = 'That looks too short for a Google key.'; return; }
    state.key = v; state.mapsPromise = null;
    msg.textContent = 'Testing…';
    try {
      var r = await searchText({ textQuery: 'pub in York', regionCode: 'GB', pageSize: 1 }, GEO_FIELDS, { free: true });
      store.set('rtc:key', v);
      msg.textContent = r.length ? 'Key works. Saved on this device.' : 'Saved, but the test search returned nothing.';
      $('keyInput').value = '';
      setTimeout(function () { $('setup').hidden = true; $('settingsBtn').setAttribute('aria-expanded', 'false'); }, 900);
    } catch (e) {
      state.key = store.get('rtc:key') || '';
      msg.textContent = 'Not saved. ' + explain(e);
    }
  }

  /* ---------- wiring ---------- */
  function buildCats(selected) {
    var host = $('cats'), groups = {};
    L.CATEGORIES.forEach(function (c) { (groups[c.group] = groups[c.group] || []).push(c); });
    Object.keys(groups).forEach(function (g) {
      host.appendChild(el('div', 'group-label', g));
      var chips = el('div', 'chips');
      groups[g].forEach(function (c) {
        var lab = el('label', 'chip');
        var inp = document.createElement('input');
        inp.type = 'radio'; inp.name = 'cat'; inp.value = c.id; inp.checked = c.id === selected;
        lab.appendChild(inp); lab.appendChild(el('span', null, c.label));
        chips.appendChild(lab);
      });
      host.appendChild(chips);
    });
  }

  function init() {
    var prefs = {};
    try { prefs = JSON.parse(store.get('rtc:prefs') || '{}') || {}; } catch (e) {}
    buildCats(prefs.cat || 'micropub');
    if (prefs.radius) $('radius').value = prefs.radius;
    if (prefs.time) $('time').value = prefs.time;
    var savedWhere = store.get('rtc:where');
    if (savedWhere) $('where').value = savedWhere;

    $('day').addEventListener('change', function () { $('timeWrap').hidden = ['now', 'any'].indexOf($('day').value) > -1; });
    $('where').addEventListener('input', function () { if ($('where').value !== GPS_LABEL) { state.gps = null; $('whereNote').textContent = ''; } });
    $('where').addEventListener('focus', function () { if ($('where').value === GPS_LABEL) $('where').select(); });
    $('gps').addEventListener('click', function () { showErr(''); useGps(); });
    $('f').addEventListener('submit', function (ev) { ev.preventDefault(); run(); });
    $('settingsBtn').addEventListener('click', function () { openSetup(); });
    $('capInput').value = getCap();
    $('capInput').addEventListener('change', function () {
      var c = L.clampCap($('capInput').value);
      store.set('rtc:cap', String(c)); $('capInput').value = c; showUsage();
    });
    showUsage();
    $('saveKey').addEventListener('click', saveKey);
    $('clearKey').addEventListener('click', function () {
      store.del('rtc:key'); state.key = ''; state.mapsPromise = null;
      $('keyMsg').textContent = 'Key removed from this device.';
    });
    $('showKey').addEventListener('click', function () {
      var i = $('keyInput'), show = i.type === 'password';
      i.type = show ? 'text' : 'password'; $('showKey').textContent = show ? 'Hide' : 'Show';
    });

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); state.installEvt = e; $('install').hidden = false;
    });
    $('install').addEventListener('click', function () {
      if (state.installEvt) { state.installEvt.prompt(); state.installEvt = null; $('install').hidden = true; }
    });

    // Optional: the daily Real Ale Finder list. A missing or broken file is simply ignored.
    try {
      fetch('raf.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { state.raf = j; })
        .catch(function () {});
    } catch (e) {}

    if (!state.key) openSetup(true);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  init();
})();
