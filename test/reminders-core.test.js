import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReminders } from '../scripts/reminders-core.js';
import { DAY, HOUR, MINUTE } from '../js/logic.js';

const TZ = 'America/Sao_Paulo';
const NOW = Date.UTC(2026, 8, 25, 13, 0); // 25/09 10:00 em SP

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] || {};
  o[keys.at(-1)] = value;
}

function fakeRepo({ appts = [], users = [], tests = [] } = {}) {
  const state = {
    appts: new Map(appts.map((a) => [a.id, structuredClone(a)])),
    users: new Map(users.map((u) => [u.uid, structuredClone(u)])),
    tests: new Map(tests.map((t) => [t.id, structuredClone(t)])),
    status: null
  };
  return {
    state,
    async getUsers() { return [...state.users.values()].map((u) => ({ tokens: [], settings: {}, ...structuredClone(u) })); },
    async removeTokens(uid, tokens) { const u = state.users.get(uid); u.tokens = u.tokens.filter((t) => !tokens.includes(t)); },
    async getAppointmentsBetween(from, to) {
      return [...state.appts.values()].filter((a) => a.datetimeMs >= from && a.datetimeMs <= to).map((a) => structuredClone(a));
    },
    async updateAppointment(appt, updates) {
      const a = state.appts.get(appt.id);
      for (const [k, v] of Object.entries(updates)) setPath(a, k, v);
    },
    async getPendingTestPushes() { return [...state.tests.values()].filter((t) => t.status === 'pending'); },
    async completeTestPush(id, data) { Object.assign(state.tests.get(id), data); },
    async updateUser(uid, data) { Object.assign(state.users.get(uid).settings, data); },
    async writeStatus(data) { state.status = data; }
  };
}

function fakeSender(behavior = () => ({ ok: true })) {
  const sent = [];
  return {
    sent,
    async send(messages) {
      sent.push(...messages);
      return messages.map((m) => behavior(m));
    }
  };
}

const pai = { uid: 'pai', tokens: ['tok-pai'], settings: {} };
const filho = { uid: 'filho', tokens: ['tok-filho'], settings: { notify: false } };

test('envia o lembrete de 1 dia só para quem quer receber e marca como enviado', async () => {
  const repo = fakeRepo({
    appts: [{ id: 'a', clientName: 'João', datetimeMs: NOW + DAY - 2 * MINUTE, notified1Day: false, notified2h: false }],
    users: [pai, filho]
  });
  const sender = fakeSender();
  const stats = await runReminders({ repo, sender, nowMs: NOW, tz: TZ });
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0].token, 'tok-pai');
  assert.match(sender.sent[0].payload.title, /^João — amanhã às /);
  const a = repo.state.appts.get('a');
  assert.equal(a.notified1Day, true);
  assert.equal(a.notified2h, false);
  assert.equal(a.remindersInfo.d1.status, 'sent');
  assert.equal(stats.reminders, 1);
  assert.equal(repo.state.status.ok, true);
  assert.equal(repo.state.status.lastSuccessMs, NOW);
});

test('aparelho cadastrado em duas contas recebe o lembrete uma vez só', async () => {
  const repo = fakeRepo({
    appts: [{ id: 'a', clientName: 'João', datetimeMs: NOW + DAY - MINUTE, notified1Day: false, notified2h: false }],
    users: [{ uid: 'pai', tokens: ['mesmo', 'outro'], settings: {} }, { uid: 'filho', tokens: ['mesmo'], settings: {} }]
  });
  const sender = fakeSender();
  await runReminders({ repo, sender, nowMs: NOW, tz: TZ });
  assert.deepEqual(sender.sent.map((m) => m.token).sort(), ['mesmo', 'outro']);
});

test('não reenvia lembretes já marcados e ignora cancelados', async () => {
  const repo = fakeRepo({
    appts: [
      { id: 'a', clientName: 'A', datetimeMs: NOW + HOUR, notified1Day: true, notified2h: true },
      { id: 'b', clientName: 'B', datetimeMs: NOW + HOUR, notified1Day: false, notified2h: false, status: 'canceled' }
    ],
    users: [pai]
  });
  const sender = fakeSender();
  await runReminders({ repo, sender, nowMs: NOW, tz: TZ });
  assert.equal(sender.sent.length, 0);
});

test('remove tokens inválidos e mantém o lembrete como enviado para os demais', async () => {
  const repo = fakeRepo({
    appts: [{ id: 'a', clientName: 'João', datetimeMs: NOW + 2 * HOUR - MINUTE, notified1Day: true, notified2h: false }],
    users: [{ uid: 'pai', tokens: ['velho', 'novo'], settings: {} }]
  });
  const sender = fakeSender((m) => (m.token === 'velho' ? { ok: false, invalidToken: true, error: 'not-registered' } : { ok: true }));
  const stats = await runReminders({ repo, sender, nowMs: NOW, tz: TZ });
  assert.deepEqual(repo.state.users.get('pai').tokens, ['novo']);
  assert.equal(stats.removedTokens, 1);
  assert.equal(repo.state.appts.get('a').notified2h, true);
});

test('falha temporária sem nenhuma entrega: tenta de novo na próxima rodada', async () => {
  const repo = fakeRepo({
    appts: [{ id: 'a', clientName: 'João', datetimeMs: NOW + 2 * HOUR - MINUTE, notified1Day: true, notified2h: false }],
    users: [pai]
  });
  const failing = fakeSender(() => ({ ok: false, error: 'messaging/internal-error' }));
  await runReminders({ repo, sender: failing, nowMs: NOW, tz: TZ });
  assert.equal(repo.state.appts.get('a').notified2h, false);

  const working = fakeSender();
  await runReminders({ repo, sender: working, nowMs: NOW + 5 * MINUTE, tz: TZ });
  assert.equal(working.sent.length, 1);
  assert.equal(repo.state.appts.get('a').notified2h, true);
});

test('lembrete sem nenhum aparelho cadastrado é marcado para não disparar atrasado depois', async () => {
  const repo = fakeRepo({
    appts: [{ id: 'a', clientName: 'João', datetimeMs: NOW + 2 * HOUR - MINUTE, notified1Day: true, notified2h: false }],
    users: []
  });
  await runReminders({ repo, sender: fakeSender(), nowMs: NOW, tz: TZ });
  assert.equal(repo.state.appts.get('a').notified2h, true);
});

test('processa pedido de notificação de teste para o usuário que pediu', async () => {
  const repo = fakeRepo({
    users: [pai, { uid: 'filho', tokens: ['tok-filho'], settings: { notify: false } }],
    tests: [
      { id: 't1', uid: 'filho', status: 'pending', createdMs: NOW - MINUTE },
      { id: 't2', uid: 'pai', status: 'pending', createdMs: NOW - 2 * DAY }
    ]
  });
  const sender = fakeSender();
  await runReminders({ repo, sender, nowMs: NOW, tz: TZ });
  assert.deepEqual(sender.sent.map((m) => m.token), ['tok-filho']);
  assert.equal(repo.state.tests.get('t1').status, 'sent');
  assert.equal(repo.state.tests.get('t2').status, 'expired');
});

test('resumo diário: uma vez por dia, entre 7h e 12h, só para quem ativou', async () => {
  const todayAt = (h) => Date.UTC(2026, 8, 25, h + 3, 0);
  const repo = fakeRepo({
    appts: [
      { id: 'a', clientName: 'Maria', datetimeMs: todayAt(14), notified1Day: true, notified2h: false },
      { id: 'b', clientName: 'Pedro', datetimeMs: todayAt(16), notified1Day: true, notified2h: false, status: 'canceled' }
    ],
    users: [{ uid: 'pai', tokens: ['tok-pai'], settings: { dailySummary: true } }, { uid: 'outro', tokens: ['tok-outro'], settings: {} }]
  });
  const sender = fakeSender();
  await runReminders({ repo, sender, nowMs: todayAt(7) + 2 * MINUTE, tz: TZ });
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0].payload.title, 'Hoje você tem 1 compromisso');
  assert.equal(sender.sent[0].payload.body, '14:00 Maria');
  assert.equal(repo.state.users.get('pai').settings.lastDailySummary, '2026-09-25');

  const again = fakeSender();
  await runReminders({ repo, sender: again, nowMs: todayAt(8), tz: TZ });
  assert.equal(again.sent.length, 0);
});

test('resumo diário não é enviado fora do horário', async () => {
  const repo = fakeRepo({
    appts: [{ id: 'a', clientName: 'Maria', datetimeMs: Date.UTC(2026, 8, 25, 20, 0), notified1Day: true, notified2h: false }],
    users: [{ uid: 'pai', tokens: ['tok-pai'], settings: { dailySummary: true } }]
  });
  const sender = fakeSender();
  await runReminders({ repo, sender, nowMs: Date.UTC(2026, 8, 25, 8, 0), tz: TZ }); // 05:00 em SP
  assert.equal(sender.sent.length, 0);
});

test('alerta de manutenção quando o último commit está perto de 60 dias', async () => {
  const repo = fakeRepo({
    users: [{ uid: 'admin', tokens: ['tok-admin'], settings: { systemAlerts: true } }, pai]
  });
  const sender = fakeSender();
  await runReminders({ repo, sender, nowMs: NOW, tz: TZ, lastCommitMs: NOW - 55 * DAY });
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0].token, 'tok-admin');
  assert.match(sender.sent[0].payload.body, /em 5 dia/);
  assert.equal(repo.state.status.lastCommitMs, NOW - 55 * DAY);

  const again = fakeSender();
  await runReminders({ repo, sender: again, nowMs: NOW + HOUR, tz: TZ, lastCommitMs: NOW - 55 * DAY });
  assert.equal(again.sent.length, 0);
});
