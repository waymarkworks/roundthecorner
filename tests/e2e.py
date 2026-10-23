import json, subprocess, time, sys, os, shutil, tempfile
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)   # the repository root
OUT = os.path.join(tempfile.gettempdir(), 'rtc-shots')   # screenshots land here
os.makedirs(OUT, exist_ok=True)
PORT = 8765
BASE = f'http://localhost:{PORT}/index.html'
KEY = 'AIzaSyTESTKEY_0123456789abcdefghijklmnop'

C = (54.4858, -0.6206)  # Whitby
def at(dlat, dlng=0.0): return {'latitude': C[0] + dlat, 'longitude': C[1] + dlng}
def periods(o=11, c=22): return [{'open': {'day': d, 'hour': o, 'minute': 0}, 'close': {'day': d, 'hour': c, 'minute': 0}} for d in range(7)]

def place(pid, name, kind, ptype, types, loc, rating, n, open_now=True, hours=True, summary=None, **extra):
    p = {
        'id': pid, 'displayName': {'text': name, 'languageCode': 'en'},
        'formattedAddress': '1 Church St, Whitby', 'location': loc,
        'rating': rating, 'userRatingCount': n,
        'googleMapsUri': f'https://maps.google.com/?cid={pid}',
        'primaryType': ptype, 'primaryTypeDisplayName': {'text': kind}, 'types': types,
        'businessStatus': 'OPERATIONAL',
    }
    if hours:
        p['regularOpeningHours'] = {'periods': periods(**extra.pop('hrs', {}))}
        p['currentOpeningHours'] = {'openNow': open_now}
    if summary: p['editorialSummary'] = {'text': summary}
    p.update(extra)
    return p

PUBS = [
    place('p_cask', 'The Cask Corner', 'Micropub', 'pub', ['pub', 'bar'], at(0.0018), 4.8, 210,
          summary='Tiny corner micropub with six rotating cask ales.', allowsDogs=True, outdoorSeating=False, websiteUri='https://example.com/cask',
          parkingOptions={'freeParkingLot': True, 'paidStreetParking': False},
          priceRange={'startPrice': {'currencyCode': 'GBP', 'units': '8'}, 'endPrice': {'currencyCode': 'GBP', 'units': '15'}},
          formattedAddress='Church St, Whitby YO22 4DE, UK'),
    place('p_tap', 'Harbour Tap', 'Taproom', 'bar', ['bar', 'pub'], at(-0.004, 0.002), 4.6, 340,
          summary='Brewery taproom on the quay with a craft beer list.', outdoorSeating=True, allowsDogs=True,
          formattedAddress='Quay St, Whitby YO21 3PU, UK'),
    place('p_spoons', 'The Moon Under Water (Wetherspoon)', 'Pub', 'pub', ['pub', 'bar'], at(0.001, 0.001), 4.3, 1500),
    place('p_shut', 'Shut Hatch Micropub', 'Micropub', 'pub', ['pub'], at(0.002, -0.002), 4.7, 90, open_now=False),
    place('p_hotel', 'Grand Hotel', 'Hotel', 'lodging', ['lodging'], at(0.001, -0.001), 4.9, 900),
    place('p_far', 'Hops & Hearth', 'Micropub', 'pub', ['pub'], at(0.0185, 0.0), 4.5, 60, summary='Micropub in an old forge.'),
    place('p_nohrs', 'No Hours Alehouse', 'Pub', 'pub', ['pub'], at(-0.003, -0.003), 4.4, 80, hours=False),
    place('p_crown', 'The Crown', 'Pub', 'pub', ['pub', 'bar'], at(0.0035, 0.001), 4.5, 400, goodForChildren=True, outdoorSeating=True,
          menuForChildren=True, priceRange={'startPrice': {'currencyCode': 'GBP', 'units': '10'}, 'endPrice': {'currencyCode': 'GBP', 'units': '20'}}),
    place('p_early', 'Early Doors Real Ale House', 'Real ale pub', 'pub', ['pub'], at(0.0025, 0.0015), 4.6, 150, hrs={'o': 11, 'c': 20}),
]
PUBS2 = [PUBS[0], place('p_tap2', 'Seaview Brewery Tap', 'Brewery taproom', 'bar', ['bar'], at(0.0045, -0.0015), 4.4, 120, summary='Craft beer from the brewery next door.')]
ICE = [place('i1', 'Sandcastle Gelato', 'Ice cream shop', 'ice_cream_shop', ['ice_cream_shop', 'food'], at(0.0012), 4.7, 800, hrs=True, hrs_=None) if False else
       place('i1', 'Sandcastle Gelato', 'Ice cream shop', 'ice_cream_shop', ['ice_cream_shop', 'food'], at(0.0012), 4.7, 800, goodForChildren=True, priceLevel='PRICE_LEVEL_INEXPENSIVE'),
       place('i2', 'Dairy Dream', 'Ice cream shop', 'ice_cream_shop', ['ice_cream_shop'], at(-0.002), 4.5, 200),
       place('i3', 'Pier Treats', 'Dessert shop', 'dessert_shop', ['dessert_shop'], at(0.003, 0.002), 4.1, 300)]
WALKS = [place('w1', 'Pannett Park', 'Park', 'park', ['park'], at(0.002), 4.6, 900, hours=False),
         place('w2', 'Whitby Abbey headland viewpoint', 'Scenic spot', 'tourist_attraction', ['park', 'tourist_attraction'], at(0.004, 0.012), 4.8, 4000, hours=False),
         place('w3', 'Mulgrave Woods', 'Woodland', 'park', ['park'], at(0.02, -0.05), 4.7, 600, hours=False)]

WINE = [place('wn1', 'Vagabond Wines', 'Wine bar', 'wine_bar', ['wine_bar', 'bar'], at(0.0015), 4.9, 40),
        place('wn2', 'The Cellar Door', 'Wine bar', 'wine_bar', ['wine_bar', 'bar'], at(0.002, 0.001), 4.5, 300),
        place('wn3', 'Corks & Co', 'Wine bar', 'wine_bar', ['wine_bar'], at(0.003, -0.002), 4.4, 120)]
COCKTAILS = [place('ck1', 'The Gilded Shaker', 'Cocktail bar', 'cocktail_bar', ['cocktail_bar', 'bar'], at(0.001), 4.6, 500),
             place('ck2', 'Speakeasy 42', 'Cocktail bar', 'cocktail_bar', ['cocktail_bar', 'bar'], at(-0.0015, 0.002), 4.5, 220),
             place('ck3', 'Rum & Ginger', 'Bar', 'bar', ['bar'], at(0.0025, -0.001), 4.3, 150)]

GEO = [{'location': {'latitude': C[0], 'longitude': C[1]}, 'displayName': {'text': 'Whitby'}, 'formattedAddress': 'Whitby, UK'}]

calls = []
mode = {'fail': None}
raf_mode = {'on': False, 'asof': '2026-10-24T04:17:00Z'}
RAF = lambda asof: {'source': 'https://www.realalefinder.com/pubs/', 'asOf': asof, 'pubs': [
    {'title': 'Harbour Tap Whitby', 'postcode': 'YO21 3PU', 'url': 'https://www.realalefinder.com/beerboard/?harbour-tap-whitby', 'updated': 'today'},
    {'title': 'The Cask Corner Whitby', 'postcode': 'YO22 4DE', 'url': 'https://www.realalefinder.com/beerboard/?cask-corner-whitby', 'updated': 'older'},
]}
def raf_handler(route):
    if not raf_mode['on']:
        return route.fulfill(status=404, body='')
    route.fulfill(status=200, content_type='application/json', body=json.dumps(RAF(raf_mode['asof'])))

def places_handler(route):
    req = route.request
    cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS'}
    if req.method == 'OPTIONS':
        return route.fulfill(status=204, headers=cors)
    body = json.loads(req.post_data or '{}')
    calls.append({'body': body, 'key': req.headers.get('x-goog-api-key'), 'mask': req.headers.get('x-goog-fieldmask')})
    if mode['fail']:
        return route.fulfill(status=mode['fail'], headers=cors, content_type='application/json',
                             body=json.dumps({'error': {'code': mode['fail'], 'message': 'Places API (New) has not been used in project 123 before or it is disabled.', 'status': 'PERMISSION_DENIED'}}))
    q = body.get('textQuery', '')
    if body.get('pageSize') == 1: res = GEO
    elif q == 'pub': res = PUBS
    elif q == 'micropub real ale craft beer taproom': res = PUBS2
    elif q in ('wine bar', 'bar serving wine by the glass'): res = WINE
    elif q in ('cocktail bar', 'craft cocktails'): res = COCKTAILS
    elif q in ('ice cream', 'gelato'): res = ICE
    elif q in ('country park or nature reserve', 'scenic walk viewpoint'): res = WALKS
    else: res = PUBS
    route.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps({'places': res}))

MAPS_JS = r"""
(function(){
  window.__mockMarkers = [];
  class Map { constructor(el,o){ el.textContent=''; el.style.position='relative';
      el.style.background='repeating-linear-gradient(45deg,#cfe0c8,#cfe0c8 10px,#d9e8d2 10px,#d9e8d2 20px)';
      var l=document.createElement('div'); l.textContent='MOCK MAP (test stub, not Google)'; l.style.cssText='position:absolute;left:8px;top:8px;font:12px sans-serif;color:#333';
      el.appendChild(l); this.el=el; window.__mockMap={opts:o}; }
    fitBounds(b,p){ window.__mockMap.fit=p; } }
  class Adv { constructor(o){ this.o=o; this.l={}; window.__mockMarkers.push(this);
      var i=window.__mockMarkers.length-1, host=o.map.el, c=o.content; c.style.position='absolute'; c.style.left=(30+i*70)+'px'; c.style.top='120px'; host.appendChild(c); }
    addListener(ev,fn){ this.l[ev]=fn; } addEventListener(ev,fn){ this.l[ev]=fn; } }
  class Pin { constructor(o){ var e=document.createElement('div'); e.textContent=o.glyph;
      e.style.cssText='width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font:700 13px sans-serif;background:'+o.background+';color:'+o.glyphColor; this.element=e; } }
  class LatLngBounds { extend(){} }
  window.google = { maps: { importLibrary: async function(n){ return n==='maps' ? {Map:Map} : {AdvancedMarkerElement:Adv, PinElement:Pin}; },
                            LatLngBounds: LatLngBounds, ColorScheme: {FOLLOW_SYSTEM:'FOLLOW_SYSTEM'} } };
  if (window.__rtcMapsReady) window.__rtcMapsReady();
})();
"""

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: check.fails += 1
check.fails = 0

def no_hscroll(page, label):
    w = page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
    check(w[0] <= w[1], f'no horizontal scroll {label} ({w[0]} <= {w[1]})')

def new_ctx(pw, scheme='light', width=390):
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': width, 'height': 844}, device_scale_factor=2, locale='en-GB',
                        timezone_id='Europe/London', geolocation={'latitude': C[0], 'longitude': C[1]},
                        permissions=['geolocation'], color_scheme=scheme)
    ctx.route('**/places.googleapis.com/**', places_handler)
    ctx.route('**/maps.googleapis.com/maps/api/js**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MAPS_JS))
    ctx.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    ctx.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    page = ctx.new_page()
    page.clock.set_fixed_time(datetime(2026, 10, 24, 18, 30, 0, tzinfo=timezone.utc))  # Saturday 19:30 BST
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)
    return b, ctx, page, errors

SITE = os.path.join(tempfile.gettempdir(), 'rtc-site')
shutil.rmtree(SITE, ignore_errors=True); shutil.copytree(APP, SITE, ignore=shutil.ignore_patterns('.git', '.github', 'scripts', 'tests', 'README.md'))
def set_raf():
    path = os.path.join(SITE, 'raf.json')
    if raf_mode['on']:
        open(path, 'w').write(json.dumps(RAF(raf_mode['asof'])))
    elif os.path.exists(path):
        os.remove(path)
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--directory', SITE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
set_raf()
time.sleep(1)
try:
    with sync_playwright() as pw:
        b, ctx, page, errors = new_ctx(pw)
        page.goto(BASE)

        # A. first run, no key
        check(page.is_visible('#setup'), 'setup panel shows when no key is saved')
        page.screenshot(path=f'{OUT}/01-setup.png', full_page=True)
        page.click('#go')
        check('Add your Google key' in page.inner_text('#formErr'), 'Find without a key asks for the key')
        check(len(calls) == 0, 'no Google call made without a key')

        # B. bad key path (403) then good key
        mode['fail'] = 403
        page.fill('#keyInput', KEY); page.click('#saveKey')
        page.wait_for_function("document.getElementById('keyMsg').textContent.startsWith('Not saved')")
        check('Not saved' in page.inner_text('#keyMsg') and 'Places API (New)' in page.inner_text('#keyMsg'), '403 explains what to enable and does not save')
        check(page.evaluate("localStorage.getItem('rtc:key')") is None, 'rejected key is not stored')
        mode['fail'] = None
        page.click('#saveKey')
        page.wait_for_function("document.getElementById('keyMsg').textContent.startsWith('Key works')")
        check(page.evaluate("localStorage.getItem('rtc:key')") == KEY, 'working key stored on device')
        page.wait_for_selector('#setup', state='hidden')
        check(True, 'setup panel closes after a good key')

        # C. GPS
        page.click('#gps')
        page.wait_for_function("document.getElementById('where').value === 'My location'")
        check('Using your location' in page.inner_text('#whereNote'), 'GPS fills in location')

        # D. micropubs, now
        calls.clear()
        page.click('#go')
        page.wait_for_selector('.card')
        names = page.eval_on_selector_all('.card h3', 'els => els.map(e => e.textContent)')
        print('   micropub picks:', names)
        check(len(names) == 3, 'three cards shown')
        check(names[0] == 'The Cask Corner', 'best micropub first')
        check('The Moon Under Water (Wetherspoon)' not in names, 'chain pub not in top 3 for micropubs')
        check('Shut Hatch Micropub' not in names and 'Grand Hotel' not in names, 'closed place and hotel excluded')
        check(len(calls) == 2, f'two category searches made, no geocode with GPS (got {len(calls)})')
        c0 = calls[0]['body']
        check(c0.get('openNow') is True and c0.get('regionCode') == 'GB', 'Now mode sends openNow and region GB')
        check(abs(c0['locationBias']['circle']['center']['latitude'] - C[0]) < 1e-6, 'search biased to the GPS point')
        check(abs(c0['locationBias']['circle']['radius'] - (10 * 80 / 1.3) * 1.6) < 1, 'default is a 10 minute walk, search radius is 1.6x that')
        check(calls[0]['key'] == KEY and 'places.rating' in calls[0]['mask'] and 'places.currentOpeningHours' in calls[0]['mask'], 'key and field mask sent')
        check(all('places.' + f in calls[0]['mask'] for f in ('menuForChildren', 'priceRange', 'parkingOptions')), 'new fields are in the field mask')
        first = page.inner_text('#card-0')
        check('★ 4.8 (210)' in first, 'rating and count shown')
        check('Open until 22:00' in first, 'open-until time shown')
        check('Matches "micropub"' in first, 'keyword match tag shown')
        check('Dogs' not in first, 'no dog tag')
        check('Tiny corner micropub' in first, 'editorial summary shown')
        hrefs = page.eval_on_selector_all('#card-0 a', 'els => els.map(e => [e.textContent, e.href])')
        d = dict(hrefs)
        check(d['Directions'].startswith('https://www.google.com/maps/dir/?api=1&destination=') and 'destination_place_id=p_cask' in d['Directions'] and d['Directions'].endswith('travelmode=walking'), 'directions link format')
        check(d['Open in Maps'] == 'https://maps.google.com/?cid=p_cask', 'uses Google-supplied maps link')
        check('CAMRA?' in d and d['CAMRA?'].startswith('https://www.google.com/search?q=') and 'CAMRA' in d['CAMRA?'], 'CAMRA search link on a drink result')
        check(page.eval_on_selector('#card-0 .links a', "e => e.target + '/' + e.rel") == '_blank/noopener', 'links open in a new tab safely')
        check(page.is_visible('#map') and 'MOCK MAP' in page.inner_text('#map'), 'map container drawn')
        check(page.evaluate('window.__mockMarkers.length') == 4, 'you-dot plus three numbered markers')
        page.evaluate("window.__mockMarkers[2].l.click()")
        check(page.evaluate("document.getElementById('card-1').classList.contains('hl')"), 'tapping a marker highlights its card')
        check(page.evaluate("new Date().getHours()") == 19, 'page clock reads 19:00-19:59 local')
        check('Early Doors Real Ale House' not in names, 'closing-in-30-minutes pub is demoted out of the top 3')
        no_hscroll(page, 'micropub results')
        page.screenshot(path=f'{OUT}/02-results-light.png', full_page=True)

        # E. next 3
        page.click('text=Show next 3')
        page.wait_for_function("document.querySelector('.card h3') && document.querySelector('.card h3').textContent !== 'The Cask Corner'")
        names2 = page.eval_on_selector_all('.card h3', 'els => els.map(e => e.textContent)')
        print('   page 2:', names2)
        check(not set(names) & set(names2), 'page two has different places')
        check('No Hours Alehouse' in names2 or 'Hops & Hearth' in names2 or len(names2) > 0, 'page two renders')
        far = [n for n in names + names2 if n == 'Hops & Hearth']
        if far:
            txt = page.inner_text('.results-head ~ .card:has(h3:text("Hops & Hearth"))') if page.query_selector('.card:has(h3:text("Hops & Hearth"))') else ''
            check('A bit past your limit' in txt, 'past-the-limit place is flagged')
        unk = page.query_selector('.card:has(h3:text("No Hours Alehouse"))')
        if unk: check('Hours not listed' in unk.inner_text(), 'no-hours place says so')
        early = page.query_selector('.card:has(h3:text("Early Doors Real Ale House"))')
        check(early is not None, 'early-closing pub appears on page two')
        if early:
            check('Open until 20:00' in early.inner_text(), 'early-closing place shows its close time')
            check(early.query_selector('.pill.warn') is not None, 'closing soon shown as a warning pill')

        # F. typed place -> geocode first
        page.fill('#where', 'Whitby')
        check(page.inner_text('#whereNote') == '', 'typing clears the GPS note')
        calls.clear()
        page.click('#go')
        page.wait_for_selector('.card')
        check(calls[0]['body'].get('pageSize') == 1 and calls[0]['body']['textQuery'] == 'Whitby', 'typed place geocoded first')
        check(len(calls) == 3, f'geocode plus two searches (got {len(calls)})')
        check(page.evaluate("localStorage.getItem('rtc:where')") == 'Whitby', 'typed place remembered')
        check('near Whitby' in page.inner_text('.results-head h2'), 'heading names the place')

        # G. ice cream, walks
        page.check('input[value="icecream"]', force=True)
        calls.clear(); page.click('#go'); page.wait_for_selector('.card')
        ic = page.eval_on_selector_all('.card h3', 'els => els.map(e => e.textContent)')
        print('   ice cream:', ic)
        check(ic[0] == 'Sandcastle Gelato', 'ice cream ranked')
        check(page.query_selector('#card-0 a:text("CAMRA?")') is None, 'no CAMRA link on ice cream')
        check('£' in page.inner_text('#card-0'), 'price level shown')
        page.check('input[value="walks"]', force=True)
        calls.clear(); page.click('#go'); page.wait_for_selector('.card')
        check('openNow' not in calls[-1]['body'], 'walks do not filter by opening hours')
        check(page.is_visible('.walks-box') and page.query_selector('.walks-box a').get_attribute('href') == 'https://www.alltrails.com/', 'AllTrails box on walks')
        check('Shut' not in page.inner_text('#results') and 'Open until' not in page.inner_text('#results'), 'no hours pills on walks')

        # H. future time
        page.check('input[value="pub"]', force=True)
        page.select_option('#day', 'sun')
        check(page.is_visible('#timeWrap'), 'time field appears for a day choice')
        page.fill('#time', '12:00')
        calls.clear(); page.click('#go'); page.wait_for_selector('.card')
        check('openNow' not in calls[-1]['body'], 'future time does not send openNow')
        check(len(page.query_selector_all('.card')) == 3, 'real ale Sunday lunchtime returns three')
        page.select_option('#day', 'any')
        check(not page.is_visible('#timeWrap'), 'time field hides for any time')


        # H2. Real Ale Finder signal
        raf_mode['on'] = True; set_raf()
        page.reload()
        page.check('input[value="pub"]', force=True)
        page.select_option('#day', 'now')
        page.fill('#where', 'Whitby')
        calls.clear(); page.click('#go'); page.wait_for_selector('.card')
        rn = page.eval_on_selector_all('.card h3', 'els => els.map(e => e.textContent)')
        print('   with Real Ale Finder:', rn)
        check(rn[0] == 'Harbour Tap', 'freshly updated Real Ale Finder pub now ranks first')
        check(rn[1] == 'The Cask Corner', 'listed-but-old pub stays second on its own merits')
        c0 = page.inner_text('#card-0')
        check('Real Ale Finder: Updated today' in c0, 'fresh status pill shown')
        check(page.query_selector('#card-0 .pill.open:has-text("Real Ale Finder")') is not None, 'fresh pill is green')
        bb = page.eval_on_selector('#card-0 a:has-text("Beer board")', "e => e.href + '|' + e.target + '|' + e.rel")
        check(bb == 'https://www.realalefinder.com/beerboard/?harbour-tap-whitby|_blank|noopener', 'beer board link verified pattern, new tab')
        check('Real Ale Finder: Not updated recently' in page.inner_text('#card-1') and page.query_selector('#card-1 .pill.warn:has-text("Real Ale Finder")') is not None, 'old status shown as a warning')
        note = page.inner_text('#results .fine')
        check('List last refreshed 24 Oct' in note and '2 of' in note, 'list freshness note: ' + note[:90])
        page.screenshot(path=f'{OUT}/05-results-raf.png', full_page=True)
        page.check('input[value="icecream"]', force=True)
        page.click('#go'); page.wait_for_selector('.card')
        check('Real Ale Finder' not in page.inner_text('#results'), 'no Real Ale Finder pills or note on ice cream')
        # stale snapshot (a week old)
        raf_mode['asof'] = '2026-10-17T04:17:00Z'; set_raf()
        page.reload()
        page.check('input[value="pub"]', force=True)
        page.fill('#where', 'Whitby'); page.click('#go'); page.wait_for_selector('.card')
        check(page.query_selector('#results .notice') is not None and 'out of date' in page.inner_text('#results .notice'), 'stale list is flagged to the user')
        harbour = page.query_selector('.card:has(h3:text-is("Harbour Tap"))')
        check(harbour is not None and 'Real Ale Finder: Updated 7 days ago' in harbour.inner_text(), 'stale pill shows an age, not "today"')
        check(page.eval_on_selector_all('.card h3', 'els => els[0].textContent') == 'The Cask Corner', 'a week-old list no longer lifts Harbour Tap above the Cask Corner')
        # file missing again: app must carry on
        raf_mode['on'] = False; set_raf()
        page.reload()
        page.check('input[value="pub"]', force=True)
        page.fill('#where', 'Whitby'); page.click('#go'); page.wait_for_selector('.card')
        check('Real Ale Finder' not in page.inner_text('#results'), 'missing raf.json is harmless')

        # K. drink choices are Pub, Wine, Cocktails and nothing else
        groups = page.evaluate("[...document.querySelectorAll('#cats .group-label')].map(g => [g.textContent, [...g.nextElementSibling.querySelectorAll('span')].map(s => s.textContent)])")
        check(groups[0] == ['Drink', ['Pub', 'Wine', 'Cocktails']], f'Drink choices are Pub, Wine, Cocktails (got {groups[0]})')
        check(groups[1][0] == 'Eat' and groups[2][0] == 'Out', 'Eat and Out groups unchanged')
        old = page.evaluate("['micropub','realale','craft'].filter(v => document.querySelector('input[name=cat][value=' + v + ']')).length")
        check(old == 0, 'no separate micropub, real ale or craft beer buttons')
        check(page.evaluate("document.querySelector('input[name=cat]:checked').value") == 'pub', 'Pub is the default drink choice')

        # L. phones that saved an old beer category open on Pub
        for old_id in ('micropub', 'realale', 'craft'):
            page.evaluate("id => localStorage.setItem('rtc:prefs', JSON.stringify({who:'family', cat:id, mode:'walk', mins:10, day:'now', time:'18:00'}))", old_id)
            page.reload()
            check(page.evaluate("document.querySelector('input[name=cat]:checked').value") == 'pub', f'saved {old_id} choice opens as Pub')

        # M. wine and cocktails
        page.fill('#where', 'Whitby')
        page.check('input[value="wine"]', force=True)
        calls.clear(); page.click('#go'); page.wait_for_selector('.card')
        wn = page.eval_on_selector_all('.card h3', 'els => els.map(e => e.textContent)')
        print('   wine:', wn)
        qs = sorted(c['body']['textQuery'] for c in calls if c['body'].get('pageSize') != 1)
        check(qs == ['bar serving wine by the glass', 'wine bar'], f'wine sends its two wine searches (got {qs})')
        check(len(calls) == 3, f'geocode plus two searches for wine (got {len(calls)})')
        check(wn[0] == 'Vagabond Wines' and len(wn) == 3, 'high-rated nearby wine bar ranks first, three shown')
        check(page.query_selector('a:text("CAMRA?")') is None, 'no CAMRA link on wine')
        check('Real Ale Finder' not in page.inner_text('#results'), 'no Real Ale Finder note on wine')
        check('Wine near Whitby' in page.inner_text('.results-head h2'), 'heading says Wine')
        page.check('input[value="cocktails"]', force=True)
        calls.clear(); page.click('#go'); page.wait_for_selector('.card')
        cn = page.eval_on_selector_all('.card h3', 'els => els.map(e => e.textContent)')
        print('   cocktails:', cn)
        qs = sorted(c['body']['textQuery'] for c in calls if c['body'].get('pageSize') != 1)
        check(qs == ['cocktail bar', 'craft cocktails'], f'cocktails sends its two cocktail searches (got {qs})')
        check(cn[0] == 'The Gilded Shaker' and len(cn) == 3, 'cocktail bar ranks first, three shown')
        check(page.query_selector('a:text("CAMRA?")') is None, 'no CAMRA link on cocktails')
        page.check('input[value="pub"]', force=True)
        calls.clear(); page.click('#go'); page.wait_for_selector('.card')
        check(page.query_selector('#card-0 a:text("CAMRA?")') is not None, 'CAMRA search link still on Pub results')
        qs = sorted(c['body']['textQuery'] for c in calls if c['body'].get('pageSize') != 1)
        check(qs == ['micropub real ale craft beer taproom', 'pub'], f'Pub sends one plain search and one for micropubs, real ale and craft beer (got {qs})')

        # N. "why here" line, off by default, switched on in Settings
        check(page.query_selector('.why') is None, 'no why-here line by default')
        page.click('#settingsBtn'); page.wait_for_selector('#setup', state='visible')
        check(not page.is_checked('#whyToggle'), 'why-here switch is off by default')
        page.check('#whyToggle')
        check(len(page.query_selector_all('.card .why')) == 3, 'switching it on adds a line to all three cards at once')
        w0 = page.inner_text('#card-0 .why')
        print('   why here:', w0)
        check(w0.startswith('Why here (score ') and 'rating 0.' in w0 and 'nearness 0.' in w0 and 'place type 0.20' in w0 and 'keyword 0.' in w0, 'why-here line shows the score and its parts')
        check(page.evaluate("localStorage.getItem('rtc:why')") == '1', 'switch is remembered on the phone')
        no_hscroll(page, 'results with why-here lines')
        page.screenshot(path=f'{OUT}/06-why-here.png', full_page=True)
        page.reload()
        check(page.evaluate("document.getElementById('whyToggle').checked"), 'switch still on after reload')
        page.click('#go'); page.wait_for_selector('.card')
        check(len(page.query_selector_all('.card .why')) == 3, 'new results show the line when the switch is on')
        page.click('#settingsBtn'); page.wait_for_selector('#setup', state='visible')
        page.uncheck('#whyToggle')
        check(page.query_selector('.why') is None and page.evaluate("localStorage.getItem('rtc:why')") == '0', 'switching it off removes the lines')
        page.click('#settingsBtn')

        page.select_option('#day', 'any')
        page.check('input[value="cocktails"]', force=True)

        # I. server error surfaced
        mode['fail'] = 403; page.click('#go')
        page.wait_for_selector('#formErr:not([hidden])')
        check('refused' in page.inner_text('#formErr'), 'search error shown with advice')
        mode['fail'] = None

        # J. prefs persisted across reload; SW; manifest
        page.reload()
        check(page.evaluate("document.querySelector('input[name=cat]:checked').value") == 'cocktails', 'last category remembered')
        check(page.evaluate("document.getElementById('where').value") == 'Whitby', 'last place remembered')
        check(not page.is_visible('#setup'), 'no setup panel once a key is saved')
        page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller || true")
        reg = page.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)")
        check(reg, 'service worker active')
        page.reload(); time.sleep(0.5)
        keys = page.evaluate("caches.keys().then(async ks => { const out=[]; for (const k of ks){ const c=await caches.open(k); out.push(...(await c.keys()).map(r=>r.url)); } return out })")
        check(all(u.startswith(f'http://localhost:{PORT}/') for u in keys) and len(keys) >= 5, f'cache holds only app files ({len(keys)} entries)')
        man = page.evaluate("fetch('manifest.webmanifest').then(r=>r.json())")
        check(man['display'] == 'standalone' and any(i['sizes'] == '512x512' for i in man['icons']), 'manifest standalone with 512 icon')
        for i in man['icons']:
            ok = page.evaluate(f"fetch('{i['src']}').then(r=>r.ok)")
            check(ok, f"icon {i['src']} loads")
        # offline shell
        ctx.set_offline(True)
        page.reload()
        check('Round the Corner' in page.inner_text('h1'), 'app shell opens offline')
        ctx.set_offline(False)
        real_errors = [e for e in errors if 'ERR_FAILED' not in e and 'fonts' not in e.lower() and 'Failed to load resource' not in e]
        check(not real_errors, 'no page errors: ' + '; '.join(real_errors[:3]))
        b.close()

        # K. dark mode + narrow phone
        b, ctx, page, errors = new_ctx(pw, 'dark', 360)
        page.goto(BASE)
        page.evaluate(f"localStorage.setItem('rtc:key','{KEY}')"); page.reload()
        page.fill('#where', 'Whitby'); page.click('#go'); page.wait_for_selector('.card')
        no_hscroll(page, 'dark 360px')
        page.screenshot(path=f'{OUT}/03-results-dark-360.png', full_page=True)
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=f'{OUT}/04-top-dark-360.png')
        b.close()

        # L. daily search limit
        b, ctx, page, errors = new_ctx(pw)
        page.goto(BASE)
        page.evaluate(f"localStorage.setItem('rtc:key','{KEY}')"); page.reload()
        check('of 80' in page.inner_text('#usageNote'), 'default daily limit is 80: ' + page.inner_text('#usageNote'))
        page.click('#settingsBtn')
        check(page.input_value('#capInput') == '80', 'limit field shows 80')
        page.fill('#capInput', '3'); page.dispatch_event('#capInput', 'change')
        check(page.input_value('#capInput') == '10', 'limit below 10 is raised to 10')
        page.fill('#capInput', '5000'); page.dispatch_event('#capInput', 'change')
        check(page.input_value('#capInput') == '1000', 'limit above 1000 is lowered to 1000')
        page.fill('#capInput', '10'); page.dispatch_event('#capInput', 'change')
        check(page.evaluate("localStorage.getItem('rtc:cap')") == '10', 'limit stored')
        page.click('#settingsBtn')
        n0 = len(calls)
        for i in range(3):
            page.fill('#where', 'Whitby'); page.click('#go'); page.wait_for_selector('.card')
        check(len(calls) - n0 == 9, f'three typed-place Finds made 9 requests ({len(calls) - n0})')
        check('9 of 10' in page.inner_text('#usageNote'), 'counter shows 9 of 10: ' + page.inner_text('#usageNote'))
        page.fill('#where', 'Whitby'); page.click('#go')
        page.wait_for_selector('#formErr:not([hidden])')
        check('Daily search limit reached' in page.inner_text('#formErr'), 'fourth Find is refused with a clear message')
        check(len(calls) - n0 == 9, 'refused Find sent nothing to Google')
        check(page.evaluate("document.querySelectorAll('.card').length") == 3, 'earlier results stay on screen when a Find is refused')
        no_hscroll(page, 'limit message')
        page.screenshot(path=f'{OUT}/05-limit-reached.png')
        # raising the limit lets searches through again
        page.click('#settingsBtn')
        page.fill('#capInput', '20'); page.dispatch_event('#capInput', 'change')
        check('9 of 20' in page.inner_text('#capNote'), 'settings note updates: ' + page.inner_text('#capNote'))
        page.click('#settingsBtn')
        page.click('#go'); page.wait_for_selector('.card')
        check(len(calls) - n0 == 12, 'after raising the limit a Find goes through')
        # saving a key still works when the allowance is used up (the test search is exempt)
        page.evaluate("localStorage.setItem('rtc:usage', JSON.stringify({d:'2026-10-24', n:20}))"); page.reload()
        page.click('#settingsBtn')
        page.fill('#keyInput', KEY); page.click('#saveKey')
        page.wait_for_function("document.getElementById('keyMsg').textContent.indexOf('Key works') > -1")
        check(True, 'Save and test still works at the limit')
        # a new day starts from zero
        page.evaluate("localStorage.setItem('rtc:usage', JSON.stringify({d:'2026-10-23', n:20}))"); page.reload()
        check('0 of 20' in page.inner_text('#usageNote'), 'yesterday\'s count is ignored: ' + page.inner_text('#usageNote'))
        # garbage in storage does not break the app
        page.evaluate("localStorage.setItem('rtc:usage','not json'); localStorage.setItem('rtc:cap','abc')"); page.reload()
        check('0 of 80' in page.inner_text('#usageNote'), 'unreadable storage falls back to defaults: ' + page.inner_text('#usageNote'))
        real_errors = [e for e in errors if 'ERR_FAILED' not in e and 'fonts' not in e.lower() and 'Failed to load resource' not in e]
        check(not real_errors, 'no page errors in limit tests: ' + '; '.join(real_errors[:3]))
        b.close()

        # M. who is with you
        b, ctx, page, errors = new_ctx(pw)
        page.goto(BASE)
        page.evaluate(f"localStorage.setItem('rtc:key','{KEY}')"); page.reload()
        check(page.is_checked('input[name=who][value=family]'), 'family is the default')
        def all_pills():
            page.wait_for_selector('.card')
            out = page.inner_text('#results')
            page.click('text=Show next 3')
            page.wait_for_function("document.querySelector('.card h3') && document.querySelector('.card h3').textContent !== 'The Cask Corner'")
            return out + page.inner_text('#results')
        page.fill('#where', 'Whitby'); page.click('#go')
        fam = all_pills()
        check('Kids OK' in fam, 'family mode shows the Kids OK tag')
        check('Kids menu' in fam, 'family mode shows the Kids menu tag')
        check('£10–20' in fam and '£8–15' in fam, 'price ranges are shown on cards')
        check('Free parking' not in fam, 'no parking tag when on foot')
        check('Dogs' not in fam, 'no dog tag anywhere')
        page.check('input[name=who][value=couple]')
        page.click('#go')
        page.wait_for_function("document.querySelector('.card h3') && document.querySelector('.card h3').textContent === 'The Cask Corner'")
        cou = all_pills()
        check('Kids OK' not in cou, 'couple mode hides the Kids OK tag')
        check('Kids menu' not in cou, 'couple mode hides the Kids menu tag')
        page.reload()
        check(page.is_checked('input[name=who][value=couple]'), 'choice is remembered')
        no_hscroll(page, 'who toggle')
        page.screenshot(path=f'{OUT}/06-who.png')
        real_errors = [e for e in errors if 'ERR_FAILED' not in e and 'fonts' not in e.lower() and 'Failed to load resource' not in e]
        check(not real_errors, 'no page errors in who tests: ' + '; '.join(real_errors[:3]))
        b.close()

        # N. how are you getting there
        b, ctx, page, errors = new_ctx(pw)
        page.goto(BASE)
        page.evaluate(f"localStorage.setItem('rtc:key','{KEY}')"); page.reload()
        check(page.is_checked('input[name=mode][value=walk]'), 'on foot is the default')
        opts = page.eval_on_selector_all('#mins option', 'els => els.map(e => e.textContent)')
        check(opts == ['5 min walk', '10 min walk', '15 min walk', '20 min walk', '30 min walk'], 'walking options: ' + str(opts))
        check(page.input_value('#mins') == '10', 'walking default is 10 minutes')
        page.select_option('#mins', '20')
        page.check('input[name=mode][value=car]')
        opts = page.eval_on_selector_all('#mins option', 'els => els.map(e => e.textContent)')
        check(opts == ['10 min drive', '15 min drive', '20 min drive', '30 min drive', '45 min drive'], 'driving options: ' + str(opts))
        check(page.input_value('#mins') == '20', 'a minutes value that exists in both lists is kept (20)')
        page.select_option('#mins', '45')
        page.check('input[name=mode][value=walk]')
        check(page.input_value('#mins') == '10', 'switching back to a list without 45 falls back to the default')
        # walking search
        n0 = len(calls)
        page.fill('#where', 'Whitby'); page.select_option('#mins', '15'); page.click('#go'); page.wait_for_selector('.card')
        r = [c for c in calls[n0:] if c['body'].get('pageSize') != 1][0]['body']['locationBias']['circle']['radius']
        check(abs(r - (15 * 80 / 1.3) * 1.6) < 1, f'15 min walk -> {r:.0f} m search radius')
        txt = page.inner_text('#card-0')
        check('min walk' in txt and 'by car' not in txt, 'cards show walking times')
        check('parking' not in txt.lower(), 'walking mode shows no parking tag')
        hrefs = dict(page.eval_on_selector_all('#card-0 a', 'els => els.map(e => [e.textContent, e.href])'))
        check(hrefs['Directions'].endswith('travelmode=walking') and 'Bus or train' not in hrefs, 'walking directions, no bus link')
        # driving search
        n0 = len(calls)
        page.check('input[name=mode][value=car]'); page.select_option('#mins', '20'); page.click('#go')
        page.wait_for_function("document.querySelector('#card-0 .sub') && document.querySelector('#card-0 .sub').textContent.indexOf('by car') > -1")
        r = [c for c in calls[n0:] if c['body'].get('pageSize') != 1][0]['body']['locationBias']['circle']['radius']
        check(abs(r - (20 * (35000 / 60) / 1.4) * 1.6) < 1, f'20 min drive -> {r:.0f} m search radius')
        hrefs = dict(page.eval_on_selector_all('#card-0 a', 'els => els.map(e => [e.textContent, e.href])'))
        check(hrefs['Drive there'].endswith('travelmode=driving'), 'drive link uses driving')
        check(hrefs['Bus or train'].endswith('travelmode=transit') and 'destination_place_id=' in hrefs['Bus or train'], 'bus or train link uses transit')
        check('Free parking' in page.inner_text('#card-0'), 'car mode shows the parking tag when Google says there is parking')
        no_hscroll(page, 'travel mode')
        page.screenshot(path=f'{OUT}/07-mode.png', full_page=True)
        page.reload()
        check(page.is_checked('input[name=mode][value=car]') and page.input_value('#mins') == '20', 'mode and minutes are remembered')
        # a stale pref from the old mile-based version is ignored cleanly
        page.evaluate("localStorage.setItem('rtc:prefs', JSON.stringify({cat:'dinner', radius:'2'}))"); page.reload()
        check(page.is_checked('input[name=mode][value=walk]') and page.input_value('#mins') == '10', 'old saved distance falls back to 10 min walk')
        real_errors = [e for e in errors if 'ERR_FAILED' not in e and 'fonts' not in e.lower() and 'Failed to load resource' not in e]
        check(not real_errors, 'no page errors in travel tests: ' + '; '.join(real_errors[:3]))
        b.close()
finally:
    srv.terminate()

print('\nFAILS:', check.fails)
sys.exit(1 if check.fails else 0)
