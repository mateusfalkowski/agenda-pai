import { auth, authApi, MOCK } from './firebase.js';
import * as store from './store.js';
import * as notifications from './notifications.js';
import { toast, closeAllSheets } from './ui.js';
import { renderAgenda, setAgendaHandlers, selectedDay } from './views/agenda.js';
import { renderClients, openClientForm } from './views/clients.js';
import { renderSettings, setSettingsHandlers } from './views/settings.js';
import { openAppointmentDetail, openAppointmentForm } from './views/appointment.js';

const APP_VERSION = '2.0.0';
const TITLES = { agenda: 'Agenda', clients: 'Clientes', settings: 'Ajustes' };
const VIEWS = { agenda: renderAgenda, clients: renderClients, settings: renderSettings };
const $ = (id) => document.getElementById(id);

let tab = 'agenda';
let renderQueued = false;

// Links vindos de notificações (?appt=ID), do atalho do app (?new) ou internos (?tab=settings).
const params = new URLSearchParams(location.search);
const deepLink = { appt: params.get('appt'), tab: params.get('tab'), newAppt: params.has('new') };
history.replaceState(history.state, '', location.pathname + (MOCK ? '?mock' : ''));

function renderNow() {
  if (!store.getUser()) return;
  VIEWS[tab]($(`view-${tab}`));
}

// Junta várias atualizações seguidas num único redesenho.
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    renderNow();
  }, 16);
}

function showTab(name) {
  if (!VIEWS[name]) name = 'agenda';
  tab = name;
  for (const t of Object.keys(VIEWS)) $(`view-${t}`).hidden = t !== name;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('view-title').textContent = TITLES[name];
  $('fab').hidden = name === 'settings';
  $('fab').setAttribute('aria-label', name === 'clients' ? 'Novo cliente' : 'Novo compromisso');
  window.scrollTo(0, 0);
  renderNow();
}

function openAppointmentWhenReady(id) {
  if (store.isReady()) {
    if (store.getAppointment(id)) openAppointmentDetail(id);
    else toast('Esse compromisso não existe mais.');
    return;
  }
  deepLink.appt = id;
}

// ---------- Login ----------

const AUTH_ERRORS = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
  'auth/user-disabled': 'Esta conta foi desativada.'
};

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const errorEl = $('login-error');
  errorEl.textContent = '';
  if (!email || !password) {
    errorEl.textContent = 'Preencha e-mail e senha.';
    return;
  }
  $('login-btn').disabled = true;
  try {
    await authApi.setPersistence(auth, authApi.browserLocalPersistence);
    await authApi.signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errorEl.textContent = AUTH_ERRORS[err.code] || 'Não foi possível entrar. Tente novamente.';
  } finally {
    $('login-btn').disabled = false;
  }
});

$('forgot-btn').addEventListener('click', async () => {
  const email = $('login-email').value.trim();
  const errorEl = $('login-error');
  if (!email) {
    errorEl.textContent = 'Digite seu e-mail acima e toque de novo em "Esqueci minha senha".';
    $('login-email').focus();
    return;
  }
  try {
    await authApi.sendPasswordResetEmail(auth, email);
    errorEl.textContent = '';
    toast(`Se esse e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.`, { duration: 6000 });
  } catch (err) {
    errorEl.textContent = AUTH_ERRORS[err.code] || 'Não foi possível enviar o e-mail agora.';
  }
});

$('toggle-password').addEventListener('click', () => {
  const input = $('login-password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('toggle-password').setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  $('toggle-password').querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
});

async function logout() {
  const user = store.getUser();
  await closeAllSheets();
  if (user) await notifications.disable(user.uid);
  await authApi.signOut(auth);
}

// ---------- Estrutura do app ----------

document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

$('fab').addEventListener('click', () => {
  if (tab === 'clients') openClientForm();
  else openAppointmentForm({ preset: { dateKey: selectedDay() } });
});

function updateOnline() {
  $('offline-pill').hidden = navigator.onLine;
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();

setAgendaHandlers({ goToSettings: () => showTab('settings') });
setSettingsHandlers({ logout, version: APP_VERSION + (MOCK ? ' (modo de teste)' : '') });
notifications.setHandlers({
  openAppointment: (id) => {
    if (!store.getUser()) return;
    closeAllSheets().then(() => openAppointmentWhenReady(id));
  },
  changed: scheduleRender
});

store.subscribe((topic) => {
  if (topic === 'appointments' && deepLink.appt && store.isReady()) {
    const id = deepLink.appt;
    deepLink.appt = null;
    openAppointmentWhenReady(id);
  }
  scheduleRender();
});

// Mantém "hoje", horários relativos e avisos atualizados com o app aberto.
setInterval(scheduleRender, 60 * 1000);

notifications.registerServiceWorker();
notifications.pushSupported();

authApi.onAuthStateChanged(auth, (user) => {
  $('boot').hidden = true;
  if (user) {
    $('login-screen').hidden = true;
    $('app').hidden = false;
    store.start(user);
    showTab(deepLink.tab || tab);
    deepLink.tab = null;
    notifications.refreshIfGranted(user.uid);
    if (deepLink.newAppt) {
      deepLink.newAppt = false;
      openAppointmentForm();
    }
  } else {
    store.stop();
    closeAllSheets();
    $('app').hidden = true;
    $('login-screen').hidden = false;
    $('login-password').value = '';
  }
});
