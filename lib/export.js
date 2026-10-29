// Exportación en el mismo formato que los CSV de Google Forms usados en el análisis (analisis_validacion.py).
const { Q } = require('./logic');
const esc = v => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (headers, rows) => '﻿' + [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n') + '\r\n';
const tsLocal = iso => iso ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false }) : '';
const KNOW = ['Nivel de conocimiento en UX', 'Nivel de conocimiento en UI', 'Nivel de conocimiento en usabilidad', 'Experiencia usando sistemas clínicos o médicos'];

function phaseOf(d, version) { return d.phases.find(p => p.version === version); }
function surveyIdx(d, version) { return phaseOf(d, version).n; }
const dur = p => (p && p.startedAt && p.finishedAt) ? (new Date(p.finishedAt) - new Date(p.startedAt)) / 1000 : null;

function satisfaccion(docs, version) {
  const sat = Q.satisfaccion.items;
  const headers = ['Marca temporal', 'Código', ...sat.map(i => 'Sentencias [' + i.text + ']')];
  Q.ueq.escalas.forEach(e => { e.pairs.forEach(p => headers.push(e.name + ': ' + p.left + ' / ' + p.right)); headers.push(e.name + ': ' + Q.ueq.importancia.texto); });
  headers.push('Control atención satisfacción (esperado ' + Q.satisfaccion.atencion.esperado + ')', 'Control atención UEQ+ (esperado ' + Q.ueq.atencion.esperado + ')', 'Segundos en cuestionarios', 'Páginas respondidas con rapidez');
  const rows = docs.map(d => {
    const n = surveyIdx(d, version), sv = d.surveys[n], a = sv.answers;
    const pages = Object.values(sv.pages);
    const row = [tsLocal(sv.completedAt), d.code, ...sat.map(i => a[i.id])];
    Q.ueq.escalas.forEach(e => { e.pairs.forEach(p => row.push(a[p.id])); row.push(a[e.importanceId]); });
    row.push(a[Q.satisfaccion.atencion.id], a[Q.ueq.atencion.id], Math.round(pages.reduce((s, p) => s + (p.ms || 0), 0) / 1000), pages.filter(p => p.fast).length);
    return row;
  });
  return csv(headers, rows);
}
function demografico(docs) {
  const headers = ['Marca temporal', 'Acepto participar voluntariamente', 'Código', 'Sexo', 'Edad', ...KNOW.map(k => 'Indicar el nivel de conocimiento que cuenta con los siguientes temas [' + k + ']')];
  return csv(headers, docs.map(d => { const m = d.demographics || {}; return [tsLocal(d.consent.at), 'Sí', d.code, m.sexo, m.edad, m.ux, m.ui, m.usab, m.clin]; }));
}
function registro(docs) {
  const headers = ['Código', 'Perfil', 'Primera_version', 'Problema_SG', 'Problema_CG', 'Esfuerzo_SG_min', 'Esfuerzo_CG_min', 'Origen', 'Observaciones',
    'Tareas_marcadas_SG', 'Tareas_marcadas_CG', 'Segundos_pestana_oculta_SG', 'Segundos_pestana_oculta_CG', 'Inicio_SG', 'Fin_SG', 'Inicio_CG', 'Fin_CG', 'Intentos_comprension', 'Dispositivo', 'Comentario_final'];
  return csv(headers, docs.map(d => {
    const sg = phaseOf(d, 'SG'), cg = phaseOf(d, 'CG'); const m = x => { const s = dur(x); return s === null ? '' : (s / 60).toFixed(2); };
    const ck = p => Object.values(p.tasks).filter(Boolean).length;
    return [d.code, 'Perfil ' + d.profile, d.phases[0].version, sg.problem, cg.problem, m(sg), m(cg), '', '', ck(sg), ck(cg), Math.round(sg.hiddenSec), Math.round(cg.hiddenSec), sg.startedAt, sg.finishedAt, cg.startedAt, cg.finishedAt,
      d.instructions ? d.instructions.attempts : '', d.client && d.client.ua, d.feedback];
  }));
}
function tareas(docs) {
  const rows = [];
  docs.forEach(d => d.phases.forEach(p => {
    const first = p.startedAt ? new Date(p.startedAt) : null;
    for (let t = 1; t <= 10; t++) {
      const ev = p.taskEvents.filter(e => e.task === t && e.checked).pop();
      rows.push([d.code, p.version, p.n, p.problem, t, p.tasks[t] ? 1 : 0, ev && first ? ((new Date(ev.ts) - first) / 1000).toFixed(1) : '']);
    }
  }));
  return csv(['Código', 'Versión', 'Orden de uso', 'Problema', 'Tarea', 'Marcada', 'Segundos desde el inicio hasta marcarla'], rows);
}
function eventos(docs) {
  const rows = [];
  docs.forEach(d => d.phases.forEach(p => { p.taskEvents.forEach(e => rows.push([d.code, p.version, 'tarea', e.task, e.checked ? 'marcada' : 'desmarcada', e.ts])); p.visEvents.forEach(e => rows.push([d.code, p.version, 'pestaña', '', e.state, e.ts])); }));
  return csv(['Código', 'Versión', 'Tipo', 'Tarea', 'Valor', 'Marca temporal (UTC)'], rows);
}
module.exports = { satisfaccion, demografico, registro, tareas, eventos };
