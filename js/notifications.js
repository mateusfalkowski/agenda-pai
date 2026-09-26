import { app, db, fs, messagingApi, MOCK, mock } from './firebase.js';
import { vapidKey } from '../firebase-config.js';
import { toast } from './ui.js';

const TOKEN_KEY = 'agenda:fcmToken';
const Notif = MOCK ? mock.FakeNotification : (typeof Notification !== 'undefined' ? Notification : null);

let registration = null;
let swPromise = null;
let supportedPromise = null;
let deferredInstall = null;
const handlers = { openAppointment: () => {}, changed: () => {} };

export function setHandlers(h) {
  Object.assign(handlers, h);
}

// ---------- Service worker (cache offline + recebimento de push) ----------

export function registerServiceWorker() {
  if (!swPromise) swPromise = doRegister();
  return swPromise;
}

async function doRegister() {
  if (!('serviceWorker' in navigator)) return null;
  const hadController = !!navigator.serviceWorker.controller;
  try {
    registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' });
  } catch (err) {
    console.warn('Falha ao registrar o service worker:', err);
    swPromise = null; // permite tentar de novo depois
    return null;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) {
      toast('Nova versão do app instalada.', { action: { label: 'Recarregar', onClick: () => location.reload() } });
    }
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'open-appt' && msg.apptId) handlers.openAppointment(msg.apptId);
    if (msg.type === 'push' && msg.data && msg.data.kind === 'test') handlers.changed();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && registration) registration.update().catch(() => {});
  });
  return registration;
}

// ---------- Instalação na tela inicial ----------

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  handlers.changed();
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  handlers.changed();
});

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const canInstall = () => !!deferredInstall;

export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  handlers.changed();
  return outcome === 'accepted';
}

// ---------- Notificações push ----------

let supported = null;

export function pushSupported() {
  if (!supportedPromise) {
    supportedPromise = (async () => {
      if (!Notif || !('serviceWorker' in navigator)) return false;
      if (!MOCK && !('PushManager' in window)) return false;
      try { return await messagingApi.isSupported(); } catch { return false; }
    })().then((value) => {
      supported = value;
      handlers.changed();
      return value;
    });
  }
  return supportedPromise;
}

// Resultado já conhecido de pushSupported() (null enquanto verifica).
export const supportedValue = () => supported;

export function permission() {
  return Notif ? Notif.permission : 'unsupported';
}

export function hasLocalToken() {
  return !!localStorage.getItem(TOKEN_KEY);
}

function withTimeout(promise, ms, message) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

async function obtainToken(uid) {
  const reg = MOCK ? null : (registration || (await registerServiceWorker()));
  if (!MOCK && !reg) throw new Error('Service worker indisponível neste navegador');
  const messaging = messagingApi.getMessaging(app);
  const token = await withTimeout(
    messagingApi.getToken(messaging, { vapidKey, serviceWorkerRegistration: reg }),
    20000, 'Tempo esgotado ao obter o token de notificação'
  );
  if (!token) throw new Error('Sem token de notificação');
  const ref = fs.doc(db, 'deviceTokens', uid);
  await fs.setDoc(ref, { tokens: fs.arrayUnion(token), updatedAt: fs.serverTimestamp() }, { merge: true });
  const previous = localStorage.getItem(TOKEN_KEY);
  if (previous && previous !== token) {
    fs.updateDoc(ref, { tokens: fs.arrayRemove(previous) }).catch(() => {});
  }
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

// Pede permissão e cadastra este aparelho para receber os lembretes.
export async function enable(uid) {
  if (!(await pushSupported())) return { ok: false, reason: 'unsupported' };
  const result = await Notif.requestPermission();
  handlers.changed();
  if (result !== 'granted') return { ok: false, reason: result };
  try {
    await obtainToken(uid);
    handlers.changed();
    return { ok: true };
  } catch (err) {
    console.error('Falha ao ativar notificações:', err);
    return { ok: false, reason: 'token' };
  }
}

// Ao abrir o app: renova o token (o FCM troca de tempos em tempos) se a permissão já foi dada.
export async function refreshIfGranted(uid) {
  if (permission() !== 'granted' || !(await pushSupported())) return;
  try { await obtainToken(uid); } catch (err) { console.warn('Não foi possível renovar o token:', err); }
  handlers.changed();
}

// Remove este aparelho da lista de quem recebe lembretes (usado em "Desativar" e ao sair da conta).
export async function disable(uid) {
  const token = localStorage.getItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  try {
    if (token && uid) await fs.updateDoc(fs.doc(db, 'deviceTokens', uid), { tokens: fs.arrayRemove(token) });
    if (await pushSupported()) await messagingApi.deleteToken(messagingApi.getMessaging(app));
  } catch (err) {
    console.warn('Falha ao remover o token:', err);
  }
  handlers.changed();
}

export async function showLocalTest() {
  if (MOCK) {
    toast('[simulação] Notificação local exibida');
    return;
  }
  const reg = registration || (await registerServiceWorker());
  if (!reg) throw new Error('Service worker indisponível');
  await reg.showNotification('Notificação de teste (local) ✅', {
    body: 'Este aparelho consegue exibir notificações da agenda.',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: 'local-test'
  });
}
