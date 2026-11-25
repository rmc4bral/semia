// acopia · capa de datos: servidor (api.php) o modo local (localStorage + IndexedDB)
import seed from './seed.json';
import { lotIdOf } from './geo.js';
import { sha256 } from './sha256.js';

const LS_KEY = 'semia.data.v1';
const LS_SESSION = 'semia.session.v1';
const clone = o => JSON.parse(JSON.stringify(o));
const safeLS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

/* ---------- IndexedDB para fotos en modo local ---------- */
function idb() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('Sin IndexedDB'));
    const r = indexedDB.open('semia-fotos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbPut(key, val) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('fotos', 'readwrite'); tx.objectStore('fotos').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function idbGet(key) { const db = await idb(); return new Promise((res, rej) => { const r = db.transaction('fotos').objectStore('fotos').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbDel(key) { const db = await idb(); return new Promise(res => { const tx = db.transaction('fotos', 'readwrite'); tx.objectStore('fotos').delete(key); tx.oncomplete = res; tx.onerror = res; }); }

export async function resolvePhoto(ref) {
  if (!ref) return null;
  if (ref.startsWith('idb:')) { try { return (await idbGet(ref.slice(4))) || null; } catch { return null; } }
  return ref;
}

/* ---------- API ---------- */
async function api(action, body) {
  const opt = body === undefined ? { credentials: 'same-origin' } : {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  };
  const r = await fetch(`api.php?action=${action}`, opt);
  let j; try { j = await r.json(); } catch { throw new Error('Respuesta inválida del servidor'); }
  if (!r.ok || j.ok === false) { const e = new Error(j.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return j;
}

// Subida con porcentaje real (XMLHttpRequest)
function apiUpload(action, body, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('POST', `api.php?action=${action}`); x.withCredentials = true;
    x.setRequestHeader('Content-Type', 'application/json');
    x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    x.onerror = () => rej(new Error('Sin conexión con el servidor. Revisá tu internet y reintentá.'));
    x.ontimeout = () => rej(new Error('El servidor tardó demasiado. Reintentá con una imagen más liviana.'));
    x.timeout = 300000;
    x.onload = () => {
      let j; try { j = JSON.parse(x.responseText); } catch {
        return rej(new Error(x.status === 413 || x.status === 200 || x.status === 400
          ? 'El servidor rechazó el archivo por tamaño. En hPanel → Avanzado → Configuración de PHP subí post_max_size y upload_max_filesize a 64M.'
          : `Respuesta inválida del servidor (${x.status})`));
      }
      if (x.status >= 400 || j.ok === false) return rej(new Error(j.error || `Error ${x.status}`));
      res(j);
    };
    x.send(JSON.stringify(body));
  });
}

export async function detectMode() {
  if (location.protocol === 'file:') return 'local';
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch('api.php?action=ping', { signal: ctl.signal, credentials: 'same-origin' });
    clearTimeout(tm);
    const j = await r.json();
    return j && j.ok && j.app === 'semia' ? 'server' : 'local';
  } catch { return 'local'; }
}

/* ---------- Modo local ---------- */
function localLoad() {
  const raw = safeLS.get(LS_KEY);
  if (raw) { try { return JSON.parse(raw); } catch { /* corrupto: reiniciar */ } }
  const d = clone(seed); safeLS.set(LS_KEY, JSON.stringify(d)); return d;
}
function localSave(d) {
  d.updatedAt = new Date().toISOString();
  if (!safeLS.set(LS_KEY, JSON.stringify(d))) throw new Error('No hay espacio en el almacenamiento local');
}
const publicState = d => { const o = clone(d); o.users = (o.users || []).map(({ sha, hash, ...u }) => u); return o; };
const isAdmin = me => me && me.rol === 'admin';

// Misma lógica que api.php → saveShapes (modo local)
function applyShapes(d, change) {
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.6;
  (change.lots || []).forEach(nl => {
    const l = d.lots.find(x => lotIdOf(x) === String(nl.id ?? nl.num)) || d.lots.find(x => x.num === nl.num); if (!l) return;
    if (!l.poly0) l.poly0 = l.poly;
    l.poly = nl.poly; l.label = nl.label;
    (nl.subs || []).forEach(ns => { const s = l.subs.find(x => x.id === ns.id); if (s) { if (!s.poly0) s.poly0 = s.poly; s.poly = ns.poly; s.label = ns.label; } });
  });
  if (change.outline) d.outline = change.outline;
  (change.silos || []).forEach(u => { const s = d.silos.find(x => x.id === u.id); if (s) Object.assign(s, { map: u.map, t: u.t, ang: u.ang, latlng: u.latlng }); });
  (d.georef?.points || []).forEach(p => {
    const l = d.lots.find(x => x.num === p.lote); if (!l || !p.map) return;
    const vi = l.poly.findIndex(q => near(q, p.map)); if (vi >= 0) { p.vi = vi; p.key = `L${p.lote}-${vi}`; }
  });
}

export function createStore(mode) {
  const local = mode === 'local';
  return {
    mode,
    async session() {
      if (local) {
        const u = safeLS.get(LS_SESSION); if (!u) return null;
        const d = localLoad(); const me = d.users.find(x => x.user === u);
        return me ? { me: { user: me.user, nombre: me.nombre, rol: me.rol }, state: publicState(d) } : null;
      }
      try { const j = await api('session'); return j.me ? { me: j.me, state: j.state } : null; } catch { return null; }
    },
    async login(user, pass) {
      user = (user || '').trim().toLowerCase();
      if (local) {
        const d = localLoad(); const u = d.users.find(x => x.user === user);
        if (!u || u.sha !== sha256(`semia|${user}|${pass}`)) throw new Error('Usuario o contraseña incorrectos');
        safeLS.set(LS_SESSION, user);
        return { me: { user: u.user, nombre: u.nombre, rol: u.rol }, state: publicState(d) };
      }
      const j = await api('login', { user, pass });
      return { me: j.me, state: j.state };
    },
    async logout() { if (local) safeLS.del(LS_SESSION); else await api('logout', {}).catch(() => {}); },
    async reload() { if (local) return publicState(localLoad()); return (await api('state')).state; },

    async uploadPhoto(siloId, dataUrl) {
      if (!dataUrl) return null;
      if (local) { await idbPut(siloId, dataUrl); return `idb:${siloId}`; }
      return (await api('upload', { id: siloId, data: dataUrl })).path;
    },
    async saveSilo(silo, me, prevId) {
      if (local) {
        const d = localLoad();
        if (prevId && prevId !== silo.id && d.silos.some(s => s.id === silo.id)) throw new Error(`El ID ${silo.id} ya existe`);
        if (!prevId && d.silos.some(s => s.id === silo.id)) throw new Error(`El ID ${silo.id} ya existe`);
        const i = d.silos.findIndex(s => s.id === (prevId || silo.id));
        if (i >= 0) {
          if (!isAdmin(me) && d.silos[i].creadoPor !== me.user) throw new Error('Sin permiso para editar este silo');
          d.silos[i] = { ...d.silos[i], ...silo, editadoPor: me.user, editadoEn: new Date().toISOString() };
        } else d.silos.push({ ...silo, creadoPor: me.user, creadoEn: new Date().toISOString() });
        localSave(d); return publicState(d);
      }
      return (await api('saveSilo', { silo, prevId })).state;
    },
    async deleteSilo(id, me) {
      if (local) {
        if (!isAdmin(me)) throw new Error('Solo el administrador puede eliminar');
        const d = localLoad(); d.silos = d.silos.filter(s => s.id !== id); localSave(d);
        idbDel(id).catch(() => {}); return publicState(d);
      }
      return (await api('deleteSilo', { id })).state;
    },
    async saveLot(lot, me) {
      if (local) {
        if (!isAdmin(me)) throw new Error('Solo el administrador puede editar lotes');
        const d = localLoad(); const i = d.lots.findIndex(l => lotIdOf(l) === String(lot._origId ?? lot._origNum));
        if (i < 0) throw new Error('Lote inexistente');
        const old = d.lots[i], kml = old.kml || null;
        if (lot.num !== old.num && d.lots.some((l, j) => j !== i && (l.kml || null) === kml && String(l.num).toLowerCase() === String(lot.num).toLowerCase())) throw new Error(`Ya existe el lote ${lot.num} en esa estancia`);
        const { _origNum, _origId, ...clean } = lot;
        const oldId = lotIdOf(old), nl = { ...old, ...clean, kml }; nl.id = kml ? `${kml}:${nl.num}` : String(nl.num);
        d.lots[i] = nl;
        if (nl.id !== oldId) d.silos.forEach(x => { if (x.lot === oldId) { x.lot = nl.id; x.lote = nl.num; } });
        localSave(d); return publicState(d);
      }
      return (await api('saveLot', { lot })).state;
    },
    async saveGeoref(georef, me) {
      if (local) {
        if (!isAdmin(me)) throw new Error('Solo el administrador puede georreferenciar');
        const d = localLoad(); d.georef = georef; localSave(d); return publicState(d);
      }
      return (await api('saveGeoref', { georef })).state;
    },
    /* ---------- Mapas propios (ortomosaicos / imágenes) ---------- */
    async uploadMap(map, dataUrl, me, onProgress) {
      if (local) {
        if (!isAdmin(me)) throw new Error('Solo el administrador puede subir mapas');
        const id = 'm' + Date.now().toString(36);
        await idbPut('map-' + id, dataUrl); onProgress && onProgress(100);
        const d = localLoad(); d.maps = d.maps || [];
        d.maps.push({ ...map, id, src: `idb:map-${id}`, peso: Math.round(dataUrl.length * 0.75), creadoPor: me.user, creadoEn: new Date().toISOString() });
        localSave(d); return { state: publicState(d), id };
      }
      const j = await apiUpload('uploadMap', { map, data: dataUrl }, onProgress);
      return { state: j.state, id: j.id };
    },
    async saveMap(map, me) {
      if (local) {
        if (!isAdmin(me)) throw new Error('Solo el administrador');
        const d = localLoad(); const i = (d.maps || []).findIndex(m => m.id === map.id);
        if (i < 0) throw new Error('El mapa ya no existe');
        d.maps[i] = { ...d.maps[i], nombre: map.nombre, fecha: map.fecha, corners: map.corners }; localSave(d); return publicState(d);
      }
      return (await api('saveMap', { map })).state;
    },
    async deleteMap(id, me) {
      if (local) {
        if (!isAdmin(me)) throw new Error('Solo el administrador');
        const d = localLoad(); d.maps = (d.maps || []).filter(m => m.id !== id); localSave(d);
        idbDel('map-' + id).catch(() => {}); return publicState(d);
      }
      return (await api('deleteMap', { id })).state;
    },
    async saveShapes(change, me) {
      if (local) {
        if (!isAdmin(me)) throw new Error('Solo el administrador puede ajustar lotes');
        const d = localLoad();
        applyShapes(d, change);
        localSave(d); return publicState(d);
      }
      return (await api('saveShapes', { change })).state;
    },
    async importKml(change, me) {
      if (local) {
        if (!isAdmin(me)) throw new Error('Solo el administrador puede reemplazar los lotes');
        const d = localLoad();
        const { kx, ky, ...g } = change.georef;
        if (!change.lots.length) { d.lots = []; d.outline = []; d.decor = {}; d.georef = { points: [] }; localSave(d); return publicState(d); }
        d.lots = change.lots.map(l => ({ ...l, subs: l.subs || [] })); d.outline = change.outline; d.decor = { lines: change.lines || [] };
        d.georef = { ...g, points: [], kml: { ...(g.kml || {}), lotes: change.lots.length }, kmls: g.kmls || [] };
        const nums = d.lots.map(l => l.num).filter(n => typeof n === 'number');
        (change.silos || []).forEach(u => { const x = d.silos.find(s => s.id === u.id); if (x) Object.assign(x, { lote: u.lote, lot: u.lot || x.lot || null, map: u.map, map2: u.map2 || null, t: u.t, ang: u.ang, latlng: u.latlng || x.latlng, latlng2: u.latlng2 || x.latlng2 || null }); });
        const ids = d.lots.filter(l => typeof l.num === 'number').map(l => l.id || lotIdOf(l));
        d.silos.forEach(x => { if (!ids.includes(x.lot)) { const l = d.lots.find(y => y.num === x.lote && typeof y.num === 'number') || d.lots.find(y => typeof y.num === 'number'); if (l) { x.lote = l.num; x.lot = lotIdOf(l); } } });
        localSave(d); return publicState(d);
      }
      return (await api('importKml', { change })).state;
    },
    async saveEstancia(estancia, me) {
      if (local) {
        if (!isAdmin(me)) throw new Error('Solo el administrador');
        const d = localLoad(); d.estancia = { ...d.estancia, ...estancia }; localSave(d); return publicState(d);
      }
      return (await api('saveEstancia', { estancia })).state;
    },
    async saveUser(u, me) {
      if (local) {
        const d = localLoad(); const i = d.users.findIndex(x => x.user === u.user);
        if (!isAdmin(me) && u.user !== me.user) throw new Error('Sin permiso');
        const rec = { user: u.user, nombre: u.nombre, rol: isAdmin(me) ? u.rol : (d.users[i]?.rol || 'operador') };
        if (u.pass) rec.sha = sha256(`semia|${u.user}|${u.pass}`);
        if (i >= 0) d.users[i] = { ...d.users[i], ...rec };
        else { if (!u.pass) throw new Error('Indicá una contraseña'); d.users.push(rec); }
        if (!d.users.some(x => x.rol === 'admin')) throw new Error('Debe quedar al menos un administrador');
        localSave(d); return publicState(d);
      }
      return (await api('saveUser', { u })).state;
    },
    async deleteUser(user, me) {
      if (local) {
        if (!isAdmin(me) || user === me.user) throw new Error('No se puede eliminar este usuario');
        const d = localLoad(); d.users = d.users.filter(x => x.user !== user); localSave(d); return publicState(d);
      }
      return (await api('deleteUser', { user })).state;
    },
    async importData(data, me) {
      if (!isAdmin(me)) throw new Error('Solo el administrador');
      if (!data || !Array.isArray(data.lots) || !Array.isArray(data.silos)) throw new Error('Archivo no válido');
      if (local) {
        const d = localLoad();
        const n = { ...d, estancia: data.estancia || d.estancia, lots: data.lots, silos: data.silos, georef: data.georef || d.georef };
        localSave(n); return publicState(n);
      }
      return (await api('import', { data })).state;
    },
    resetLocal() { safeLS.del(LS_KEY); },
  };
}
