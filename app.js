/* =====================================================================
   LUVX · Negocio y Taller
   App web instalable. Datos en Firebase (o en el aparato en modo prueba).
   ===================================================================== */
'use strict';

// ---------- Datos en memoria ----------
const COLS = ['productos', 'proveedores', 'clientes', 'compras', 'ventas', 'ajustes', 'personas', 'prendas', 'registros', 'config'];
const S = {}; COLS.forEach(c => S[c] = []);
let cache = {};
let backend = null, listoDatos = false, modoPrueba = false, usuario = null;
let F = null; // formulario abierto
const UI = { vista: 'inicio', ref: null, buscar: '', cat: '', kfiltro: 'stock', rep: { modo: 'semana', desde: '', hasta: '' } };

// ---------- Utilidades ----------
const DIA = 86400000;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
const aT = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const aS = t => new Date(t).toISOString().slice(0, 10);
const masDias = (s, n) => aS(aT(s) + n * DIA);
const hoy = () => { const n = new Date(); return aS(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
const fCorta = s => { const [, m, d] = s.split('-'); return `${d}/${m}`; };
const fLarga = s => { const [y, m, d] = s.split('-'); return `${+d} ${MESES[+m - 1]} ${y}`; };
const diaSem = s => DIAS[new Date(aT(s)).getUTCDay()];
const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const sol = n => 'S/ ' + r2(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = n => { n = +n || 0; return Number.isInteger(n) ? String(n) : r2(n).toLocaleString('es-PE', { maximumFractionDigits: 2 }); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const copia = o => JSON.parse(JSON.stringify(o));
const $ = id => document.getElementById(id);
const porId = (col, id) => S[col].find(x => x.id === id);
const enRango = (f, a, b) => f >= a && f <= b;

function aviso(t) {
  const el = $('aviso'); el.textContent = t; el.classList.remove('oculto');
  clearTimeout(aviso._t); aviso._t = setTimeout(() => el.classList.add('oculto'), 2600);
}

// ---------- Configuración y semanas ----------
function CFG() { return S.config.find(c => c.id === 'general') || { id: 'general', diaInicio: 6, semanasEditadas: [] }; }

/* Devuelve la semana a la que pertenece una fecha.
   Las semanas editadas mandan; la semana que sigue a una editada arranca al día siguiente de su cierre. */
function semanaDe(f) {
  const cfg = CFG(); const di = cfg.diaInicio ?? 6;
  const eds = (cfg.semanasEditadas || []).slice().sort((a, b) => a.inicio < b.inicio ? -1 : 1);
  for (const e of eds) if (e.inicio <= f && f <= e.fin) return { inicio: e.inicio, fin: e.fin, editada: true };
  const wd = new Date(aT(f)).getUTCDay();
  let ini = masDias(f, -((wd - di + 7) % 7)), fin = masDias(ini, 6);
  const prev = eds.filter(e => e.fin < f).pop(); if (prev && ini <= prev.fin) ini = masDias(prev.fin, 1);
  const sig = eds.find(e => e.inicio > f); if (sig && fin >= sig.inicio) fin = masDias(sig.inicio, -1);
  return { inicio: ini, fin, editada: false };
}
const SEM = () => semanaDe(UI.ref || hoy());
function textoSemana(s) { return `${fCorta(s.inicio)} – ${fCorta(s.fin)}`; }
function fechaPorDefecto() { const s = SEM(), h = hoy(); return enRango(h, s.inicio, s.fin) ? h : s.fin < h ? s.fin : s.inicio; }

// ---------- Almacenamiento: modo prueba (solo este aparato) ----------
const Local = {
  clave: 'luvx_datos_v1',
  async iniciar(listo) {
    let d = {}; try { d = JSON.parse(localStorage.getItem(this.clave) || '{}'); } catch (e) { }
    COLS.forEach(c => S[c] = d[c] || []); listo();
  },
  guardarTodo() { const d = {}; COLS.forEach(c => d[c] = S[c]); localStorage.setItem(this.clave, JSON.stringify(d)); },
  poner(col, o) { const a = S[col]; const i = a.findIndex(x => x.id === o.id); if (i >= 0) a[i] = o; else a.push(o); },
  async guardar(col, o) { this.poner(col, copia(o)); this.guardarTodo(); cambiaron(); },
  async borrar(col, id) { S[col] = S[col].filter(x => x.id !== id); this.guardarTodo(); cambiaron(); },
  async cargarVarios(lotes) { lotes.forEach(([col, o]) => this.poner(col, copia(o))); this.guardarTodo(); cambiaron(); }
};

// ---------- Almacenamiento: Firebase (celular + PC sincronizados) ----------
const FB_VER = '10.12.2';
const Nube = {
  async preparar() {
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
    const [a, au, fs] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
    this.m = { ...a, ...au, ...fs };
    const app = a.initializeApp(window.FIREBASE_CONFIG);
    this.auth = au.getAuth(app);
    try { this.db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
    catch (e) { this.db = fs.getFirestore(app); }
  },
  alCambiarSesion(cb) { this.m.onAuthStateChanged(this.auth, cb); },
  async entrar() {
    const p = new this.m.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    try { await this.m.signInWithPopup(this.auth, p); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) await this.m.signInWithRedirect(this.auth, p);
      else throw e;
    }
  },
  salir() { return this.m.signOut(this.auth); },
  async iniciar(listo) {
    const pend = new Set(COLS);
    this.quitar = COLS.map(c => this.m.onSnapshot(this.m.collection(this.db, 'usuarios', usuario.uid, c), snap => {
      S[c] = snap.docs.map(d => d.data());
      pend.delete(c);
      if (pend.size === 0) { if (!this.listo) { this.listo = true; listo(); } else cambiaron(); }
    }, err => aviso('No se pudo leer: ' + err.message)));
  },
  ref(col, id) { return this.m.doc(this.db, 'usuarios', usuario.uid, col, id); },
  async guardar(col, o) { this.m.setDoc(this.ref(col, o.id), copia(o)).catch(e => aviso('No se guardó: ' + e.message)); },
  async borrar(col, id) { this.m.deleteDoc(this.ref(col, id)).catch(e => aviso('No se borró: ' + e.message)); },
  async cargarVarios(lotes) {
    for (let i = 0; i < lotes.length; i += 400) {
      const b = this.m.writeBatch(this.db);
      lotes.slice(i, i + 400).forEach(([col, o]) => b.set(this.ref(col, o.id), copia(o)));
      await b.commit();
    }
  }
};

function cambiaron() { cache = {}; if (listoDatos) render(); }
const guardar = (col, o) => backend.guardar(col, o);
const borrar = (col, id) => backend.borrar(col, id);

// ---------- Arranque ----------
async function arrancar() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
  const c = window.FIREBASE_CONFIG || {};
  if (!c.apiKey || /PEGAR/i.test(c.apiKey)) {
    modoPrueba = true; backend = Local; await Local.iniciar(datosListos); return;
  }
  backend = Nube;
  try { await Nube.preparar(); }
  catch (e) { pantalla(`<div class="logo">LUVX</div><p>No se pudo conectar. Revisa tu internet y vuelve a abrir la app.</p><p class="ayuda">${esc(e.message)}</p>`); return; }
  Nube.alCambiarSesion(u => {
    if (!u) { (Nube.quitar || []).forEach(f => f()); Nube.listo = false; usuario = null; listoDatos = false; pantallaEntrar(); return; }
    usuario = u; pantalla('<div class="logo">LUVX</div><p>Cargando tus datos…</p>');
    Nube.iniciar(datosListos);
  });
}
function pantalla(html) { $('app').innerHTML = `<div class="pantalla-centro">${html}</div>`; }
function pantallaEntrar() {
  pantalla(`<div class="logo">LUVX</div><p>Negocio y Taller</p>
    <button class="btn pri" onclick="entrar()">Entrar con mi cuenta de Google</button>
    <p class="ayuda" id="err-login"></p>`);
}
async function entrar() { try { await Nube.entrar(); } catch (e) { const el = $('err-login'); if (el) el.textContent = 'No se pudo entrar: ' + e.message; } }
function datosListos() {
  listoDatos = true; cache = {};
  render();
  if (!S.productos.length && !S.prendas.length && !S.personas.length && window.DATOS_INICIALES) ofrecerCarga();
}

// ---------- Carga de los datos de los Excel ----------
function ofrecerCarga() {
  if (!window.DATOS_INICIALES) return aviso('Los datos de los Excel ya no están en la app (se quitaron por privacidad).');
  abrirModal('Cargar tus datos', `
    <p>Puedo copiar a la app lo que ya tienes en tus Excel:</p>
    <ul><li>144 productos, proveedores y clientes</li><li>Compras y ventas registradas</li><li>Costureros, prendas, operaciones y precios</li><li>Registros del taller</li></ul>
    <p class="ayuda">Si ya los cargaste antes, no se duplican: solo se vuelven a poner igual que en el Excel.</p>`,
    `<button class="btn" onclick="cerrarModal()">Ahora no</button><button class="btn pri" onclick="cargarExcel()">Cargar datos</button>`);
}
async function cargarExcel() {
  const d = copia(window.DATOS_INICIALES); const lotes = [];
  COLS.forEach(c => {
    if (!d[c]) return;
    let arr = Array.isArray(d[c]) ? d[c] : [d[c]];
    if (c === 'config') { const actual = S.config.find(x => x.id === 'general'); if (actual) return; }
    arr.forEach(o => { delete o._excelPago; lotes.push([c, o]); });
  });
  cerrarModal(); aviso('Cargando datos…');
  try { await backend.cargarVarios(lotes); aviso('Listo: datos cargados ✓'); } catch (e) { aviso('Error: ' + e.message); }
}

// =====================================================================
//  CÁLCULOS DEL NEGOCIO (inventario con costo promedio)
// =====================================================================
const totalLinea = l => (+l.cantidad || 0) * (+l.precio || 0) - (+l.descuento || 0);
function inventario() {
  if (cache.inv) return cache.inv;
  const movs = [];
  S.compras.forEach(c => (c.lineas || []).forEach((l, i) => movs.push({ f: c.fecha, o: 0, tipo: c.inicial ? 'Stock inicial' : 'Compra', doc: c, col: 'compras', pid: l.productoId, q: +l.cantidad, v: totalLinea(l), key: c.id + '#' + i })));
  S.ajustes.forEach(a => movs.push({ f: a.fecha, o: 1, tipo: 'Ajuste · ' + a.motivo, doc: a, col: 'ajustes', pid: a.productoId, q: +a.diferencia, key: a.id }));
  S.ventas.forEach(v => (v.lineas || []).forEach((l, i) => movs.push({ f: v.fecha, o: 2, tipo: 'Venta', doc: v, col: 'ventas', pid: l.productoId, q: -l.cantidad, key: v.id + '#' + i })));
  movs.sort((a, b) => a.f < b.f ? -1 : a.f > b.f ? 1 : a.o - b.o);
  const st = {}, costoVenta = {}, porProd = {};
  for (const m of movs) {
    const s = st[m.pid] || (st[m.pid] = { q: 0, v: 0, prom: 0 });
    if (m.o === 0) { s.q += m.q; s.v += m.v; if (s.q > 0) s.prom = s.v / s.q; else if (m.q) s.prom = m.v / m.q; }
    else { m.v = m.q * s.prom; s.q += m.q; s.v += m.v; if (m.o === 2) costoVenta[m.key] = s.prom; }
    if (Math.abs(s.q) < 1e-9) { s.q = 0; s.v = 0; }
    m.sq = s.q; m.sv = s.v; m.prom = s.prom;
    (porProd[m.pid] || (porProd[m.pid] = [])).push(m);
  }
  return cache.inv = { movs, st, costoVenta, porProd };
}
function stockA(pid, fecha) { // existencia y valor al cierre de una fecha
  const l = inventario().porProd[pid] || []; let r = { q: 0, v: 0, prom: 0 };
  for (const m of l) { if (m.f > fecha) break; r = { q: m.sq, v: m.sv, prom: m.prom }; }
  return r;
}
const stockHoy = pid => inventario().st[pid] || { q: 0, v: 0, prom: 0 };
function lineasVenta(a, b) {
  const inv = inventario(), out = [];
  S.ventas.filter(v => enRango(v.fecha, a, b)).forEach(v => (v.lineas || []).forEach((l, i) => {
    const p = porId('productos', l.productoId) || { nombre: '(borrado)', categoria: '-' };
    const cu = inv.costoVenta[v.id + '#' + i] || 0, tot = totalLinea(l);
    out.push({ v, l, p, fecha: v.fecha, q: +l.cantidad, total: tot, costo: cu * l.cantidad, gan: tot - cu * l.cantidad });
  }));
  return out;
}
const totalDoc = d => (d.lineas || []).reduce((s, l) => s + totalLinea(l), 0);
function resumenVentas(a, b) {
  const ls = lineasVenta(a, b);
  return { ventas: ls.reduce((s, x) => s + x.total, 0), costo: ls.reduce((s, x) => s + x.costo, 0), gan: ls.reduce((s, x) => s + x.gan, 0), unid: ls.reduce((s, x) => s + x.q, 0), ls };
}
const comprasEntre = (a, b) => S.compras.filter(c => !c.inicial && enRango(c.fecha, a, b));

// =====================================================================
//  CÁLCULOS DEL TALLER
// =====================================================================
const MAQ = { recta: 'Recta', remalle: 'Remalle', completa: 'Prenda completa' };
const TIPO = { todo: 'Todo completo', menos: 'Todo menos…', solo: 'Solo estas operaciones' };
function precioOp(op, fecha) {
  const ps = (op.precios || []).slice().sort((a, b) => a.desde < b.desde ? -1 : 1);
  let v = ps.length ? ps[0].valor : 0;
  for (const p of ps) if (p.desde <= fecha) v = p.valor;
  return +v || 0;
}
const opVigente = (op, fecha) => (!op.desde || op.desde <= fecha) && (!op.quitadaDesde || op.quitadaDesde > fecha);
function universo(prenda, maquina, fecha) {
  if (!prenda) return [];
  return prenda.ops.filter(o => (maquina === 'completa' || o.maquina === maquina) && opVigente(o, fecha));
}
function opsHechas(r, prenda) {
  prenda = prenda || porId('prendas', r.prendaId);
  const u = universo(prenda, r.maquina, r.fecha), marc = new Set(r.ops || []);
  if (r.tipo === 'todo') return u;
  if (r.tipo === 'menos') return u.filter(o => !marc.has(o.id));
  return (prenda ? prenda.ops : []).filter(o => marc.has(o.id));
}
function pagoUnit(r) { return opsHechas(r).reduce((s, o) => s + precioOp(o, r.fecha), 0); }
const pagoReg = r => r2(pagoUnit(r) * (+r.cantidad || 0));
function textoOps(r) {
  const prenda = porId('prendas', r.prendaId);
  const nombres = (r.ops || []).map(id => (prenda?.ops.find(o => o.id === id) || {}).nombre).filter(Boolean);
  if (r.tipo === 'todo') return 'Todo completo';
  if (r.tipo === 'menos') return 'Todo menos: ' + (nombres.join(', ') || '—');
  return 'Solo: ' + (nombres.join(', ') || '—');
}
// Persona que completa lo que falta en los trabajos de los demás (por defecto "YO")
function idCompleta() {
  const c = CFG();
  if (c.completaId !== undefined) { const p = porId('personas', c.completaId); return p && p.activo !== false ? p.id : ''; }
  const yo = S.personas.find(p => p.activo !== false && p.nombre.trim().toLowerCase() === 'yo');
  return yo ? yo.id : '';
}
// Lo que falta de la prenda en un registro, separado en recta y remalle, para anotarlo a quien completa
function etqOpPrenda(p) { return p && /baggy/i.test(p.nombre) ? p.ops.find(o => /etiqueta/i.test(o.nombre)) : null; }
function partesFaltantes(r) {
  const p = porId('prendas', r.prendaId), quien = idCompleta();
  if (!p || !quien) return [];
  const etq = r.sinEtiqueta ? etqOpPrenda(p) : null; // prenda sin etiqueta: esa operación no la hace nadie
  const hechas = new Set(opsHechas(r, p).map(o => o.id)), out = [];
  for (const [m, suf] of [['recta', 'a'], ['remalle', 'b']]) {
    const u = universo(p, m, r.fecha), falt = u.filter(o => !hechas.has(o.id) && !(etq && o.id === etq.id));
    if (!falt.length) continue;
    const todo = falt.length === u.length && !(etq && u.some(o => o.id === etq.id));
    out.push({ id: r.id + '_' + suf, personaId: quien, fecha: r.fecha, prendaId: r.prendaId, productoId: r.productoId || '', cantidad: +r.cantidad, maquina: m, tipo: todo ? 'todo' : 'solo', ops: todo ? [] : falt.map(o => o.id), origenId: r.id, creado: (r.creado || 0) + 1 });
  }
  return out;
}
// Trabajos que entre la persona y YO cubren toda la prenda: no dejan remalle pendiente
function gruposCompletos() {
  if (cache.grupos) return cache.grupos;
  const excl = new Set();
  S.registros.filter(r => r.completar).forEach(r => {
    const hijos = S.registros.filter(x => x.origenId === r.id), p = porId('prendas', r.prendaId);
    if (!hijos.length || !p) return;
    const todos = [r, ...hijos];
    if (todos.some(x => +x.cantidad !== +r.cantidad || x.prendaId !== r.prendaId)) return;
    const hechas = new Set(todos.flatMap(x => opsHechas(x, p).map(o => o.id)));
    const etq = r.sinEtiqueta ? etqOpPrenda(p) : null;
    if (universo(p, 'completa', r.fecha).every(o => hechas.has(o.id) || (etq && o.id === etq.id))) todos.forEach(x => excl.add(x.id));
  });
  return cache.grupos = excl;
}
function remallePendiente(hasta) {
  const excl = gruposCompletos();
  return S.prendas.map(p => {
    const regs = S.registros.filter(r => r.prendaId === p.id && r.fecha <= hasta && !excl.has(r.id));
    const listas = regs.filter(r => r.maquina === 'recta' && (r.tipo === 'todo' || r.tipo === 'menos')).reduce((s, r) => s + +r.cantidad, 0);
    const rem = regs.filter(r => r.maquina === 'remalle');
    const det = universo(p, 'remalle', hasta).map(o => {
      const hechas = rem.filter(r => opsHechas(r, p).some(x => x.id === o.id)).reduce((s, r) => s + +r.cantidad, 0);
      const faltan = Math.max(0, listas - hechas), pu = precioOp(o, hasta);
      return { op: o, hechas, faltan, pu, pago: faltan * pu };
    });
    return { prenda: p, listas, det, pago: det.reduce((s, d) => s + d.pago, 0), faltanMax: det.reduce((m, d) => Math.max(m, d.faltan), 0) };
  });
}
const personasActivas = () => S.personas.filter(p => p.activo !== false).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));

// =====================================================================
//  PANTALLA PRINCIPAL
// =====================================================================
const GRUPOS = {
  negocio: [['ventas', 'Ventas'], ['compras', 'Compras'], ['productos', 'Productos'], ['kardex', 'Kardex'], ['reportes', 'Reportes']],
  mas: [['mas', 'Menú'], ['clientes', 'Clientes'], ['proveedores', 'Proveedores'], ['ajustes', 'Ajustes de stock'], ['config', 'Configuración']]
};
function grupoDe(v) {
  if (v === 'inicio') return 'inicio';
  if (GRUPOS.negocio.some(x => x[0] === v)) return 'negocio';
  if (v.startsWith('t:') || ['tresumen', 'remalle', 'prendas', 'personas'].includes(v)) return 'taller';
  return 'mas';
}
function ir(v) { UI.vista = v; if (v !== 'productos') UI.buscar = ''; render(); window.scrollTo(0, 0); }
function irGrupo(g) {
  if (g === 'inicio') return ir('inicio');
  if (g === 'negocio') return ir(UI.ultNeg || 'ventas');
  if (g === 'taller') { const p = personasActivas()[0]; return ir(UI.ultTaller || (p ? 't:' + p.id : 'tresumen')); }
  ir('mas');
}
function semAnterior() { UI.ref = masDias(SEM().inicio, -1); render(); }
function semSiguiente() { UI.ref = masDias(SEM().fin, 1); render(); }
function semHoy() { UI.ref = null; render(); }

function render() {
  if (!listoDatos) return;
  const g = grupoDe(UI.vista);
  if (g === 'negocio') UI.ultNeg = UI.vista;
  if (g === 'taller') UI.ultTaller = UI.vista;
  const s = SEM(), esActual = enRango(hoy(), s.inicio, s.fin);
  let sub = '';
  if (g === 'negocio') sub = subtabs(GRUPOS.negocio);
  if (g === 'taller') sub = subtabs([...personasActivas().map(p => ['t:' + p.id, p.nombre]), ['tresumen', 'Resumen semana'], ['remalle', 'Remalle pendiente'], ['prendas', 'Prendas y precios'], ['personas', 'Personas']]);
  const titulos = { inicio: 'Resumen', negocio: 'Negocio', taller: 'Taller', mas: 'Más' };
  $('app').innerHTML = `
    <div class="barra"><div class="barra-fila">
      <h1>${titulos[g]}</h1>${!esActual ? '<button class="hoy" onclick="semHoy()">Hoy</button>' : ''}
      <div class="semana">
        <button onclick="semAnterior()" aria-label="Semana anterior">◀</button>
        <div class="rango" onclick="formSemana()">${textoSemana(s)}<small>${esActual ? 'esta semana' : 'toca para editar'}${s.editada ? ' ✎' : ''}</small></div>
        <button onclick="semSiguiente()" aria-label="Semana siguiente">▶</button>
      </div>
    </div></div>
    ${modoPrueba ? '<div class="prueba">Modo prueba: los datos se guardan solo en este aparato. Cuando conectes Firebase se sincronizarán celular y PC.</div>' : ''}
    ${sub}
    <main id="principal">${vista()}</main>
    ${botonFlotante()}
    <nav class="nav">
      ${[['inicio', '🏠', 'Resumen'], ['negocio', '🛍️', 'Negocio'], ['taller', '🧵', 'Taller'], ['mas', '☰', 'Más']].map(([k, ic, t]) => `<button class="${g === k ? 'act' : ''}" onclick="irGrupo('${k}')"><span>${ic}</span>${t}</button>`).join('')}
    </nav>`;
  llenarListas();
}
function subtabs(items) { return `<div class="subtabs">${items.map(([v, t]) => `<button class="${UI.vista === v ? 'act' : ''}" onclick="ir('${v}')">${esc(t)}</button>`).join('')}</div>`; }
function botonFlotante() {
  const v = UI.vista;
  const b = (t, f) => `<button class="flotante" onclick="${f}">${t}</button>`;
  if (v === 'ventas') return b('+ Venta', 'formVenta()');
  if (v === 'compras') return b('+ Compra', 'formCompra()');
  if (v === 'productos') return b('+ Producto', 'formProducto()');
  if (v.startsWith('t:')) return b('+ Registro', `formRegistro(null,'${v.slice(2)}')`);
  if (v === 'clientes') return b('+ Cliente', 'formContacto("clientes")');
  if (v === 'proveedores') return b('+ Proveedor', 'formContacto("proveedores")');
  if (v === 'ajustes') return b('+ Ajuste', 'formAjuste()');
  if (v === 'prendas') return b('+ Prenda', 'formNuevaPrenda()');
  if (v === 'personas') return b('+ Persona', 'formPersona()');
  return '';
}
function llenarListas() {
  const dl = $('dl-prod'); const h = S.productos.slice().sort(ordenProd).map(p => `<option value="${esc(p.codigo + ' · ' + p.nombre)}"></option>`).join('');
  if (llenarListas.h !== h) { dl.innerHTML = h; llenarListas.h = h; }
  $('dl-cat').innerHTML = categorias().map(c => `<option value="${esc(c)}"></option>`).join('');
}
const ordenProd = (a, b) => (+a.codigo || 0) - (+b.codigo || 0) || a.nombre.localeCompare(b.nombre);
const categorias = () => [...new Set(S.productos.map(p => p.categoria).filter(Boolean))].sort();

function vista() {
  const v = UI.vista;
  if (v === 'inicio') return vInicio();
  if (v === 'ventas') return vDocs('ventas');
  if (v === 'compras') return vDocs('compras');
  if (v === 'productos') return vProductos();
  if (v === 'kardex') return vKardex();
  if (v === 'reportes') return vReportes();
  if (v.startsWith('t:')) return vPersona(v.slice(2));
  if (v === 'tresumen') return vTallerResumen();
  if (v === 'remalle') return vRemalle();
  if (v === 'prendas') return vPrendas();
  if (v === 'personas') return vPersonas();
  if (v === 'clientes' || v === 'proveedores') return vContactos(v);
  if (v === 'ajustes') return vAjustes();
  if (v === 'config') return vConfig();
  return vMas();
}
const cifra = (et, val, cls = '', clic = '') => `<div class="cifra ${clic ? 'clic' : ''}" ${clic ? `onclick="${clic}"` : ''}><div class="et">${et}</div><div class="val ${cls}">${val}</div></div>`;

// ---------- Resumen ----------
function vInicio() {
  const s = SEM(), rv = resumenVentas(s.inicio, s.fin);
  const compras = comprasEntre(s.inicio, s.fin).reduce((t, c) => t + totalDoc(c), 0);
  const regs = S.registros.filter(r => enRango(r.fecha, s.inicio, s.fin));
  const pagar = regs.reduce((t, r) => t + pagoReg(r), 0);
  const rp = remallePendiente(s.fin).reduce((t, x) => t + x.pago, 0);
  const valorInv = S.productos.reduce((t, p) => t + stockA(p.id, s.fin).v, 0);
  return `
    <h2>Semana del ${fLarga(s.inicio)} al ${fLarga(s.fin)}</h2>
    <h3>Negocio</h3>
    <div class="cifras">
      ${cifra('Ventas', sol(rv.ventas), '', "ir('ventas')")}
      ${cifra('Ganancia', sol(rv.gan), rv.gan >= 0 ? 'pos' : 'neg', "ir('reportes')")}
      ${cifra('Compras', sol(compras), '', "ir('compras')")}
      ${cifra('Valor del inventario', sol(valorInv), '', "ir('kardex')")}
    </div>
    <h3>Taller</h3>
    <div class="cifras">
      ${cifra('A pagar esta semana', sol(pagar), '', "ir('tresumen')")}
      ${cifra('Prendas registradas', num(prendasReales(regs)), '', "ir('tresumen')")}
      ${cifra('Remalle pendiente', sol(rp), '', "ir('remalle')")}
      ${cifra('Registros', gruposDe(regs).length, '', "ir('tresumen')")}
    </div>
    <div class="acciones">
      <button class="btn pri" onclick="formVenta()">+ Venta</button>
      <button class="btn" onclick="formCompra()">+ Compra</button>
      ${personasActivas().map(p => `<button class="btn" onclick="formRegistro(null,'${p.id}')">+ Taller: ${esc(p.nombre)}</button>`).join('')}
    </div>`;
}

// ---------- Ventas y compras ----------
function vDocs(col) {
  const s = SEM(), esV = col === 'ventas';
  const docs = S[col].filter(d => enRango(d.fecha, s.inicio, s.fin)).sort((a, b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0);
  const inv = inventario();
  let tot = 0, gan = 0;
  const filas = docs.map(d => {
    const t = totalDoc(d); tot += t;
    let extra = '';
    if (esV) { const c = (d.lineas || []).reduce((x, l, i) => x + (inv.costoVenta[d.id + '#' + i] || 0) * l.cantidad, 0); gan += t - c; extra = `<small class="${t - c >= 0 ? 'pos' : 'neg'}">ganancia ${sol(t - c)}</small>`; }
    const quien = esV ? porId('clientes', d.clienteId)?.nombre : d.inicial ? 'Stock inicial' : porId('proveedores', d.proveedorId)?.nombre;
    const unid = (d.lineas || []).reduce((x, l) => x + +l.cantidad, 0);
    return `<div class="fila" onclick="${esV ? 'formVenta' : 'formCompra'}('${d.id}')">
      <div class="cuerpo"><div class="tit">${fCorta(d.fecha)} · ${esc(quien || 'Sin nombre')}</div>
      <div class="sub">${d.factura ? 'N° ' + esc(d.factura) + ' · ' : ''}${num(unid)} unid. · ${(d.lineas || []).length} productos${d.comentario ? ' · ' + esc(d.comentario) : ''}</div></div>
      <div class="der"><span class="monto">${sol(t)}</span>${extra}</div></div>`;
  }).join('');
  return `<div class="cifras">${cifra(esV ? 'Ventas de la semana' : 'Compras de la semana', sol(tot))}${esV ? cifra('Ganancia', sol(gan), gan >= 0 ? 'pos' : 'neg') : cifra('Documentos', docs.length)}</div>
    <div class="lista">${filas || `<div class="vacio">No hay ${col} en esta semana.</div>`}</div>`;
}
function formVenta(id) { formDoc('ventas', id); }
function formCompra(id) { formDoc('compras', id); }
function formDoc(col, id) {
  const esV = col === 'ventas';
  const d = id ? copia(porId(col, id)) : { id: nid(), fecha: fechaPorDefecto(), factura: '', comentario: '', lineas: [], ...(esV ? { clienteId: '' } : { proveedorId: '' }) };
  if (!d.lineas.length) d.lineas.push({ productoId: '', cantidad: 1, precio: 0, descuento: 0 });
  F = { col, d, nuevo: !id, modoDoc: 'prenda', dr: { color: '', precio: '', q: {} } };
  const contactos = esV ? S.clientes : S.proveedores, campo = esV ? 'clienteId' : 'proveedorId';
  const cuerpo = `
    <div class="dos">
      <div class="campo"><label>Fecha</label><input type="date" value="${d.fecha}" onchange="F.d.fecha=this.value;pintarLineas()"></div>
      <div class="campo"><label>N° de documento (opcional)</label><input value="${esc(d.factura)}" oninput="F.d.factura=this.value"></div>
    </div>
    ${d.inicial ? '<div class="nota">Este es el stock con el que se creó el producto.</div>' : `
    <div class="campo"><label>${esV ? 'Cliente' : 'Proveedor'}</label>
      <select onchange="if(this.value==='__nuevo'){nuevoContactoRapido('${esV ? 'clientes' : 'proveedores'}',this)}else F.d.${campo}=this.value">
        <option value="">— Sin nombre —</option>
        ${contactos.map(c => `<option value="${c.id}" ${c.id === d[campo] ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
        <option value="__nuevo">+ Agregar nuevo…</option>
      </select></div>`}
    <h3>Productos</h3>
    <div id="lineas"></div>
    <div class="campo"><label>Cómo agregar</label><div class="seg" id="doc-modo"></div></div>
    <div id="rollo-doc"></div>
    <button class="btn ancho" id="btn-add-linea" onclick="agregarLinea()">+ Agregar producto</button>
    <div class="calc" style="margin-top:12px"><span>Total</span><b id="doc-total"></b></div>
    <div class="campo"><label>Comentario (opcional)</label><input value="${esc(d.comentario || '')}" oninput="F.d.comentario=this.value"></div>`;
  abrirModal((id ? 'Editar ' : 'Nueva ') + (esV ? 'venta' : 'compra'), cuerpo,
    `${id ? `<button class="btn peligro" onclick="borrarDoc()">Borrar</button>` : ''}<button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn pri" onclick="guardarDoc()">Guardar</button>`);
  pintarLineas(); pintarRolloDoc();
}
// ----- Agregar por rollo (color + cantidad por talla) en ventas y compras -----
function colorGrupos() { const g = {}; S.productos.filter(p => F.col !== 'ventas' || stockDisponible(p.id) > 0).forEach(p => { const k = claveColor(p); (g[k] = g[k] || []).push(p); }); return g; }
function precioDefecto(p) { return F.col === 'ventas' ? (+p.precio || 0) : r2(+p.costo || ultimoCosto(p.id) || stockHoy(p.id).prom || 0); }
function docModo(m) { F.modoDoc = m; pintarRolloDoc(); }
function docColor(k) { F.dr.color = k; F.dr.q = {}; pintarRolloDoc(); }
function docQ(id, v) { F.dr.q[id] = +v || 0; docCalc(); }
function docCalc() { const t = $('rd-total'); if (t) t.textContent = num(Object.values(F.dr.q).reduce((a, q) => a + (+q || 0), 0)) + ' prendas'; }
function pintarRolloDoc() {
  const esV = F.col === 'ventas', box = $('rollo-doc'); if (!box) return;
  $('doc-modo').innerHTML = [['prenda', 'Una prenda'], ['rollo', 'Por rollo (varias tallas)']].map(([k, t]) => `<button class="${F.modoDoc === k ? 'act' : ''}" onclick="docModo('${k}')">${t}</button>`).join('');
  $('btn-add-linea').classList.toggle('oculto', F.modoDoc === 'rollo');
  if (F.modoDoc !== 'rollo') { box.innerHTML = ''; return; }
  const g = colorGrupos(), tallas = (g[F.dr.color] || []).slice().sort(ordenTalla);
  const sinStock = esV && !Object.keys(g).length;
  box.innerHTML = sinStock ? '<div class="nota">No hay productos con stock para vender.</div>' : `<div class="campo"><label>Color del rollo</label>
    <select onchange="docColor(this.value)"><option value="">— Elegir color —</option>${Object.keys(g).sort().map(k => `<option value="${esc(k)}" ${k === F.dr.color ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
    ${tallas.length ? `<div class="campo"><label>Cantidad por talla</label><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:8px">${tallas.map(p => `<div><label style="margin-bottom:2px">${esc(partesProd(p).talla)}</label><input class="inp" type="number" inputmode="numeric" min="0" value="${F.dr.q[p.id] || ''}" placeholder="0" oninput="docQ('${p.id}',this.value)">${esV ? `<div class="ayuda">stock ${num(stockDisponible(p.id))}</div>` : ''}</div>`).join('')}</div></div>
    <div class="calc"><span>Total del rollo</span><b id="rd-total">0 prendas</b></div>
    <button class="btn pri ancho" style="margin-bottom:10px" onclick="agregarRolloDoc()">+ Agregar rollo al documento</button>` : ''}`;
  docCalc();
}
function agregarRolloDoc() {
  if (!F.dr.color) return aviso('Elige el color del rollo');
  const ids = new Set((colorGrupos()[F.dr.color] || []).map(p => p.id));
  const filas = Object.entries(F.dr.q).filter(([id, q]) => ids.has(id) && +q > 0);
  if (!filas.length) return aviso('Escribe la cantidad de al menos una talla');
  F.d.lineas = F.d.lineas.filter(l => l.productoId);
  filas.forEach(([id, q]) => {
    const precio = precioDefecto(porId('productos', id)), l = F.d.lineas.find(x => x.productoId === id && +x.precio === precio);
    if (l) l.cantidad = (+l.cantidad || 0) + (+q); else F.d.lineas.push({ productoId: id, cantidad: +q, precio, descuento: 0 });
  });
  const n = filas.length; F.dr = { color: '', precio: '', q: {} };
  pintarLineas(); pintarRolloDoc(); aviso('Rollo agregado (' + n + ' tallas) ✓');
}
function nuevoContactoRapido(col, sel) {
  const n = prompt(col === 'clientes' ? 'Nombre del cliente nuevo:' : 'Nombre del proveedor nuevo:');
  if (!n || !n.trim()) { sel.value = F.d[col === 'clientes' ? 'clienteId' : 'proveedorId'] || ''; return; }
  const c = { id: nid(), nombre: n.trim() }; guardar(col, c);
  F.d[col === 'clientes' ? 'clienteId' : 'proveedorId'] = c.id;
  const o = document.createElement('option'); o.value = c.id; o.textContent = c.nombre; sel.insertBefore(o, sel.lastElementChild); sel.value = c.id;
}
function stockDisponible(pid) { // existencia sin contar el documento que estoy editando
  let q = stockHoy(pid).q;
  const orig = porId(F.col, F.d.id);
  if (orig) (orig.lineas || []).forEach(l => { if (l.productoId === pid) q += F.col === 'ventas' ? +l.cantidad : -l.cantidad; });
  return q;
}
function pintarLineas() {
  const esV = F.col === 'ventas';
  $('lineas').innerHTML = F.d.lineas.map((l, i) => {
    const p = porId('productos', l.productoId);
    return `<div class="linea">
      <input class="inp" list="dl-prod" placeholder="Escribe código o nombre…" value="${p ? esc(p.codigo + ' · ' + p.nombre) : ''}" onchange="elegirProd(${i},this.value)" id="lp-${i}">
      <div class="fila-in">
        <div><label>Cantidad</label><input class="inp" type="number" inputmode="decimal" min="0" value="${l.cantidad}" oninput="ponLinea(${i},'cantidad',this.value)"></div>
        <div><label>${esV ? 'Precio venta' : 'Costo unitario'} (S/)</label><input class="inp" type="number" inputmode="decimal" step="0.01" min="0" value="${l.precio}" oninput="ponLinea(${i},'precio',this.value)"></div>
        <button class="quitar" onclick="quitarLinea(${i})" aria-label="Quitar">✕</button>
      </div>
      <div class="info"><span>${p ? 'Stock: ' + num(stockDisponible(p.id)) + ' ' + esc(p.medida || '') : ''}</span><span id="st-${i}">${sol(totalLinea(l))}</span></div>
    </div>`;
  }).join('');
  $('doc-total').textContent = sol(totalDoc(F.d));
}
function ultimoCosto(pid) { // último costo que escribiste en una compra de este producto
  let best = null;
  S.compras.forEach(c => (c.lineas || []).forEach(l => { if (l.productoId === pid && +l.precio > 0 && (!best || c.fecha >= best.f)) best = { f: c.fecha, p: +l.precio }; }));
  return best ? best.p : 0;
}
function elegirProd(i, val) {
  const cod = val.split(' · ')[0].trim();
  const p = S.productos.find(x => x.codigo === cod) || S.productos.find(x => x.nombre.toLowerCase() === val.trim().toLowerCase());
  if (!p) { aviso('Elige un producto de la lista'); return; }
  const l = F.d.lineas[i]; l.productoId = p.id;
  l.precio = F.col === 'ventas' ? +p.precio || 0 : r2(+p.costo || ultimoCosto(p.id) || stockHoy(p.id).prom || l.precio || 0);
  setTimeout(pintarLineas, 0);
}
function ponLinea(i, k, v) { F.d.lineas[i][k] = +v || 0; $('st-' + i).textContent = sol(totalLinea(F.d.lineas[i])); $('doc-total').textContent = sol(totalDoc(F.d)); }
function agregarLinea() { F.d.lineas.push({ productoId: '', cantidad: 1, precio: 0, descuento: 0 }); pintarLineas(); const el = $('lp-' + (F.d.lineas.length - 1)); el && el.focus(); }
function quitarLinea(i) { F.d.lineas.splice(i, 1); if (!F.d.lineas.length) F.d.lineas.push({ productoId: '', cantidad: 1, precio: 0, descuento: 0 }); pintarLineas(); }
function guardarDoc() {
  if (F.modoDoc === 'rollo' && Object.values(F.dr.q).some(q => +q > 0)) agregarRolloDoc(); // rollo escrito pero sin agregar
  const d = F.d; d.lineas = d.lineas.filter(l => l.productoId && +l.cantidad > 0);
  if (!d.fecha) return aviso('Falta la fecha');
  if (!d.lineas.length) { d.lineas.push({ productoId: '', cantidad: 1, precio: 0 }); pintarLineas(); return aviso('Agrega al menos un producto con cantidad'); }
  if (F.col === 'ventas') {
    const falta = d.lineas.filter(l => +l.cantidad > stockDisponible(l.productoId));
    if (falta.length && !confirm('Estás vendiendo más de lo que hay en stock en: ' + falta.map(l => porId('productos', l.productoId).nombre).join(', ') + '.\n¿Guardar de todas formas?')) return;
  }
  guardar(F.col, d); cerrarModal(); aviso('Guardado ✓');
}
function borrarDoc() { if (!confirm('¿Borrar este documento? El stock se recalcula solo.')) return; borrar(F.col, F.d.id); cerrarModal(); aviso('Borrado'); }

// ---------- Productos ----------
function vProductos() {
  const cats = categorias();
  return `<input class="buscar" placeholder="🔍 Buscar producto o código" value="${esc(UI.buscar)}" oninput="UI.buscar=this.value;$('lista-prod').innerHTML=listaProductos()">
    <div class="subtabs" style="padding:0 0 8px">${['', ...cats].map(c => `<button class="${UI.cat === c ? 'act' : ''}" onclick="UI.cat='${esc(c)}';render()">${c ? esc(c) : 'Todas'}</button>`).join('')}</div>
    <div class="lista" id="lista-prod">${listaProductos()}</div>`;
}
function listaProductos() {
  const b = UI.buscar.trim().toLowerCase();
  const ps = S.productos.filter(p => (!UI.cat || p.categoria === UI.cat) && (!b || (p.nombre + ' ' + p.codigo + ' ' + p.categoria).toLowerCase().includes(b))).sort(ordenProd);
  if (!ps.length) return '<div class="vacio">No hay productos.</div>';
  return ps.slice(0, 300).map(p => {
    const s = stockHoy(p.id);
    return `<div class="fila" onclick="fichaProducto('${p.id}')">
      <div class="cuerpo"><div class="tit">${esc(p.nombre)}</div><div class="sub">Cód. ${esc(p.codigo)} · ${esc(p.categoria)} · venta ${sol(p.precio)} · costo ${sol(+p.costo || s.prom)}</div></div>
      <div class="der"><span class="monto ${s.q < 0 ? 'neg' : ''}">${num(s.q)}</span><small>${sol(s.v)}</small></div></div>`;
  }).join('');
}
function fichaProducto(id) {
  const p = porId('productos', id), s = stockHoy(id);
  abrirModal(esc(p.nombre), `
    <div class="cifras">${cifra('Existencia', num(s.q) + ' ' + esc(p.medida || ''))}${cifra('Costo de compra', sol(+p.costo || ultimoCosto(id) || s.prom))}${cifra('Costo total', sol(s.v))}${cifra('Precio de venta', sol(p.precio))}</div>
    <p class="ayuda">Código ${esc(p.codigo)} · ${esc(p.categoria)}</p>
    <div class="acciones"><button class="btn" onclick="formProducto('${id}')">Editar</button><button class="btn" onclick="formAjuste('${id}')">Ajustar stock</button><button class="btn" onclick="verKardex('${id}')">Ver kardex</button></div>`, '');
}
const claveModelo = x => (x.categoria || '') + '|' + ((String(x.nombre || '').match(/\(([^)]*)\)\s*$/) || [])[1] || '');
const etiquetaModelo = x => (x.categoria || '') + (claveModelo(x).split('|')[1] ? ' (' + claveModelo(x).split('|')[1] + ')' : '');
const grupoModelo = x => S.productos.filter(y => claveModelo(y) === claveModelo(x));
function formProducto(id) {
  const p = id ? copia(porId('productos', id)) : { id: nid(), codigo: String(Math.max(0, ...S.productos.map(x => +x.codigo || 0)) + 1), categoria: UI.cat || '', nombre: '', medida: 'UND', precio: 0 };
  F = { col: 'productos', d: p, nuevo: !id, ini: { q: 0, c: 0 } };
  const costoMostrar = id ? (+p.costo || ultimoCosto(id) || '') : '';
  F.costoMostrar = costoMostrar; F.aplicar = false;
  const nGrupo = id ? grupoModelo(p).length : 0;
  abrirModal(id ? 'Editar producto' : 'Nuevo producto', `
    <div class="dos"><div class="campo"><label>Código</label><input value="${esc(p.codigo)}" oninput="F.d.codigo=this.value.trim()"></div>
    <div class="campo"><label>Categoría</label><input list="dl-cat" value="${esc(p.categoria)}" oninput="F.d.categoria=this.value.trim()"></div></div>
    <div class="campo"><label>Nombre</label><input value="${esc(p.nombre)}" oninput="F.d.nombre=this.value"></div>
    <div class="dos"><div class="campo"><label>Medida</label><input value="${esc(p.medida)}" oninput="F.d.medida=this.value"></div>
    <div class="campo"><label>Precio de venta (S/)</label><input type="number" inputmode="decimal" step="0.01" value="${p.precio}" oninput="F.d.precio=+this.value||0"></div></div>
    <div class="campo"><label>Costo de compra (S/)</label><input type="number" inputmode="decimal" step="0.01" min="0" value="${costoMostrar}" placeholder="0.00" oninput="F.d.costo=+this.value||0"><div class="ayuda">Este costo aparece solo al comprar este producto. Cámbialo aquí cuando suba o baje.</div></div>
    ${id && nGrupo > 1 ? `<label class="check" style="background:var(--pri2);border-radius:10px;margin-bottom:12px"><input type="checkbox" onchange="F.aplicar=this.checked"><span>Poner este mismo costo a todas las tallas y colores de «${esc(etiquetaModelo(p))}» (${nGrupo} productos)</span></label>` : ''}
    ${id ? '<p class="ayuda">La existencia y el costo se calculan solos con las compras, ventas y ajustes.</p>' : `
    <h3>Stock que ya tengo (opcional)</h3>
    <div class="dos"><div class="campo"><label>Cantidad</label><input type="number" inputmode="decimal" min="0" value="0" oninput="F.ini.q=+this.value||0"></div>
    <div class="campo"><label>Costo unitario (S/)</label><input type="number" inputmode="decimal" step="0.01" min="0" value="0" oninput="F.ini.c=+this.value||0"></div></div>`}`,
    `${id ? '<button class="btn peligro" onclick="borrarProducto()">Borrar</button>' : ''}<button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn pri" onclick="guardarProducto()">Guardar</button>`);
}
function guardarProducto() {
  const p = F.d; p.nombre = p.nombre.trim();
  if (!p.nombre) return aviso('Falta el nombre');
  if (!p.codigo) return aviso('Falta el código');
  if (S.productos.some(x => x.codigo === p.codigo && x.id !== p.id)) return aviso('Ese código ya existe');
  let msgCosto = '';
  if (F.aplicar) {
    const c = +p.costo || +F.costoMostrar || 0;
    if (!(c > 0)) return aviso('Escribe el costo para ponerlo a todos');
    p.costo = c;
    const otros = grupoModelo(p).filter(x => x.id !== p.id);
    otros.forEach(x => guardar('productos', { ...copia(x), costo: c }));
    msgCosto = ' · costo puesto a ' + otros.length + ' productos más';
  }
  guardar('productos', p);
  if (F.nuevo && F.ini.q > 0) guardar('compras', { id: nid(), fecha: hoy(), factura: '', proveedorId: '', inicial: true, comentario: 'Stock inicial', lineas: [{ productoId: p.id, cantidad: F.ini.q, precio: F.ini.c || p.costo || 0, descuento: 0 }] });
  cerrarModal(); aviso('Producto guardado ✓' + msgCosto);
}
function borrarProducto() {
  if ((inventario().porProd[F.d.id] || []).length) return aviso('No se puede borrar: tiene movimientos. Puedes cambiarle el nombre.');
  if (!confirm('¿Borrar este producto?')) return; borrar('productos', F.d.id); cerrarModal();
}

// ---------- Ajustes de stock ----------
const MOTIVOS = ['Merma', 'Fallas', 'Error de conteo', 'Otro'];
function formAjuste(pid, id) {
  const a = id ? copia(porId('ajustes', id)) : { id: nid(), fecha: fechaPorDefecto(), productoId: pid || '', diferencia: 0, motivo: 'Merma', nota: '' };
  F = { col: 'ajustes', d: a, nuevo: !id };
  const p = porId('productos', a.productoId);
  abrirModal(id ? 'Editar ajuste' : 'Ajustar stock', `
    <div class="campo"><label>Producto</label><input class="inp" list="dl-prod" value="${p ? esc(p.codigo + ' · ' + p.nombre) : ''}" placeholder="Escribe código o nombre…" onchange="ajProd(this.value)"></div>
    <div class="campo"><label>Fecha</label><input type="date" value="${a.fecha}" onchange="F.d.fecha=this.value;ajPintar()"></div>
    <div id="aj-info"></div>
    <div class="campo"><label>Motivo</label><div class="seg">${MOTIVOS.map(m => `<button class="${a.motivo === m ? 'act' : ''}" onclick="F.d.motivo='${m}';this.parentNode.querySelectorAll('button').forEach(b=>b.classList.toggle('act',b===this))">${m}</button>`).join('')}</div></div>
    <div class="campo"><label>Nota (opcional)</label><input value="${esc(a.nota || '')}" oninput="F.d.nota=this.value"></div>`,
    `${id ? '<button class="btn peligro" onclick="borrarAjuste()">Borrar</button>' : ''}<button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn pri" onclick="guardarAjuste()">Guardar</button>`);
  ajPintar();
}
function ajProd(v) { const cod = v.split(' · ')[0].trim(); const p = S.productos.find(x => x.codigo === cod); if (!p) return aviso('Elige un producto de la lista'); F.d.productoId = p.id; F.real = undefined; setTimeout(ajPintar, 0); }
function ajBase() { // existencia a esa fecha sin contar este ajuste
  let q = F.d.productoId ? stockA(F.d.productoId, F.d.fecha).q : 0;
  const orig = porId('ajustes', F.d.id); if (orig && orig.productoId === F.d.productoId && orig.fecha <= F.d.fecha) q -= +orig.diferencia;
  return q;
}
function ajPintar() {
  if (!F.d.productoId) { $('aj-info').innerHTML = ''; return; }
  const base = ajBase(), real = F.nuevo && F.real === undefined ? base : (F.real ?? base + +F.d.diferencia);
  $('aj-info').innerHTML = `<div class="dos">
    <div class="campo"><label>El sistema dice</label><input disabled value="${num(base)}"></div>
    <div class="campo"><label>Cantidad real contada</label><input type="number" inputmode="decimal" value="${num(real)}" oninput="F.real=+this.value||0;F.d.diferencia=F.real-ajBase();$('aj-dif').textContent=(F.d.diferencia>0?'+':'')+num(F.d.diferencia)"></div></div>
    <div class="calc"><span>Diferencia que se registra</span><b id="aj-dif">${(real - base > 0 ? '+' : '') + num(real - base)}</b></div>`;
  F.d.diferencia = real - base;
}
function guardarAjuste() {
  if (!F.d.productoId) return aviso('Elige el producto');
  if (!F.d.diferencia) return aviso('La cantidad real es igual a la del sistema: no hay nada que ajustar');
  guardar('ajustes', F.d); cerrarModal(); aviso('Ajuste guardado ✓');
}
function borrarAjuste() { if (!confirm('¿Borrar este ajuste?')) return; borrar('ajustes', F.d.id); cerrarModal(); }
function vAjustes() {
  const s = SEM();
  const as = S.ajustes.filter(a => enRango(a.fecha, s.inicio, s.fin)).sort((a, b) => a.fecha < b.fecha ? 1 : -1);
  return `<h2>Ajustes de stock de la semana</h2><div class="lista">${as.map(a => {
    const p = porId('productos', a.productoId);
    return `<div class="fila" onclick="formAjuste(null,'${a.id}')"><div class="cuerpo"><div class="tit">${fCorta(a.fecha)} · ${esc(p?.nombre || '?')}</div><div class="sub">${esc(a.motivo)}${a.nota ? ' · ' + esc(a.nota) : ''}</div></div>
      <div class="der"><span class="monto ${a.diferencia < 0 ? 'neg' : 'pos'}">${a.diferencia > 0 ? '+' : ''}${num(a.diferencia)}</span></div></div>`;
  }).join('') || '<div class="vacio">No hay ajustes en esta semana.</div>'}</div>`;
}

// ---------- Kardex ----------
function vKardex() {
  const s = SEM(), inv = inventario();
  const filas = S.productos.slice().sort(ordenProd).map(p => {
    const a = stockA(p.id, masDias(s.inicio, -1)), b = stockA(p.id, s.fin);
    const ms = (inv.porProd[p.id] || []).filter(m => enRango(m.f, s.inicio, s.fin));
    const ent = ms.filter(m => m.q > 0).reduce((t, m) => t + m.q, 0), sal = -ms.filter(m => m.q < 0).reduce((t, m) => t + m.q, 0);
    return { p, a, b, ent, sal, mov: ms.length };
  }).filter(x => UI.kfiltro === 'todos' || (UI.kfiltro === 'stock' ? Math.abs(x.b.q) > 0 : x.mov > 0));
  const tq = filas.reduce((t, x) => t + x.b.q, 0), tv = S.productos.reduce((t, p) => t + stockA(p.id, s.fin).v, 0);
  return `<div class="cifras">${cifra('Unidades al cierre', num(S.productos.reduce((t, p) => t + stockA(p.id, s.fin).q, 0)))}${cifra('Valor al cierre (S/)', sol(tv))}</div>
    <div class="seg" style="margin-bottom:10px">${[['stock', 'Con stock'], ['mov', 'Con movimiento'], ['todos', 'Todos']].map(([k, t]) => `<button class="${UI.kfiltro === k ? 'act' : ''}" onclick="UI.kfiltro='${k}';render()">${t}</button>`).join('')}</div>
    <div class="lista tabla-caja"><table class="tabla"><tr><th>Producto</th><th>Inicio</th><th>Entra</th><th>Sale</th><th>Cierre</th><th>Valor</th></tr>
    ${filas.map(x => `<tr onclick="verKardex('${x.p.id}')" style="cursor:pointer"><td>${esc(x.p.nombre)}</td><td>${num(x.a.q)}</td><td>${x.ent ? num(x.ent) : ''}</td><td>${x.sal ? num(x.sal) : ''}</td><td><b>${num(x.b.q)}</b></td><td>${sol(x.b.v)}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Nada que mostrar.</td></tr>'}
    <tr class="total"><td>Total</td><td></td><td></td><td></td><td>${num(tq)}</td><td>${sol(filas.reduce((t, x) => t + x.b.v, 0))}</td></tr></table></div>
    <p class="ayuda">Toca un producto para ver todos sus movimientos. Valores con costo promedio.</p>`;
}
function verKardex(pid) {
  const p = porId('productos', pid), s = SEM();
  const ms = (inventario().porProd[pid] || []).slice().reverse();
  abrirModal('Kardex · ' + esc(p.nombre), `<div class="lista tabla-caja"><table class="tabla">
    <tr><th>Fecha</th><th>Movimiento</th><th>Cant.</th><th>Costo u.</th><th>Saldo</th><th>Valor</th></tr>
    ${ms.map(m => `<tr class="${enRango(m.f, s.inicio, s.fin) ? 'marcada' : ''}"><td>${fCorta(m.f)}</td><td style="text-align:left">${esc(m.tipo)}</td><td class="${m.q < 0 ? 'neg' : 'pos'}">${m.q > 0 ? '+' : ''}${num(m.q)}</td><td>${sol(m.q ? Math.abs(m.v / m.q) : 0)}</td><td><b>${num(m.sq)}</b></td><td>${sol(m.sv)}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin movimientos</td></tr>'}
    </table></div><p class="ayuda">Las filas sombreadas son de la semana elegida.</p>`, '');
}

// ---------- Reportes ----------
function vReportes() {
  const s = SEM(), R = UI.rep;
  if (!R.desde) { R.desde = s.inicio; R.hasta = s.fin; }
  const [a, b] = R.modo === 'semana' ? [s.inicio, s.fin] : [R.desde, R.hasta];
  const rv = resumenVentas(a, b);
  const compras = comprasEntre(a, b).reduce((t, c) => t + totalDoc(c), 0);
  const agrupar = (fn) => { const m = {}; rv.ls.forEach(x => { const k = fn(x); const o = m[k] || (m[k] = { k, q: 0, v: 0, c: 0, g: 0 }); o.q += x.q; o.v += x.total; o.c += x.costo; o.g += x.gan; }); return Object.values(m); };
  const tabla = (tit, filas, col1) => `<h3>${tit}</h3><div class="lista tabla-caja"><table class="tabla"><tr><th>${col1}</th><th>Cant.</th><th>Ventas</th><th>Costo</th><th>Ganancia</th></tr>
    ${filas.map(o => `<tr><td>${esc(o.k)}</td><td>${num(o.q)}</td><td>${sol(o.v)}</td><td>${sol(o.c)}</td><td class="${o.g >= 0 ? 'pos' : 'neg'}">${sol(o.g)}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin ventas</td></tr>'}
    ${filas.length ? `<tr class="total"><td>Total</td><td>${num(rv.unid)}</td><td>${sol(rv.ventas)}</td><td>${sol(rv.costo)}</td><td>${sol(rv.gan)}</td></tr>` : ''}</table></div>`;
  const dias = agrupar(x => x.fecha).sort((x, y) => x.k < y.k ? -1 : 1).map(o => ({ ...o, k: diaSem(o.k).slice(0, 3) + ' ' + fCorta(o.k) }));
  // ganancias de las últimas 8 semanas
  let sems = [], ref = s;
  for (let i = 0; i < 8; i++) { const r = resumenVentas(ref.inicio, ref.fin); sems.push({ k: textoSemana(ref), q: r.unid, v: r.ventas, c: r.costo, g: r.gan }); ref = semanaDe(masDias(ref.inicio, -1)); }
  return `<div class="seg" style="margin-bottom:10px"><button class="${R.modo === 'semana' ? 'act' : ''}" onclick="UI.rep.modo='semana';render()">Semana elegida</button><button class="${R.modo === 'fechas' ? 'act' : ''}" onclick="UI.rep.modo='fechas';render()">Entre fechas</button></div>
    ${R.modo === 'fechas' ? `<div class="dos"><div class="campo"><label>Desde</label><input type="date" value="${R.desde}" onchange="UI.rep.desde=this.value;render()"></div><div class="campo"><label>Hasta</label><input type="date" value="${R.hasta}" onchange="UI.rep.hasta=this.value;render()"></div></div>` : ''}
    <div class="cifras">${cifra('Ventas', sol(rv.ventas))}${cifra('Costo de venta', sol(rv.costo))}${cifra('Ganancia', sol(rv.gan), rv.gan >= 0 ? 'pos' : 'neg')}${cifra('Compras', sol(compras))}</div>
    ${tabla('Ventas diarias', dias, 'Día')}
    ${tabla('Ventas por categoría', agrupar(x => x.p.categoria).sort((x, y) => y.v - x.v), 'Categoría')}
    ${tabla('Ventas por artículo', agrupar(x => x.p.nombre).sort((x, y) => y.v - x.v), 'Artículo')}
    <h3>Ganancias por semana</h3><div class="lista tabla-caja"><table class="tabla"><tr><th>Semana</th><th>Cant.</th><th>Ventas</th><th>Costo</th><th>Ganancia</th></tr>
    ${sems.map(o => `<tr><td>${o.k}</td><td>${num(o.q)}</td><td>${sol(o.v)}</td><td>${sol(o.c)}</td><td class="${o.g >= 0 ? 'pos' : 'neg'}">${sol(o.g)}</td></tr>`).join('')}</table></div>`;
}

// ---------- Clientes y proveedores ----------
const CAMPOS_CONT = {
  clientes: [['nombre', 'Nombre'], ['empresa', 'Compañía'], ['ruc', 'RUC / DNI'], ['telefono', 'Teléfono'], ['email', 'Correo'], ['direccion', 'Dirección']],
  proveedores: [['nombre', 'Nombre'], ['documento', 'RUC / DNI'], ['telefono', 'Teléfono'], ['direccion', 'Dirección']]
};
function vContactos(col) {
  const l = S[col].slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
  return `<h2>${col === 'clientes' ? 'Clientes' : 'Proveedores'}</h2><div class="lista">${l.map(c => `<div class="fila" onclick="formContacto('${col}','${c.id}')"><div class="cuerpo"><div class="tit">${esc(c.nombre)}</div><div class="sub">${esc([c.empresa, c.ruc || c.documento, c.telefono].filter(Boolean).join(' · '))}</div></div></div>`).join('') || '<div class="vacio">Todavía no hay nadie.</div>'}</div>`;
}
function formContacto(col, id) {
  const c = id ? copia(porId(col, id)) : { id: nid(), nombre: '' }; F = { col, d: c };
  abrirModal((id ? 'Editar ' : 'Nuevo ') + (col === 'clientes' ? 'cliente' : 'proveedor'),
    CAMPOS_CONT[col].map(([k, t]) => `<div class="campo"><label>${t}</label><input value="${esc(c[k] || '')}" oninput="F.d.${k}=this.value"></div>`).join(''),
    `${id ? '<button class="btn peligro" onclick="borrarContacto()">Borrar</button>' : ''}<button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn pri" onclick="if(!F.d.nombre.trim())return aviso('Falta el nombre');guardar(F.col,F.d);cerrarModal()">Guardar</button>`);
}
function borrarContacto() {
  const campo = F.col === 'clientes' ? 'clienteId' : 'proveedorId', docs = F.col === 'clientes' ? S.ventas : S.compras;
  if (docs.some(d => d[campo] === F.d.id)) return aviso('No se puede borrar: tiene ' + (F.col === 'clientes' ? 'ventas' : 'compras') + ' registradas');
  if (confirm('¿Borrar?')) { borrar(F.col, F.d.id); cerrarModal(); }
}

// =====================================================================
//  TALLER
// =====================================================================
function vPersona(pid) {
  const per = porId('personas', pid); if (!per) return '<div class="vacio">Persona no encontrada.</div>';
  const s = SEM();
  const regs = S.registros.filter(r => r.personaId === pid && enRango(r.fecha, s.inicio, s.fin)).sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.creado || 0) - (b.creado || 0));
  const total = regs.reduce((t, r) => t + pagoReg(r), 0);
  const porMaq = m => regs.filter(r => r.maquina === m).reduce((t, r) => t + pagoReg(r), 0);
  const gr = gruposDe(regs); UI.grp = {}; gr.forEach(g => UI.grp[g.key] = g.rs.map(r => r.id));
  return `<div class="cifras">${cifra('A pagar a ' + esc(per.nombre), sol(total))}${cifra('Prendas', num(prendasReales(regs)))}</div>
    <p class="ayuda" style="margin:-2px 2px 10px">Recta ${sol(porMaq('recta'))} · Remalle ${sol(porMaq('remalle'))} · Completa ${sol(porMaq('completa'))}</p>
    <div class="lista">${gr.map(lineaGrupo).join('') || '<div class="vacio">Sin registros en esta semana.<br>Toca “+ Registro” para anotar.</div>'}</div>`;
}
// Una prenda real = un trabajo y lo que "falta" de ese trabajo (recta + remalle de la misma prenda cuentan una sola vez)
const grupoReg = r => (r.origenId && porId('registros', r.origenId)) ? r.origenId : r.id;
function prendasReales(regs) {
  const m = {}; regs.forEach(r => { const k = grupoReg(r); m[k] = Math.max(m[k] || 0, +r.cantidad || 0); });
  return Object.values(m).reduce((t, x) => t + x, 0);
}
function gruposDe(regs) {
  const m = new Map(); regs.forEach(r => { const k = grupoReg(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return [...m].map(([key, rs]) => ({ key, rs }));
}
const minus1 = t => t.charAt(0).toLowerCase() + t.slice(1);
function lineaGrupo(g) {
  const rs = g.rs.slice().sort((a, b) => (a.creado || 0) - (b.creado || 0));
  if (rs.length === 1) return lineaRegistro(rs[0]);
  const b = rs[0], p = porId('prendas', b.prendaId), prod = porId('productos', b.productoId);
  const maqs = ['recta', 'remalle', 'completa'].filter(m => rs.some(r => r.maquina === m));
  const o = b.origenId ? porId('registros', b.origenId) : null;
  const marca = o ? ` <span class="chip gris">falta de ${esc(porId('personas', o.personaId)?.nombre || '…')}</span>${o.sinEtiqueta ? ' <span class="chip gris">sin etiqueta</span>' : ''}` : '';
  const pago = rs.reduce((t, r) => t + pagoReg(r), 0), unit = rs.reduce((t, r) => t + pagoUnit(r), 0);
  const detalle = rs.map(r => `<b>${MAQ[r.maquina]}</b> ${esc(minus1(textoOps(r)))}`).join(' · ');
  return `<div class="fila" onclick="abrirGrupo('${g.key}')"><div class="cuerpo reg-linea"><b>${fCorta(b.fecha)}</b> · ${esc(prod?.nombre || p?.nombre || '?')} ×${num(Math.max(...rs.map(r => +r.cantidad || 0)))} <span class="chip comp">${maqs.map(m => MAQ[m]).join(' + ')}</span> · <span style="color:var(--suave)">${detalle}</span>${marca}</div>
    <div class="der"><span class="monto">${sol(pago)}</span><small>${sol(unit)} c/u</small></div></div>`;
}
function abrirGrupo(key) {
  const rs = ((UI.grp || {})[key] || []).map(id => porId('registros', id)).filter(Boolean);
  abrirModal('Detalle de la prenda', `<p class="ayuda" style="margin:0 2px 8px">Toca una parte para editarla o borrarla.</p><div class="lista">${rs.map(lineaRegistro).join('')}</div>`, '');
}
function lineaRegistro(r) {
  const p = porId('prendas', r.prendaId), prod = porId('productos', r.productoId);
  const chip = r.maquina === 'recta' ? 'chip' : r.maquina === 'remalle' ? 'chip rem' : 'chip comp';
  let marca = '';
  if (r.origenId) { const o = porId('registros', r.origenId); marca = ` <span class="chip gris">falta de ${esc(porId('personas', o?.personaId)?.nombre || '…')}</span>${o?.sinEtiqueta ? ' <span class="chip gris">sin etiqueta</span>' : ''}`; }
  else if (r.completar && S.registros.some(x => x.origenId === r.id)) {
    const hs = S.registros.filter(x => x.origenId === r.id), ms = ['recta', 'remalle', 'completa'].filter(m => hs.some(x => x.maquina === m));
    marca = ` <span class="chip gris">resto a ${esc(porId('personas', idCompleta())?.nombre || 'YO')}${ms.length ? ' · ' + ms.map(m => MAQ[m]).join(' + ') : ''}</span>${r.sinEtiqueta ? ' <span class="chip gris">sin etiqueta</span>' : ''}`;
  } else if (r.sinEtiqueta) marca = ' <span class="chip gris">sin etiqueta</span>';
  return `<div class="fila" onclick="formRegistro('${r.id}')"><div class="cuerpo reg-linea"><b>${fCorta(r.fecha)}</b> · ${esc(prod?.nombre || p?.nombre || '?')} ×${num(r.cantidad)} <span class="${chip}">${MAQ[r.maquina]}</span> · <span style="color:var(--suave)">${esc(textoOps(r))}</span>${marca}</div>
    <div class="der"><span class="monto">${sol(pagoReg(r))}</span><small>${sol(pagoUnit(r))} c/u</small></div></div>`;
}
function formRegistro(id, pid) {
  const r = id ? copia(porId('registros', id)) : { id: nid(), personaId: pid, fecha: fechaPorDefecto(), prendaId: (UI.ultPrenda && porId('prendas', UI.ultPrenda)) ? UI.ultPrenda : (S.prendas[0]?.id || ''), productoId: '', sinEtiqueta: false, cantidad: '', maquina: 'recta', tipo: 'todo', ops: [], creado: Date.now() };
  const quien = idCompleta();
  F = { col: 'registros', d: r, nuevo: !id, abierto: false, verTodos: false, rollo: false, rq: {}, rcolor: '', puede: !!quien && r.personaId !== quien && !r.origenId };
  F.completar = F.puede && (id ? !!r.completar : true);
  const per = porId('personas', r.personaId);
  abrirModal((id ? 'Editar registro · ' : 'Nuevo registro · ') + esc(per?.nombre || ''), '<div id="reg-form"></div>',
    `${id ? '<button class="btn peligro" onclick="borrarRegistro()">Borrar</button>' : ''}<button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn pri" onclick="guardarRegistro()">Guardar</button>`);
  pintarRegistro();
}
function tiposPermitidos(m) { return m === 'completa' ? ['todo', 'menos'] : ['todo', 'menos', 'solo']; }
function pintarRegistro() {
  const r = F.d, prenda = porId('prendas', r.prendaId);
  const u = universo(prenda, r.maquina, r.fecha);
  const marc = new Set(r.ops);
  const nombres = (r.ops || []).map(id => prenda?.ops.find(o => o.id === id)?.nombre).filter(Boolean);
  const grupos = r.maquina === 'completa' ? [['recta', 'Recta'], ['remalle', 'Remalle']] : [[r.maquina, '']];
  const otrasPersonas = S.personas.filter(p => p.activo !== false || p.id === r.personaId);
  const prods = productosDePrenda(prenda, r.fecha, r.productoId), porCat = {}, cSem = comprasSemana(r.fecha);
  prods.forEach(p => (porCat[p.categoria] = porCat[p.categoria] || []).push(p));
  const opcionesProd = Object.entries(porCat).map(([c, ps]) => `<optgroup label="${esc(c)}">${ps.map(p => `<option value="${p.id}" ${p.id === r.productoId ? 'selected' : ''}>${esc(p.nombre)} · compradas ${num(cSem[p.id] || 0)}</option>`).join('')}</optgroup>`).join('');
  const bloqueProd = `<div class="campo"><label>Prenda exacta (talla y color)</label>
      <select onchange="F.d.productoId=this.value"><option value="">— Elegir —</option>${opcionesProd}</select>
      <div class="ayuda">${prods.length ? 'Solo prendas compradas en la semana ' + textoSemana(semanaDe(r.fecha)) + '.' : 'No hay compras de esta prenda en la semana ' + textoSemana(semanaDe(r.fecha)) + '. Registra primero la compra.'}</div></div>`;
  const etq = etqOp();
  const bloqueEtq = etq && r.maquina === 'recta' ? `<label class="check" style="background:var(--aviso2);border-radius:10px;margin-bottom:12px"><input type="checkbox" ${r.sinEtiqueta ? 'checked' : ''} onchange="regSinEtq(this.checked)"><span>Sin etiqueta (no se pegó etiqueta)</span></label>` : '';
  const bloqueModo = F.nuevo ? `<div class="campo"><label>Cómo registrar</label><div class="seg"><button class="${!F.rollo ? 'act' : ''}" onclick="regModo(false)">Una prenda</button><button class="${F.rollo ? 'act' : ''}" onclick="regModo(true)">Por rollo (varias tallas)</button></div></div>` : '';
  let bloqueRollo = '';
  if (F.rollo) {
    const colores = {}; prods.forEach(p => { const k = claveColor(p); (colores[k] = colores[k] || []).push(p); });
    const tallas = (colores[F.rcolor] || []).slice().sort(ordenTalla);
    bloqueRollo = `<div class="campo"><label>Color del rollo</label>
      <select onchange="regColor(this.value)"><option value="">— Elegir color —</option>${Object.keys(colores).sort().map(k => `<option value="${esc(k)}" ${k === F.rcolor ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      <div class="ayuda">${prods.length ? 'Colores comprados en la semana ' + textoSemana(semanaDe(r.fecha)) + '.' : 'No hay compras de esta prenda en la semana ' + textoSemana(semanaDe(r.fecha)) + '. Registra primero la compra.'}</div></div>
      ${tallas.length ? `<div class="campo"><label>Cantidad por talla</label><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:8px">${tallas.map(p => `<div><label style="margin-bottom:2px">${esc(partesProd(p).talla)}</label><input class="inp" type="number" inputmode="numeric" min="0" value="${F.rq[p.id] || ''}" placeholder="0" oninput="F.rq['${p.id}']=+this.value||0;regCalc()"><div class="ayuda">compradas ${num(cSem[p.id] || 0)}</div></div>`).join('')}</div></div>
      <div class="calc"><span>Total del rollo</span><b id="rollo-total">0 prendas</b></div>` : ''}`;
  }
  $('reg-form').innerHTML = `
    <div class="campo"><label>Fecha</label><input type="date" value="${r.fecha}" onchange="F.d.fecha=this.value;regLimpiar();pintarRegistro()"></div>
    <div class="campo"><label>Prenda</label><div class="seg">${S.prendas.map(p => `<button class="${p.id === r.prendaId ? 'act' : ''}" onclick="regPrenda('${p.id}')">${esc(p.nombre)}</button>`).join('')}</div></div>
    ${bloqueModo}
    ${F.rollo ? bloqueRollo : `${bloqueProd}
    <div class="campo"><label>Cantidad</label><input type="number" inputmode="numeric" min="0" value="${r.cantidad}" placeholder="0" oninput="F.d.cantidad=+this.value||0;regCalc()" id="reg-cant"></div>`}
    <div class="campo"><label>Máquina</label><div class="seg">${Object.entries(MAQ).map(([k, t]) => `<button class="${k === r.maquina ? 'act' : ''}" onclick="regMaquina('${k}')">${t}</button>`).join('')}</div></div>
    <div class="campo"><label>Tipo</label><div class="seg">${tiposPermitidos(r.maquina).map(k => `<button class="${k === r.tipo ? 'act' : ''}" onclick="regTipo('${k}')">${TIPO[k]}</button>`).join('')}</div></div>
    ${bloqueEtq}
    ${r.tipo === 'todo' ? '' : `
    <div class="campo"><label>Operaciones</label>
      <button class="desp-btn" onclick="F.abierto=!F.abierto;pintarRegistro()"><span>${F.abierto ? (r.tipo === 'menos' ? 'Marca las que NO hizo' : 'Marca las que SÍ hizo') : (nombres.length ? nombres.length + ' marcada' + (nombres.length > 1 ? 's' : '') : 'Elegir operaciones')}</span><span class="flecha">${F.abierto ? '▲' : '▼'}</span></button>
      ${F.abierto ? `<div class="desp-panel">${grupos.map(([m, t]) => {
        const lst = u.filter(o => o.maquina === m);
        return (t ? `<div class="grupo">${t}</div>` : '') + lst.map(o => `<label class="check"><input type="checkbox" ${marc.has(o.id) ? 'checked' : ''} onchange="regMarcar('${o.id}',this.checked)"><span>${esc(o.nombre)}</span><span class="pr">${sol(precioOp(o, r.fecha))}</span></label>`).join('');
      }).join('')}<div style="padding:6px 6px 0"><button class="btn ancho chico" onclick="F.abierto=false;pintarRegistro()">Listo</button></div></div>`
        : (nombres.length ? `<div class="resumen-ops">${r.tipo === 'menos' ? 'No hizo: ' : 'Hizo: '}${esc(nombres.join(', '))}</div>` : '')}
    </div>`}
    ${otrasPersonas.length > 1 && !F.nuevo ? `<div class="campo"><label>Persona</label><select onchange="F.d.personaId=this.value">${otrasPersonas.map(p => `<option value="${p.id}" ${p.id === r.personaId ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></div>` : ''}
    <div class="calc"><span>Pago por unidad: <b id="reg-pu"></b></span><span>Total: <b id="reg-tot"></b></span></div>
    ${F.puede ? `<label class="check" style="background:var(--pri2);border-radius:10px"><input type="checkbox" ${F.completar ? 'checked' : ''} onchange="F.completar=this.checked;regCalc()"><span>Lo que falta lo hizo <b>${esc(porId('personas', idCompleta())?.nombre || '')}</b></span></label><div class="ayuda" id="reg-resto" style="margin:6px 4px 4px"></div>` : ''}
    ${r.origenId ? `<div class="nota" style="margin-top:6px">Se anotó solo, con lo que faltó en el trabajo de <b>${esc(porId('personas', porId('registros', r.origenId)?.personaId)?.nombre || 'otra persona')}</b>. Puedes cambiarlo; desde ese momento ya no se actualizará solo.</div>` : ''}`;
  regCalc();
}
function regLimpiar() { const u = new Set(universo(porId('prendas', F.d.prendaId), F.d.maquina, F.d.fecha).map(o => o.id)); F.d.ops = F.d.ops.filter(id => u.has(id)); }
function productosDePrenda(prenda, fecha, actualId) { // solo lo que entró por compras en la semana de esa fecha
  if (!prenda) return [];
  const n = prenda.nombre.trim().toLowerCase(), sem = semanaDe(fecha), comp = new Set();
  S.compras.filter(c => enRango(c.fecha, sem.inicio, sem.fin)).forEach(c => (c.lineas || []).forEach(l => comp.add(l.productoId)));
  return S.productos.filter(p => (p.categoria || '').toLowerCase().startsWith(n) && (comp.has(p.id) || p.id === actualId)).sort(ordenProd);
}
function comprasSemana(fecha) { // unidades compradas por producto en la semana de esa fecha
  const sem = semanaDe(fecha), m = {};
  S.compras.filter(c => enRango(c.fecha, sem.inicio, sem.fin)).forEach(c => (c.lineas || []).forEach(l => { m[l.productoId] = (m[l.productoId] || 0) + (+l.cantidad || 0); }));
  return m;
}
function partesProd(p) { // separa color, talla y detalle del nombre del producto
  let n = String(p.nombre || '').trim();
  const m = n.match(/\(([^)]*)\)\s*$/), suf = m ? m[1] : '';
  if (m) n = n.slice(0, m.index).trim();
  const cat = String(p.categoria || '').trim();
  if (cat && n.toLowerCase().startsWith(cat.toLowerCase())) n = n.slice(cat.length).trim();
  const t = n.split(/\s+/).filter(Boolean), talla = t.pop() || '';
  let color = t.join(' ').toLowerCase(); color = color.charAt(0).toUpperCase() + color.slice(1);
  return { cat, color, talla, suf };
}
const claveColor = p => { const x = partesProd(p); return (x.cat + ' ' + x.color + (x.suf ? ' (' + x.suf + ')' : '')).replace(/\s+/g, ' ').trim(); };
const ORDEN_TALLA = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const ordenTalla = (a, b) => { const x = partesProd(a).talla.toUpperCase(), y = partesProd(b).talla.toUpperCase(); const i = ORDEN_TALLA.indexOf(x), j = ORDEN_TALLA.indexOf(y); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || x.localeCompare(y); };
function regModo(on) { F.rollo = on; F.rq = {}; F.rcolor = ''; F.d.productoId = ''; pintarRegistro(); }
function regColor(k) { F.rcolor = k; F.rq = {}; pintarRegistro(); }
function guardarRollo() {
  const r = F.d, prenda = porId('prendas', r.prendaId);
  if (!r.prendaId) return aviso('Elige la prenda');
  if (!F.rcolor) return aviso('Elige el color del rollo');
  const vis = new Set(productosDePrenda(prenda, r.fecha, '').filter(p => claveColor(p) === F.rcolor).map(p => p.id));
  const filas = Object.entries(F.rq || {}).filter(([id, q]) => vis.has(id) && +q > 0);
  if (!filas.length) return aviso('Escribe la cantidad de al menos una talla');
  if (r.tipo !== 'todo' && !r.ops.length) return aviso(r.tipo === 'solo' ? 'Marca las operaciones que hizo' : 'Marca las operaciones que NO hizo (o elige “Todo completo”)');
  UI.ultPrenda = r.prendaId;
  filas.forEach(([pid, q], i) => {
    const x = { ...copia(r), id: nid(), productoId: pid, cantidad: +q, creado: Date.now() + i * 3 };
    if (F.puede) x.completar = F.completar;
    guardar('registros', x);
    if (F.puede && x.completar) partesFaltantes(x).forEach(h => guardar('registros', h));
  });
  cerrarModal(); aviso('Rollo guardado ✓ (' + filas.length + ' registros)');
}
function etqOp() { return etqOpPrenda(porId('prendas', F.d.prendaId)); }
function regResetEtq() { if (F.d.sinEtiqueta) { F.d.sinEtiqueta = false; F.d.tipo = 'todo'; F.d.ops = []; } }
function aplicarEtq(on) {
  const e = etqOp(); if (!e) return;
  const s = new Set(F.d.ops), t = F.d.tipo;
  if (t === 'menos') { on ? s.add(e.id) : s.delete(e.id); if (!on && !s.size) F.d.tipo = 'todo'; }
  else if (t === 'solo') { on ? s.delete(e.id) : s.add(e.id); }
  else if (on) { F.d.tipo = 'menos'; s.add(e.id); }
  F.d.ops = [...s];
}
function regPrenda(id) { regResetEtq(); F.d.prendaId = id; F.d.productoId = ''; F.d.ops = []; F.verTodos = false; F.rcolor = ''; F.rq = {}; pintarRegistro(); }
function regTipo(k) { F.d.tipo = k; F.d.ops = []; F.abierto = k !== 'todo'; if (F.d.sinEtiqueta) aplicarEtq(true); pintarRegistro(); }
function regSinEtq(on) { F.d.sinEtiqueta = on; aplicarEtq(on); pintarRegistro(); }
function regMaquina(m) { if (m !== F.d.maquina) regResetEtq(); F.d.maquina = m; if (!tiposPermitidos(m).includes(F.d.tipo)) F.d.tipo = 'todo'; regLimpiar(); pintarRegistro(); }
function regMarcar(id, on) {
  const s = new Set(F.d.ops); on ? s.add(id) : s.delete(id); F.d.ops = [...s];
  const e = etqOp();
  if (e && e.id === id && F.d.maquina === 'recta') {
    const nuevo = F.d.tipo === 'solo' ? !on : F.d.tipo === 'menos' ? on : false;
    if (nuevo !== !!F.d.sinEtiqueta) { F.d.sinEtiqueta = nuevo; pintarRegistro(); return; }
  }
  regCalc();
}
function regCalc() {
  if (F.rollo) { F.d.cantidad = Object.values(F.rq || {}).reduce((t, q) => t + (+q || 0), 0); const tt = $('rollo-total'); if (tt) tt.textContent = num(F.d.cantidad) + ' prendas'; }
  const pu = F.d.prendaId ? pagoUnit(F.d) : 0;
  $('reg-pu').textContent = sol(pu); $('reg-tot').textContent = sol(pu * (+F.d.cantidad || 0));
  const el = $('reg-resto'); if (!el) return;
  if (!F.completar) { el.textContent = 'No se anotará nada más.'; return; }
  const partes = F.d.prendaId ? partesFaltantes(F.d) : [], nom = porId('personas', idCompleta())?.nombre || '';
  const nota = F.d.sinEtiqueta ? ' (la etiqueta no se anota a nadie: la prenda va sin etiqueta)' : '';
  if (!partes.length) { el.textContent = 'Hizo toda la prenda: no falta nada para ' + nom + '.' + nota; return; }
  const tot = partes.reduce((s, x) => s + pagoUnit(x) * (+F.d.cantidad || 0), 0);
  el.innerHTML = 'A ' + esc(nom) + ' se le anotará: ' + partes.map(x => '<b>' + MAQ[x.maquina] + '</b> ' + esc(x.tipo === 'todo' ? 'todo completo' : textoOps(x).replace('Solo: ', ''))).join(' + ') + ' · <b>' + sol(tot) + '</b>' + nota;
}
function guardarRegistro() {
  if (F.rollo && F.nuevo) return guardarRollo();
  const r = F.d;
  if (!r.prendaId) return aviso('Elige la prenda');
  if (F.nuevo && !r.productoId) return aviso('Elige la prenda exacta (talla y color)');
  if (!(+r.cantidad > 0)) return aviso('Escribe la cantidad');
  if (r.tipo !== 'todo' && !r.ops.length) return aviso(r.tipo === 'solo' ? 'Marca las operaciones que hizo' : 'Marca las operaciones que NO hizo (o elige “Todo completo”)');
  r.cantidad = +r.cantidad; UI.ultPrenda = r.prendaId;
  if (r.origenId && !F.nuevo) r.manual = true;
  if (F.puede) r.completar = F.completar;
  guardar('registros', r);
  let msg = 'Registro guardado ✓';
  if (F.puede) {
    const hijos = S.registros.filter(x => x.origenId === r.id), nom = porId('personas', idCompleta())?.nombre || '';
    if (r.completar) {
      if (!hijos.some(h => h.manual) || confirm('Lo anotado a ' + nom + ' de este trabajo fue cambiado a mano. ¿Reemplazarlo con lo que falta ahora?')) {
        const nuevos = partesFaltantes(r), ids = new Set(nuevos.map(x => x.id));
        hijos.filter(h => !ids.has(h.id)).forEach(h => borrar('registros', h.id));
        nuevos.forEach(x => guardar('registros', x));
        if (nuevos.length) msg = 'Guardado ✓ y anotado lo que falta a ' + nom;
      }
    } else hijos.filter(h => !h.manual).forEach(h => borrar('registros', h.id));
  }
  cerrarModal(); aviso(msg);
}
function borrarRegistro() {
  const hijos = S.registros.filter(x => x.origenId === F.d.id), nom = porId('personas', idCompleta())?.nombre || 'YO';
  if (!confirm(hijos.length ? '¿Borrar este registro y también lo que se anotó a ' + nom + ' por este trabajo?' : '¿Borrar este registro?')) return;
  hijos.forEach(h => borrar('registros', h.id)); borrar('registros', F.d.id); cerrarModal();
}

function vTallerResumen() {
  const s = SEM();
  const regs = S.registros.filter(r => enRango(r.fecha, s.inicio, s.fin));
  const pers = S.personas.filter(p => p.activo !== false || regs.some(r => r.personaId === p.id));
  const fila = per => { const rs = regs.filter(r => r.personaId === per.id); const m = k => rs.filter(r => r.maquina === k).reduce((t, r) => t + pagoReg(r), 0); return { per, rec: m('recta'), rem: m('remalle'), com: m('completa'), tot: rs.reduce((t, r) => t + pagoReg(r), 0), u: rs.reduce((t, r) => t + +r.cantidad, 0) }; };
  const fs = pers.map(fila); const T = k => fs.reduce((t, f) => t + f[k], 0);
  const prendas = S.prendas.map(p => { const rs = regs.filter(r => r.prendaId === p.id); const u = k => rs.filter(r => r.maquina === k).reduce((t, r) => t + +r.cantidad, 0); return { p, rec: u('recta'), rem: u('remalle'), com: u('completa'), real: prendasReales(rs) }; }).filter(x => x.rec + x.rem + x.com);
  return `<div class="cifras">${cifra('Total a pagar de todos', sol(T('tot')))}${cifra('Prendas trabajadas', num(prendasReales(regs)))}</div>
    <h3>Pago por persona</h3>
    <div class="lista tabla-caja"><table class="tabla"><tr><th>Persona</th><th>Recta</th><th>Remalle</th><th>Completa</th><th>Total</th></tr>
    ${fs.map(f => `<tr onclick="ir('t:${f.per.id}')" style="cursor:pointer"><td>${esc(f.per.nombre)}</td><td>${sol(f.rec)}</td><td>${sol(f.rem)}</td><td>${sol(f.com)}</td><td><b>${sol(f.tot)}</b></td></tr>`).join('')}
    <tr class="total"><td>Total</td><td>${sol(T('rec'))}</td><td>${sol(T('rem'))}</td><td>${sol(T('com'))}</td><td>${sol(T('tot'))}</td></tr></table></div>
    <h3>Unidades por prenda</h3>
    <div class="lista tabla-caja"><table class="tabla"><tr><th>Prenda</th><th>Prendas reales</th><th>Recta</th><th>Remalle</th><th>Completa</th></tr>
    ${prendas.map(x => `<tr><td>${esc(x.p.nombre)}</td><td><b>${num(x.real)}</b></td><td>${num(x.rec)}</td><td>${num(x.rem)}</td><td>${num(x.com)}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin registros</td></tr>'}</table></div>
    <p class="ayuda">“Prendas reales” cuenta cada prenda una sola vez, aunque tenga recta y remalle.</p>`;
}
function vRemalle() {
  const s = SEM(), rp = remallePendiente(s.fin);
  const tot = rp.reduce((t, x) => t + x.pago, 0);
  return `<div class="cifras">${cifra('Pago pendiente de remalle', sol(tot))}${cifra('Calculado hasta', fLarga(s.fin))}</div>
    <p class="ayuda" style="margin:0 2px 10px">Prendas con la recta terminada (“Todo completo” o “Todo menos…” en Recta) menos lo ya remallado. Lo registrado como Prenda completa no queda pendiente.</p>
    ${rp.map(x => `<div class="tarjeta"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>${esc(x.prenda.nombre)}</b><span class="monto">${sol(x.pago)}</span></div>
      <div class="ayuda">Recta lista: ${num(x.listas)} unid.</div>
      ${x.listas ? `<div class="tabla-caja"><table class="tabla" style="margin-top:6px"><tr><th>Operación de remalle</th><th>Hechas</th><th>Faltan</th><th>c/u</th><th>Pendiente</th></tr>
      ${x.det.map(d => `<tr><td>${esc(d.op.nombre)}</td><td>${num(d.hechas)}</td><td><b>${num(d.faltan)}</b></td><td>${sol(d.pu)}</td><td>${sol(d.pago)}</td></tr>`).join('')}</table></div>` : ''}
    </div>`).join('')}`;
}

// ---------- Prendas, operaciones y precios ----------
function vPrendas() {
  const h = hoy();
  return S.prendas.map(p => {
    const u = m => universo(p, m, h).reduce((t, o) => t + precioOp(o, h), 0);
    const fila = o => `<div class="fila sinclic"><div class="cuerpo">${esc(o.nombre)} <span class="${o.maquina === 'recta' ? 'chip' : 'chip rem'}">${MAQ[o.maquina]}</span></div><div class="der"><span class="monto">${sol(precioOp(o, h))}</span>${(o.precios || []).length > 1 ? `<small>${o.precios.length} precios</small>` : ''}</div></div>`;
    const quitadas = p.ops.filter(o => o.quitadaDesde && o.quitadaDesde <= h).length;
    return `<h2>${esc(p.nombre)}</h2>
      <p class="ayuda" style="margin:-4px 2px 8px">Hoy: recta ${sol(u('recta'))} · remalle ${sol(u('remalle'))} · completa ${sol(u('completa'))}${quitadas ? ` · ${quitadas} quitada(s)` : ''}</p>
      <div class="acciones" style="margin-top:0"><button class="btn chico" onclick="formOps('${p.id}')">Editar operaciones</button><button class="btn chico" onclick="formPrecios('${p.id}')">Cambiar precios</button><button class="btn chico" onclick="verHistorial('${p.id}')">Historial de precios</button></div>
      <div class="lista">${universo(p, 'completa', h).map(fila).join('') || '<div class="vacio">Sin operaciones</div>'}</div>`;
  }).join('') || '<div class="vacio">No hay prendas. Toca “+ Prenda”.</div>';
}
function formNuevaPrenda() {
  const n = prompt('Nombre de la prenda nueva:'); if (!n || !n.trim()) return;
  if (S.prendas.some(p => p.nombre.toLowerCase() === n.trim().toLowerCase())) return aviso('Esa prenda ya existe');
  const p = { id: nid(), nombre: n.trim(), ops: [] }; guardar('prendas', p);
  setTimeout(() => formOps(p.id), 50);
}
function formOps(pid) {
  F = { col: 'prendas', d: copia(porId('prendas', pid)) };
  abrirModal('Operaciones · ' + esc(F.d.nombre), '<div id="ops-form"></div>',
    `${!S.registros.some(r => r.prendaId === pid) ? '<button class="btn peligro" onclick="borrarPrenda()">Borrar prenda</button>' : ''}<button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn pri" onclick="guardarOps()">Guardar</button>`);
  pintarOps();
}
function pintarOps() {
  const d = F.d, h = hoy();
  const usadas = new Set(S.registros.filter(r => r.prendaId === d.id).flatMap(r => r.ops || []));
  const usaTodo = S.registros.some(r => r.prendaId === d.id);
  $('ops-form').innerHTML = `
    <div class="campo"><label>Nombre de la prenda</label><input value="${esc(d.nombre)}" oninput="F.d.nombre=this.value"></div>
    <h3>Operaciones</h3>
    ${d.ops.map((o, i) => {
      const quitada = o.quitadaDesde && o.quitadaDesde <= h;
      return `<div class="linea" style="${quitada ? 'opacity:.55' : ''}">
        <input class="inp" value="${esc(o.nombre)}" oninput="F.d.ops[${i}].nombre=this.value" placeholder="Nombre de la operación">
        <div class="fila-in" style="grid-template-columns:1fr auto">
          <div class="seg">${['recta', 'remalle'].map(m => `<button class="${o.maquina === m ? 'act' : ''}" onclick="F.d.ops[${i}].maquina='${m}';pintarOps()">${MAQ[m]}</button>`).join('')}</div>
          ${quitada ? `<button class="btn chico" onclick="delete F.d.ops[${i}].quitadaDesde;pintarOps()">Volver a usar</button>` : `<button class="quitar" onclick="quitarOp(${i},${usaTodo || usadas.has(o.id)})" aria-label="Quitar">✕</button>`}
        </div>
        <div class="info"><span>${quitada ? 'Quitada desde ' + fLarga(o.quitadaDesde) : 'Precio hoy: ' + sol(precioOp(o, h))}</span>${o._nueva ? `<span>Precio <input type="number" step="0.01" inputmode="decimal" style="width:80px" class="inp" value="${o.precios[0].valor}" oninput="F.d.ops[${i}].precios[0].valor=+this.value||0"></span>` : ''}</div>
      </div>`;
    }).join('')}
    <button class="btn ancho" onclick="F.d.ops.push({id:nid(),nombre:'',maquina:'recta',desde:hoy(),_nueva:true,precios:[{desde:hoy(),valor:0}]});pintarOps()">+ Agregar operación</button>
    <p class="ayuda">Al quitar una operación ya usada, se oculta desde hoy; los registros anteriores no cambian. Para cambiar precios usa “Cambiar precios”.</p>`;
}
function quitarOp(i, usada) {
  if (usada) { F.d.ops[i].quitadaDesde = hoy(); }
  else F.d.ops.splice(i, 1);
  pintarOps();
}
function guardarOps() {
  const d = F.d; d.nombre = d.nombre.trim(); if (!d.nombre) return aviso('Falta el nombre de la prenda');
  d.ops = d.ops.filter(o => o.nombre.trim()); d.ops.forEach(o => { o.nombre = o.nombre.trim(); delete o._nueva; });
  guardar('prendas', d); cerrarModal(); aviso('Guardado ✓');
}
function borrarPrenda() { if (!confirm('¿Borrar la prenda ' + F.d.nombre + '?')) return; borrar('prendas', F.d.id); cerrarModal(); }
function formPrecios(pid) {
  const p = porId('prendas', pid);
  F = { col: 'prendas', d: copia(p), fecha: hoy(), nuevos: {} };
  abrirModal('Precios · ' + esc(p.nombre), `
    <div class="campo"><label>Rigen desde</label><input type="date" value="${F.fecha}" onchange="F.fecha=this.value;pintarPrecios()"></div>
    <div class="nota">Los registros con fecha anterior siguen pagándose con el precio de antes. Cambia solo los que suben o bajan.</div>
    <div id="precios-form"></div>`,
    `<button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn pri" onclick="guardarPrecios()">Guardar precios</button>`);
  pintarPrecios();
}
function pintarPrecios() {
  const ops = universo(F.d, 'completa', F.fecha);
  $('precios-form').innerHTML = ['recta', 'remalle'].map(m => `<h3>${MAQ[m]}</h3><div class="lista">${ops.filter(o => o.maquina === m).map(o => `
    <div class="fila sinclic"><div class="cuerpo">${esc(o.nombre)}<div class="sub">antes ${sol(precioOp(o, masDias(F.fecha, -1)))}</div></div>
    <input class="inp" style="width:96px;text-align:right" type="number" step="0.01" inputmode="decimal" value="${F.nuevos[o.id] ?? precioOp(o, F.fecha)}" oninput="F.nuevos['${o.id}']=this.value"></div>`).join('')}</div>`).join('');
}
function guardarPrecios() {
  let n = 0;
  F.d.ops.forEach(o => {
    if (!(o.id in F.nuevos)) return;
    const v = r2(+F.nuevos[o.id] || 0); if (v === r2(precioOp(o, F.fecha)) && !(o.precios || []).some(p => p.desde === F.fecha)) return;
    o.precios = (o.precios || []).filter(p => p.desde !== F.fecha); o.precios.push({ desde: F.fecha, valor: v }); n++;
  });
  if (!n) return aviso('No cambiaste ningún precio');
  guardar('prendas', F.d); cerrarModal(); aviso(n + ' precio(s) actualizados ✓');
}
function verHistorial(pid) {
  const p = porId('prendas', pid);
  abrirModal('Historial · ' + esc(p.nombre), `<div class="lista">${p.ops.map(o => `<div class="fila sinclic"><div class="cuerpo"><div class="tit">${esc(o.nombre)} <span class="${o.maquina === 'recta' ? 'chip' : 'chip rem'}">${MAQ[o.maquina]}</span></div>
    <div class="sub">${(o.precios || []).slice().sort((a, b) => a.desde < b.desde ? -1 : 1).map(x => `desde ${fLarga(x.desde)}: ${sol(x.valor)}`).join(' → ')}${o.quitadaDesde ? ' · quitada desde ' + fLarga(o.quitadaDesde) : ''}</div></div></div>`).join('')}</div>`, '');
}

// ---------- Personas ----------
function cambiarCompleta(v) { const c = copia(CFG()); c.completaId = v; guardar('config', c); aviso(v ? 'Listo ✓' : 'Ya no se llenará solo'); }
function vPersonas() {
  const ic = idCompleta();
  return `<h2>Personas del taller</h2>
    <div class="tarjeta"><div class="campo" style="margin:0"><label>Lo que falta en los trabajos de los demás lo hace</label>
      <select onchange="cambiarCompleta(this.value)"><option value="">Nadie (no llenar solo)</option>${personasActivas().map(p => `<option value="${p.id}" ${p.id === ic ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>
      <div class="ayuda">Al anotar un trabajo de otra persona aparece la casilla “Lo que falta lo hizo…”.</div></div></div>
    <div class="lista">${S.personas.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(p => `<div class="fila" onclick="formPersona('${p.id}')"><div class="cuerpo"><div class="tit">${esc(p.nombre)}</div><div class="sub">${p.activo === false ? 'Quitada (no aparece en las pestañas)' : 'Activa'}</div></div></div>`).join('') || '<div class="vacio">No hay personas.</div>'}</div>`;
}
function formPersona(id) {
  const p = id ? copia(porId('personas', id)) : { id: nid(), nombre: '', activo: true }; F = { col: 'personas', d: p };
  abrirModal(id ? 'Editar persona' : 'Nueva persona', `<div class="campo"><label>Nombre</label><input value="${esc(p.nombre)}" oninput="F.d.nombre=this.value"></div>`,
    `${id ? `<button class="btn peligro" onclick="F.d.activo=${p.activo === false};guardar('personas',F.d);cerrarModal()">${p.activo === false ? 'Volver a activar' : 'Quitar'}</button>` : ''}<button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn pri" onclick="if(!F.d.nombre.trim())return aviso('Falta el nombre');F.d.nombre=F.d.nombre.trim();guardar('personas',F.d);cerrarModal()">Guardar</button>`);
}

// ---------- Semanas ----------
function formSemana() {
  const s = SEM(); F = { ini: s.inicio, fin: s.fin, orig: s };
  abrirModal('Editar semana', `
    <p>Puedes cambiar la fecha de apertura y de cierre de esta semana. La semana siguiente arranca al día siguiente del cierre.</p>
    <div class="dos"><div class="campo"><label>Apertura</label><input type="date" value="${s.inicio}" onchange="F.ini=this.value"></div>
    <div class="campo"><label>Cierre</label><input type="date" value="${s.fin}" onchange="F.fin=this.value"></div></div>
    <p class="ayuda">Las semanas solo agrupan; nunca bloquean nada.</p>`,
    `${s.editada ? '<button class="btn peligro" onclick="restablecerSemana()">Volver a lo normal</button>' : ''}<button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn pri" onclick="guardarSemana()">Guardar</button>`);
}
function guardarSemana() {
  if (!F.ini || !F.fin || F.fin < F.ini) return aviso('El cierre debe ser igual o después de la apertura');
  if (aT(F.fin) - aT(F.ini) > 40 * DIA) return aviso('La semana es demasiado larga');
  const cfg = copia(CFG());
  cfg.semanasEditadas = (cfg.semanasEditadas || []).filter(e => e.fin < F.ini || e.inicio > F.fin);
  cfg.semanasEditadas.push({ inicio: F.ini, fin: F.fin });
  guardar('config', cfg); UI.ref = F.ini; cerrarModal(); aviso('Semana actualizada ✓');
}
function restablecerSemana() {
  const cfg = copia(CFG()); cfg.semanasEditadas = (cfg.semanasEditadas || []).filter(e => !(e.inicio === F.orig.inicio && e.fin === F.orig.fin));
  guardar('config', cfg); cerrarModal();
}

// ---------- Más / Configuración ----------
function vMas() {
  const item = (ic, t, sub, f) => `<div class="fila" onclick="${f}"><div class="ic">${ic}</div><div class="cuerpo"><div class="tit">${t}</div><div class="sub">${sub}</div></div><div>›</div></div>`;
  return `<div class="lista menu" style="margin-top:6px">
    ${item('👥', 'Clientes', S.clientes.length + ' registrados', "ir('clientes')")}
    ${item('🚚', 'Proveedores', S.proveedores.length + ' registrados', "ir('proveedores')")}
    ${item('📦', 'Ajustes de stock', 'Mermas, fallas y correcciones', "ir('ajustes')")}
    ${item('🧑‍🔧', 'Personas del taller', personasActivas().length + ' activas', "ir('personas')")}
    ${item('⚙️', 'Configuración', 'Semanas, respaldo y cuenta', "ir('config')")}
    ${item('📥', 'Descargar respaldo en Excel', 'Todos tus datos en un archivo', 'exportarExcel()')}
  </div>`;
}
function vConfig() {
  const cfg = CFG(), di = cfg.diaInicio ?? 6;
  return `<h2>Semanas</h2><div class="tarjeta">
    <div class="campo"><label>La semana empieza el</label><select onchange="cambiarDiaInicio(+this.value)">${DIAS.map((d, i) => `<option value="${i}" ${i === di ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <div class="ayuda">…y termina el <b>${DIAS[(di + 6) % 7]}</b>. Para cambiar una semana en particular, toca las fechas arriba.</div></div>
    ${(cfg.semanasEditadas || []).length ? `<div class="ayuda">Semanas editadas: ${cfg.semanasEditadas.slice().sort((a, b) => a.inicio < b.inicio ? -1 : 1).map(e => fCorta(e.inicio) + '–' + fCorta(e.fin)).join(', ')}</div>` : ''}
  </div>
  <h2>Respaldo</h2><div class="tarjeta">
    <button class="btn pri ancho" onclick="exportarExcel()">📥 Descargar todo en Excel</button>
    <p class="ayuda">Guarda una copia de vez en cuando (por ejemplo, cada semana).</p>
    <button class="btn ancho" onclick="ofrecerCarga()">Volver a cargar datos de mis Excel originales</button>
  </div>
  <h2>Cuenta</h2><div class="tarjeta">
    ${modoPrueba ? '<p>Modo prueba: los datos están solo en este aparato. Conecta Firebase (ver guía) para usar el mismo dato en celular y PC.</p><button class="btn peligro ancho" onclick="borrarTodoPrueba()">Borrar datos de prueba</button>'
      : `<p>Conectado como <b>${esc(usuario?.email || '')}</b></p><button class="btn ancho" onclick="if(confirm('¿Cerrar sesión?'))Nube.salir()">Cerrar sesión</button>`}
  </div>`;
}
function cambiarDiaInicio(d) { const cfg = copia(CFG()); cfg.diaInicio = d; guardar('config', cfg); aviso('Listo: la semana empieza el ' + DIAS[d]); }
function borrarTodoPrueba() { if (!confirm('¿Borrar todos los datos de prueba de este aparato?')) return; localStorage.removeItem(Local.clave); location.reload(); }

// ---------- Exportar a Excel ----------
function cargarXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, mal) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = () => mal(new Error('Sin internet')); document.head.appendChild(s); });
}
async function exportarExcel() {
  aviso('Preparando Excel…');
  try { await cargarXLSX(); } catch (e) { return aviso('Necesitas internet para descargar el Excel'); }
  const inv = inventario(), P = id => porId('productos', id) || {};
  const nom = (col, id) => porId(col, id)?.nombre || '';
  const hojas = {
    Productos: S.productos.slice().sort(ordenProd).map(p => { const s = stockHoy(p.id); return { 'Código': p.codigo, 'Categoría': p.categoria, 'Producto': p.nombre, 'Medida': p.medida, 'Precio venta': p.precio, 'Existencia': r2(s.q), 'Costo unit': r2(s.prom), 'Costo total': r2(s.v) }; }),
    Compras: S.compras.slice().sort((a, b) => a.fecha < b.fecha ? -1 : 1).flatMap(c => c.lineas.map(l => ({ 'Fecha': c.fecha, 'Semana': textoSemana(semanaDe(c.fecha)), 'N° doc': c.factura, 'Proveedor': c.inicial ? 'Stock inicial' : nom('proveedores', c.proveedorId), 'Código': P(l.productoId).codigo, 'Producto': P(l.productoId).nombre, 'Cantidad': l.cantidad, 'Costo unit': l.precio, 'Descuento': l.descuento || 0, 'Total': r2(totalLinea(l)), 'Comentario': c.comentario || '' }))),
    Ventas: S.ventas.slice().sort((a, b) => a.fecha < b.fecha ? -1 : 1).flatMap(v => v.lineas.map((l, i) => { const cu = inv.costoVenta[v.id + '#' + i] || 0; return { 'Fecha': v.fecha, 'Semana': textoSemana(semanaDe(v.fecha)), 'N° doc': v.factura, 'Cliente': nom('clientes', v.clienteId), 'Código': P(l.productoId).codigo, 'Categoría': P(l.productoId).categoria, 'Producto': P(l.productoId).nombre, 'Cantidad': l.cantidad, 'Precio': l.precio, 'Descuento': l.descuento || 0, 'Total': r2(totalLinea(l)), 'Costo unit': r2(cu), 'Costo total': r2(cu * l.cantidad), 'Ganancia': r2(totalLinea(l) - cu * l.cantidad), 'Comentario': v.comentario || '' }; })),
    Ajustes: S.ajustes.map(a => ({ 'Fecha': a.fecha, 'Producto': P(a.productoId).nombre, 'Diferencia': a.diferencia, 'Motivo': a.motivo, 'Nota': a.nota || '' })),
    Kardex: inv.movs.map(m => ({ 'Fecha': m.f, 'Código': P(m.pid).codigo, 'Producto': P(m.pid).nombre, 'Movimiento': m.tipo, 'Cantidad': r2(m.q), 'Valor': r2(m.v), 'Saldo unid.': r2(m.sq), 'Saldo S/': r2(m.sv) })),
    Clientes: S.clientes.map(c => ({ 'Nombre': c.nombre, 'Compañía': c.empresa || '', 'RUC/DNI': c.ruc || '', 'Teléfono': c.telefono || '', 'Correo': c.email || '', 'Dirección': c.direccion || '' })),
    Proveedores: S.proveedores.map(c => ({ 'Nombre': c.nombre, 'RUC/DNI': c.documento || '', 'Teléfono': c.telefono || '', 'Dirección': c.direccion || '' })),
    Taller: S.registros.slice().sort((a, b) => a.fecha < b.fecha ? -1 : 1).map(r => ({ 'Fecha': r.fecha, 'Semana': textoSemana(semanaDe(r.fecha)), 'Persona': nom('personas', r.personaId), 'Prenda': nom('prendas', r.prendaId), 'Producto (talla y color)': nom('productos', r.productoId), 'Cantidad': r.cantidad, 'Máquina': MAQ[r.maquina], 'Operaciones': textoOps(r), 'Pago unidad': r2(pagoUnit(r)), 'Total': pagoReg(r) })),
    Tarifas: S.prendas.flatMap(p => p.ops.flatMap(o => (o.precios || []).map(x => ({ 'Prenda': p.nombre, 'Operación': o.nombre, 'Máquina': MAQ[o.maquina], 'Desde': x.desde, 'Precio': x.valor, 'Quitada desde': o.quitadaDesde || '' }))))
  };
  const wb = XLSX.utils.book_new();
  Object.entries(hojas).forEach(([n, filas]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }]), n));
  XLSX.writeFile(wb, `respaldo_luvx_${hoy()}.xlsx`);
}

// ---------- Ventana emergente ----------
function abrirModal(titulo, cuerpo, pie) {
  $('modal').innerHTML = `<div class="m-cab"><h2>${titulo}</h2><button class="x" onclick="cerrarModal()" aria-label="Cerrar">✕</button></div><div class="m-cuerpo">${cuerpo}</div>${pie ? `<div class="m-pie">${pie}</div>` : ''}`;
  $('modal-fondo').classList.remove('oculto'); document.body.style.overflow = 'hidden';
}
function cerrarModal() { $('modal-fondo').classList.add('oculto'); document.body.style.overflow = ''; F = null; }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal-fondo').classList.contains('oculto')) cerrarModal(); });

// La rueda del mouse no cambia los números: solo desplaza la pantalla
document.addEventListener('wheel', () => { const a = document.activeElement; if (a && a.type === 'number') a.blur(); }, { passive: true });

arrancar();
