# Round the Corner

An installable web app for finding micropubs, real ale, craft beer, pubs, food, ice cream and walks near wherever you are. It uses your phone's location (or a town you type), asks Google for places, ratings and opening hours, ranks them, and shows the best three on a map.

Open in Chrome on Android, then menu, Install app. It then opens full screen from the home screen.

## 1. Get a Google key

1. In Google Cloud (console.cloud.google.com) create a project and switch on billing.
2. Enable two APIs: **Places API (New)** and **Maps JavaScript API**.
3. Create an API key under APIs and services, Credentials.
4. Restrict the key:
   - Application restriction: HTTP referrers, set to your site address, for example `https://YOURNAME.github.io/*`
   - API restriction: only the two APIs above
5. Add a budget alert (Billing, Budgets and alerts, choose alerts only). A budget only emails you, it does not stop spending. Google's daily quota for Places text search is fixed at 75,000 and cannot be lowered, so the app has its own daily limit (see below).

Cost. Each Find makes two Google searches (three if you typed a place). The search asks for ratings, hours and extra detail such as outside seating, which Google prices in its top Places tier, about 40 US dollars per 1,000 searches after a small free monthly allowance when this was checked in October 2026. Check Google's current pricing page. Maps JavaScript loads are billed separately. For weekend use this should be small, but set the alerts anyway.

## 2. Host it

The files must be served over https, because phones only share location on secure pages.

GitHub Pages (free):
1. Create a new GitHub repository and upload every file in this folder.
2. Settings, Pages, deploy from the main branch, root folder.
3. After a minute your site is at `https://YOURNAME.github.io/REPONAME/`. Use that address in the key restriction above, with `/*` on the end.

Netlify or Cloudflare Pages also work: drag this folder in.

Your key is not in these files. You paste it into the app on your phone (gear icon), and it stays in that browser, so a public repository does not expose it.

## Daily search limit

The app counts every Google search it makes on the phone and refuses to make more once it reaches a daily limit. The default is 80 (a Find uses 2 or 3 searches, so about 30 Finds). Change it in Settings, between 10 and 1000. The count resets at midnight and the current figure shows under the Find button.

It is a guard against a bug or a stuck loop, not a billing control. The count lives in this browser, so clearing site data resets it, and a second device has its own count. The key restrictions in step 4 are what stop anyone else using your key.

## 3. First run

Open the site, paste the key, tap Save and test. Then tap Use my location, pick a category and tap Find 3 places.

## Real Ale Finder signal (optional)

realalefinder.com publishes a public list of the pubs that use its app, each marked Updated Today, Yesterday or This Week, with a link to the pub's beer board. The app uses that as a ranking signal for the real ale, micropub, craft beer and pub categories. A pub that updated its board recently ranks higher. A pub that is not on the list is not marked down.

How it works:
- `.github/workflows/refresh-raf.yml` runs once a day on GitHub, reads the list page and saves `raf.json` in your repository.
- The app loads `raf.json`, matches each Google result to the list by postcode plus the words in the pub's name, and adds a "Real Ale Finder: Updated today" tag and a Beer board link to the card.
- If the list is more than a couple of days old the app says so and weakens the signal.

Setup: keep the folder layout as it is, with `.github` and `scripts` at the top of the repository. The `.github` folder is hidden on some computers, so if you upload through the GitHub website, make sure it went up, or create `.github/workflows/refresh-raf.yml` there by hand and paste the file in.

First run: open the repository's Actions tab, choose "Refresh Real Ale Finder list", and tap Run workflow. In the log, look for a line like `Page: ... 600 entries read`. Then check `raf.json` in the repository has today's date in `asOf`.

If it fails: the job stops without touching `raf.json` and prints the first few link texts it saw. The reader was written from a description of the page, without seeing the raw HTML, so a failure on the first run is possible. Paste the log to Claude and it can be fixed in a minute. Also check your live site shows the new `raf.json` after the daily commit. If it does not refresh, say so, because the deployment step may need changing.

What it does not do:
- It does not know how many ales or ciders a pub has on. The list page has only the update status. The beer lists themselves load inside each beer board page, and there is no published feed for them, so the app does not read them. Tap Beer board on a card to see the selection.
- The list seems to cover only recently updated pubs, so a pub missing from it may be inactive, or may not use the app.

Courtesy: the job makes one request a day, says who it is in the request, and the site's robots.txt allows the page. The site publishes no terms for reusing the list, so this is a personal project that credits Real Ale Finder and links to it. If they ever ask you to stop, switch off the workflow.

## What it can and cannot do

- Ratings and hours are Google's and can lag. Every card links to Google Maps to confirm.
- The CAMRA button on pub cards runs a web search for that pub's CAMRA entry. It cannot confirm Good Beer Guide status. CAMRA has no public search link or data feed that this app can use.
- "Within" is a travel time, not a distance. On foot assumes about 80 metres a minute with a third added for street bends, so 10 minutes reaches about 600 metres in a straight line. By car or bus assumes about 35 km/h with 40 percent added for bends. These are estimates from straight-line distance, not routes: traffic, hills and bus timetables are not known. The Bus or train button opens Google Maps with real public transport times.
- Walks lists parks, reserves and viewpoints from Google. AllTrails has no open API for this, so the app links to AllTrails for routes. Searching AllTrails for the town gives distance, climb and difficulty.
- Opening hours for "Later today" and weekday choices use your phone's clock, which is right for UK use.
- The app stores no Google place data. Only the offline app shell is cached, because Google's terms do not allow caching place content.
- The map uses Google's demo map style. If you want a styled map, create a Map ID in Google Cloud and replace `DEMO_MAP_ID` in `app.js`.

## Files

- `index.html`, `style.css`: the page
- `logic.js`: ranking, opening hours, distance, Real Ale Finder matching (no network)
- `app.js`: location, Google calls, map, screens
- `sw.js`, `manifest.webmanifest`, `icon-*.png`: install and offline shell
- `raf.json`: the Real Ale Finder list, rewritten daily by the job (starts empty)
- `scripts/`, `.github/workflows/`: the daily refresh job
- `tests/`: the three test suites above

## Tests

- `node tests/logic.test.js`: ranking, opening hours, travel time, daily limit (no network)
- `node tests/raf.test.mjs`: the Real Ale Finder list reader and matching
- `python3 tests/e2e.py`: drives the real page in Chromium with Google mocked. Needs `pip install playwright` and a Chromium. Screenshots go to the system temp folder under `rtc-shots`.

Run all three before pushing a change.

## Licence

Copyright (c) 2026 waymarkworks. All rights reserved. See `LICENSE`. The page asks search engines not to list it. That reduces how easily strangers find it, but it does not hide the files from anyone who has the address.
