import { html, icon } from '../ui.js';
import { MINUTE, STATUS_LABEL, timeHM, formatDuration, dayKey, ddmm } from '../logic.js';

export function isAwaitingReport(a, nowMs) {
  return a.status === 'scheduled' && a.datetimeMs + a.durationMin * MINUTE < nowMs;
}

// Linha de compromisso usada na agenda e no histórico do cliente.
// Na ficha do cliente (inClient) o nome seria repetido em todas as linhas, então o título vira o conteúdo da visita.
export function apptRow(a, nowMs, { withDate = false, quickConclude = false, inClient = false } = {}) {
  const awaiting = isAwaitingReport(a, nowMs);
  const cls = a.status !== 'scheduled' ? a.status : (awaiting ? 'pending' : '');
  let title = a.clientName || 'Sem nome';
  let sub = '';
  if (inClient) {
    title = (a.status === 'done' && a.visitReport) || a.notes || (a.status === 'done' ? 'Visita concluída' : 'Visita');
    if (a.address) sub = html`<span class="appt-sub">${icon('pin')}<span>${a.address}</span></span>`;
  } else if (a.status === 'done' && a.visitReport) sub = html`<span class="appt-sub">${icon('check')}<span>${a.visitReport}</span></span>`;
  else if (a.address) sub = html`<span class="appt-sub">${icon('pin')}<span>${a.address}</span></span>`;
  else if (a.notes) sub = html`<span class="appt-sub">${icon('note')}<span>${a.notes}</span></span>`;

  const showConclude = quickConclude && awaiting;
  let badge = '';
  if (a.status !== 'scheduled') badge = html`<span class="badge badge-${a.status}">${STATUS_LABEL[a.status]}</span>`;
  else if (awaiting && !showConclude) badge = html`<span class="badge badge-pending">Sem relatório</span>`;

  return html`
    <div class="appt-row">
      <button type="button" class="appt ${cls}" data-open="${a.id}">
        <span class="appt-time">
          <strong>${withDate ? ddmm(dayKey(a.datetimeMs)) : timeHM(a.datetimeMs)}</strong>
          <span>${withDate ? timeHM(a.datetimeMs) : formatDuration(a.durationMin)}</span>
        </span>
        <span class="appt-main">
          <span class="appt-name">${title}</span>
          ${sub}
        </span>
        ${badge}
      </button>
      ${showConclude ? html`<button type="button" class="btn btn-soft btn-small" data-conclude="${a.id}">Concluir</button>` : ''}
    </div>`;
}
