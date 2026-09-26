import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SCOPE = 'https://exemplo.github.io/agenda-pai/';
const code = await readFile(new URL('../firebase-messaging-sw.js', import.meta.url), 'utf8');

// Carrega o service worker num ambiente simulado e devolve os handlers registrados.
function loadWorker({ windows = [] } = {}) {
  const handlers = {};
  const shown = [];
  const opened = [];
  const self = {
    location: new URL(SCOPE),
    registration: {
      scope: SCOPE,
      showNotification: async (title, options) => { shown.push({ title, options }); }
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url) => { opened.push(url); },
      claim: async () => {}
    },
    skipWaiting: async () => {},
    addEventListener: (type, fn) => { handlers[type] = fn; }
  };
  vm.runInNewContext(code, { self, URL, console, caches: {}, fetch: async () => { throw new Error('offline'); } });
  return { handlers, shown, opened };
}

async function dispatch(handler, event) {
  const pending = [];
  handler({ ...event, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}

test('push "data-only" do servidor vira uma notificação completa', async () => {
  const posted = [];
  const { handlers, shown } = loadWorker({ windows: [{ url: SCOPE, postMessage: (m) => posted.push(m) }] });
  const payload = {
    data: {
      kind: 'reminder', title: 'João — amanhã às 14:00', body: 'Rua X, 10', tag: 'appt-a1',
      url: './?appt=a1', apptId: 'a1', mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Rua%20X'
    },
    from: '123', fcmMessageId: 'abc'
  };
  await dispatch(handlers.push, { data: { json: () => payload, text: () => JSON.stringify(payload) } });
  assert.equal(shown.length, 1, 'mostra exatamente uma notificação');
  assert.equal(shown[0].title, 'João — amanhã às 14:00');
  assert.equal(shown[0].options.body, 'Rua X, 10');
  assert.equal(shown[0].options.tag, 'appt-a1');
  assert.equal(shown[0].options.data.apptId, 'a1');
  assert.equal(shown[0].options.actions[0].action, 'map');
  assert.equal(posted[0].type, 'push');
});

test('push sem mapa não oferece o botão "Abrir no mapa"', async () => {
  const { handlers, shown } = loadWorker();
  await dispatch(handlers.push, { data: { json: () => ({ data: { title: 'Teste', body: 'ok', tag: 'test' } }) } });
  assert.equal(shown[0].options.actions.length, 0);
});

test('push com conteúdo inesperado ainda mostra algo (o Chrome exige)', async () => {
  const { handlers, shown } = loadWorker();
  await dispatch(handlers.push, { data: { json: () => { throw new Error('não é JSON'); }, text: () => 'texto puro' } });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'Agenda');
  assert.equal(shown[0].options.body, 'texto puro');
});

test('tocar na notificação com o app aberto foca a janela e abre o compromisso', async () => {
  const posted = [];
  let focused = false;
  const win = { url: `${SCOPE}?mock`, focus: async () => { focused = true; }, postMessage: (m) => posted.push(m) };
  const { handlers, opened } = loadWorker({ windows: [win] });
  await dispatch(handlers.notificationclick, {
    action: '',
    notification: { close() {}, data: { url: './?appt=a1', apptId: 'a1' } }
  });
  assert.ok(focused);
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ type: 'open-appt', apptId: 'a1' }]);
  assert.equal(opened.length, 0);
});

test('tocar na notificação com o app fechado abre o link do compromisso', async () => {
  const { handlers, opened } = loadWorker();
  await dispatch(handlers.notificationclick, {
    action: '',
    notification: { close() {}, data: { url: './?appt=a1', apptId: 'a1' } }
  });
  assert.deepEqual(opened, [`${SCOPE}?appt=a1`]);
});

test('botão "Abrir no mapa" abre o link do mapa', async () => {
  const { handlers, opened } = loadWorker();
  await dispatch(handlers.notificationclick, {
    action: 'map',
    notification: { close() {}, data: { url: './?appt=a1', mapsUrl: 'https://maps.example/x' } }
  });
  assert.deepEqual(opened, ['https://maps.example/x']);
});
