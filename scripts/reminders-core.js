import {
  DAY, HOUR, MINUTE, dayKey, hourOf, statusOf, reminderDecisions,
  reminderMessage, dailySummaryMessage, testMessage, maintenanceMessage
} from '../js/logic.js';

const SUMMARY_START_HOUR = 7;
const SUMMARY_END_HOUR = 12;
const MAINTENANCE_WARN_DAYS = 50;
const TEST_PUSH_MAX_AGE = DAY;

// Executa uma rodada do verificador. `repo` e `sender` são injetados (Firestore/FCM em produção,
// implementações em memória nos testes).
export async function runReminders({ repo, sender, nowMs, tz, lastCommitMs = null, log = () => {} }) {
  const stats = { reminders: 0, skipped: 0, delivered: 0, failed: 0, removedTokens: 0, tests: 0, summaries: 0, alerts: 0 };
  const users = await repo.getUsers();
  const wantsReminders = (u) => u.settings.notify !== false;

  async function deliver(targets, payload) {
    const messages = [];
    const seen = new Set();
    for (const u of targets) {
      for (const token of u.tokens) {
        if (seen.has(token)) continue; // mesmo aparelho logado em duas contas
        seen.add(token);
        messages.push({ uid: u.uid, token, payload });
      }
    }
    const result = { success: 0, transient: 0, recipients: messages.length };
    if (!messages.length) return result;

    const responses = await sender.send(messages);
    const invalidByUid = new Map();
    responses.forEach((r, i) => {
      if (r.ok) {
        result.success++;
        return;
      }
      if (r.invalidToken) {
        const { uid, token } = messages[i];
        if (!invalidByUid.has(uid)) invalidByUid.set(uid, []);
        invalidByUid.get(uid).push(token);
      } else {
        result.transient++;
      }
      log(`Falha ao enviar para ${messages[i].uid}: ${r.error || 'erro desconhecido'}`);
    });

    for (const [uid, tokens] of invalidByUid) {
      await repo.removeTokens(uid, tokens);
      const user = users.find((u) => u.uid === uid);
      if (user) user.tokens = user.tokens.filter((t) => !tokens.includes(t));
      stats.removedTokens += tokens.length;
    }
    stats.delivered += result.success;
    stats.failed += responses.length - result.success;
    return result;
  }

  // 1. Lembretes de compromissos (só a janela relevante, para economizar leituras no Firestore)
  const appts = await repo.getAppointmentsBetween(nowMs - HOUR, nowMs + DAY + 30 * MINUTE);
  const recipients = users.filter((u) => wantsReminders(u) && u.tokens.length);
  for (const appt of appts) {
    const decisions = reminderDecisions(appt, nowMs);
    if (!decisions.length) continue;
    const updates = {};
    for (const { reminder, action } of decisions) {
      if (action === 'skip') {
        updates[reminder.flag] = true;
        updates[`remindersInfo.${reminder.id}`] = { status: 'skipped', atMs: nowMs };
        stats.skipped++;
        continue;
      }
      const res = await deliver(recipients, reminderMessage(appt, reminder, nowMs, tz));
      // Falha temporária (FCM fora do ar etc.) sem nenhum envio: tenta de novo na próxima rodada.
      if (res.success === 0 && res.transient > 0) continue;
      updates[reminder.flag] = true;
      updates[`remindersInfo.${reminder.id}`] = { status: 'sent', atMs: nowMs, delivered: res.success };
      stats.reminders++;
      log(`Lembrete ${reminder.label} → ${appt.clientName} (${appt.id}): ${res.success}/${res.recipients} aparelho(s)`);
    }
    if (Object.keys(updates).length) await repo.updateAppointment(appt, updates);
  }

  // 2. Pedidos de notificação de teste feitos pelo app
  const tests = await repo.getPendingTestPushes();
  for (const t of tests) {
    const user = users.find((u) => u.uid === t.uid);
    if (!user || nowMs - (t.createdMs || nowMs) > TEST_PUSH_MAX_AGE) {
      await repo.completeTestPush(t.id, { status: 'expired', processedMs: nowMs });
      continue;
    }
    const res = await deliver([user], testMessage());
    await repo.completeTestPush(t.id, {
      status: res.success > 0 ? 'sent' : (res.recipients ? 'failed' : 'no-devices'),
      delivered: res.success,
      processedMs: nowMs
    });
    stats.tests++;
  }

  // 3. Resumo diário (opcional, por usuário)
  const todayKey = dayKey(nowMs, tz);
  const hour = hourOf(nowMs, tz);
  if (hour >= SUMMARY_START_HOUR && hour < SUMMARY_END_HOUR) {
    let todays = null;
    for (const u of users) {
      if (!u.settings.dailySummary || !wantsReminders(u) || u.settings.lastDailySummary === todayKey) continue;
      if (todays === null) {
        const around = await repo.getAppointmentsBetween(nowMs - DAY, nowMs + DAY);
        todays = around.filter((a) => statusOf(a) === 'scheduled' && dayKey(a.datetimeMs, tz) === todayKey);
      }
      if (todays.length && u.tokens.length) {
        await deliver([u], dailySummaryMessage(todays, tz));
        stats.summaries++;
      }
      await repo.updateUser(u.uid, { lastDailySummary: todayKey });
    }
  }

  // 4. Aviso de manutenção: o GitHub desliga o agendamento após 60 dias sem commits em repositório público
  if (lastCommitMs && nowMs - lastCommitMs > MAINTENANCE_WARN_DAYS * DAY) {
    const daysLeft = 60 - Math.floor((nowMs - lastCommitMs) / DAY);
    for (const u of users) {
      if (!u.settings.systemAlerts || u.settings.lastMaintenanceAlert === todayKey) continue;
      await deliver([u], maintenanceMessage(daysLeft));
      await repo.updateUser(u.uid, { lastMaintenanceAlert: todayKey });
      stats.alerts++;
    }
  }

  await repo.writeStatus({ ok: true, error: null, lastRunMs: nowMs, lastSuccessMs: nowMs, lastCommitMs, stats });
  return stats;
}
