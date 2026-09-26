// Utilitários de interface: templates com escape automático, ícones, toasts e painéis (bottom sheets)
// integrados ao botão "voltar" do Android.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const safe = (s) => new Safe(s);

function part(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || v === false || v === true) return '';
  return esc(v);
}

// Tudo que é interpolado é escapado, exceto outros templates html`` ou safe().
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new Safe(out);
}

export function render(el, content) {
  el.innerHTML = part(content);
}

export function icon(name, cls = '') {
  return safe(`<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`);
}

export function initials(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const first = words[0] ? words[0][0] : '?';
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// ---------- Toasts ----------

export function toast(message, { type = 'info', action = null, duration = 3200 } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  render(el, html`<span>${message}</span>${action ? html`<button type="button">${action.label}</button>` : ''}`);
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };
  if (action) {
    el.querySelector('button').addEventListener('click', () => {
      dismiss();
      action.onClick();
    });
  }
  while (host.children.length >= 3) host.firstElementChild.remove();
  host.appendChild(el);
  el.getBoundingClientRect(); // força o layout para a transição de entrada acontecer
  el.classList.add('show');
  timer = setTimeout(dismiss, action ? Math.max(duration, 6000) : duration);
  return dismiss;
}

// ---------- Painéis ----------
// Cada painel aberto empilha uma entrada no histórico; o "voltar" do celular fecha o painel do topo.

const stack = [];

function destroy(entry) {
  if (entry.closed) return;
  entry.closed = true;
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  entry.backdrop.classList.remove('open');
  setTimeout(() => entry.backdrop.remove(), 220);
  if (!stack.length) document.body.classList.remove('has-sheet');
  try { entry.onClose && entry.onClose(); } catch (err) { console.error(err); }
  entry.waiters.forEach((resolve) => resolve());
}

window.addEventListener('popstate', (e) => {
  const depth = (e.state && e.state.sheetDepth) || 0;
  while (stack.length > depth) destroy(stack[stack.length - 1]);
});

function closeEntry(entry) {
  if (entry.closed) return Promise.resolve();
  return new Promise((resolve) => {
    entry.waiters.push(resolve);
    const above = stack.length - stack.indexOf(entry);
    history.go(-above);
    // Segurança caso o navegador não dispare o popstate.
    setTimeout(() => {
      if (!entry.closed) {
        const idx = stack.indexOf(entry);
        for (let i = stack.length - 1; i >= idx && i >= 0; i--) destroy(stack[i]);
      }
    }, 600);
  });
}

export function openSheet({ label = '', onClose = null, className = '' } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = `sheet ${className}`.trim();
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  if (label) sheet.setAttribute('aria-label', label);
  sheet.innerHTML = '<div class="sheet-grip"></div><div class="sheet-body"></div>';
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  document.body.classList.add('has-sheet');

  const entry = { backdrop, sheet, onClose, closed: false, waiters: [] };
  stack.push(entry);
  history.pushState({ sheetDepth: stack.length }, '');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeEntry(entry);
  });
  backdrop.getBoundingClientRect(); // força o layout para a transição de entrada acontecer
  backdrop.classList.add('open');

  const body = sheet.querySelector('.sheet-body');
  return {
    el: body,
    close: () => closeEntry(entry),
    isOpen: () => !entry.closed,
    render: (content) => render(body, content)
  };
}

export function closeAllSheets() {
  if (!stack.length) return Promise.resolve();
  return closeEntry(stack[0]);
}

export function confirmSheet({ title, message = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const s = openSheet({ label: title, onClose: () => resolve(result) });
    s.render(html`
      <h2 class="sheet-title">${title}</h2>
      ${message ? html`<p class="muted" style="margin-top:8px">${message}</p>` : ''}
      <div class="sheet-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">${cancelLabel}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${confirmLabel}</button>
      </div>`);
    s.el.querySelector('[data-act="cancel"]').addEventListener('click', () => s.close());
    s.el.querySelector('[data-act="ok"]').addEventListener('click', () => {
      result = true;
      s.close();
    });
  });
}

// Lista de opções; resolve com o `value` escolhido (ou null se fechar).
export function chooseSheet({ title, options }) {
  return new Promise((resolve) => {
    let result = null;
    const s = openSheet({ label: title, onClose: () => resolve(result) });
    s.render(html`
      <h2 class="sheet-title">${title}</h2>
      <div class="menu-list">
        ${options.map((o, i) => html`<button type="button" class="menu-item ${o.danger ? 'danger' : ''}" data-i="${i}">${o.icon ? icon(o.icon) : ''}<span>${o.label}</span></button>`)}
      </div>`);
    s.el.querySelectorAll('[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        result = options[Number(btn.dataset.i)].value;
        s.close();
      });
    });
  });
}

export function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
