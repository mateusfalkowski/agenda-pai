import * as store from '../store.js';
import { html, render, icon, initials, openSheet, confirmSheet, toast } from '../ui.js';
import { clientMatches, formatPhone, formatMoney, monthName, relativeDay, timeHM, dayKey, ddmm } from '../logic.js';
import { apptRow } from './components.js';
import { openAppointmentDetail, openAppointmentForm, quickActions } from './appointment.js';

let query = '';

function clientIndex(nowMs) {
  const idx = new Map();
  for (const a of store.allAppointments()) {
    if (!a.clientId) continue;
    let e = idx.get(a.clientId);
    if (!e) idx.set(a.clientId, (e = { next: null, last: null }));
    if (a.status === 'scheduled' && a.datetimeMs >= nowMs) {
      if (!e.next || a.datetimeMs < e.next.datetimeMs) e.next = a;
    } else if (a.status === 'done') {
      if (!e.last || a.datetimeMs > e.last.datetimeMs) e.last = a;
    }
  }
  return idx;
}

export function renderClients(root) {
  if (!root.querySelector('#client-list')) {
    render(root, html`
      <label class="search">${icon('search')}
        <input type="search" id="client-search" placeholder="Buscar por nome, telefone ou endereço" autocomplete="off" enterkeyhint="search" aria-label="Buscar cliente">
      </label>
      <div class="section">
        <div class="section-head"><h2 id="client-count"></h2></div>
        <div class="client-list" id="client-list"></div>
      </div>`);
    const input = root.querySelector('#client-search');
    input.value = query;
    input.addEventListener('input', () => {
      query = input.value;
      renderList(root);
    });
    root.querySelector('#client-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-client]');
      if (btn) openClientSheet(btn.dataset.client);
      if (e.target.closest('[data-act="new-client"]')) openClientForm();
    });
  }
  renderList(root);
}

function renderList(root) {
  const now = Date.now();
  const all = store.getClients();
  const list = all.filter((c) => clientMatches(c, query));
  const idx = clientIndex(now);
  const countEl = root.querySelector('#client-count');
  countEl.textContent = query.trim() ? `${list.length} de ${all.length}` : (all.length === 1 ? '1 cliente' : `${all.length} clientes`);

  const listEl = root.querySelector('#client-list');
  if (store.getErrors().clients) {
    render(listEl, html`<div class="empty">${icon('alert')}<p>O cadastro de clientes ficará disponível assim que as regras do banco forem atualizadas.</p></div>`);
    return;
  }
  if (!all.length) {
    render(listEl, html`<div class="empty">${icon('users')}
      <p>Nenhum cliente ainda. Eles são cadastrados automaticamente quando você agenda um compromisso.</p>
      <button type="button" class="btn btn-soft" data-act="new-client">${icon('plus')}Cadastrar cliente</button></div>`);
    return;
  }
  if (!list.length) {
    render(listEl, html`<div class="empty">${icon('search')}<p>Nenhum cliente encontrado para “${query.trim()}”.</p></div>`);
    return;
  }
  render(listEl, list.map((c) => {
    const e = idx.get(c.id);
    let meta = '';
    if (e && e.next) meta = html`<strong>${relativeDay(e.next.datetimeMs, now)}</strong>${timeHM(e.next.datetimeMs)}`;
    else if (e && e.last) meta = html`Última visita<br>${ddmm(dayKey(e.last.datetimeMs))}`;
    return html`
      <button type="button" class="client" data-client="${c.id}">
        <span class="avatar">${initials(c.name)}</span>
        <span class="client-main">
          <span class="client-name">${c.name}</span>
          <span class="client-sub">${c.phone ? formatPhone(c.phone) : (c.address || 'Sem telefone')}</span>
        </span>
        <span class="client-meta">${meta}</span>
      </button>`;
  }));
}

// ---------- Ficha do cliente ----------

function clientContent(c, history) {
  const now = Date.now();
  const upcoming = (history || []).filter((a) => a.status === 'scheduled' && a.datetimeMs >= now).reverse();
  const past = (history || []).filter((a) => !(a.status === 'scheduled' && a.datetimeMs >= now));
  const done = past.filter((a) => a.status === 'done');
  const sum = (arr) => arr.reduce((s, a) => s + (typeof a.price === 'number' ? a.price : 0), 0);
  const received = sum(done.filter((a) => a.paid));
  const toReceive = sum(done.filter((a) => !a.paid));
  const since = c.createdMs ? new Date(c.createdMs) : null;

  return html`
    <div class="sheet-head">
      <span class="avatar lg">${initials(c.name)}</span>
      <div>
        <h2>${c.name}</h2>
        ${since ? html`<p class="muted small">Cliente desde ${monthName(since.getMonth())} de ${since.getFullYear()}</p>` : ''}
      </div>
    </div>
    ${quickActions(c.phone, c.address)}
    <div class="info">
      ${c.phone ? html`<div class="info-row">${icon('phone')}<div><div class="info-label">Telefone</div><div class="info-value">${formatPhone(c.phone)}</div></div></div>` : ''}
      ${c.address ? html`<div class="info-row">${icon('pin')}<div><div class="info-label">Endereço</div><div class="info-value">${c.address}</div></div></div>` : ''}
      ${c.notes ? html`<div class="info-row">${icon('note')}<div><div class="info-label">Anotações</div><div class="info-value">${c.notes}</div></div></div>` : ''}
    </div>
    ${history ? html`<div class="report-money">
      <span class="pill">${done.length === 1 ? '1 visita concluída' : `${done.length} visitas concluídas`}</span>
      ${received ? html`<span class="pill pill-ok">${formatMoney(received)} recebidos</span>` : ''}
      ${toReceive ? html`<span class="pill pill-warn">${formatMoney(toReceive)} a receber</span>` : ''}
    </div>` : ''}
    <div class="sheet-actions">
      <button type="button" class="btn btn-primary" data-act="new-appt">${icon('plus')}Agendar</button>
      <button type="button" class="btn btn-ghost" data-act="edit">${icon('edit')}Editar</button>
    </div>
    ${upcoming.length ? html`<h3 class="subhead">Próximos compromissos</h3>
      <div class="appt-list">${upcoming.map((a) => apptRow(a, now, { withDate: true, inClient: true }))}</div>` : ''}
    <h3 class="subhead">Histórico</h3>
    ${history === null
      ? html`<div class="appt-list"><div class="skeleton"></div><div class="skeleton"></div></div>`
      : past.length
        ? html`<div class="appt-list">${past.map((a) => apptRow(a, now, { withDate: true, inClient: true }))}</div>`
        : html`<p class="muted">Nenhuma visita anterior.</p>`}
    <div style="text-align:center;margin-top:18px">
      <button type="button" class="btn-link danger" data-act="delete">Excluir cliente</button>
    </div>`;
}

export function openClientSheet(id) {
  if (!store.getClient(id)) {
    toast('Cliente não encontrado.');
    return;
  }
  let history = null;
  let reloadTimer = null;
  let unsub = null;
  const sheet = openSheet({
    label: 'Ficha do cliente',
    onClose: () => {
      if (unsub) unsub();
      clearTimeout(reloadTimer);
    }
  });

  const draw = () => {
    const c = store.getClient(id);
    if (!c) {
      sheet.close();
      return;
    }
    sheet.render(clientContent(c, history));
    sheet.el.onclick = async (e) => {
      const open = e.target.closest('[data-open]');
      if (open) return openAppointmentDetail(open.dataset.open);
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'new-appt') {
        openAppointmentForm({ preset: { clientId: c.id, clientName: c.name, phone: c.phone, address: c.address } });
      } else if (act.dataset.act === 'edit') {
        openClientForm(c.id);
      } else if (act.dataset.act === 'delete') {
        const ok = await confirmSheet({
          title: `Excluir ${c.name}?`,
          message: 'A ficha do cliente será apagada. Os compromissos dele continuam na agenda.',
          confirmLabel: 'Excluir cliente', danger: true
        });
        if (ok) {
          await sheet.close();
          store.deleteClient(c.id);
        }
      }
    };
  };

  const load = () => store.clientHistory(id)
    .then((h) => { history = h; })
    .catch((err) => { console.error(err); history = []; })
    .finally(() => { if (sheet.isOpen()) draw(); });

  draw();
  load();
  unsub = store.subscribe((topic) => {
    if (!sheet.isOpen()) return;
    if (topic === 'clients') draw();
    if (topic === 'appointments') {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 800);
    }
  });
}

// ---------- Formulário do cliente ----------

export function openClientForm(id = null) {
  const c = id ? store.getClient(id) : null;
  const sheet = openSheet({ label: c ? 'Editar cliente' : 'Novo cliente' });
  sheet.render(html`
    <h2 class="sheet-title">${c ? 'Editar cliente' : 'Novo cliente'}</h2>
    <form novalidate autocomplete="off">
      <label class="field"><span>Nome</span><input name="name" required value="${c ? c.name : ''}" placeholder="Nome completo"></label>
      <label class="field"><span>Telefone / WhatsApp</span><input name="phone" type="tel" inputmode="tel" value="${c ? c.phone : ''}" placeholder="(00) 00000-0000"></label>
      <label class="field"><span>Endereço</span><input name="address" value="${c ? c.address : ''}" placeholder="Rua, número, bairro, cidade"></label>
      <label class="field"><span>Anotações</span><textarea name="notes" rows="3" placeholder="Preferências, equipamentos, referências…">${c ? c.notes : ''}</textarea></label>
      <p class="form-error" data-error></p>
      <div class="sheet-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form>`);
  const form = sheet.el.querySelector('form');
  const f = form.elements;
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => sheet.close());
  if (!c) setTimeout(() => f.name.focus(), 250);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = form.querySelector('[data-error]');
    const name = f.name.value.trim();
    if (!name) {
      errorEl.textContent = 'Informe o nome do cliente.';
      return;
    }
    const existing = store.findClientByName(name);
    if (existing && existing.id !== id) {
      errorEl.textContent = 'Já existe um cliente com esse nome.';
      return;
    }
    store.saveClient({ name, phone: f.phone.value, address: f.address.value, notes: f.notes.value }, id);
    await sheet.close();
  });
}
