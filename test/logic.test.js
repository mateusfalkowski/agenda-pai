import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY, HOUR, MINUTE, REMINDERS, initialReminderFields, reminderDecisions, reminderStatus,
  reminderMessage, dailySummaryMessage, dayKey, timeHM, hourOf, relativeDay, dayTitle,
  recurrenceDates, findConflicts, whatsappNumber, whatsappLink, telLink, formatPhone,
  parseMoney, normalizeName, toCsv, schedulerHealth, maintenanceInfo, monthStats,
  confirmationText, clientMatches, formatDuration, daysBetweenKeys, statusOf
} from '../js/logic.js';

const TZ = 'America/Sao_Paulo';
const D1 = REMINDERS.find((r) => r.id === 'd1');
const H2 = REMINDERS.find((r) => r.id === 'h2');
// 25/09/2026 10:00 em São Paulo (UTC-3)
const NOW = Date.UTC(2026, 8, 25, 13, 0);

const appt = (over = {}) => ({
  id: 'a1', clientName: 'João Silva', address: 'Rua das Flores, 123',
  datetimeMs: NOW + 26 * HOUR, notified1Day: false, notified2h: false, ...over
});

test('initialReminderFields pula lembretes cujo horário já passou', () => {
  assert.deepEqual(initialReminderFields(NOW + 30 * HOUR, NOW), { notified1Day: false, notified2h: false, remindersInfo: {} });
  const close = initialReminderFields(NOW + 5 * HOUR, NOW);
  assert.equal(close.notified1Day, true);
  assert.equal(close.notified2h, false);
  assert.deepEqual(close.remindersInfo, { d1: { status: 'skipped' } });
  const veryClose = initialReminderFields(NOW + 90 * MINUTE, NOW);
  assert.equal(veryClose.notified1Day, true);
  assert.equal(veryClose.notified2h, true);
});

test('reminderDecisions: nada antes da hora, envia na janela certa', () => {
  assert.deepEqual(reminderDecisions(appt(), NOW), []);
  const at1d = reminderDecisions(appt({ datetimeMs: NOW + DAY - MINUTE }), NOW);
  assert.deepEqual(at1d.map((d) => [d.reminder.id, d.action]), [['d1', 'send']]);
  const at2h = reminderDecisions(appt({ datetimeMs: NOW + 2 * HOUR - MINUTE, notified1Day: true }), NOW);
  assert.deepEqual(at2h.map((d) => [d.reminder.id, d.action]), [['h2', 'send']]);
});

test('reminderDecisions: lembrete de 1 dia atrasado vira "pulado" quando o de 2h já venceu', () => {
  const late = reminderDecisions(appt({ datetimeMs: NOW + HOUR }), NOW);
  assert.deepEqual(late.map((d) => [d.reminder.id, d.action]), [['d1', 'skip'], ['h2', 'send']]);
});

test('reminderDecisions: compromisso passado, cancelado ou concluído', () => {
  const past = reminderDecisions(appt({ datetimeMs: NOW - MINUTE }), NOW);
  assert.deepEqual(past.map((d) => d.action), ['skip', 'skip']);
  assert.deepEqual(reminderDecisions(appt({ datetimeMs: NOW + HOUR, status: 'canceled' }), NOW), []);
  assert.deepEqual(reminderDecisions(appt({ datetimeMs: NOW + HOUR, status: 'done' }), NOW), []);
  assert.deepEqual(reminderDecisions(appt({ datetimeMs: NOW + HOUR, notified1Day: true, notified2h: true }), NOW), []);
});

test('reminderStatus descreve cada situação', () => {
  assert.equal(reminderStatus(appt(), D1, NOW).state, 'scheduled');
  assert.equal(reminderStatus(appt({ notified1Day: true }), D1, NOW).state, 'sent');
  assert.equal(reminderStatus(appt({ notified1Day: true, remindersInfo: { d1: { status: 'skipped' } } }), D1, NOW).state, 'skipped');
  assert.equal(reminderStatus(appt({ datetimeMs: NOW - HOUR }), H2, NOW).state, 'off');
  assert.equal(reminderStatus(appt({ status: 'canceled' }), H2, NOW).state, 'off');
});

test('datas no fuso de São Paulo', () => {
  const lateNight = Date.UTC(2026, 8, 25, 2, 30); // 24/09 23:30 em SP
  assert.equal(dayKey(lateNight, TZ), '2026-09-24');
  assert.equal(timeHM(lateNight, TZ), '23:30');
  assert.equal(hourOf(NOW, TZ), 10);
  assert.equal(relativeDay(NOW + DAY, NOW, TZ), 'amanhã');
  assert.equal(relativeDay(NOW, NOW, TZ), 'hoje');
  assert.equal(relativeDay(NOW + 3 * DAY, NOW, TZ), 'segunda-feira');
  assert.equal(relativeDay(NOW + 10 * DAY, NOW, TZ), 'segunda, 05/10');
  assert.equal(daysBetweenKeys('2026-09-30', '2026-10-01'), 1);
  assert.equal(dayTitle('2026-09-26', '2026-09-25'), 'Amanhã · sábado, 26 de setembro');
  assert.equal(dayTitle('2026-09-30', '2026-09-25'), 'Quarta, 30 de setembro');
});

test('reminderMessage monta título, corpo e validade', () => {
  const a = appt({ datetimeMs: Date.UTC(2026, 8, 26, 17, 0) }); // 26/09 14:00 SP
  const m1 = reminderMessage(a, D1, a.datetimeMs - DAY, TZ);
  assert.equal(m1.title, 'João Silva — amanhã às 14:00');
  assert.equal(m1.body, 'Rua das Flores, 123');
  assert.equal(m1.url, './?appt=a1');
  assert.ok(m1.mapsUrl.startsWith('https://www.google.com/maps/'));
  assert.equal(m1.ttlSeconds, 24 * 3600);
  const m2 = reminderMessage(a, H2, a.datetimeMs - 2 * HOUR, TZ);
  assert.equal(m2.title, 'João Silva — hoje às 14:00');
  assert.equal(m2.body, 'Faltam 2 horas · Rua das Flores, 123');
  const late = reminderMessage({ ...a, address: '' , notes: 'Levar peças' }, H2, a.datetimeMs - 100 * MINUTE, TZ);
  assert.equal(late.body, 'Faltam 1h 40min · Levar peças');
});

test('dailySummaryMessage lista os horários em ordem', () => {
  const base = Date.UTC(2026, 8, 25, 12, 0);
  const m = dailySummaryMessage([
    { clientName: 'Maria', datetimeMs: base + 5 * HOUR },
    { clientName: 'Pedro', datetimeMs: base }
  ], TZ);
  assert.equal(m.title, 'Hoje você tem 2 compromissos');
  assert.equal(m.body, '09:00 Pedro · 14:00 Maria');
});

test('recurrenceDates: semanal, quinzenal e mensal com ajuste de fim de mês', () => {
  const start = new Date(2027, 0, 31, 9, 30).getTime();
  const monthly = recurrenceDates(start, 'monthly', 3).map((ms) => new Date(ms));
  assert.deepEqual(monthly.map((d) => [d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]), [[0, 31, 9, 30], [1, 28, 9, 30], [2, 31, 9, 30]]);
  const weekly = recurrenceDates(start, 'weekly', 2).map((ms) => new Date(ms));
  assert.deepEqual(weekly.map((d) => [d.getMonth(), d.getDate()]), [[0, 31], [1, 7]]);
  const biweekly = recurrenceDates(start, 'biweekly', 2).map((ms) => new Date(ms));
  assert.deepEqual(biweekly.map((d) => [d.getMonth(), d.getDate()]), [[0, 31], [1, 14]]);
  assert.deepEqual(recurrenceDates(start, 'none', 5), [start]);
});

test('findConflicts considera duração e ignora cancelados', () => {
  const list = [
    { id: 'x', datetimeMs: NOW, durationMin: 60 },
    { id: 'y', datetimeMs: NOW + 3 * HOUR, durationMin: 30, status: 'canceled' },
    { id: 'z', datetimeMs: NOW + 90 * MINUTE }
  ];
  assert.deepEqual(findConflicts(list, NOW + 30 * MINUTE, 60).map((a) => a.id), ['x']);
  assert.deepEqual(findConflicts(list, NOW + 45 * MINUTE, 60).map((a) => a.id), ['x', 'z']);
  assert.deepEqual(findConflicts(list, NOW + 60 * MINUTE, 30).map((a) => a.id), []);
  assert.deepEqual(findConflicts(list, NOW + 3 * HOUR, 30).map((a) => a.id), []);
  assert.deepEqual(findConflicts(list, NOW, 60, 'x').map((a) => a.id), []);
});

test('telefone: WhatsApp, discagem e formatação', () => {
  assert.equal(whatsappNumber('(41) 99999-8888'), '5541999998888');
  assert.equal(whatsappNumber('041 3333-4444'), '554133334444');
  assert.equal(whatsappNumber('+55 41 99999-8888'), '5541999998888');
  assert.equal(whatsappNumber(''), '');
  assert.equal(whatsappLink('41999998888', 'Oi, tudo bem?'), 'https://wa.me/5541999998888?text=Oi%2C%20tudo%20bem%3F');
  assert.equal(telLink('(41) 99999-8888'), 'tel:41999998888');
  assert.equal(telLink('+55 41 9999-8888'), 'tel:+554199998888');
  assert.equal(formatPhone('41999998888'), '(41) 99999-8888');
  assert.equal(formatPhone('4133334444'), '(41) 3333-4444');
});

test('parseMoney entende formatos brasileiros', () => {
  assert.equal(parseMoney('150'), 150);
  assert.equal(parseMoney('150,5'), 150.5);
  assert.equal(parseMoney('1.500,00'), 1500);
  assert.equal(parseMoney('R$ 2.345,67'), 2345.67);
  assert.equal(parseMoney('1.500'), 1500);
  assert.equal(parseMoney('12.5'), 12.5);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(''), null);
});

test('normalizeName, busca de clientes e duração', () => {
  assert.equal(normalizeName('  João   da SILVA '), 'joao da silva');
  const c = { name: 'José Álvares', phone: '(41) 98888-7777', address: 'Av. Brasil' };
  assert.ok(clientMatches(c, 'jose'));
  assert.ok(clientMatches(c, '8888'));
  assert.ok(clientMatches(c, 'brasil'));
  assert.ok(!clientMatches(c, 'maria'));
  assert.ok(!clientMatches(c, '41'));
  assert.equal(formatDuration(90), '1h30');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(30), '30 min');
});

test('toCsv escapa separadores e bloqueia fórmulas', () => {
  const csv = toCsv(['A', 'B'], [['x;y', '=SOMA(1)'], ['aspas "boas"', null]]);
  assert.equal(csv, '﻿A;B\r\n"x;y";\'=SOMA(1)\r\n"aspas ""boas""";');
});

test('schedulerHealth e maintenanceInfo', () => {
  assert.equal(schedulerHealth(null, NOW).level, 'unknown');
  assert.equal(schedulerHealth({ lastRunMs: NOW - 5 * MINUTE, lastSuccessMs: NOW - 5 * MINUTE, ok: true }, NOW).level, 'ok');
  assert.equal(schedulerHealth({ lastRunMs: NOW - 2 * HOUR, lastSuccessMs: NOW - 2 * HOUR, ok: true }, NOW).level, 'warn');
  assert.equal(schedulerHealth({ lastRunMs: NOW - 5 * HOUR, lastSuccessMs: NOW - 5 * HOUR, ok: true }, NOW).level, 'error');
  assert.equal(schedulerHealth({ lastRunMs: NOW - MINUTE, lastSuccessMs: NOW - 20 * MINUTE, ok: false }, NOW).level, 'error');
  assert.deepEqual(maintenanceInfo({ lastCommitMs: NOW - 50 * DAY }, NOW), { days: 50, daysLeft: 10, warn: true });
  assert.equal(maintenanceInfo({}, NOW), null);
});

test('monthStats soma valores recebidos e a receber', () => {
  const sep = (d, over) => ({ datetimeMs: new Date(2026, 8, d, 10).getTime(), ...over });
  const s = monthStats([
    sep(1, { status: 'done', price: 100, paid: true }),
    sep(2, { status: 'done', price: 50, paid: false }),
    sep(3, {}),
    sep(4, { status: 'canceled' }),
    { datetimeMs: new Date(2026, 9, 1, 10).getTime(), status: 'done', price: 999, paid: true }
  ], '2026-09');
  assert.deepEqual(s, { scheduled: 1, done: 2, canceled: 1, received: 100, toReceive: 50 });
  assert.equal(statusOf({}), 'scheduled');
});

test('confirmationText gera mensagem natural para o cliente', () => {
  const now = new Date(2026, 8, 25, 10, 0).getTime(); // sexta
  const tomorrow = { clientName: 'Ana Paula', datetimeMs: new Date(2026, 8, 26, 14, 30).getTime(), address: 'Rua X, 10' };
  assert.equal(
    confirmationText(tomorrow, now, 'Márcio'),
    'Olá, Ana! Passando para confirmar nossa visita amanhã (26/09) às 14:30, no endereço Rua X, 10. Qualquer imprevisto, é só avisar. Obrigado!\n— Márcio'
  );
  const sunday = { clientName: 'Bia', datetimeMs: new Date(2026, 8, 27, 9, 0).getTime() };
  assert.match(confirmationText(sunday, now, ''), /visita no domingo \(27\/09\) às 09:00\. /);
  const monday = { clientName: 'Bia', datetimeMs: new Date(2026, 8, 28, 9, 0).getTime() };
  assert.match(confirmationText(monday, now, ''), /visita na segunda-feira \(28\/09\)/);
  const far = { clientName: 'Bia', datetimeMs: new Date(2026, 9, 15, 9, 0).getTime() };
  assert.match(confirmationText(far, now, ''), /visita no dia 15\/10 \(quinta\)/);
});
