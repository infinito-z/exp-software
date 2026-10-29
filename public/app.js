(() => {
'use strict';
const $ = s => document.querySelector(s);
const main = $('#main');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let token = null; try { token = localStorage.getItem('exp_token'); } catch (e) {}
let S = null;            // estado enviado por el servidor
let offset = 0;          // servidor - cliente (ms)
let timerId = null, visHandler = null;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, { method, headers: { 'Content-Type': 'application/json', 'x-token': token || '' }, body: body ? JSON.stringify(body) : undefined, keepalive: path.includes('visibility') });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Error de conexión'); e.status = r.status; throw e; }
  return j;
}
function setState(s) { S = s; if (s.serverNow) offset = new Date(s.serverNow).getTime() - Date.now(); render(); }
function confirmBox(text, yes = 'Aceptar', no = 'Cancelar') {
  return new Promise(res => { $('#modal-text').textContent = text; $('#modal-yes').textContent = yes; $('#modal-no').textContent = no; $('#modal').hidden = false;
    const done = v => { $('#modal').hidden = true; $('#modal-yes').onclick = $('#modal-no').onclick = null; res(v); };
    $('#modal-yes').onclick = () => done(true); $('#modal-no').onclick = () => done(false); });
}
const STEPS = ['Consentimiento', 'Tus datos', 'Instrucciones', 'Aplicación 1', 'Cuestionarios 1', 'Aplicación 2', 'Cuestionarios 2', 'Fin'];
const IDX = { consent: 0, demographics: 1, instructions: 2, p1_task: 3, p1_survey: 4, p2_task: 5, p2_survey: 6, done: 7 };
function progress(step) {
  const i = IDX[step] ?? 0; $('#progress').hidden = false;
  $('#bar').style.width = Math.round(((i + 1) / STEPS.length) * 100) + '%';
  $('#steps').innerHTML = STEPS.map((t, k) => `<span class="${k <= i ? 'on' : ''}">${k === i ? t : (window.innerWidth > 700 ? t : '•')}</span>`).join('');
}
function stopTimers() { if (timerId) clearInterval(timerId); timerId = null; if (visHandler) { document.removeEventListener('visibilitychange', visHandler); visHandler = null; } }

function render() {
  stopTimers(); main.className = ''; window.scrollTo(0, 0);
  $('#who').textContent = S && S.code ? 'Participante ' + S.code : '';
  if (!S) return renderConsent();
  progress(S.step);
  if (S.step === 'demographics') return renderDemo();
  if (S.step === 'instructions') return renderInstr();
  if (/^p\d_task$/.test(S.step)) return renderTask();
  if (/^p\d_survey$/.test(S.step)) return renderSurvey();
  if (S.step === 'done') return renderDone();
}

// ---------------------------------------------------------------- consentimiento
async function renderConsent() {
  $('#progress').hidden = true;
  const c = await fetch('/api/consent').then(r => r.json());
  main.innerHTML = `<div class="card"><h1>${esc(c.titulo)}</h1><p class="muted">Consentimiento informado</p>
    ${c.consentimiento.texto.map(p => `<p>${esc(p)}</p>`).join('')}
    <label class="check"><input type="checkbox" id="ok"><span>${esc(c.consentimiento.casilla)}</span></label>
    <div class="err" id="err"></div>
    <div class="row"><button class="btn" id="go" disabled>Comenzar</button></div></div>`;
  $('#ok').onchange = e => { $('#go').disabled = !e.target.checked; };
  $('#go').onclick = async () => {
    $('#go').disabled = true;
    try { const r = await api('start', 'POST', { consent: true, screen: screen.width + 'x' + screen.height, lang: navigator.language }); token = r.token; try { localStorage.setItem('exp_token', token); } catch (e) {} setState(r); }
    catch (e) { $('#err').textContent = e.message; $('#go').disabled = false; }
  };
}

// ---------------------------------------------------------------- demográficos
function selectField(id, label, opts) { return `<label class="field"><span>${label}</span><select id="${id}"><option value="">Selecciona…</option>${opts.map(o => `<option>${o}</option>`).join('')}</select></label>`; }
function renderDemo() {
  const lv = ['Nada', 'Poco', 'Intermedio', 'Alto'];
  main.innerHTML = `<div class="card"><h2>Cuéntanos un poco sobre ti</h2><p class="muted small">Tu código es <b>${esc(S.code)}</b>. No pedimos tu nombre ni tu correo.</p>
    ${selectField('sexo', 'Sexo', ['Hombre', 'Mujer', 'Prefiero no decirlo'])}
    <label class="field"><span>Edad (años)</span><input type="number" id="edad" min="16" max="80"></label>
    <h3>¿Qué nivel de conocimiento tienes en los siguientes temas?</h3>
    ${selectField('ux', 'Conocimiento en UX (experiencia de usuario)', lv)}${selectField('ui', 'Conocimiento en UI (diseño de interfaces)', lv)}${selectField('usab', 'Conocimiento en usabilidad', lv)}
    ${selectField('clin', 'Experiencia usando sistemas clínicos o médicos', lv)}
    <div class="err" id="err"></div><div class="row"><button class="btn" id="go">Continuar</button></div></div>`;
  $('#go').onclick = async () => {
    const b = { sexo: $('#sexo').value, edad: $('#edad').value, ux: $('#ux').value, ui: $('#ui').value, usab: $('#usab').value, clin: $('#clin').value };
    if (Object.values(b).some(v => !v)) return ($('#err').textContent = 'Completa todos los campos.');
    try { setState(await api('demographics', 'POST', b)); } catch (e) { $('#err').textContent = e.message; }
  };
}

// ---------------------------------------------------------------- instrucciones
const QUIZ = [];
function renderInstr() {
  const I = S.instrucciones;
  main.innerHTML = `<div class="card"><h2>Instrucciones</h2>${I.intro.map(p => `<p>${esc(p)}</p>`).join('')}</div>
   <div class="card quiz"><h2>Antes de empezar</h2><p class="muted small">Responde estas tres preguntas para confirmar que leíste las instrucciones.</p>
   ${I.comprension.map((q, i) => `<div class="q"><b>${i + 1}. ${esc(q.pregunta)}</b>${q.opciones.map((o, k) => `<label><input type="radio" name="q${i}" value="${k}"> ${esc(o)}</label>`).join('')}</div>`).join('')}
   <div class="err" id="err"></div><div class="row"><button class="btn" id="go">Continuar</button></div></div>`;
  $('#go').onclick = async () => {
    const ans = I.comprension.map((_, i) => { const r = document.querySelector(`input[name=q${i}]:checked`); return r ? Number(r.value) : null; });
    if (ans.some(a => a === null)) return ($('#err').textContent = 'Responde las tres preguntas.');
    try { const r = await api('instructions', 'POST', { answers: ans }); if (r.ok) setState(r); else $('#err').textContent = 'Alguna respuesta no es correcta. Vuelve a leer las instrucciones e inténtalo de nuevo.'; } catch (e) { $('#err').textContent = e.message; }
  };
}

// ---------------------------------------------------------------- ficha del caso
const dash = v => (v === null || v === undefined || v === '') ? '—' : esc(v);
function caseHtml(c) {
  return `<div class="case"><h4>Propietario</h4><table><tr><th>Nombre</th><td>${dash(c.propietario.nombre)}</td><th>Contacto</th><td>${dash(c.propietario.contacto)}</td></tr>
  <tr><th>Departamento</th><td>${dash(c.propietario.departamento)}</td><th>Distrito</th><td>${dash(c.propietario.distrito)}</td></tr></table>
  <h4>Paciente</h4><table><tr><th>Nombre</th><th>Especie</th><th>Raza</th><th>Edad</th><th>Sexo</th><th>Peso</th></tr><tr>${['nombre', 'especie', 'raza', 'edad', 'sexo', 'peso'].map(k => `<td>${dash(c.paciente[k])}</td>`).join('')}</tr></table>
  <h4>Síntomas observados</h4><table><tr><th>Síntoma</th><th>Severidad</th><th>Frecuencia</th><th>Duración</th></tr>${c.sintomas.map(s => `<tr><td>${dash(s.nombre)}</td><td>${dash(s.severidad)}</td><td>${dash(s.frecuencia)}</td><td>${dash(s.duracion)}</td></tr>`).join('')}</table>
  <h4>Variables clínicas</h4><table><tr><th>Variable</th><th>Valor</th><th>Unidad</th></tr>${c.variables.map(v => `<tr><td>${dash(v.nombre)}</td><td>${dash(v.valor)}</td><td>${dash(v.unidad)}</td></tr>`).join('')}</table>
  ${c.pacienteHistorial ? `<h4>Historial</h4><p class="small">Para consultar el historial, usa el paciente: <b>${esc(c.pacienteHistorial)}</b>.</p>` : ''}</div>`;
}

// ---------------------------------------------------------------- fase de tareas
function fmt(sec) { sec = Math.max(0, Math.floor(sec)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
function renderTask() {
  const P = S.phase, n = P.n;
  if (!P.startedAt) {
    main.innerHTML = `<div class="card"><span class="chip">Aplicación ${n} de 2</span><h2>Caso clínico a resolver</h2>
      <p>Lee con calma la ficha del caso y la lista de tareas. Cuando estés listo, pulsa <b>Comenzar</b>: se iniciará el cronómetro y verás la aplicación junto a las tareas.</p>
      <details class="case" open><summary>Ficha del caso: ${esc(P.caso.titulo)}</summary>${caseHtml(P.caso)}</details>
      <h3>Tareas</h3><ol>${S.tasks.map(t => `<li>${esc(t.texto)}</li>`).join('')}</ol>
      <div class="notice">Haz el caso de una sola vez, sin cambiar de pestaña. Marca cada tarea cuando la termines.</div>
      <div class="err" id="err"></div><div class="row"><button class="btn" id="go">Comenzar</button></div></div>`;
    $('#go').onclick = async () => { $('#go').disabled = true; try { setState(await api('phase/' + n + '/start', 'POST')); } catch (e) { $('#err').textContent = e.message; $('#go').disabled = false; } };
    return;
  }
  main.className = 'wide';
  main.innerHTML = `<div class="work"><aside class="side"><span class="chip">Aplicación ${n} de 2</span><div class="timer" id="timer">00:00</div>
    <div class="notice" id="lim" hidden>Llevas más de ${S.config.limiteSugeridoMin} minutos. Puedes terminar cuando quieras; no pasa nada si no completaste alguna tarea.</div>
    <h3 style="margin-top:6px">Tareas</h3><ul class="tasklist" id="tl">${S.tasks.map(t => `<li data-n="${t.n}" class="${P.tasksDone[t.n] ? 'done' : ''}"><input type="checkbox" ${P.tasksDone[t.n] ? 'checked' : ''}><span class="n">${t.n}.</span><span>${esc(t.texto)}</span></li>`).join('')}</ul>
    <details class="case"><summary>Ficha del caso: ${esc(P.caso.titulo)}</summary>${caseHtml(P.caso)}</details>
    <div class="row" style="justify-content:stretch"><button class="btn ok" id="fin" style="width:100%">Terminé este caso</button></div></aside>
    <section class="stage"><div class="bar2"><span class="muted">Aplicación ${n}</span><a href="${esc(P.urlAbrir)}" target="_blank" rel="noopener" class="small">¿No se ve? Abrir en una pestaña nueva</a></div>
    <iframe id="app" src="${esc(P.url)}" title="Aplicación ${n}" allow="clipboard-write; fullscreen"></iframe></section></div>`;
  const t0 = new Date(P.startedAt).getTime();
  const tick = () => { const el = (Date.now() + offset - t0) / 1000; $('#timer').textContent = fmt(el); $('#lim').hidden = el < S.config.limiteSugeridoMin * 60; };
  tick(); timerId = setInterval(tick, 500);
  document.querySelectorAll('#tl li').forEach(li => {
    li.onclick = async e => {
      const cb = li.querySelector('input'); if (e.target !== cb) cb.checked = !cb.checked;
      li.classList.toggle('done', cb.checked);
      try { await api('phase/' + n + '/task', 'POST', { task: Number(li.dataset.n), checked: cb.checked }); P.tasksDone[li.dataset.n] = cb.checked; } catch (er) { cb.checked = !cb.checked; li.classList.toggle('done', cb.checked); }
    };
  });
  visHandler = () => { api('phase/' + n + '/visibility', 'POST', { state: document.hidden ? 'hidden' : 'visible' }).catch(() => {}); };
  document.addEventListener('visibilitychange', visHandler);
  $('#fin').onclick = async () => {
    const done = Object.values(P.tasksDone).filter(Boolean).length;
    const msg = done < S.tasks.length ? `Marcaste ${done} de ${S.tasks.length} tareas. ¿Quieres terminar este caso de todos modos?` : '¿Confirmas que terminaste este caso?';
    if (!await confirmBox(msg, 'Sí, terminé', 'Seguir')) return;
    try { setState(await api('phase/' + n + '/finish', 'POST')); } catch (e) { alert(e.message); }
  };
}

// ---------------------------------------------------------------- cuestionarios
function firstPendingPage() {
  return S.pages.findIndex(p => { const ids = p.type === 'likert' ? p.items.map(i => i.id) : [...p.rows.map(r => r.id), p.importance.id]; return ids.some(id => !(id in S.answers)); });
}
function renderSurvey() {
  const n = Number(S.step[1]); let k = firstPendingPage();
  if (k === -1) { api('survey/' + n + '/complete', 'POST').then(setState).catch(e => { main.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }); main.innerHTML = '<div class="card">Guardando…</div>'; return; }
  const pg = S.pages[k], t0 = Date.now(); const ans = {}; let warned = false, fast = false;
  const total = S.pages.length;
  const head = `<div class="card ${pg.type === 'likert' ? 'likert' : 'sd'}"><span class="chip">Aplicación ${n} · página ${k + 1} de ${total}</span><h2 style="margin-top:8px">${esc(pg.title)}</h2><p class="muted small">${esc(pg.intro)}</p>`;
  let body = '';
  if (pg.type === 'likert') {
    body = pg.items.map(it => `<div class="item" data-id="${it.id}"><div class="t">${esc(it.text)}</div><div class="scale">${pg.labels.map((lb, i) => `<label class="pill"><input type="radio" name="${it.id}" value="${i + 1}"><b>${i + 1}</b>${esc(lb)}</label>`).join('')}</div></div>`).join('');
  } else {
    body = `<div class="lead">${esc(pg.lead)}</div>` + pg.rows.map(r => `<div class="item" data-id="${r.id}">${r.nota ? `<div class="nota">${esc(r.nota)}</div>` : ''}<div class="scale"><div class="end l">${esc(r.left)}</div>${[1, 2, 3, 4, 5, 6, 7].map(v => `<label class="pill"><input type="radio" name="${r.id}" value="${v}"><b>${v}</b></label>`).join('')}<div class="end r">${esc(r.right)}</div></div></div>`).join('')
      + `<div class="item imp" data-id="${pg.importance.id}"><div class="t">${esc(pg.importance.text)}</div><div class="scale"><div class="end l">${esc(pg.importance.left)}</div>${[1, 2, 3, 4, 5, 6, 7].map(v => `<label class="pill"><input type="radio" name="${pg.importance.id}" value="${v}"><b>${v}</b></label>`).join('')}<div class="end r">${esc(pg.importance.right)}</div></div></div>`;
  }
  const ids = [...document.createRange().createContextualFragment(body).querySelectorAll('.item')].map(e => e.dataset.id);
  main.innerHTML = head + body + `<div class="notice" id="warn" hidden>Respondiste muy rápido. Tómate un momento para leer cada afirmación; si ya las leíste, puedes continuar.</div><div class="err" id="err"></div><div class="row"><button class="btn" id="next" disabled>${k + 1 === total ? 'Finalizar cuestionarios' : 'Siguiente'}</button></div></div>`;
  main.querySelectorAll('input[type=radio]').forEach(r => r.onchange = () => {
    ans[r.name] = Number(r.value);
    main.querySelectorAll(`input[name="${r.name}"]`).forEach(x => x.parentElement.classList.toggle('sel', x.checked));
    $('#next').disabled = ids.some(id => !(id in ans));
  });
  $('#next').onclick = async () => {
    const ms = Date.now() - t0; const minMs = S.config.minSegundosPorItem * 1000 * ids.length;
    if (ms < minMs && !warned) { warned = true; fast = true; $('#warn').hidden = false; $('#next').textContent = 'Continuar de todos modos'; return; }
    $('#next').disabled = true;
    try { await api('survey/' + n + '/page', 'POST', { pageId: pg.id, answers: ans, ms, fast }); Object.assign(S.answers, ans); renderSurvey(); }
    catch (e) { $('#err').textContent = e.message; $('#next').disabled = false; }
  };
}

// ---------------------------------------------------------------- fin
function renderDone() {
  main.innerHTML = `<div class="card"><h1>¡Gracias por participar!</h1><p>Completaste toda la sesión. Tus respuestas quedaron guardadas con el código <b>${esc(S.code)}</b>.</p>
    <p class="muted">Si quieres, cuéntanos si algo te costó especialmente o si algo te gustó (opcional).</p><textarea id="fb" maxlength="2000"></textarea>
    <div class="notice">Por favor, no comentes los detalles del estudio con otras personas que aún no han participado.</div>
    <div class="row"><button class="btn" id="sv">Enviar comentario</button></div><div class="small muted" id="ok"></div></div>`;
  $('#sv').onclick = async () => { try { await api('feedback', 'POST', { comment: $('#fb').value }); $('#ok').textContent = 'Comentario enviado. Ya puedes cerrar esta ventana.'; $('#sv').disabled = true; } catch (e) { $('#ok').textContent = e.message; } };
  try { localStorage.removeItem('exp_token'); } catch (e) {}
}

// ---------------------------------------------------------------- arranque
(async () => {
  if (token) { try { setState(await api('state')); return; } catch (e) { token = null; try { localStorage.removeItem('exp_token'); } catch (x) {} } }
  S = null; render();
})();
})();
