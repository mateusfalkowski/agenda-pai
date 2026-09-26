import * as store from '../store.js';
import { html, render, icon, safe, openSheet, confirmSheet, chooseSheet, toast } from '../ui.js';
import {
  REMINDERS, STATUS_LABEL, MINUTE, DURATIONS, DEFAULT_DURATION, REPEAT_LABEL,
  dayKey, dayTitle, timeHM, formatDuration, reminderStatus, relativeDay, ddmm,
  telLink, whatsappLink, mapsLink, wazeLink, formatPhone, confirmationText,
  formatMoney, parseMoney, findConflicts, localDateTimeToMs, truncate
} from '../logic.js';
import { isAwaitingReport } from './components.js';
import { openClientSheet } from './clients.js';

function infoRow(iconName, label, value) {
  return html`<div class="info-row">${icon(iconName)}<div><div class="info-label">${label}</div><div class="info-value">${value}</div></div></div>`;
}

export function quickActions(phone, address) {
  if (!phone && !address) return '';
  const wa = phone ? whatsappLink(phone) : '';
  return html`<div class="quick">
    ${phone ? html`<a href="${telLink(phone)}">${icon('phone')}Ligar</a>` : ''}
    ${wa ? html`<a href="${wa}" target="_blank" rel="noopener">${icon('message')}WhatsApp</a>` : ''}
    ${address ? html`<a href="${mapsLink(address)}" target="_blank" rel="noopener">${icon('map')}Maps</a>` : ''}
    ${address ? html`<a href="${wazeLink(address)}" target="_blank" rel="noopener">${icon('navigation')}Waze</a>` : ''}
  </div>`;
}

function presetFrom(a) {
  return { clientId: a.clientId || null, clientName: a.clientName, phone: a.phone, address: a.address, durationMin: a.durationMin };
}

// ---------- Detalhes ----------

function remindersSection(a, now) {
  const rows = REMINDERS.map((r) => {
    const s = reminderStatus(a, r, now);
    if (s.state === 'off') return '';
    let iconName = 'bell';
    let text = '';
    if (s.state === 'sent') {
      iconName = 'check';
      text = s.atMs ? `Enviado ${relativeDay(s.atMs, now)} às ${timeHM(s.atMs)}` : 'Enviado';
    } else if (s.state === 'skipped') {
      iconName = 'x';
      text = 'Não enviado (marcado em cima da hora)';
    } else if (s.state === 'due') {
      iconName = 'clock';
      text = 'Enviando em instantes';
    } else {
      text = `${relativeDay(s.atMs, now)} às ${timeHM(s.atMs)}`;
    }
    return html`<div class="reminder ${s.state}">${icon(iconName)}<span>${r.label}</span><span>${text}</span></div>`;
  });
  return html`<h3 class="subhead">Lembretes no celular</h3><div class="reminders">${rows}</div>`;
}

function reportSection(a) {
  const hasPrice = typeof a.price === 'number';
  return html`
    <h3 class="subhead">Relatório da visita</h3>
    <div class="report-box ${a.visitReport ? '' : 'empty-report'}">${a.visitReport || 'Nenhum relatório registrado.'}</div>
    ${hasPrice ? html`<div class="report-money">
      <span class="pill">${icon('money')}${formatMoney(a.price)}</span>
      <button type="button" class="pill ${a.paid ? 'pill-ok' : 'pill-warn'}" data-act="toggle-paid">${a.paid ? 'Pago ✓' : 'A receber · marcar como pago'}</button>
    </div>` : ''}`;
}

function detailContent(a) {
  const now = Date.now();
  const end = a.datetimeMs + a.durationMin * MINUTE;
  const awaiting = isAwaitingReport(a, now);
  const client = a.clientId ? store.getClient(a.clientId) : null;
  const settings = store.getSettings();

  let badge;
  if (a.status !== 'scheduled') badge = html`<span class="badge badge-${a.status}">${STATUS_LABEL[a.status]}</span>`;
  else if (awaiting) badge = html`<span class="badge badge-pending">Aguardando relatório</span>`;
  else badge = html`<span class="badge badge-scheduled">Agendado</span>`;

  const confirmLink = a.phone && a.status === 'scheduled' && a.datetimeMs > now
    ? whatsappLink(a.phone, confirmationText(a, now, settings.displayName || ''))
    : '';

  let actions;
  if (a.status === 'scheduled') {
    actions = html`
      <div class="sheet-actions"><button type="button" class="btn btn-success" data-act="conclude">${icon('check')}Concluir visita</button></div>
      <div class="sheet-actions" style="margin-top:10px">
        <button type="button" class="btn btn-ghost" data-act="edit">${icon('edit')}Editar</button>
        <button type="button" class="btn btn-ghost" data-act="more">${icon('more')}Mais</button>
      </div>`;
  } else if (a.status === 'done') {
    actions = html`
      <div class="sheet-actions">
        <button type="button" class="btn btn-soft" data-act="edit-report">${icon('edit')}Relatório</button>
        <button type="button" class="btn btn-soft" data-act="follow-up">${icon('plus')}Agendar retorno</button>
      </div>
      <div class="sheet-actions" style="margin-top:10px"><button type="button" class="btn btn-ghost" data-act="more">${icon('more')}Mais opções</button></div>`;
  } else {
    actions = html`
      <div class="sheet-actions">
        <button type="button" class="btn btn-soft" data-act="reopen">Reativar</button>
        <button type="button" class="btn btn-ghost" data-act="more">${icon('more')}Mais</button>
      </div>`;
  }

  return html`
    <div class="sheet-head">
      <div>
        <p class="eyebrow">${dayTitle(dayKey(a.datetimeMs), dayKey(now))} · ${timeHM(a.datetimeMs)}–${timeHM(end)}</p>
        <h2>${a.clientName || 'Sem nome'}</h2>
      </div>
      ${badge}
    </div>
    ${quickActions(a.phone, a.address)}
    ${confirmLink ? html`<a class="btn btn-soft btn-block" style="margin-top:10px" href="${confirmLink}" target="_blank" rel="noopener">${icon('send')}Enviar confirmação pelo WhatsApp</a>` : ''}
    <div class="info">
      ${a.address ? infoRow('pin', 'Endereço', a.address) : ''}
      ${a.phone ? infoRow('phone', 'Telefone', formatPhone(a.phone)) : ''}
      ${infoRow('clock', 'Duração', formatDuration(a.durationMin))}
      ${a.seriesId ? infoRow('repeat', 'Repetição', `${a.seriesIndex} de ${a.seriesTotal}`) : ''}
      ${a.notes ? infoRow('note', 'Observações', a.notes) : ''}
    </div>
    ${client ? html`<button type="button" class="menu-item" data-act="client">${icon('user')}<span>Ver ficha do cliente</span></button>` : ''}
    ${a.status === 'done' ? reportSection(a) : ''}
    ${a.status === 'scheduled' && a.datetimeMs > now ? remindersSection(a, now) : ''}
    ${actions}`;
}

export function openAppointmentDetail(id) {
  if (!store.getAppointment(id)) {
    toast('Compromisso não encontrado.');
    return;
  }
  let unsub = null;
  const sheet = openSheet({ label: 'Detalhes do compromisso', onClose: () => unsub && unsub() });
  const draw = () => {
    const a = store.getAppointment(id);
    if (!a) {
      sheet.close();
      return;
    }
    sheet.render(detailContent(a));
    sheet.el.onclick = (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) handleDetailAction(btn.dataset.act, a, sheet);
    };
  };
  draw();
  unsub = store.subscribe((topic) => {
    if (sheet.isOpen() && ['appointments', 'clients', 'settings'].includes(topic)) draw();
  });
}

async function handleDetailAction(act, a, sheet) {
  switch (act) {
    case 'conclude': openConclude(a.id, { complete: true }); break;
    case 'edit-report': openConclude(a.id, { complete: false }); break;
    case 'edit': openAppointmentForm({ id: a.id }); break;
    case 'toggle-paid': store.setPaid(a.id, !a.paid); break;
    case 'follow-up': openAppointmentForm({ preset: presetFrom(a) }); break;
    case 'client': openClientSheet(a.clientId); break;
    case 'reopen': store.reopenAppointment(a.id); break;
    case 'more': await moreMenu(a, sheet); break;
  }
}

async function moreMenu(a, sheet) {
  const options = [];
  if (a.status === 'scheduled') options.push({ label: 'Cancelar compromisso', value: 'cancel', icon: 'x' });
  if (a.status === 'done') options.push({ label: 'Reabrir (voltar para agendado)', value: 'reopen', icon: 'repeat' });
  if (a.status !== 'done') options.push({ label: 'Agendar outro para este cliente', value: 'follow-up', icon: 'plus' });
  options.push({ label: 'Excluir', value: 'delete', icon: 'trash', danger: true });

  const choice = await chooseSheet({ title: a.clientName || 'Compromisso', options });
  if (choice === 'cancel') {
    const ok = await confirmSheet({
      title: 'Cancelar este compromisso?',
      message: 'Ele continua na agenda como cancelado e os lembretes não serão enviados.',
      confirmLabel: 'Cancelar compromisso', cancelLabel: 'Voltar', danger: true
    });
    if (ok) store.cancelAppointment(a.id);
  } else if (choice === 'reopen') {
    store.reopenAppointment(a.id);
  } else if (choice === 'follow-up') {
    openAppointmentForm({ preset: presetFrom(a) });
  } else if (choice === 'delete') {
    await deleteFlow(a, sheet);
  }
}

async function deleteFlow(a, sheet) {
  if (a.seriesId) {
    const which = await chooseSheet({
      title: 'Este compromisso se repete',
      options: [
        { label: 'Excluir só este', value: 'one', icon: 'trash', danger: true },
        { label: 'Excluir este e os próximos da série', value: 'series', icon: 'trash', danger: true }
      ]
    });
    if (!which) return;
    await sheet.close();
    if (which === 'one') store.deleteAppointment(a.id);
    else await store.deleteSeriesFrom(a.seriesId, a.datetimeMs);
    return;
  }
  const ok = await confirmSheet({ title: 'Excluir compromisso?', message: 'Esta ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true });
  if (!ok) return;
  await sheet.close();
  store.deleteAppointment(a.id);
}

// ---------- Formulário (novo / editar) ----------

function defaultTime(dateKeyValue) {
  if (dateKeyValue !== dayKey(Date.now())) return '09:00';
  const d = new Date();
  const next = Math.min(d.getHours() + 1, 23);
  return `${String(next).padStart(2, '0')}:00`;
}

export function openAppointmentForm({ id = null, preset = {} } = {}) {
  const editing = id ? store.getAppointment(id) : null;
  const src = editing || preset;
  const todayKey = dayKey(Date.now());
  const dateValue = editing ? dayKey(editing.datetimeMs) : (preset.dateKey && preset.dateKey >= todayKey ? preset.dateKey : todayKey);
  const timeValue = editing ? timeHM(editing.datetimeMs) : defaultTime(dateValue);
  const duration = src.durationMin || DEFAULT_DURATION;
  const sheet = openSheet({ label: editing ? 'Editar compromisso' : 'Novo compromisso' });

  sheet.render(html`
    <h2 class="sheet-title">${editing ? 'Editar compromisso' : 'Novo compromisso'}</h2>
    <form novalidate autocomplete="off">
      <label class="field"><span>Cliente</span>
        <input name="clientName" list="client-options" required placeholder="Nome do cliente" value="${src.clientName || ''}" enterkeyhint="next">
        <span class="hint" data-hint></span>
      </label>
      <datalist id="client-options">${store.getClients().map((c) => html`<option value="${c.name}"></option>`)}</datalist>
      <label class="field"><span>Telefone</span>
        <input name="phone" type="tel" inputmode="tel" placeholder="(00) 00000-0000" value="${src.phone || ''}">
      </label>
      <div class="row2">
        <label class="field"><span>Data</span><input name="date" type="date" required value="${dateValue}"></label>
        <label class="field"><span>Hora</span><input name="time" type="time" required value="${timeValue}"></label>
      </div>
      <div class="day-preview" data-preview></div>
      <span class="hint warn" data-conflict></span>
      <label class="field"><span>Duração prevista</span>
        <select name="duration">${DURATIONS.map((d) => html`<option value="${d}" ${d === duration ? safe('selected') : ''}>${formatDuration(d)}</option>`)}</select>
      </label>
      <label class="field"><span>Endereço</span>
        <input name="address" placeholder="Rua, número, bairro, cidade" value="${src.address || ''}">
      </label>
      <label class="field"><span>Observações</span>
        <textarea name="notes" rows="3" placeholder="O que foi combinado com o cliente">${editing ? editing.notes : ''}</textarea>
      </label>
      ${editing ? '' : html`
        <div class="row2">
          <label class="field"><span>Repetir</span>
            <select name="repeat">${Object.entries(REPEAT_LABEL).map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select>
          </label>
          <label class="field" data-count hidden><span>Quantas vezes</span>
            <input name="count" type="number" inputmode="numeric" min="2" max="52" value="4">
          </label>
        </div>`}
      <p class="form-error" data-error></p>
      <div class="sheet-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">${editing ? 'Salvar' : 'Agendar'}</button>
      </div>
    </form>`);

  const form = sheet.el.querySelector('form');
  const f = form.elements;
  const hint = form.querySelector('[data-hint]');
  const errorEl = form.querySelector('[data-error]');
  let linkedClientId = src.clientId || null;

  function onClientInput() {
    const name = f.clientName.value.trim();
    const client = store.findClientByName(name);
    if (client) {
      linkedClientId = client.id;
      if (!f.phone.value.trim() && client.phone) f.phone.value = client.phone;
      if (!f.address.value.trim() && client.address) f.address.value = client.address;
      hint.textContent = 'Cliente cadastrado ✓';
      hint.className = 'hint ok';
    } else {
      linkedClientId = null;
      hint.textContent = name ? 'Cliente novo — será adicionado à lista de clientes.' : '';
      hint.className = 'hint';
    }
  }

  function updateDayPreview() {
    const preview = form.querySelector('[data-preview]');
    const conflictEl = form.querySelector('[data-conflict]');
    conflictEl.textContent = '';
    if (!f.date.value) {
      preview.innerHTML = '';
      return;
    }
    const sameDay = store.allAppointments().filter((a) =>
      dayKey(a.datetimeMs) === f.date.value && a.id !== id && a.status !== 'canceled');
    render(preview, sameDay.length
      ? html`<span class="muted small">Neste dia:</span>${sameDay.map((a) => html`<span class="pill">${timeHM(a.datetimeMs)} · ${truncate(a.clientName, 18)}</span>`)}`
      : html`<span class="muted small">Nenhum outro compromisso neste dia.</span>`);
    if (f.time.value) {
      const start = localDateTimeToMs(f.date.value, f.time.value);
      const conflicts = findConflicts(sameDay, start, Number(f.duration.value), id);
      if (conflicts.length) {
        conflictEl.textContent = `Atenção: choca com ${conflicts.map((c) => `${timeHM(c.datetimeMs)} ${c.clientName}`).join(', ')}.`;
      }
    }
  }

  f.clientName.addEventListener('input', onClientInput);
  ['date', 'time', 'duration'].forEach((n) => f[n].addEventListener('input', updateDayPreview));
  f.duration.addEventListener('change', updateDayPreview);
  if (f.repeat) {
    f.repeat.addEventListener('change', () => {
      form.querySelector('[data-count]').hidden = f.repeat.value === 'none';
    });
  }
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => sheet.close());
  if (src.clientName) onClientInput();
  updateDayPreview();
  if (!src.clientName) setTimeout(() => f.clientName.focus(), 250);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const clientName = f.clientName.value.trim();
    if (!clientName) {
      errorEl.textContent = 'Informe o nome do cliente.';
      f.clientName.focus();
      return;
    }
    if (!f.date.value || !f.time.value) {
      errorEl.textContent = 'Informe a data e a hora.';
      return;
    }
    const datetimeMs = localDateTimeToMs(f.date.value, f.time.value);
    const repeat = f.repeat ? f.repeat.value : 'none';
    const repeatCount = repeat === 'none' ? 1 : Math.round(Number(f.count.value));
    if (repeat !== 'none' && !(repeatCount >= 2 && repeatCount <= 52)) {
      errorEl.textContent = 'Escolha entre 2 e 52 repetições.';
      return;
    }
    if (!editing && datetimeMs < Date.now() - 5 * MINUTE) {
      const ok = await confirmSheet({
        title: 'Esse horário já passou',
        message: 'Registrar mesmo assim? Útil para anotar uma visita que já aconteceu.',
        confirmLabel: 'Registrar'
      });
      if (!ok) return;
    }
    store.saveAppointment({
      clientId: linkedClientId,
      clientName,
      phone: f.phone.value,
      address: f.address.value,
      notes: f.notes.value,
      datetimeMs,
      durationMin: Number(f.duration.value)
    }, { id, repeat, repeatCount });
    await sheet.close();
  });
}

// ---------- Concluir visita / relatório ----------

export function openConclude(id, { complete = true } = {}) {
  const a = store.getAppointment(id);
  if (!a) return;
  const sheet = openSheet({ label: 'Relatório da visita' });
  sheet.render(html`
    <h2 class="sheet-title">${complete ? 'Concluir visita' : 'Relatório da visita'}</h2>
    <p class="muted" style="margin-top:4px">${a.clientName} · ${ddmm(dayKey(a.datetimeMs))} às ${timeHM(a.datetimeMs)}</p>
    <form novalidate>
      <label class="field"><span>O que foi feito na visita</span>
        <textarea name="report" rows="6" placeholder="Serviço realizado, peças trocadas, pendências, próximos passos…">${a.visitReport}</textarea>
      </label>
      <label class="field"><span>Valor cobrado (opcional)</span>
        <input name="price" inputmode="decimal" placeholder="R$ 0,00" value="${typeof a.price === 'number' ? a.price.toFixed(2).replace('.', ',') : ''}">
      </label>
      <label class="check-row"><input type="checkbox" name="paid" ${a.paid ? safe('checked') : ''}>Pagamento recebido</label>
      <p class="form-error" data-error></p>
      <div class="sheet-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">Cancelar</button>
        <button type="submit" class="btn ${complete ? 'btn-success' : 'btn-primary'}">${complete ? 'Concluir' : 'Salvar'}</button>
      </div>
    </form>`);

  const form = sheet.el.querySelector('form');
  const f = form.elements;
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => sheet.close());
  setTimeout(() => f.report.focus(), 250);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawPrice = f.price.value.trim();
    const price = rawPrice ? parseMoney(rawPrice) : null;
    if (rawPrice && price === null) {
      form.querySelector('[data-error]').textContent = 'Valor inválido. Exemplo: 150,00';
      f.price.focus();
      return;
    }
    store.saveVisitReport(id, { report: f.report.value, price, paid: f.paid.checked }, { complete, quiet: complete });
    await sheet.close();
    if (complete) {
      const preset = presetFrom(a);
      toast('Visita concluída', { action: { label: 'Agendar retorno', onClick: () => openAppointmentForm({ preset }) } });
    }
  });
}
