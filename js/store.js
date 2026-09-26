import { db, fs } from './firebase.js';
import { toast } from './ui.js';
import {
  DEFAULT_DURATION, STATUS_LABEL, statusOf, normalizeName, initialReminderFields,
  recurrenceDates, dayKey, timeHM, formatDuration, toCsv
} from './logic.js';

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(topic) {
  for (const fn of [...listeners]) {
    try { fn(topic); } catch (err) { console.error(err); }
  }
}

const state = {
  user: null,
  live: new Map(),
  archive: new Map(),
  loadedMonths: new Set(),
  clients: new Map(),
  settings: {},
  status: null,
  ready: { appointments: false, clients: false },
  fromServer: { appointments: false, clients: false },
  errors: {},
  windowStartMs: 0
};
let unsubs = [];
let migrated = false;
let sortedCache = null;

// ---------- Leitura ----------

export const getUser = () => state.user;
export const getSettings = () => state.settings;
export const getStatus = () => state.status;
export const getErrors = () => state.errors;
export const isReady = () => state.ready.appointments;
export const windowStart = () => state.windowStartMs;

export function getAppointment(id) {
  return state.live.get(id) || state.archive.get(id) || null;
}

export function allAppointments() {
  if (!sortedCache) {
    const merged = new Map(state.archive);
    for (const [id, a] of state.live) merged.set(id, a);
    sortedCache = [...merged.values()].sort((a, b) => a.datetimeMs - b.datetimeMs);
  }
  return sortedCache;
}

export function getClients() {
  return [...state.clients.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export const getClient = (id) => state.clients.get(id) || null;

export function findClientByName(name) {
  const key = normalizeName(name);
  if (!key) return null;
  for (const c of state.clients.values()) if (c.nameLower === key || normalizeName(c.name) === key) return c;
  return null;
}

function normAppt(snap) {
  const d = snap.data();
  const remindersInfo = {};
  for (const [k, v] of Object.entries(d.remindersInfo || {})) remindersInfo[k] = { ...v };
  return {
    ...d,
    id: snap.id,
    clientName: d.clientName || '',
    phone: d.phone || '',
    address: d.address || '',
    notes: d.notes || '',
    visitReport: d.visitReport || '',
    datetimeMs: d.datetime && d.datetime.toMillis ? d.datetime.toMillis() : 0,
    durationMin: d.durationMin || DEFAULT_DURATION,
    status: statusOf(d),
    remindersInfo,
    pendingWrite: !!(snap.metadata && snap.metadata.hasPendingWrites)
  };
}

function normClient(snap) {
  const d = snap.data();
  return {
    ...d,
    id: snap.id,
    name: d.name || '',
    phone: d.phone || '',
    address: d.address || '',
    notes: d.notes || '',
    createdMs: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : null
  };
}

function normStatus(d) {
  const ms = (t) => (t && t.toMillis ? t.toMillis() : null);
  return { ...d, lastRunMs: ms(d.lastRunAt), lastSuccessMs: ms(d.lastSuccessAt), lastCommitMs: ms(d.lastCommitAt) };
}

function onError(topic, err) {
  console.error(`Erro ao sincronizar ${topic}:`, err);
  state.errors[topic] = err.code || 'unknown';
  if (topic === 'appointments') state.ready.appointments = true;
  if (topic === 'clients') state.ready.clients = true;
  emit('error');
}

// ---------- Sincronização ----------

export function start(user) {
  stop();
  state.user = user;
  const now = new Date();
  // Mantém sincronizado em tempo real só os últimos ~2 meses + futuro; meses antigos carregam sob demanda.
  state.windowStartMs = new Date(now.getFullYear(), now.getMonth() - 2, 1).getTime();

  const apptQuery = fs.query(
    fs.collection(db, 'appointments'),
    fs.where('datetime', '>=', fs.Timestamp.fromMillis(state.windowStartMs)),
    fs.orderBy('datetime')
  );
  unsubs.push(fs.onSnapshot(apptQuery, (snap) => {
    state.live = new Map(snap.docs.map((d) => [d.id, normAppt(d)]));
    sortedCache = null;
    state.ready.appointments = true;
    state.fromServer.appointments = state.fromServer.appointments || !snap.metadata.fromCache;
    delete state.errors.appointments;
    emit('appointments');
    migrateLegacy();
  }, (err) => onError('appointments', err)));

  unsubs.push(fs.onSnapshot(fs.collection(db, 'clients'), (snap) => {
    state.clients = new Map(snap.docs.map((d) => [d.id, normClient(d)]));
    state.ready.clients = true;
    state.fromServer.clients = state.fromServer.clients || !snap.metadata.fromCache;
    delete state.errors.clients;
    emit('clients');
    migrateLegacy();
  }, (err) => onError('clients', err)));

  unsubs.push(fs.onSnapshot(fs.doc(db, 'users', user.uid), (snap) => {
    state.settings = snap.exists() ? snap.data() : {};
    emit('settings');
  }, (err) => onError('settings', err)));

  unsubs.push(fs.onSnapshot(fs.doc(db, 'system', 'status'), (snap) => {
    state.status = snap.exists() ? normStatus(snap.data()) : null;
    emit('status');
  }, (err) => onError('status', err)));
}

export function stop() {
  unsubs.forEach((u) => u());
  unsubs = [];
  migrated = false;
  sortedCache = null;
  Object.assign(state, {
    user: null, live: new Map(), archive: new Map(), loadedMonths: new Set(), clients: new Map(),
    settings: {}, status: null, errors: {},
    ready: { appointments: false, clients: false },
    fromServer: { appointments: false, clients: false }
  });
}

export async function ensureMonthLoaded(year, month) {
  const start = new Date(year, month, 1).getTime();
  if (!state.user || start >= state.windowStartMs) return;
  const key = `${year}-${month}`;
  if (state.loadedMonths.has(key)) return;
  state.loadedMonths.add(key);
  const end = new Date(year, month + 1, 1).getTime();
  try {
    const snap = await fs.getDocs(fs.query(
      fs.collection(db, 'appointments'),
      fs.where('datetime', '>=', fs.Timestamp.fromMillis(start)),
      fs.where('datetime', '<', fs.Timestamp.fromMillis(end)),
      fs.orderBy('datetime')
    ));
    snap.docs.forEach((d) => state.archive.set(d.id, normAppt(d)));
    sortedCache = null;
    emit('appointments');
  } catch (err) {
    state.loadedMonths.delete(key);
    console.error(err);
  }
}

async function refreshArchived(id) {
  if (!state.archive.has(id)) return;
  const snap = await fs.getDoc(fs.doc(db, 'appointments', id));
  if (snap.exists()) state.archive.set(id, normAppt(snap));
  else state.archive.delete(id);
  sortedCache = null;
  emit('appointments');
}

// Compromissos antigos (criados antes do cadastro de clientes) ganham uma ficha de cliente automaticamente.
function migrateLegacy() {
  if (migrated || !state.fromServer.appointments || !state.fromServer.clients || state.errors.clients) return;
  migrated = true;
  const legacy = [...state.live.values()].filter((a) => !a.clientId && a.clientName.trim());
  if (!legacy.length) return;
  const batch = fs.writeBatch(db);
  const byName = new Map([...state.clients.values()].map((c) => [c.nameLower || normalizeName(c.name), c.id]));
  for (const a of legacy) {
    const key = normalizeName(a.clientName);
    let clientId = byName.get(key);
    if (!clientId) {
      const ref = fs.doc(fs.collection(db, 'clients'));
      batch.set(ref, {
        name: a.clientName.trim(), nameLower: key, phone: a.phone, address: a.address, notes: '',
        createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp()
      });
      clientId = ref.id;
      byName.set(key, clientId);
    }
    batch.update(fs.doc(db, 'appointments', a.id), { clientId });
  }
  batch.commit().catch((err) => console.warn('Migração de clientes falhou:', err));
}

// ---------- Escrita ----------
// As escritas não bloqueiam a tela: o Firestore aplica localmente na hora (funciona offline)
// e confirma no servidor em segundo plano. Erros aparecem como aviso.

function friendlyError(err) {
  if (err && err.code === 'permission-denied') return 'Sem permissão para salvar. As regras do banco precisam ser atualizadas.';
  return 'Não foi possível salvar. Tente novamente.';
}

function commit(batch, okMessage, afterCommit) {
  batch.commit().then(afterCommit, (err) => {
    console.error(err);
    toast(friendlyError(err), { type: 'error', duration: 6000 });
  });
  if (okMessage) toast(navigator.onLine ? okMessage : `${okMessage} — será sincronizado quando houver internet`);
}

function resolveClient(batch, input) {
  const name = input.clientName.trim();
  const key = normalizeName(name);
  let client = input.clientId ? state.clients.get(input.clientId) : null;
  if (client && normalizeName(client.name) !== key) client = null;
  if (!client) client = findClientByName(name);
  if (client) {
    const patch = {};
    if (!client.phone && input.phone) patch.phone = input.phone;
    if (!client.address && input.address) patch.address = input.address;
    if (Object.keys(patch).length) batch.update(fs.doc(db, 'clients', client.id), { ...patch, updatedAt: fs.serverTimestamp() });
    return client.id;
  }
  const ref = fs.doc(fs.collection(db, 'clients'));
  batch.set(ref, {
    name, nameLower: key, phone: input.phone, address: input.address, notes: '',
    createdBy: state.user.uid, createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp()
  });
  return ref.id;
}

// input: { clientId, clientName, phone, address, notes, datetimeMs, durationMin }
export function saveAppointment(input, { id = null, repeat = 'none', repeatCount = 1 } = {}) {
  const clean = {
    ...input,
    clientName: input.clientName.trim(),
    phone: (input.phone || '').trim(),
    address: (input.address || '').trim(),
    notes: (input.notes || '').trim()
  };
  const now = Date.now();
  const batch = fs.writeBatch(db);
  const clientId = state.errors.clients ? (clean.clientId || null) : resolveClient(batch, clean);
  const base = {
    clientId,
    clientName: clean.clientName,
    phone: clean.phone,
    address: clean.address,
    notes: clean.notes,
    durationMin: clean.durationMin || DEFAULT_DURATION,
    updatedAt: fs.serverTimestamp()
  };

  if (id) {
    const prev = getAppointment(id);
    const patch = { ...base, datetime: fs.Timestamp.fromMillis(clean.datetimeMs) };
    // Remarcou: os lembretes voltam a valer para o novo horário.
    if (!prev || prev.datetimeMs !== clean.datetimeMs) Object.assign(patch, initialReminderFields(clean.datetimeMs, now));
    batch.update(fs.doc(db, 'appointments', id), patch);
    commit(batch, 'Compromisso atualizado', () => refreshArchived(id));
    return [id];
  }

  const dates = recurrenceDates(clean.datetimeMs, repeat, repeatCount);
  const seriesId = dates.length > 1 ? fs.doc(fs.collection(db, 'appointments')).id : null;
  const ids = dates.map((ms, i) => {
    const ref = fs.doc(fs.collection(db, 'appointments'));
    batch.set(ref, {
      ...base,
      datetime: fs.Timestamp.fromMillis(ms),
      status: 'scheduled',
      visitReport: '',
      seriesId,
      seriesIndex: seriesId ? i + 1 : null,
      seriesTotal: seriesId ? dates.length : null,
      createdBy: state.user.uid,
      createdAt: fs.serverTimestamp(),
      ...initialReminderFields(ms, now)
    });
    return ref.id;
  });
  commit(batch, dates.length > 1 ? `${dates.length} compromissos criados` : 'Compromisso salvo');
  return ids;
}

function patchAppointment(id, patch, okMessage) {
  const batch = fs.writeBatch(db);
  batch.update(fs.doc(db, 'appointments', id), { ...patch, updatedAt: fs.serverTimestamp() });
  commit(batch, okMessage, () => refreshArchived(id));
}

export function saveVisitReport(id, { report, price, paid }, { complete = false, quiet = false } = {}) {
  const patch = { visitReport: report.trim(), price: typeof price === 'number' ? price : null, paid: !!paid };
  if (complete) Object.assign(patch, { status: 'done', completedAt: fs.serverTimestamp() });
  patchAppointment(id, patch, quiet ? null : (complete ? 'Visita concluída' : 'Relatório salvo'));
}

export function setPaid(id, paid) {
  patchAppointment(id, { paid: !!paid }, paid ? 'Marcado como pago' : 'Marcado como não pago');
}

export function cancelAppointment(id) {
  patchAppointment(id, { status: 'canceled', canceledAt: fs.serverTimestamp() }, 'Compromisso cancelado');
}

export function reopenAppointment(id) {
  patchAppointment(id, { status: 'scheduled' }, 'Compromisso reaberto');
}

export function deleteAppointment(id) {
  const batch = fs.writeBatch(db);
  batch.delete(fs.doc(db, 'appointments', id));
  state.archive.delete(id);
  sortedCache = null;
  commit(batch, 'Compromisso excluído');
}

export async function deleteSeriesFrom(seriesId, fromMs) {
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'appointments'), fs.where('seriesId', '==', seriesId)));
  const targets = snap.docs.filter((d) => {
    const t = d.data().datetime;
    return t && t.toMillis() >= fromMs;
  });
  const batch = fs.writeBatch(db);
  targets.forEach((d) => {
    batch.delete(d.ref);
    state.archive.delete(d.id);
  });
  sortedCache = null;
  commit(batch, targets.length === 1 ? 'Compromisso excluído' : `${targets.length} compromissos excluídos`);
  return targets.length;
}

// ---------- Clientes ----------

export function saveClient(input, id = null) {
  const data = {
    name: input.name.trim(),
    nameLower: normalizeName(input.name),
    phone: (input.phone || '').trim(),
    address: (input.address || '').trim(),
    notes: (input.notes || '').trim(),
    updatedAt: fs.serverTimestamp()
  };
  const batch = fs.writeBatch(db);
  if (!id) {
    const ref = fs.doc(fs.collection(db, 'clients'));
    batch.set(ref, { ...data, createdBy: state.user.uid, createdAt: fs.serverTimestamp() });
    commit(batch, 'Cliente cadastrado');
    return ref.id;
  }
  const prev = state.clients.get(id);
  batch.update(fs.doc(db, 'clients', id), data);
  commit(batch, 'Cliente atualizado');
  if (prev && (prev.name !== data.name || prev.phone !== data.phone)) propagateClient(id, prev, data);
  return id;
}

// Atualiza nome/telefone nos compromissos do cliente (os futuros herdam o telefone novo).
async function propagateClient(id, prev, data) {
  try {
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'appointments'), fs.where('clientId', '==', id)));
    const now = Date.now();
    const batch = fs.writeBatch(db);
    let n = 0;
    snap.docs.forEach((d) => {
      const a = d.data();
      const patch = {};
      if (prev.name !== data.name) patch.clientName = data.name;
      const future = a.datetime && a.datetime.toMillis() >= now;
      if (future && prev.phone !== data.phone && (!a.phone || a.phone === prev.phone)) patch.phone = data.phone;
      if (Object.keys(patch).length && n < 450) {
        batch.update(d.ref, patch);
        n++;
      }
    });
    if (n) await batch.commit();
  } catch (err) {
    console.error('Falha ao atualizar compromissos do cliente:', err);
  }
}

export function deleteClient(id) {
  const batch = fs.writeBatch(db);
  batch.delete(fs.doc(db, 'clients', id));
  commit(batch, 'Cliente excluído');
}

export async function clientHistory(clientId) {
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'appointments'), fs.where('clientId', '==', clientId)));
  const map = new Map(snap.docs.map((d) => [d.id, normAppt(d)]));
  for (const a of state.live.values()) if (a.clientId === clientId) map.set(a.id, a);
  return [...map.values()].sort((a, b) => b.datetimeMs - a.datetimeMs);
}

// ---------- Preferências, teste de notificação, exportação ----------

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  emit('settings');
  fs.setDoc(fs.doc(db, 'users', state.user.uid), patch, { merge: true }).catch((err) => {
    console.error(err);
    toast(friendlyError(err), { type: 'error' });
  });
}

export async function requestTestPush() {
  const ref = fs.doc(fs.collection(db, 'testPushes'));
  await fs.setDoc(ref, { uid: state.user.uid, status: 'pending', createdAt: fs.serverTimestamp() });
  return ref.id;
}

export function watchTestPush(id, cb) {
  return fs.onSnapshot(fs.doc(db, 'testPushes', id), (snap) => cb(snap.exists() ? snap.data() : null), () => {});
}

export async function exportCsv() {
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'appointments'), fs.orderBy('datetime')));
  const rows = snap.docs.map(normAppt).map((a) => {
    const [y, m, d] = dayKey(a.datetimeMs).split('-');
    const hasPrice = typeof a.price === 'number';
    return [
      `${d}/${m}/${y}`, timeHM(a.datetimeMs), formatDuration(a.durationMin), a.clientName, a.phone, a.address,
      STATUS_LABEL[a.status], a.notes, a.visitReport,
      hasPrice ? a.price.toFixed(2).replace('.', ',') : '',
      hasPrice && a.status === 'done' ? (a.paid ? 'Sim' : 'Não') : ''
    ];
  });
  return toCsv(
    ['Data', 'Hora', 'Duração', 'Cliente', 'Telefone', 'Endereço', 'Situação', 'Observações', 'Relatório da visita', 'Valor (R$)', 'Pago'],
    rows
  );
}
