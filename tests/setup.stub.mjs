/*
 * Drives apps/setup.html in a real browser with the appliance STUBBED: the keys routes, the views
 * and the world gateway answer from tests/fixtures, captured from live runs against the proof
 * cluster. Asserts what a person sees and what the page WRITES: the exact body sent to the keys
 * route and the exact entry created.
 *
 *   node tests/setup.stub.mjs        (needs `playwright` resolvable from tests/)
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const fix = (n) => JSON.parse(read(`./fixtures/${n}.json`));
const html = read('../apps/setup.html');
const coverage = existsSync(fileURLToPath(new URL('./fixtures/LogStoreCoverage.json', import.meta.url))) ? fix('LogStoreCoverage') : null;
const FIX = { RunningVersions: fix('RunningVersions'), KubeLogFailures: fix('KubeLogFailures'), WhatBrokeInProduction: fix('WhatBrokeInProduction'), LogStoreCoverage: coverage };
const KEYS = fix('keys');
const URL_ = 'http://world.test/apps/which-change/setup.html';

const runtime = (mode) => `
  window.__views = []; window.__entries = []; const FIX = ${JSON.stringify(FIX)}; const MODE = ${JSON.stringify(mode)};
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  window.embabel = { views: { invoke: async (name, args) => {
    window.__views.push(name + ':' + JSON.stringify(args));
    if (name === 'WatchedServices') return { status: 'OK', rows: window.__entries.map(e => e.data) };
    if (MODE === 'nopods' && name === 'RunningVersions') return { status: 'OK', rows: [] };
    if (MODE === 'clusterdown' && (name === 'RunningVersions' || name === 'KubeLogFailures')) { const e = new Error('the cluster did not answer'); e.reason = 'FAILED'; throw e; }
    if (name === 'LogStoreCoverage') { if (MODE === 'logstore' && FIX.LogStoreCoverage) return FIX.LogStoreCoverage; return { status: 'OK', rows: [] }; }
    if (name === 'RunningVersions' && MODE === 'slow') await wait(1200);
    if (!FIX[name]) throw new Error('no fixture for ' + name);
    return FIX[name];
  } } };`;
const gateway = `window.gateway = { repository: { createEntry: async (e) => { window.__entries.push(e); return { id: e.data.key }; } } };`;

let failures = 0;
const ok = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) failures++; };

async function open(browser, mode, { refuse = false } = {}) {
  const page = await browser.newPage();
  const errors = [], puts = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('422')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const keys = JSON.parse(JSON.stringify(KEYS)).map(k => ({ ...k, fields: k.fields.map(f => ({ ...f, set: mode === 'fresh' ? false : f.set })) }));
  await page.route('**/*', async (route) => {
    const req = route.request(), u = req.url();
    if (u.startsWith(URL_)) return route.fulfill({ contentType: 'text/html', body: html });
    if (u.endsWith('/embabel.js')) return route.fulfill({ contentType: 'application/javascript', body: runtime(mode) });
    if (u.endsWith('/gateway.js')) return route.fulfill({ contentType: 'application/javascript', body: gateway });
    if (u.endsWith('/api/v1/keys') && req.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(keys) });
    if (u.includes('/api/v1/keys/') && req.method() === 'PUT') {
      const name = decodeURIComponent(u.split('/api/v1/keys/')[1]), body = JSON.parse(req.postData());
      puts.push({ name, body });
      const entry = keys.find(k => k.name === name);
      if (refuse) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ...entry, health: { status: 'refused', message: '401 Unauthorized' } }) });
      entry.fields.forEach(f => { if (body.values[f.variable]) f.set = true; });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(entry) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(URL_);
  return { page, errors, puts };
}
async function check(page, ns = 'clinic', app = 'petclinic', repo = 'embabel-worlds/petclinic-proof') {
  await page.fill('#namespace', ns); await page.fill('#app', app); await page.fill('#repo', repo);
  await page.locator('#svc button').click();
}

const browser = await chromium.launch();
try {
  console.log('a world with nothing connected');
  let { page, errors, puts } = await open(browser, 'fresh');
  await page.waitForSelector('form[data-key]');
  ok(await page.locator('form[data-key]').count() === KEYS.length, `one card per key entry (${KEYS.length})`);
  ok(await page.locator('.pill', { hasText: 'not connected' }).count() === KEYS.length, 'each says not connected');
  ok(await page.locator('input[type=password]').count() === KEYS.flatMap(k => k.fields).filter(f => f.secret).length, 'every secret field is a password field');
  const kube = page.locator('form[data-key]', { hasText: 'Kubernetes cluster' });
  await kube.locator('button').click();
  ok((await kube.innerText()).includes('Enter a value to store') && puts.length === 0, 'storing nothing is refused on the page, with no request');
  await kube.locator('input[name=KUBERNETES_API_SERVER]').fill(' https://10.0.0.1:6443 ');
  await kube.locator('input[name=KUBERNETES_TOKEN]').fill('tok-123');
  await kube.locator('button').click();
  await page.waitForFunction(() => document.body.innerText.includes('Stored.'));
  ok(puts.length === 1 && puts[0].name === 'kubernetes:kubernetes' && JSON.stringify(puts[0].body) === JSON.stringify({ values: { KUBERNETES_API_SERVER: 'https://10.0.0.1:6443', KUBERNETES_TOKEN: 'tok-123' } }),
     'the keys route gets exactly the fields entered, trimmed, under their variables');
  const after = page.locator('form[data-key]', { hasText: 'Kubernetes cluster' });
  ok((await after.locator('.pill.p-green').first().innerText()) === 'connected', 'the card turns to connected');
  ok(!(await page.content()).includes('tok-123'), 'the secret is not on the page after storing');
  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  console.log('a refused credential');
  ({ page, errors, puts } = await open(browser, 'fresh', { refuse: true }));
  await page.waitForSelector('form[data-key]');
  const k2 = page.locator('form[data-key]', { hasText: 'Kubernetes cluster' });
  await k2.locator('input[name=KUBERNETES_TOKEN]').fill('bad');
  await k2.locator('button').click();
  await page.waitForFunction(() => document.body.innerText.includes('Not stored'));
  ok((await page.locator('form[data-key]', { hasText: 'Kubernetes cluster' }).innerText()).includes('the source refused it (401 Unauthorized)'), 'a refusal says the source refused it, and why');
  await page.close();

  console.log('checks on the live fixtures (no log store: the pods\' own logs)');
  ({ page, errors } = await open(browser, 'ok'));
  await page.waitForSelector('form[data-key]');
  await check(page);
  await page.waitForSelector('#saveBtn');
  const checks = await page.locator('#checks').innerText();
  const rv = FIX.RunningVersions.rows, pods = rv.reduce((n, r) => n + r.pods, 0);
  ok(checks.includes(`${pods} pods on ${rv.length} versions`) && checks.includes('1 crash-looping'), `pods: ${pods} on ${rv.length} versions, one crash-looping`);
  ok(rv.every(r => checks.includes(String(r.commit).slice(0, 7))), 'each running commit is named');
  ok(checks.includes('Reading the pods\' own logs instead: ' + FIX.KubeLogFailures.rows.length + ' failures'), 'logs fall back to the pods, and say how far that reaches');
  ok(await page.locator('.dot.ok').count() === 3, 'three checks pass');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => document.querySelector('#watched table'));
  const entries = await page.evaluate(() => window.__entries);
  ok(entries.length === 1 && JSON.stringify(entries[0]) === JSON.stringify({ type: 'WatchedService', data: { key: 'clinic/petclinic', namespace: 'clinic', app: 'petclinic', repo: 'embabel-worlds/petclinic-proof', logs: 'cluster' } }),
     'saving creates exactly one WatchedService entry with the three names');
  ok(await page.locator('#watched tbody tr').count() === 1, 'and it is listed');
  await page.locator('[data-broke]').click();
  await page.waitForSelector('#broke table');
  const wb = FIX.WhatBrokeInProduction.rows[0], brokeText = await page.locator('#broke').innerText();
  ok(await page.locator('#broke tbody tr').count() === FIX.WhatBrokeInProduction.rows.length && brokeText.includes(wb.commit) && brokeText.includes('pull request #' + wb.pullRequest) && brokeText.includes('with a coding agent'),
     'what broke: the failure, its line, the change, the pull request, and that an agent helped');
  const badge = page.locator('#embabel-badge'), box = await badge.boundingBox(), vp = page.viewportSize();
  ok((await badge.innerText()).includes('Embabel') && await badge.locator('a[href="https://embabel.com"]').count() === 1 && box.y + box.height <= vp.height + 1, 'the badge is visible and links out');
  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  if (coverage) {
    console.log('checks with the log store');
    ({ page, errors } = await open(browser, 'logstore'));
    await page.waitForSelector('form[data-key]');
    await check(page);
    await page.waitForSelector('#saveBtn');
    ok((await page.locator('#checks').innerText()).includes('The log store holds ' + Number(coverage.rows[0].events).toLocaleString() + ' events'), 'the log store\'s own count is shown');
    await page.locator('#saveBtn').click();
    await page.waitForFunction(() => window.__entries.length === 1);
    ok((await page.evaluate(() => window.__entries[0].data.logs)) === 'log store', 'and the entry records that logs come from the log store');
    await page.close();
  }

  console.log('a service with no pods');
  ({ page, errors } = await open(browser, 'nopods'));
  await page.waitForSelector('form[data-key]');
  await check(page, 'clinic', 'nosuch');
  await page.waitForFunction(() => document.querySelector('#save').innerText.includes('Fix what is marked'));
  ok((await page.locator('#checks').innerText()).includes('No pod in namespace clinic carries the app label nosuch') && await page.locator('#saveBtn').count() === 0, 'no pods is said in words, and the service cannot be saved');
  await page.close();

  console.log('the cluster does not answer');
  ({ page, errors } = await open(browser, 'clusterdown'));
  await page.waitForSelector('form[data-key]');
  await check(page);
  await page.waitForFunction(() => document.querySelector('#save').innerText.includes('Fix what is marked'));
  ok((await page.locator('#checks').innerText()).includes('The cluster could not be read: the cluster did not answer'), 'a source\'s error is shown as its error');
  await page.close();

  console.log('a second check while the first is still running');
  ({ page, errors } = await open(browser, 'slow'));
  await page.waitForSelector('form[data-key]');
  await check(page, 'clinic', 'first');
  await check(page, 'clinic', 'petclinic');
  await page.waitForSelector('#saveBtn');
  await page.waitForTimeout(1500);
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__entries.length === 1);
  ok((await page.evaluate(() => window.__entries[0].data.app)) === 'petclinic', 'the late answer to the first check does not overwrite the second');
  await page.close();

  console.log('bad input');
  ({ page, errors } = await open(browser, 'ok'));
  await page.waitForSelector('form[data-key]');
  await check(page, 'clinic', 'petclinic', 'not-a-repo');
  ok((await page.locator('#checks').innerText()).includes('owner/repo') && (await page.evaluate(() => window.__views.filter(v => v.startsWith('RunningVersions')).length)) === 0, 'a repository that is not owner/repo is refused before anything is read');
  await page.close();
} finally { await browser.close(); }
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
