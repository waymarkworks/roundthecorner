// Fetches the public Real Ale Finder pub list once and writes raf.json for the app.
// Run daily by .github/workflows/refresh-raf.yml. One request, identified, robots.txt allows it.
import { writeFile } from 'node:fs/promises';
import { parseRaf } from './raf-parse.mjs';

const URL_LIST = 'https://www.realalefinder.com/pubs/';
const MIN_PUBS = 20; // fewer than this means the page changed shape; fail rather than publish rubbish

const repo = process.env.GITHUB_REPOSITORY || 'personal-project';
const res = await fetch(URL_LIST, {
  headers: {
    'User-Agent': `RoundTheCornerPersonal/1.0 (personal project, once a day; https://github.com/${repo})`,
    'Accept': 'text/html',
  },
});
if (!res.ok) {
  console.error(`Fetch failed: HTTP ${res.status}. raf.json left as it was.`);
  process.exit(1);
}
const html = await res.text();
const { pubs, anchors, samples } = parseRaf(html);

const counts = pubs.reduce((c, p) => ((c[p.updated] = (c[p.updated] || 0) + 1), c), {});
console.log(`Page: ${html.length} bytes, ${anchors} beer board links, ${pubs.length} entries read`, counts);

if (pubs.length < MIN_PUBS) {
  console.error(`Only ${pubs.length} entries read (need at least ${MIN_PUBS}). The page format has probably changed.`);
  console.error('First link texts seen, to help fix the reader:');
  samples.forEach((s, i) => console.error(`  ${i + 1}. ${JSON.stringify(s)}`));
  console.error('raf.json left as it was.');
  process.exit(1);
}

await writeFile(
  'raf.json',
  JSON.stringify({ source: URL_LIST, asOf: new Date().toISOString(), pubs }) + '\n'
);
console.log('raf.json written.');
