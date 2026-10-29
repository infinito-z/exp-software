const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const OUT = process.argv[2] || '/tmp/e2e'; fs.mkdirSync(OUT, { recursive: true });
const fake = http.createServer((q, r) => { const f = path.join(__dirname, 'fake', q.url.replace(/[^a-z.]/g, '')); if (fs.existsSync(f)) { r.setHeader('Content-Type', 'text/html'); r.end(fs.readFileSync(f)); } else { r.statusCode = 404; r.end(); } }).listen(4001);
const dataFile = path.join(OUT, 'sessions.json'); try { fs.unlinkSync(dataFile); } catch (e) {}
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '4000', ADMIN_KEY: 'test', DATA_FILE: dataFile, URL_CG: 'http://localhost:4001/cg.html', URL_SG: 'http://localhost:4001/sg.html' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stdout.on('data', d => process.stdout.write('[srv] ' + d)); srv.stderr.on('data', d => process.stdout.write('[srv!] ' + d));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const B = 'http://localhost:4000';
async function api(p, m, b, tok) { const r = await fetch(B + '/api/' + p, { method: m || 'GET', headers: { 'Content-Type': 'application/json', 'x-token': tok || '' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; }
// participante por API (para probar balance y exportación)
async function viaApi(i) {
  const st = await api('start', 'POST', { consent: true }); const tok = st.j.token;
  await api('demographics', 'POST', { sexo: i % 2 ? 'Mujer' : 'Hombre', edad: 20 + i, ux: 'Alto', ui: 'Intermedio', usab: 'Poco', clin: 'Nada' }, tok);
  await api('instructions', 'POST', { answers: [1, 1, 0] }, tok);
  let s = (await api('state', 'GET', null, tok)).j;
  for (const n of [1, 2]) {
    await api(`phase/${n}/start`, 'POST', {}, tok); for (let t = 1; t <= 10; t++) await api(`phase/${n}/task`, 'POST', { task: t, checked: t <= 9 }, tok);
    s = (await api(`phase/${n}/finish`, 'POST', {}, tok)).j;
    for (const pg of s.pages) { const a = {}; const ids = pg.type === 'likert' ? pg.items : [...pg.rows, pg.importance]; ids.forEach(it => { a[it.id] = it.atencion ? (it.id === 'ATN_SAT' ? 4 : 3) : 1 + Math.floor(Math.random() * 5); }); await api(`survey/${n}/page`, 'POST', { pageId: pg.id, answers: a, ms: 20000, fast: false }, tok); }
    const c = await api(`survey/${n}/complete`, 'POST', {}, tok); if (c.s !== 200) throw new Error('complete falló ' + JSON.stringify(c));
  }
  return st.j.code;
}
(async () => {
  await sleep(1500);
  console.log('health', (await api('health')).j);
  // 1) flujo completo en navegador
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
  const pg = await (await br.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(B); await pg.waitForSelector('#ok'); await pg.screenshot({ path: OUT + '/1_consent.png' });
  await pg.check('#ok'); await pg.click('#go'); await pg.waitForSelector('#sexo'); await pg.screenshot({ path: OUT + '/2_demo.png' });
  await pg.selectOption('#sexo', 'Mujer'); await pg.fill('#edad', '24'); for (const id of ['ux', 'ui', 'usab', 'clin']) await pg.selectOption('#' + id, 'Intermedio'); await pg.click('#go');
  await pg.waitForSelector('.quiz'); await pg.screenshot({ path: OUT + '/3_instr.png', fullPage: true });
  await pg.click('input[name="q0"][value="0"]'); await pg.click('input[name="q1"][value="1"]'); await pg.click('input[name="q2"][value="0"]'); await pg.click('#go'); await pg.waitForSelector('.err'); console.log('quiz incorrecto ->', await pg.textContent('.err'));
  await pg.click('input[name="q0"][value="1"]'); await pg.click('#go');
  await pg.waitForSelector('text=Caso clínico a resolver'); await pg.screenshot({ path: OUT + '/4_pre.png', fullPage: true });
  await pg.click('#go'); await pg.waitForSelector('#tl'); await sleep(1200);
  await pg.click('#tl li:nth-child(1)'); await pg.click('#tl li:nth-child(2)'); await sleep(800); await pg.screenshot({ path: OUT + '/5_work.png' });
  const frame = pg.frameLocator('#app'); console.log('iframe:', await frame.locator('h1').textContent());
  await pg.click('#fin'); await pg.waitForSelector('#modal-yes'); await pg.click('#modal-yes');
  for (let k = 0; k < 20; k++) {
    await pg.locator('#next').or(pg.getByText('Caso clínico a resolver')).first().waitFor({ timeout: 8000 }); if (!(await pg.$('#next'))) break;
    const names = await pg.$$eval('input[type=radio]', els => [...new Set(els.map(e => e.name))]);
    for (const nm of names) await pg.click(`input[name="${nm}"][value="${nm === 'ATN_SAT' ? 4 : nm === 'ATN_UEQ' ? 3 : 2}"]`, { force: true });
    if (k === 0) await pg.screenshot({ path: OUT + '/6_survey_likert.png', fullPage: true });
    if (k === 6) await pg.screenshot({ path: OUT + '/7_survey_sd.png', fullPage: true });
    await pg.click('#next'); if (await pg.$('#warn:not([hidden])')) await pg.click('#next');
    await sleep(250);
  }
  await pg.waitForSelector('text=Caso clínico a resolver'); console.log('fase 2 alcanzada');
  await pg.reload(); await pg.waitForSelector('text=Caso clínico a resolver'); console.log('reanudación tras recargar: OK');
  console.log('errores de consola:', errs);
  await br.close();
  // 2) participantes por API
  const codes = []; for (let i = 0; i < 8; i++) codes.push(await viaApi(i)); console.log('códigos', codes.join(','));
  const adm = await fetch(B + '/api/admin/sessions', { headers: { 'x-admin-key': 'test' } }).then(r => r.json());
  console.log('completadas por perfil', adm.completadasPorPerfil, '| sesión browser:', adm.sesiones[0].estado, adm.sesiones[0].paso);
  for (const f of ['satisfaccion_CG.csv', 'satisfaccion_SG.csv', 'demografico.csv', 'registro_sesiones.csv', 'tareas.csv', 'eventos.csv']) { const t = await fetch(B + '/api/admin/export/' + f + '?key=test').then(r => r.text()); fs.writeFileSync(path.join(OUT, f), t); console.log(f, t.split('\n').length - 2, 'filas'); }
  console.log('sin clave:', (await fetch(B + '/api/admin/sessions')).status);
  srv.kill(); fake.close(); process.exit(0);
})().catch(e => { console.error('FALLO', e); srv.kill(); fake.close(); process.exit(1); });
