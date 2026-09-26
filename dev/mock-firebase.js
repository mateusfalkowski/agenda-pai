// Backend FALSO para testar a interface localmente (http://localhost:PORTA/?mock).
// Imita o subconjunto do Firebase (Auth, Firestore, Messaging) usado pelo app, guardando tudo no
// localStorage do navegador. Nunca é carregado em produção (ver js/firebase.js).
//
// Parâmetros de URL: ?mock&reset (apaga e recria os dados de exemplo), ?mock&deny=clients (simula
// regras do banco negando uma coleção). Login de teste: teste@agenda.dev / teste123

import { DAY, HOUR, MINUTE, initialReminderFields } from '../js/logic.js';

const params = new URLSearchParams(location.search);
const LS_DB = 'mock:db';
const LS_AUTH = 'mock:auth';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const autoId = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('').slice(0, 20);
const fail = (code, message = code) => Object.assign(new Error(message), { code });

// ---------- Timestamp e sentinelas ----------

class Timestamp {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (((ms % 1000) + 1000) % 1000) * 1e6); }
  static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
  static now() { return Timestamp.fromMillis(Date.now()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  isEqual(o) { return o instanceof Timestamp && o.toMillis() === this.toMillis(); }
}

class Sentinel {
  constructor(kind, values = []) {
    this.kind = kind;
    this.values = values;
  }
}
const serverTimestamp = () => new Sentinel('serverTimestamp');
const arrayUnion = (...values) => new Sentinel('arrayUnion', values);
const arrayRemove = (...values) => new Sentinel('arrayRemove', values);

const isPlain = (v) => v !== null && typeof v === 'object' && !(v instanceof Timestamp) && !(v instanceof Sentinel) && !Array.isArray(v);

function clone(v) {
  if (v instanceof Timestamp) return new Timestamp(v.seconds, v.nanoseconds);
  if (Array.isArray(v)) return v.map(clone);
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

function same(a, b) {
  if (a instanceof Timestamp || b instanceof Timestamp) return a instanceof Timestamp && a.isEqual(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveValue(v, current) {
  if (v instanceof Sentinel) {
    if (v.kind === 'serverTimestamp') return Timestamp.now();
    const arr = Array.isArray(current) ? current.map(clone) : [];
    if (v.kind === 'arrayUnion') {
      for (const x of v.values) if (!arr.some((y) => same(x, y))) arr.push(clone(x));
      return arr;
    }
    return arr.filter((y) => !v.values.some((x) => same(x, y)));
  }
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x, undefined)]));
  return clone(v);
}

function mergeInto(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (isPlain(v)) target[k] = mergeInto(isPlain(target[k]) ? target[k] : {}, v);
    else target[k] = resolveValue(v, target[k]);
  }
  return target;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isPlain(o[k])) o[k] = {};
    o = o[k];
  }
  const last = keys[keys.length - 1];
  o[last] = resolveValue(value, o[last]);
}

// ---------- Persistência no localStorage ----------

function encode(v) {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(encode);
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}

function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if ('__ts' in v) return Timestamp.fromMillis(v.__ts);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

let collections = {};
function persist() {
  localStorage.setItem(LS_DB, JSON.stringify(encode(collections)));
}
function load() {
  try {
    const raw = localStorage.getItem(LS_DB);
    collections = raw ? decode(JSON.parse(raw)) : {};
  } catch {
    collections = {};
  }
}

const denied = new Set((params.get('deny') || '').split(',').filter(Boolean));

// ---------- Auth ----------

const USERS = [{ uid: 'Ogv5kGERJKguWd5lSux5xDu1zZr1', email: 'teste@agenda.dev', password: 'teste123' }];
let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem(LS_AUTH)); } catch { currentUser = null; }
const authListeners = new Set();
const authObj = { get currentUser() { return currentUser; } };

function setUser(u) {
  currentUser = u;
  localStorage.setItem(LS_AUTH, JSON.stringify(u));
  authListeners.forEach((cb) => cb(currentUser));
}

export const authApi = {
  getAuth: () => authObj,
  browserLocalPersistence: {},
  setPersistence: async () => {},
  onAuthStateChanged(_auth, cb) {
    authListeners.add(cb);
    setTimeout(() => cb(currentUser), 60);
    return () => authListeners.delete(cb);
  },
  async signInWithEmailAndPassword(_auth, email, password) {
    await delay(350);
    const u = USERS.find((x) => x.email === String(email).toLowerCase() && x.password === password);
    if (!u) throw fail('auth/invalid-credential');
    setUser({ uid: u.uid, email: u.email });
    return { user: currentUser };
  },
  async signOut() {
    setUser(null);
  },
  async sendPasswordResetEmail(_auth, email) {
    await delay(200);
    console.info('[mock] e-mail de redefinição enviado para', email);
  }
};

export const appApi = {
  initializeApp: (options) => ({ name: '[DEFAULT]', options })
};

// ---------- Firestore ----------

const dbObj = { type: 'db' };

function collection(_db, name) {
  return { type: 'collection', col: name };
}

function makeDocRef(col, id) {
  return { type: 'doc', col, id, path: `${col}/${id}` };
}

function doc(parent, ...segments) {
  if (parent.type === 'collection') return makeDocRef(parent.col, segments[0] || autoId());
  const parts = segments.length === 1 ? segments[0].split('/') : segments;
  return makeDocRef(parts[0], parts[1]);
}

const query = (ref, ...constraints) => ({ type: 'query', col: ref.col, constraints });
const where = (field, op, value) => ({ kind: 'where', field, op, value });
const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
const limit = (n) => ({ kind: 'limit', n });

function cmp(a, b) {
  const va = a instanceof Timestamp ? a.toMillis() : a;
  const vb = b instanceof Timestamp ? b.toMillis() : b;
  if (va === vb) return 0;
  return va < vb ? -1 : 1;
}

function matches(data, w) {
  const v = getPath(data, w.field);
  if (v === undefined) return false;
  switch (w.op) {
    case '==': return same(v, w.value);
    case '!=': return !same(v, w.value);
    case '<': return cmp(v, w.value) < 0;
    case '<=': return cmp(v, w.value) <= 0;
    case '>': return cmp(v, w.value) > 0;
    case '>=': return cmp(v, w.value) >= 0;
    case 'in': return w.value.some((x) => same(v, x));
    case 'array-contains': return Array.isArray(v) && v.some((x) => same(x, w.value));
    default: throw new Error(`Operador não suportado no mock: ${w.op}`);
  }
}

function checkAccess(col) {
  if (!currentUser) throw fail('permission-denied', 'Não autenticado');
  if (denied.has(col)) throw fail('permission-denied', `Acesso negado a ${col} (simulado)`);
}

class DocSnap {
  constructor(ref, data) {
    this.ref = ref;
    this.id = ref.id;
    this._data = data;
    this.metadata = { fromCache: false, hasPendingWrites: false };
  }
  exists() { return this._data !== undefined; }
  data() { return this._data === undefined ? undefined : clone(this._data); }
  get(field) { return clone(getPath(this._data, field)); }
}

class QuerySnap {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
    this.metadata = { fromCache: false, hasPendingWrites: false };
  }
  forEach(fn) { this.docs.forEach(fn); }
}

function runQuery(target) {
  checkAccess(target.col);
  const colData = collections[target.col] || {};
  let docs = Object.entries(colData).map(([id, data]) => ({ id, data }));
  const constraints = target.constraints || [];
  for (const c of constraints) if (c.kind === 'where') docs = docs.filter((d) => matches(d.data, c));
  const orders = constraints.filter((c) => c.kind === 'orderBy');
  for (const o of orders) docs = docs.filter((d) => getPath(d.data, o.field) !== undefined);
  docs.sort((x, y) => {
    for (const o of orders) {
      const r = cmp(getPath(x.data, o.field), getPath(y.data, o.field));
      if (r) return o.dir === 'desc' ? -r : r;
    }
    return x.id < y.id ? -1 : 1;
  });
  const lim = constraints.find((c) => c.kind === 'limit');
  if (lim) docs = docs.slice(0, lim.n);
  return new QuerySnap(docs.map((d) => new DocSnap(makeDocRef(target.col, d.id), clone(d.data))));
}

function readDoc(ref) {
  checkAccess(ref.col);
  const data = (collections[ref.col] || {})[ref.id];
  return new DocSnap(ref, data === undefined ? undefined : clone(data));
}

const snapshotListeners = new Set();

function deliver(l) {
  try {
    l.next(l.target.type === 'doc' ? readDoc(l.target) : runQuery(l.target));
  } catch (err) {
    snapshotListeners.delete(l);
    if (err.code && l.error) l.error(err);
    else console.error(err);
  }
}

function onSnapshot(target, a, b, c) {
  const [next, error] = typeof a === 'function' ? [a, b] : [b, c];
  const l = { target, next, error };
  snapshotListeners.add(l);
  setTimeout(() => snapshotListeners.has(l) && deliver(l), 40);
  return () => snapshotListeners.delete(l);
}

function applyOps(ops) {
  for (const op of ops) checkAccess(op.ref.col);
  for (const op of ops) {
    const col = (collections[op.ref.col] = collections[op.ref.col] || {});
    if (op.type === 'delete') {
      delete col[op.ref.id];
    } else if (op.type === 'set') {
      col[op.ref.id] = op.merge ? mergeInto(clone(col[op.ref.id] || {}), op.data) : resolveValue(op.data, undefined);
    } else {
      if (!col[op.ref.id]) throw fail('not-found', `Documento inexistente: ${op.ref.path}`);
      const d = clone(col[op.ref.id]);
      for (const [k, v] of Object.entries(op.data)) setPath(d, k, v);
      col[op.ref.id] = d;
    }
  }
  persist();
  setTimeout(() => [...snapshotListeners].forEach(deliver), 20);
}

function writeBatch() {
  const ops = [];
  return {
    set(ref, data, options) { ops.push({ type: 'set', ref, data, merge: !!(options && options.merge) }); return this; },
    update(ref, data) { ops.push({ type: 'update', ref, data }); return this; },
    delete(ref) { ops.push({ type: 'delete', ref }); return this; },
    async commit() {
      await delay(120);
      applyOps(ops);
    }
  };
}

export const fs = {
  Timestamp,
  initializeFirestore: () => dbObj,
  getFirestore: () => dbObj,
  persistentLocalCache: () => ({}),
  persistentMultipleTabManager: () => ({}),
  collection, doc, query, where, orderBy, limit, onSnapshot,
  serverTimestamp, arrayUnion, arrayRemove, writeBatch,
  async getDoc(ref) { await delay(80); return readDoc(ref); },
  async getDocs(target) { await delay(120); return runQuery(target.type === 'collection' ? { ...target, constraints: [] } : target); },
  async setDoc(ref, data, options) { await delay(80); applyOps([{ type: 'set', ref, data, merge: !!(options && options.merge) }]); },
  async updateDoc(ref, data) { await delay(80); applyOps([{ type: 'update', ref, data }]); },
  async deleteDoc(ref) { await delay(80); applyOps([{ type: 'delete', ref }]); },
  async addDoc(colRef, data) { const ref = doc(colRef); await fs.setDoc(ref, data); return ref; }
};

// ---------- Messaging e permissão de notificação ----------

export const messagingApi = {
  isSupported: async () => true,
  getMessaging: () => ({}),
  async getToken() {
    await delay(200);
    let t = localStorage.getItem('mock:token');
    if (!t) {
      t = `mock-token-${autoId()}`;
      localStorage.setItem('mock:token', t);
    }
    return t;
  },
  async deleteToken() {
    localStorage.removeItem('mock:token');
    return true;
  }
};

export const FakeNotification = {
  get permission() { return localStorage.getItem('mock:perm') || 'default'; },
  async requestPermission() {
    await delay(150);
    const answer = localStorage.getItem('mock:permAnswer') || 'granted';
    localStorage.setItem('mock:perm', answer);
    return answer;
  }
};

// ---------- Dados de exemplo ----------

function seed() {
  const now = Date.now();
  const at = (dayOffset, h, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const ts = Timestamp.fromMillis;
  const uid = USERS[0].uid;
  const clients = {
    ana: { name: 'Ana Paula Ribeiro', phone: '(41) 99812-3344', address: 'Rua XV de Novembro, 1200 - Centro, Curitiba', notes: 'Portão azul. Prefere visitas pela manhã.' },
    carlos: { name: 'Carlos Menezes', phone: '41988771122', address: 'Av. Sete de Setembro, 3456 - Batel, Curitiba', notes: '' },
    maria: { name: 'Maria Aparecida Souza', phone: '(41) 3333-4455', address: 'Rua das Palmeiras, 88 - Água Verde, Curitiba', notes: 'Idosa, ligar antes de ir.' },
    rest: { name: 'Restaurante Sabor da Terra', phone: '(41) 99654-7788', address: 'Rua Mateus Leme, 900 - São Francisco, Curitiba', notes: 'Falar com o gerente Roberto.' },
    joao: { name: 'João Pedro Alves', phone: '(41) 99123-4567', address: 'Rua Padre Anchieta, 2050 - Bigorrilho, Curitiba', notes: '' },
    marcos: { name: 'Marcos Vinícius', phone: '', address: '', notes: '' }
  };
  collections = { clients: {}, appointments: {}, users: {}, deviceTokens: {}, system: {}, testPushes: {} };
  for (const [id, c] of Object.entries(clients)) {
    collections.clients[id] = { ...c, nameLower: c.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), createdAt: ts(now - 120 * DAY), updatedAt: ts(now - 120 * DAY) };
  }
  const appt = (id, clientKey, ms, extra = {}) => {
    const c = clients[clientKey];
    collections.appointments[id] = {
      clientId: clientKey, clientName: c.name, phone: c.phone, address: c.address, notes: '',
      datetime: ts(ms), durationMin: 60, status: 'scheduled', visitReport: '',
      createdBy: uid, createdAt: ts(now - 10 * DAY), updatedAt: ts(now - DAY),
      ...initialReminderFields(ms, now - 10 * DAY), ...extra
    };
  };
  const soon = Math.max(now + 3 * HOUR, at(0, 0)) - (now % (15 * MINUTE));
  appt('a1', 'ana', at(0, 8, 30), { notes: 'Manutenção preventiva do ar-condicionado da sala.' });
  appt('a2', 'carlos', soon, { durationMin: 90, notes: 'Instalação de tomada 220V na cozinha.' });
  appt('a3', 'maria', at(1, 14), { notified1Day: true, remindersInfo: { d1: { status: 'sent', atMs: at(0, 14) } } });
  appt('a4', 'rest', at(3, 10, 30), { durationMin: 120, notes: 'Revisão das câmaras frias.' });
  [2, 9, 16, 23].forEach((d, i) => appt(`s${i + 1}`, 'joao', at(d, 8), { seriesId: 'serieJoao', seriesIndex: i + 1, seriesTotal: 4, notes: 'Visita semanal de manutenção.' }));
  appt('p1', 'ana', at(-3, 15), { status: 'done', visitReport: 'Troca do filtro e limpeza geral. Cliente pediu orçamento para instalar mais um aparelho no quarto.', price: 250, paid: true });
  appt('p2', 'carlos', at(-6, 11), { status: 'done', visitReport: 'Revisão completa do quadro de energia. Trocado 1 disjuntor.', price: 180, paid: false });
  appt('p3', 'maria', at(-1, 16), { status: 'canceled' });
  appt('p4', 'marcos', at(-10, 9), { status: 'done', visitReport: 'Orçamento feito no local.' });
  appt('p5', 'rest', at(-2, 17), { notes: 'Visita técnica — aguardando relatório.' });
  appt('old', 'ana', at(-100, 10), { status: 'done', visitReport: 'Primeira visita: instalação do aparelho.', price: 900, paid: true });
  collections.appointments.legacy = {
    clientName: 'Cliente Antigo', ownerUid: uid, address: 'Rua Antiga, 10', notes: 'Criado antes do cadastro de clientes',
    datetime: ts(at(5, 13)), notified1Day: false, notified2h: false, createdAt: ts(now - 30 * DAY)
  };
  collections.system.status = { ok: true, lastRunAt: ts(now - 3 * MINUTE), lastSuccessAt: ts(now - 3 * MINUTE), lastCommitAt: ts(now - 3 * DAY) };
  persist();
}

load();
if (params.has('reset') || !collections.appointments) seed();

// Atalhos para testes pelo console: __mock.seed(), __mock.clear()
window.__mock = {
  seed() { seed(); [...snapshotListeners].forEach(deliver); },
  clear() { localStorage.clear(); location.reload(); },
  data: () => collections
};
