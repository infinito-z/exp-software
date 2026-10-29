const express = require('express');
const path = require('path');
const L = require('./lib/logic');
const X = require('./lib/export');
const { makeStore } = require('./lib/store');

const ADMIN_KEY = process.env.ADMIN_KEY || '';
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

let store;
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Error interno' }); });
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// Ejecuta mutate(doc) sobre la sesión del token; devuelve lo que retorne mutate
async function withSession(req, res, mutate) {
  const token = req.get('x-token');
  if (!token) return bad(res, 'Sin sesión', 401);
  let err = null;
  const out = await store.tx(async docs => {
    const d = docs.find(x => x.id === token);
    if (!d) { err = ['Sesión no encontrada', 404]; return { docs, result: null }; }
    if (d.status === 'invalid') { err = ['Esta sesión fue anulada', 403]; return { docs, result: null }; }
    try { const r = await mutate(d); return { docs, result: r }; } catch (e) { if (e.userError) { err = [e.message, 400]; return { docs, result: null }; } throw e; }
  });
  if (err) return bad(res, err[0], err[1]);
  return res.json(out);
}
const userErr = m => { const e = new Error(m); e.userError = true; return e; };

// Vista de la sesión para el cliente (no revela qué versión es CG o SG)
function view(d) {
  const v = { code: d.code, step: d.step, serverNow: L.nowIso(), config: { titulo: L.CFG.titulo, limiteSugeridoMin: L.CFG.limiteSugeridoMin, minSegundosPorItem: L.CFG.minSegundosPorItem, modoApp: L.CFG.modoApp }, tasks: L.TASKS };
  if (d.step === 'instructions') v.instrucciones = L.CFG.instrucciones;
  const m = /^p(\d)_(task|survey)$/.exec(d.step);
  if (m) {
    const n = Number(m[1]); const ph = d.phases[n - 1];
    v.phase = { n, startedAt: ph.startedAt, finishedAt: ph.finishedAt, tasksDone: ph.tasks, caso: L.CASES[String(ph.problem)], url: ph.version === 'CG' ? L.CFG.urlCG : L.toEmbed(L.CFG.urlSG), urlAbrir: ph.version === 'CG' ? L.CFG.urlCG : L.CFG.urlSG };
    if (m[2] === 'survey') { v.pages = L.surveyPages(d, n); v.answers = d.surveys[n].answers; }
  }
  return v;
}

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/api/health', (req, res) => res.json({ ok: true, almacenamiento: store.kind }));
app.get('/api/consent', (req, res) => res.json({ titulo: L.CFG.titulo, consentimiento: L.CFG.consentimiento }));

app.post('/api/start', wrap(async (req, res) => {
  if (!req.body || req.body.consent !== true) return bad(res, 'Debes aceptar el consentimiento');
  const meta = { ua: String(req.get('user-agent') || '').slice(0, 300), screen: String((req.body.screen) || '').slice(0, 30), lang: String(req.body.lang || '').slice(0, 20) };
  const doc = await store.tx(async docs => { const d = L.newSession(docs, meta); docs.push(d); return { docs, result: d }; });
  res.json({ token: doc.id, ...view(doc) });
}));
app.get('/api/state', wrap(async (req, res) => {
  const d = (await store.all()).find(x => x.id === req.get('x-token'));
  if (!d) return bad(res, 'Sesión no encontrada', 404);
  res.json(view(d));
}));

app.post('/api/demographics', wrap((req, res) => withSession(req, res, d => {
  if (d.step !== 'demographics') throw userErr('Paso no válido');
  const b = req.body || {}; const lv = ['Nada', 'Poco', 'Intermedio', 'Alto'];
  const age = Number(b.edad);
  if (!['Hombre', 'Mujer', 'Prefiero no decirlo'].includes(b.sexo) || !(age >= 16 && age <= 80) || ![b.ux, b.ui, b.usab, b.clin].every(x => lv.includes(x))) throw userErr('Completa todos los campos');
  d.demographics = { sexo: b.sexo, edad: age, ux: b.ux, ui: b.ui, usab: b.usab, clin: b.clin, at: L.nowIso() };
  d.step = 'instructions'; return view(d);
})));
app.post('/api/instructions', wrap((req, res) => withSession(req, res, d => {
  if (d.step !== 'instructions') throw userErr('Paso no válido');
  const ans = (req.body || {}).answers; const q = L.CFG.instrucciones.comprension;
  d.instructions = d.instructions || { attempts: 0 }; d.instructions.attempts++;
  if (!Array.isArray(ans) || ans.length !== q.length || !q.every((x, i) => ans[i] === x.correcta)) return { ok: false, attempts: d.instructions.attempts };
  d.instructions.passedAt = L.nowIso(); d.step = 'p1_task'; return { ok: true, ...view(d) };
})));

app.post('/api/phase/:n/start', wrap((req, res) => withSession(req, res, d => {
  const n = Number(req.params.n); if (d.step !== 'p' + n + '_task') throw userErr('Paso no válido');
  const ph = d.phases[n - 1]; if (!ph.startedAt) ph.startedAt = L.nowIso(); return view(d);
})));
app.post('/api/phase/:n/task', wrap((req, res) => withSession(req, res, d => {
  const n = Number(req.params.n); if (d.step !== 'p' + n + '_task') throw userErr('Paso no válido');
  const ph = d.phases[n - 1]; const t = Number(req.body.task); if (!ph.startedAt || !(t >= 1 && t <= L.TASKS.length)) throw userErr('Tarea no válida');
  const checked = !!req.body.checked; ph.tasks[t] = checked; ph.taskEvents.push({ task: t, checked, ts: L.nowIso() }); return { ok: true };
})));
app.post('/api/phase/:n/visibility', wrap((req, res) => withSession(req, res, d => {
  const n = Number(req.params.n); const ph = d.phases[n - 1]; if (d.step !== 'p' + n + '_task' || !ph.startedAt) return { ok: true };
  const state = req.body.state === 'hidden' ? 'hidden' : 'visible'; const ts = L.nowIso(); const last = ph.visEvents[ph.visEvents.length - 1];
  if (state === 'visible' && last && last.state === 'hidden') ph.hiddenSec += (new Date(ts) - new Date(last.ts)) / 1000;
  ph.visEvents.push({ state, ts }); return { ok: true };
})));
app.post('/api/phase/:n/finish', wrap((req, res) => withSession(req, res, d => {
  const n = Number(req.params.n); if (d.step !== 'p' + n + '_task') throw userErr('Paso no válido');
  const ph = d.phases[n - 1]; if (!ph.startedAt) throw userErr('Debes comenzar el problema primero');
  const last = ph.visEvents[ph.visEvents.length - 1]; const ts = L.nowIso();
  if (last && last.state === 'hidden') ph.hiddenSec += (new Date(ts) - new Date(last.ts)) / 1000;
  ph.finishedAt = ts; d.step = 'p' + n + '_survey'; return view(d);
})));

app.post('/api/survey/:n/page', wrap((req, res) => withSession(req, res, d => {
  const n = Number(req.params.n); if (d.step !== 'p' + n + '_survey') throw userErr('Paso no válido');
  const page = L.surveyPages(d, n).find(p => p.id === req.body.pageId); if (!page) throw userErr('Página no válida');
  const ids = page.type === 'likert' ? page.items.map(i => [i.id, 5]) : [...page.rows.map(r => [r.id, 7]), [page.importance.id, 7]];
  const a = req.body.answers || {};
  for (const [id, max] of ids) { const v = Number(a[id]); if (!Number.isInteger(v) || v < 1 || v > max) throw userErr('Faltan respuestas'); }
  const sv = d.surveys[n]; ids.forEach(([id]) => { sv.answers[id] = Number(a[id]); });
  sv.pages[page.id] = { ms: Math.min(Math.max(Number(req.body.ms) || 0, 0), 3600000), fast: !!req.body.fast, at: L.nowIso() };
  return { ok: true };
})));
app.post('/api/survey/:n/complete', wrap((req, res) => withSession(req, res, d => {
  const n = Number(req.params.n); if (d.step !== 'p' + n + '_survey') throw userErr('Paso no válido');
  const sv = d.surveys[n]; const miss = L.requiredIds(d, n).filter(([id, lo, hi]) => !(sv.answers[id] >= lo && sv.answers[id] <= hi));
  if (miss.length) throw userErr('Faltan respuestas del cuestionario');
  sv.completedAt = L.nowIso();
  if (n === 1) d.step = 'p2_task'; else { d.step = 'done'; d.status = 'completed'; d.completedAt = L.nowIso(); }
  return view(d);
})));
app.post('/api/feedback', wrap((req, res) => withSession(req, res, d => { d.feedback = String((req.body || {}).comment || '').slice(0, 2000); return { ok: true }; })));

// ----------------------------- Administración
const admin = (req, res, next) => { if (!ADMIN_KEY) return bad(res, 'ADMIN_KEY no configurada', 503); if (req.get('x-admin-key') !== ADMIN_KEY && req.query.key !== ADMIN_KEY) return bad(res, 'No autorizado', 401); next(); };
app.get('/api/admin/sessions', admin, wrap(async (req, res) => {
  const docs = await store.all();
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 }; docs.filter(d => d.status === 'completed').forEach(d => counts[d.profile]++);
  res.json({ almacenamiento: store.kind, completadasPorPerfil: counts, sesiones: docs.map(d => ({ code: d.code, perfil: d.profile, estado: d.status, paso: d.step, creada: d.createdAt, completada: d.completedAt || null, motivo: d.invalidReason || null,
    minutos: d.phases.map(p => p.startedAt && p.finishedAt ? +((new Date(p.finishedAt) - new Date(p.startedAt)) / 60000).toFixed(1) : null) })) });
}));
app.post('/api/admin/invalidate', admin, wrap(async (req, res) => {
  const out = await store.tx(async docs => { const d = docs.find(x => x.code === req.body.code); if (!d) return { docs, result: false }; d.status = 'invalid'; d.invalidReason = String(req.body.reason || '').slice(0, 300); return { docs, result: true }; });
  res.json({ ok: out });
}));
app.get('/api/admin/export/:name', admin, wrap(async (req, res) => {
  let docs = await store.all(); if (req.query.todas !== '1') docs = docs.filter(d => d.status === 'completed');
  docs.sort((a, b) => a.code.localeCompare(b.code));
  const f = { 'satisfaccion_CG.csv': () => X.satisfaccion(docs, 'CG'), 'satisfaccion_SG.csv': () => X.satisfaccion(docs, 'SG'), 'demografico.csv': () => X.demografico(docs), 'registro_sesiones.csv': () => X.registro(docs), 'tareas.csv': () => X.tareas(docs), 'eventos.csv': () => X.eventos(docs), 'sesiones_completas.json': () => JSON.stringify(docs, null, 1) }[req.params.name];
  if (!f) return bad(res, 'Archivo desconocido', 404);
  res.set('Content-Type', req.params.name.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="' + req.params.name + '"').send(f());
}));

const PORT = process.env.PORT || 3000;
makeStore().then(s => {
  store = s;
  const pend = []; Object.entries(L.CASES).forEach(([k, c]) => { if (!c.pacienteHistorial) pend.push('caso ' + k + ': paciente con historial'); if (!c.propietario.departamento || !c.propietario.distrito) pend.push('caso ' + k + ': departamento/distrito'); if (c.sintomas.some(x => !x.severidad || !x.frecuencia || !x.duracion)) pend.push('caso ' + k + ': severidad/frecuencia/duración de síntomas'); });
  if (/REEMPLAZAR/.test(L.CFG.urlCG + L.CFG.urlSG)) pend.push('URL de las aplicaciones en config/config.json (o variables URL_CG y URL_SG)');
  if (pend.length) console.warn('PENDIENTE de configurar:\n - ' + pend.join('\n - '));
  if (!ADMIN_KEY) console.warn('ADVERTENCIA: define ADMIN_KEY para usar el panel /admin');
  app.listen(PORT, () => console.log('Servidor en puerto ' + PORT + ' · almacenamiento: ' + store.kind));
});
