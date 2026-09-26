// Funções puras compartilhadas entre o app (navegador) e o verificador de lembretes (Node).
// Sem acesso a DOM nem a Firebase: tudo aqui é testado em test/logic.test.js.

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const REMINDERS = [
  { id: 'd1', flag: 'notified1Day', offset: DAY, label: '1 dia antes' },
  { id: 'h2', flag: 'notified2h', offset: 2 * HOUR, label: '2 horas antes' }
];

export const STATUS_LABEL = { scheduled: 'Agendado', done: 'Concluído', canceled: 'Cancelado' };

export const DURATIONS = [30, 60, 90, 120, 180, 240, 480];
export const DEFAULT_DURATION = 60;

export const REPEAT_LABEL = {
  none: 'Não repete',
  weekly: 'Toda semana',
  biweekly: 'A cada 2 semanas',
  monthly: 'Todo mês'
};

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function statusOf(appt) {
  return appt && (appt.status === 'done' || appt.status === 'canceled') ? appt.status : 'scheduled';
}

// ---------- Datas ----------
// `tz` opcional: no navegador fica indefinido (fuso do aparelho); no servidor é 'America/Sao_Paulo'.

const formatters = new Map();
function partsOf(ms, tz) {
  const key = tz || '';
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    formatters.set(key, f);
  }
  const p = {};
  for (const { type, value } of f.formatToParts(ms)) p[type] = value;
  return p;
}

export function dayKey(ms, tz) {
  const p = partsOf(ms, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function monthKey(ms, tz) {
  return dayKey(ms, tz).slice(0, 7);
}

export function timeHM(ms, tz) {
  const p = partsOf(ms, tz);
  return `${p.hour}:${p.minute}`;
}

export function hourOf(ms, tz) {
  return Number(partsOf(ms, tz).hour);
}

function keyToUTC(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetweenKeys(fromKey, toKey) {
  return Math.round((keyToUTC(toKey) - keyToUTC(fromKey)) / DAY);
}

export function weekdayName(key) {
  return WEEKDAYS[new Date(keyToUTC(key)).getUTCDay()];
}

export function shortWeekday(key) {
  return weekdayName(key).split('-')[0];
}

export function monthName(monthIndex) {
  return MONTHS[monthIndex];
}

export function ddmm(key) {
  const [, m, d] = key.split('-');
  return `${d}/${m}`;
}

// "hoje", "amanhã", "ontem", "sexta-feira" (mesma semana) ou "sex, 03/10"
export function relativeDay(ms, nowMs, tz) {
  const key = dayKey(ms, tz);
  const diff = daysBetweenKeys(dayKey(nowMs, tz), key);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  if (diff > 1 && diff < 7) return weekdayName(key);
  return `${shortWeekday(key)}, ${ddmm(key)}`;
}

// "Hoje · quinta, 25 de setembro"
export function dayTitle(key, todayKey) {
  const [, m, d] = key.split('-').map(Number);
  const base = `${shortWeekday(key)}, ${d} de ${MONTHS[m - 1]}`;
  const diff = daysBetweenKeys(todayKey, key);
  if (diff === 0) return `Hoje · ${base}`;
  if (diff === 1) return `Amanhã · ${base}`;
  if (diff === -1) return `Ontem · ${base}`;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// "quinta-feira, 25 de setembro de 2026"
export function longDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${weekdayName(key)}, ${d} de ${MONTHS[m - 1]} de ${y}`;
}

// Converte os valores dos inputs date/time (horário local do aparelho) em milissegundos.
export function localDateTimeToMs(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

export function formatDuration(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function formatLeft(minutes) {
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m < 5) return h === 1 ? '1 hora' : `${h} horas`;
  return `${h}h ${m}min`;
}

export function ago(ms, nowMs) {
  const diff = Math.max(0, nowMs - ms);
  if (diff < MINUTE) return 'agora mesmo';
  if (diff < HOUR) return `há ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`;
  const days = Math.floor(diff / DAY);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

// ---------- Lembretes ----------

// Campos de lembrete para um compromisso novo ou remarcado. Lembretes cujo momento já passou
// (ex.: marcado com menos de 24h de antecedência) ficam como "não aplicável" em vez de disparar na hora.
export function initialReminderFields(apptMs, nowMs) {
  const fields = { remindersInfo: {} };
  for (const r of REMINDERS) {
    const passed = apptMs - nowMs <= r.offset;
    fields[r.flag] = passed;
    if (passed) fields.remindersInfo[r.id] = { status: 'skipped' };
  }
  return fields;
}

// Decide, para um compromisso, quais lembretes enviar ou descartar agora.
export function reminderDecisions(appt, nowMs) {
  const out = [];
  if (statusOf(appt) !== 'scheduled' || typeof appt.datetimeMs !== 'number') return out;
  const apptMs = appt.datetimeMs;
  for (const r of REMINDERS) {
    if (appt[r.flag]) continue;
    if (nowMs < apptMs - r.offset) continue;
    if (nowMs >= apptMs) {
      out.push({ reminder: r, action: 'skip' });
      continue;
    }
    // Se um lembrete mais próximo já está no horário, este ficou velho (ex.: verificador parado por horas).
    const closerDue = REMINDERS.some((o) => o.offset < r.offset && nowMs >= apptMs - o.offset);
    out.push({ reminder: r, action: closerDue ? 'skip' : 'send' });
  }
  return out;
}

// Situação de um lembrete para exibir no app.
export function reminderStatus(appt, reminder, nowMs) {
  const info = appt.remindersInfo ? appt.remindersInfo[reminder.id] : null;
  if (appt[reminder.flag]) {
    if (info && info.status === 'skipped') return { state: 'skipped' };
    return { state: 'sent', atMs: info && info.atMs ? info.atMs : null };
  }
  if (statusOf(appt) !== 'scheduled' || nowMs >= appt.datetimeMs) return { state: 'off' };
  const dueMs = appt.datetimeMs - reminder.offset;
  return { state: nowMs >= dueMs ? 'due' : 'scheduled', atMs: dueMs };
}

// ---------- Mensagens push (montadas no servidor) ----------

export function reminderMessage(appt, reminder, nowMs, tz) {
  const when = `${relativeDay(appt.datetimeMs, nowMs, tz)} às ${timeHM(appt.datetimeMs, tz)}`;
  const lines = [];
  if (reminder.id === 'h2') lines.push(`Faltam ${formatLeft(Math.round((appt.datetimeMs - nowMs) / MINUTE))}`);
  if (appt.address) lines.push(appt.address);
  else if (appt.notes) lines.push(truncate(appt.notes, 90));
  return {
    kind: 'reminder',
    title: `${appt.clientName || 'Compromisso'} — ${when}`,
    body: lines.join(' · ') || 'Toque para ver os detalhes.',
    tag: `appt-${appt.id}`,
    url: `./?appt=${encodeURIComponent(appt.id)}`,
    apptId: appt.id,
    mapsUrl: appt.address ? mapsLink(appt.address) : '',
    ttlSeconds: Math.max(60, Math.floor((appt.datetimeMs - nowMs) / 1000))
  };
}

export function dailySummaryMessage(appts, tz) {
  const sorted = [...appts].sort((a, b) => a.datetimeMs - b.datetimeMs);
  const n = sorted.length;
  const items = sorted.slice(0, 4).map((a) => `${timeHM(a.datetimeMs, tz)} ${truncate(a.clientName || '', 22)}`);
  return {
    kind: 'summary',
    title: n === 1 ? 'Hoje você tem 1 compromisso' : `Hoje você tem ${n} compromissos`,
    body: items.join(' · ') + (n > 4 ? ` · +${n - 4}` : ''),
    tag: 'daily-summary',
    url: './',
    ttlSeconds: 6 * 3600
  };
}

export function testMessage() {
  return {
    kind: 'test',
    title: 'Notificação de teste ✅',
    body: 'Tudo certo! Os lembretes da agenda vão chegar neste aparelho.',
    tag: 'test',
    url: './?tab=settings',
    ttlSeconds: 3600
  };
}

export function maintenanceMessage(daysLeft) {
  return {
    kind: 'system',
    title: 'Agenda: manutenção necessária',
    body: `O GitHub desativa os lembretes automáticos em ${Math.max(daysLeft, 0)} dia(s) sem commits no repositório. Faça qualquer atualização para mantê-los ativos.`,
    tag: 'maintenance',
    url: './?tab=settings',
    ttlSeconds: 86400
  };
}

// ---------- Saúde do verificador automático ----------

export function schedulerHealth(status, nowMs) {
  if (!status || !status.lastRunMs) {
    return { level: 'unknown', text: 'Aguardando a primeira verificação automática.' };
  }
  const lastOk = status.lastSuccessMs || 0;
  if (status.ok === false && nowMs - status.lastRunMs < 3 * HOUR) {
    return { level: 'error', text: `A última verificação automática falhou (${ago(status.lastRunMs, nowMs)}).` };
  }
  const age = nowMs - lastOk;
  if (!lastOk || age > 3 * HOUR) {
    return { level: 'error', text: `Os lembretes automáticos estão parados${lastOk ? ` desde ${ago(lastOk, nowMs)}` : ''}.` };
  }
  if (age > HOUR) {
    return { level: 'warn', text: `Os lembretes automáticos estão atrasados (última verificação ${ago(lastOk, nowMs)}).` };
  }
  return { level: 'ok', text: `Funcionando · última verificação ${ago(lastOk, nowMs)}.` };
}

export function maintenanceInfo(status, nowMs) {
  if (!status || !status.lastCommitMs) return null;
  const days = Math.floor((nowMs - status.lastCommitMs) / DAY);
  return { days, daysLeft: 60 - days, warn: days >= 45 };
}

// ---------- Compromissos ----------

export function findConflicts(appts, startMs, durationMin, excludeId) {
  const end = startMs + (durationMin || DEFAULT_DURATION) * MINUTE;
  return appts.filter((a) =>
    a.id !== excludeId &&
    statusOf(a) !== 'canceled' &&
    a.datetimeMs < end &&
    a.datetimeMs + (a.durationMin || DEFAULT_DURATION) * MINUTE > startMs
  );
}

// Datas das repetições (horário local). Mensal mantém o dia, ajustando para o último dia em meses curtos.
export function recurrenceDates(startMs, repeat, count) {
  if (!repeat || repeat === 'none' || !(count > 1)) return [startMs];
  const base = new Date(startMs);
  const out = [];
  for (let i = 0; i < count; i++) {
    let d;
    if (repeat === 'monthly') {
      const y = base.getFullYear();
      const m = base.getMonth() + i;
      const lastDay = new Date(y, m + 1, 0).getDate();
      d = new Date(y, m, Math.min(base.getDate(), lastDay), base.getHours(), base.getMinutes());
    } else {
      const step = repeat === 'biweekly' ? 14 : 7;
      d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + step * i, base.getHours(), base.getMinutes());
    }
    out.push(d.getTime());
  }
  return out;
}

export function monthStats(appts, mKey) {
  const s = { scheduled: 0, done: 0, canceled: 0, received: 0, toReceive: 0 };
  for (const a of appts) {
    if (monthKey(a.datetimeMs) !== mKey) continue;
    const st = statusOf(a);
    s[st]++;
    if (st === 'done' && typeof a.price === 'number') {
      if (a.paid) s.received += a.price;
      else s.toReceive += a.price;
    }
  }
  return s;
}

// ---------- Texto, telefone, links ----------

export function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

export function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstName(s) {
  return String(s || '').trim().split(/\s+/)[0] || '';
}

export function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function whatsappNumber(phone) {
  let d = phoneDigits(phone).replace(/^0+/, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

export function whatsappLink(phone, text) {
  const n = whatsappNumber(phone);
  if (!n) return '';
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function telLink(phone) {
  const d = phoneDigits(phone);
  if (!d) return '';
  return `tel:${String(phone).trim().startsWith('+') ? '+' : ''}${d}`;
}

export function formatPhone(phone) {
  const d = phoneDigits(phone);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(phone || '').trim();
}

export function mapsLink(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function wazeLink(address) {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

// Mensagem de confirmação para o cliente, enviada pelo próprio usuário via WhatsApp.
export function confirmationText(appt, nowMs, senderName) {
  const key = dayKey(appt.datetimeMs);
  const diff = daysBetweenKeys(dayKey(nowMs), key);
  let when;
  if (diff === 0) when = 'hoje';
  else if (diff === 1) when = `amanhã (${ddmm(key)})`;
  else if (diff > 1 && diff < 7) {
    const wd = weekdayName(key);
    when = `${wd === 'sábado' || wd === 'domingo' ? 'no' : 'na'} ${wd} (${ddmm(key)})`;
  } else when = `no dia ${ddmm(key)} (${shortWeekday(key)})`;
  const place = appt.address ? `, no endereço ${appt.address}` : '';
  const name = firstName(appt.clientName);
  const sign = senderName ? `\n— ${senderName}` : '';
  return `Olá${name ? `, ${name}` : ''}! Passando para confirmar nossa visita ${when} às ${timeHM(appt.datetimeMs)}${place}. Qualquer imprevisto, é só avisar. Obrigado!${sign}`;
}

// ---------- Dinheiro ----------

export function parseMoney(input) {
  let s = String(input == null ? '' : input).replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatMoney(n) {
  return typeof n === 'number' && Number.isFinite(n) ? moneyFormatter.format(n) : '';
}

// ---------- Busca e exportação ----------

export function clientMatches(client, query) {
  const q = normalizeName(query);
  if (!q) return true;
  if (normalizeName(client.name).includes(q)) return true;
  if (normalizeName(client.address).includes(q)) return true;
  const qDigits = q.replace(/\D/g, '');
  return qDigits.length >= 3 && phoneDigits(client.phone).includes(qDigits);
}

// CSV no padrão do Excel em português (separador ";" e BOM para acentos).
export function toCsv(headers, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}
