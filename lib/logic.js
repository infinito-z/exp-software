const crypto = require('crypto');
const path = require('path');
const read = f => require(path.join('..', 'config', f));
const CFG = { ...read('config.json') }; if (process.env.URL_CG) CFG.urlCG = process.env.URL_CG; if (process.env.URL_SG) CFG.urlSG = process.env.URL_SG;
const TASKS = read('tasks.json'), CASES = read('cases.json'), Q = read('questionnaires.json');

const shuffle = (arr, rnd = Math.random) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const nowIso = () => new Date().toISOString();

// Asignación por minimización aleatoria: perfil con menos sesiones válidas (empates al azar).
// Mantiene el equilibrio 5-5-5-5 en 20 sesiones válidas y funciona por bloques de 4.
function assignProfile(docs, rnd = Math.random) {
  const valid = docs.filter(d => d.status !== 'invalid');
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  valid.forEach(d => { counts[d.profile]++; });
  const min = Math.min(...Object.values(counts));
  const cand = Object.keys(counts).filter(k => counts[k] === min);
  return Number(cand[Math.floor(rnd() * cand.length)]);
}
function nextCode(docs) {
  const n = docs.map(d => parseInt(String(d.code).slice(1), 10) || 0);
  return 'S' + String(Math.max(0, ...n) + 1).padStart(2, '0');
}
function phasesFor(profile) {
  const p = CFG.perfiles[String(profile)];
  const second = p.primera === 'CG' ? 'SG' : 'CG';
  const prob = v => (v === 'CG' ? p.problemaCG : p.problemaSG);
  return [p.primera, second].map((v, i) => ({ n: i + 1, version: v, problem: prob(v) }));
}
function newSession(docs, meta) {
  const profile = assignProfile(docs);
  const sat = shuffle(Q.satisfaccion.items.map(i => i.id));
  const ueq = shuffle(Q.ueq.escalas.map(e => e.name));
  const doc = {
    id: crypto.randomBytes(24).toString('base64url'), code: nextCode(docs), profile, status: 'in_progress', step: 'demographics',
    createdAt: nowIso(), consent: { accepted: true, at: nowIso(), version: CFG.consentimiento.version },
    client: meta, phases: phasesFor(profile).map(p => ({ ...p, startedAt: null, finishedAt: null, tasks: {}, taskEvents: [], visEvents: [], hiddenSec: 0 })),
    order: { sat: { 1: shuffle(sat), 2: shuffle(sat) }, ueq: { 1: shuffle(ueq), 2: shuffle(ueq) }, atnSatPos: { 1: Math.floor(Math.random() * 17), 2: Math.floor(Math.random() * 17) }, atnUeqPage: { 1: Math.floor(Math.random() * 10), 2: Math.floor(Math.random() * 10) }, atnUeqRow: { 1: Math.floor(Math.random() * 5), 2: Math.floor(Math.random() * 5) } },
    demographics: null, instructions: null, surveys: { 1: { answers: {}, pages: {} }, 2: { answers: {}, pages: {} } }, feedback: null,
  };
  return doc;
}
// Páginas del cuestionario de la fase n (definición enviada al cliente; el orden queda guardado en la sesión)
function surveyPages(doc, n) {
  const s = Q.satisfaccion; const byId = Object.fromEntries(s.items.map(i => [i.id, i]));
  const items = doc.order.sat[n].map(id => ({ id, text: byId[id].text }));
  items.splice(doc.order.atnSatPos[n], 0, { id: s.atencion.id, text: s.atencion.text, atencion: true });
  const pages = [];
  for (let i = 0; i < items.length; i += 6) pages.push({ id: 'sat' + (pages.length + 1), type: 'likert', title: s.titulo, intro: s.instruccion, labels: s.etiquetas, items: items.slice(i, i + 6) });
  const byName = Object.fromEntries(Q.ueq.escalas.map(e => [e.name, e]));
  doc.order.ueq[n].forEach((name, k) => {
    const e = byName[name]; const rows = e.pairs.map(p => ({ id: p.id, left: p.left, right: p.right }));
    if (k === doc.order.atnUeqPage[n]) rows.splice(doc.order.atnUeqRow[n], 0, { id: Q.ueq.atencion.id, left: Q.ueq.atencion.izq, right: Q.ueq.atencion.der, nota: Q.ueq.atencion.instruccion, atencion: true });
    pages.push({ id: 'ueq' + (k + 1), type: 'sd', title: Q.ueq.titulo, intro: Q.ueq.instruccion, lead: e.intro, rows, importance: { id: e.importanceId, text: Q.ueq.importancia.texto, left: Q.ueq.importancia.izq, right: Q.ueq.importancia.der } });
  });
  return pages;
}
function requiredIds(doc, n) {
  const ids = [];
  surveyPages(doc, n).forEach(p => { if (p.type === 'likert') p.items.forEach(i => ids.push([i.id, 1, 5])); else { p.rows.forEach(r => ids.push([r.id, 1, 7])); ids.push([p.importance.id, 1, 7]); } });
  return ids;
}
const toEmbed = url => {
  try { const u = new URL(url); if (/(^|\.)figma\.com$/.test(u.hostname) && !u.hostname.startsWith('embed.')) { u.hostname = 'embed.figma.com'; u.searchParams.set('embed-host', 'experimento-ux'); } return u.toString(); } catch { return url; }
};
module.exports = { CFG, TASKS, CASES, Q, shuffle, nowIso, assignProfile, nextCode, phasesFor, newSession, surveyPages, requiredIds, toEmbed };
