import * as store from '../store.js';
import * as notifications from '../notifications.js';
import { html, render, icon, toast } from '../ui.js';
import {
  DAY, dayKey, dayTitle, monthName, monthStats, formatMoney, schedulerHealth
} from '../logic.js';
import { apptRow, isAwaitingReport } from './components.js';
import { openAppointmentDetail, openAppointmentForm, openConclude } from './appointment.js';

const UPCOMING_LIMIT = 40;
const INSTALL_DISMISSED = 'agenda:installDismissed';

const view = {
  month: startOfMonth(new Date()),
  selected: null,
  showAll: false
};
let handlers = { goToSettings: () => {} };

export function setAgendaHandlers(h) {
  handlers = { ...handlers, ...h };
}

export const selectedDay = () => view.selected;

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function shiftMonth(delta) {
  view.month = new Date(view.month.getFullYear(), view.month.getMonth() + delta, 1);
  store.ensureMonthLoaded(view.month.getFullYear(), view.month.getMonth());
}

function goToday() {
  view.month = startOfMonth(new Date());
  view.selected = null;
}

// ---------- Avisos no topo ----------

function banners(now) {
  const out = [];
  const errors = store.getErrors();
  if (errors.appointments) {
    out.push(html`<div class="banner banner-error">${icon('alert')}<span class="banner-text">Sem acesso aos compromissos (${errors.appointments}). Verifique a internet ou as regras do banco de dados.</span></div>`);
  } else if (errors.clients) {
    out.push(html`<div class="banner banner-warn">${icon('alert')}<span class="banner-text">O cadastro de clientes está indisponível até as regras do banco serem atualizadas. A agenda funciona normalmente.</span></div>`);
  }

  const health = schedulerHealth(store.getStatus(), now);
  if (health.level === 'warn' || health.level === 'error') {
    out.push(html`<div class="banner ${health.level === 'error' ? 'banner-error' : 'banner-warn'}">${icon('bell')}
      <span class="banner-text">${health.text} Os lembretes podem não chegar.</span>
      <button type="button" class="btn btn-small btn-ghost" data-act="settings">Detalhes</button></div>`);
  }

  const settings = store.getSettings();
  const supported = notifications.supportedValue();
  const perm = notifications.permission();
  if (supported && settings.notify !== false) {
    if (perm === 'denied') {
      out.push(html`<div class="banner banner-warn">${icon('bell')}<span class="banner-text">As notificações estão bloqueadas neste aparelho.</span>
        <button type="button" class="btn btn-small btn-ghost" data-act="settings">Como liberar</button></div>`);
    } else if (perm !== 'granted' || !notifications.hasLocalToken()) {
      out.push(html`<div class="banner">${icon('bell')}<span class="banner-text">Ative as notificações para receber os lembretes neste aparelho.</span>
        <button type="button" class="btn btn-small btn-primary" data-act="enable-notif">Ativar</button></div>`);
    }
  }

  let dismissed = false;
  try { dismissed = localStorage.getItem(INSTALL_DISMISSED) === '1'; } catch { /* sem armazenamento */ }
  if (notifications.canInstall() && !notifications.isStandalone() && !dismissed) {
    out.push(html`<div class="banner">${icon('phone-device')}<span class="banner-text">Instale a agenda na tela inicial para abrir como um app.</span>
      <button type="button" class="btn btn-small btn-primary" data-act="install">Instalar</button>
      <button type="button" class="icon-btn" data-act="dismiss-install" aria-label="Dispensar">${icon('x')}</button></div>`);
  }
  return out;
}

// ---------- Calendário ----------

function calendar(appts, now) {
  const y = view.month.getFullYear();
  const m = view.month.getMonth();
  const todayKey = dayKey(now);
  const byDay = new Map();
  for (const a of appts) {
    if (a.status === 'canceled') continue;
    const k = dayKey(a.datetimeMs);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(a);
  }

  const cells = [];
  const offset = new Date(y, m, 1).getDay();
  for (let i = 0; i < offset; i++) cells.push(html`<span class="cal-day blank"></span>`);
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const list = byDay.get(key) || [];
    const dots = list.slice(0, 3).map((a) => {
      const cls = a.status === 'done' ? 'done' : (isAwaitingReport(a, now) ? 'pending' : '');
      return html`<i class="dot ${cls}"></i>`;
    });
    const classes = ['cal-day'];
    if (key === todayKey) classes.push('today');
    if (key === view.selected) classes.push('selected');
    if (key < todayKey) classes.push('past');
    const label = `${d} de ${monthName(m)}${list.length ? `, ${list.length} compromisso${list.length > 1 ? 's' : ''}` : ''}`;
    cells.push(html`<button type="button" class="${classes.join(' ')}" data-day="${key}" aria-label="${label}" ${key === view.selected ? html`aria-pressed="true"` : ''}>
      <span class="num">${d}</span><span class="dots">${dots}</span></button>`);
  }

  const stats = monthStats(appts, `${y}-${String(m + 1).padStart(2, '0')}`);
  const statPills = [];
  if (stats.scheduled) statPills.push(html`<span class="pill">${stats.scheduled} agendado${stats.scheduled > 1 ? 's' : ''}</span>`);
  if (stats.done) statPills.push(html`<span class="pill pill-ok">${stats.done} concluído${stats.done > 1 ? 's' : ''}</span>`);
  if (stats.received) statPills.push(html`<span class="pill pill-ok">${formatMoney(stats.received)} recebidos</span>`);
  if (stats.toReceive) statPills.push(html`<span class="pill pill-warn">${formatMoney(stats.toReceive)} a receber</span>`);

  const isCurrentMonth = y === new Date(now).getFullYear() && m === new Date(now).getMonth();
  return html`
    <section class="card cal" aria-label="Calendário">
      <div class="cal-head">
        <button type="button" class="icon-btn" data-act="prev" aria-label="Mês anterior">${icon('chevron-left')}</button>
        <button type="button" class="cal-title" data-act="today" aria-label="${isCurrentMonth ? 'Mês atual' : 'Voltar para hoje'}">
          ${monthName(m)} ${y}${isCurrentMonth ? '' : html` <span class="pill" style="margin-left:6px">Hoje</span>`}
        </button>
        <button type="button" class="icon-btn" data-act="next" aria-label="Próximo mês">${icon('chevron-right')}</button>
      </div>
      <div class="cal-week" aria-hidden="true"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div>
      <div class="cal-grid">${cells}</div>
      ${statPills.length ? html`<div class="cal-stats">${statPills}</div>` : ''}
    </section>`;
}

// ---------- Listas ----------

function dayList(appts, now) {
  const key = view.selected;
  const list = appts.filter((a) => dayKey(a.datetimeMs) === key);
  return html`
    <div class="section">
      <div class="section-head">
        <h2>${dayTitle(key, dayKey(now))}</h2>
        <button type="button" class="btn btn-small btn-ghost" data-act="clear">Ver próximos</button>
      </div>
      ${list.length
        ? html`<div class="appt-list">${list.map((a) => apptRow(a, now, { quickConclude: true }))}</div>`
        : html`<div class="empty card">${icon('calendar')}<p>Nenhum compromisso neste dia.</p>
            ${key >= dayKey(now) ? html`<button type="button" class="btn btn-soft" data-act="new-on-day">${icon('plus')}Agendar neste dia</button>` : ''}</div>`}
    </div>`;
}

function upcomingList(appts, now) {
  const todayKey = dayKey(now);
  const awaiting = appts
    .filter((a) => isAwaitingReport(a, now) && now - a.datetimeMs < 30 * DAY)
    .sort((a, b) => b.datetimeMs - a.datetimeMs);
  const upcoming = appts.filter((a) => a.status !== 'canceled' && dayKey(a.datetimeMs) >= todayKey && !isAwaitingReport(a, now));

  const shown = view.showAll ? upcoming : upcoming.slice(0, UPCOMING_LIMIT);
  const groups = [];
  for (const a of shown) {
    const k = dayKey(a.datetimeMs);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(a);
    else groups.push({ key: k, items: [a] });
  }

  return html`
    ${awaiting.length ? html`
      <div class="section">
        <div class="section-head"><h2>Aguardando relatório<span class="count">${awaiting.length}</span></h2></div>
        <div class="appt-list">${awaiting.map((a) => apptRow(a, now, { withDate: true, quickConclude: true }))}</div>
      </div>` : ''}
    <div class="section">
      <div class="section-head"><h2>Próximos compromissos</h2></div>
      ${groups.length
        ? groups.map((g) => html`<div class="day-group">
            <div class="day-label">${dayTitle(g.key, todayKey)}</div>
            <div class="appt-list">${g.items.map((a) => apptRow(a, now))}</div>
          </div>`)
        : html`<div class="empty card">${icon('calendar')}<p>Nenhum compromisso agendado.</p>
            <button type="button" class="btn btn-soft" data-act="new">${icon('plus')}Agendar compromisso</button></div>`}
      ${upcoming.length > shown.length ? html`<button type="button" class="btn btn-ghost btn-block" style="margin-top:12px" data-act="show-all">Mostrar todos (${upcoming.length})</button>` : ''}
    </div>`;
}

// ---------- Render ----------

export function renderAgenda(root) {
  bind(root);
  const now = Date.now();
  if (!store.isReady()) {
    render(root, html`${banners(now)}<div class="appt-list" style="margin-top:8px"><div class="skeleton" style="height:340px"></div><div class="skeleton"></div><div class="skeleton"></div></div>`);
    return;
  }
  const appts = store.allAppointments();
  render(root, html`
    ${banners(now)}
    ${calendar(appts, now)}
    ${view.selected ? dayList(appts, now) : upcomingList(appts, now)}`);
}

function bind(root) {
  if (root.dataset.bound) return;
  root.dataset.bound = '1';
  const rerender = () => renderAgenda(root);

  root.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) return openAppointmentDetail(open.dataset.open);
    const conclude = e.target.closest('[data-conclude]');
    if (conclude) return openConclude(conclude.dataset.conclude, { complete: true });
    const day = e.target.closest('[data-day]');
    if (day) {
      view.selected = view.selected === day.dataset.day ? null : day.dataset.day;
      return rerender();
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'prev': shiftMonth(-1); break;
      case 'next': shiftMonth(1); break;
      case 'today': goToday(); break;
      case 'clear': view.selected = null; break;
      case 'show-all': view.showAll = true; break;
      case 'new': openAppointmentForm(); return;
      case 'new-on-day': openAppointmentForm({ preset: { dateKey: view.selected } }); return;
      case 'settings': handlers.goToSettings(); return;
      case 'enable-notif': {
        const user = store.getUser();
        const res = await notifications.enable(user.uid);
        if (res.ok) toast('Notificações ativadas neste aparelho');
        else if (res.reason === 'denied') handlers.goToSettings();
        else if (res.reason !== 'default') toast('Não foi possível ativar as notificações. Tente de novo em Ajustes.', { type: 'error' });
        break;
      }
      case 'install': await notifications.promptInstall(); break;
      case 'dismiss-install':
        try { localStorage.setItem(INSTALL_DISMISSED, '1'); } catch { /* sem armazenamento */ }
        break;
      default: return;
    }
    rerender();
  });

  // Deslizar o calendário para trocar de mês.
  let startX = null;
  let startY = null;
  root.addEventListener('touchstart', (e) => {
    if (!e.target.closest('.cal-grid')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    startX = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      shiftMonth(dx < 0 ? 1 : -1);
      rerender();
    }
  }, { passive: true });
}
