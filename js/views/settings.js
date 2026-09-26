import * as store from '../store.js';
import * as notifications from '../notifications.js';
import { html, render, icon, safe, toast, confirmSheet, downloadFile } from '../ui.js';
import { schedulerHealth, maintenanceInfo, dayKey, ddmm, timeHM, ago } from '../logic.js';

let handlers = { logout: async () => {}, version: '' };
let testState = null; // { status, text }
let unwatchTest = null;
let busy = false;

export function setSettingsHandlers(h) {
  handlers = { ...handlers, ...h };
}

function toggle(name, label, description, checked) {
  return html`
    <label class="setting">
      <span class="setting-text"><strong>${label}</strong><span>${description}</span></span>
      <span class="switch"><input type="checkbox" data-setting="${name}" ${checked ? safe('checked') : ''}><span></span></span>
    </label>`;
}

function deviceSection() {
  const supported = notifications.supportedValue();
  const perm = notifications.permission();
  if (supported === null) return html`<div class="status-line"><span class="status-dot"></span>Verificando suporte a notificações…</div>`;
  if (!supported) {
    return html`<div class="status-line"><span class="status-dot error"></span>
      <span>Este navegador não recebe notificações. No Android, abra a agenda pelo <strong>Google Chrome</strong>.</span></div>`;
  }
  if (perm === 'denied') {
    return html`<div class="status-line"><span class="status-dot error"></span><span>Notificações <strong>bloqueadas</strong> neste aparelho.</span></div>
      <p class="muted small" style="margin-bottom:14px">Para liberar: no Chrome, toque no cadeado ao lado do endereço › Permissões › Notificações › Permitir.
      Se a agenda estiver instalada: Configurações do Android › Apps › Agenda › Notificações.</p>`;
  }
  if (perm === 'granted' && notifications.hasLocalToken()) {
    return html`<div class="status-line"><span class="status-dot ok"></span><span>Notificações <strong>ativadas</strong> neste aparelho.</span></div>
      <button type="button" class="btn btn-ghost btn-block" data-act="disable-notif">Desativar neste aparelho</button>`;
  }
  return html`<div class="status-line"><span class="status-dot warn"></span><span>Notificações desativadas neste aparelho.</span></div>
    <button type="button" class="btn btn-primary btn-block" data-act="enable-notif">${icon('bell')}Ativar notificações</button>`;
}

function healthSection(now) {
  const status = store.getStatus();
  const health = schedulerHealth(status, now);
  const maint = maintenanceInfo(status, now);
  const dot = health.level === 'unknown' ? '' : health.level;
  return html`
    <div class="status-line"><span class="status-dot ${dot}"></span><span>${health.text}</span></div>
    ${maint && maint.warn ? html`<p class="banner banner-warn">${icon('alert')}<span class="banner-text">
      O GitHub desativa os lembretes automáticos após 60 dias sem atualizações no repositório.
      Faltam <strong>${Math.max(maint.daysLeft, 0)} dia(s)</strong>. Qualquer commit no repositório renova o prazo.</span></p>` : ''}
    <details class="small muted" style="padding-bottom:14px">
      <summary>Detalhes técnicos</summary>
      <p style="margin-top:8px">Os lembretes são verificados a cada ~5 minutos (pode atrasar alguns minutos em horários de pico).</p>
      ${status && status.lastRunMs ? html`<p>Última execução: ${ddmm(dayKey(status.lastRunMs))} às ${timeHM(status.lastRunMs)} (${ago(status.lastRunMs, now)})${status.ok === false ? ' — com erro' : ''}.</p>` : ''}
      ${status && status.error ? html`<p>Erro: ${status.error}</p>` : ''}
      ${maint ? html`<p>Último commit no repositório: ${ago(status.lastCommitMs, now)}.</p>` : ''}
    </details>`;
}

function appSection() {
  let install;
  if (notifications.isStandalone()) {
    install = html`<div class="status-line"><span class="status-dot ok"></span>Instalado na tela inicial.</div>`;
  } else if (notifications.canInstall()) {
    install = html`<button type="button" class="btn btn-soft btn-block" data-act="install">${icon('phone-device')}Instalar na tela inicial</button>`;
  } else {
    install = html`<p class="muted small" style="padding:12px 0">Para instalar: no Chrome, toque no menu ⋮ › <strong>Adicionar à tela inicial</strong>.</p>`;
  }
  return html`${install}
    <button type="button" class="btn btn-ghost btn-block" data-act="export">${icon('download')}Exportar compromissos (planilha)</button>`;
}

export function renderSettings(root) {
  bind(root);
  // Não redesenha enquanto o usuário digita (evita perder o cursor).
  if (root.contains(document.activeElement) && document.activeElement.matches('input[type="text"], textarea')) return;
  const now = Date.now();
  const user = store.getUser();
  const s = store.getSettings();

  render(root, html`
    <section class="card settings-card">
      <h2>Notificações neste aparelho</h2>
      ${deviceSection()}
    </section>

    <section class="card settings-card">
      <h2>O que receber</h2>
      ${toggle('notify', 'Lembretes de compromissos', '1 dia antes e 2 horas antes de cada visita.', s.notify !== false)}
      ${toggle('dailySummary', 'Resumo da agenda às 7h', 'Uma notificação de manhã com os compromissos do dia.', !!s.dailySummary)}
      ${toggle('systemAlerts', 'Alertas técnicos', 'Avisos de manutenção do sistema de lembretes.', !!s.systemAlerts)}
      <button type="button" class="btn btn-ghost btn-block" data-act="test" ${busy ? safe('disabled') : ''}>${icon('send')}Enviar notificação de teste</button>
      ${testState ? html`<div class="status-line" style="margin-top:-6px"><span class="status-dot ${testState.status}"></span><span class="small">${testState.text}</span></div>` : ''}
    </section>

    <section class="card settings-card">
      <h2>Lembretes automáticos</h2>
      ${healthSection(now)}
    </section>

    <section class="card settings-card">
      <h2>Mensagens para clientes</h2>
      <label class="field" style="margin-bottom:14px"><span>Seu nome (assinatura da confirmação pelo WhatsApp)</span>
        <input type="text" data-name-input value="${s.displayName || ''}" placeholder="Ex.: Márcio" autocomplete="name">
      </label>
    </section>

    <section class="card settings-card">
      <h2>Aplicativo</h2>
      ${appSection()}
    </section>

    <section class="card settings-card">
      <h2>Conta</h2>
      <div class="status-line">${icon('user')}<span>${user ? user.email : ''}</span></div>
      <button type="button" class="btn btn-danger btn-block" data-act="logout">${icon('logout')}Sair da conta</button>
    </section>

    <p class="app-version">Agenda · versão ${handlers.version}</p>`);
}

async function runTest(root) {
  const user = store.getUser();
  if (notifications.permission() !== 'granted' || !notifications.hasLocalToken()) {
    const res = await notifications.enable(user.uid);
    if (!res.ok) {
      testState = { status: 'error', text: res.reason === 'denied' ? 'Permissão negada. Libere as notificações para testar.' : 'Não foi possível ativar as notificações neste aparelho.' };
      return;
    }
  }
  await notifications.showLocalTest().catch(() => {});
  testState = { status: 'warn', text: 'Pedido enviado. A notificação do servidor deve chegar em até ~10 minutos.' };
  renderSettings(root);
  try {
    const id = await store.requestTestPush();
    if (unwatchTest) unwatchTest();
    unwatchTest = store.watchTestPush(id, (data) => {
      if (!data || data.status === 'pending') return;
      if (data.status === 'sent') testState = { status: 'ok', text: `Servidor enviou para ${data.delivered} aparelho(s). Se chegou, está tudo certo!` };
      else if (data.status === 'no-devices') testState = { status: 'error', text: 'O servidor não encontrou nenhum aparelho cadastrado.' };
      else testState = { status: 'error', text: 'O servidor não conseguiu entregar a notificação.' };
      unwatchTest();
      unwatchTest = null;
      renderSettings(root);
    });
  } catch (err) {
    console.error(err);
    testState = { status: 'error', text: 'Não foi possível pedir o teste ao servidor.' };
  }
}

function bind(root) {
  if (root.dataset.bound) return;
  root.dataset.bound = '1';

  root.addEventListener('change', (e) => {
    const input = e.target.closest('[data-setting]');
    if (input) store.updateSettings({ [input.dataset.setting]: input.checked });
    if (e.target.matches('[data-name-input]')) store.updateSettings({ displayName: e.target.value.trim() });
  });

  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (!act || busy) return;
    const user = store.getUser();
    busy = true;
    try {
      switch (act.dataset.act) {
        case 'enable-notif': {
          const res = await notifications.enable(user.uid);
          if (res.ok) toast('Notificações ativadas neste aparelho');
          else if (res.reason === 'token') toast('Não foi possível ativar. Verifique a internet e tente de novo.', { type: 'error' });
          break;
        }
        case 'disable-notif':
          await notifications.disable(user.uid);
          toast('Este aparelho não vai mais receber lembretes');
          break;
        case 'test':
          await runTest(root);
          break;
        case 'install':
          await notifications.promptInstall();
          break;
        case 'export': {
          const csv = await store.exportCsv();
          downloadFile(`agenda-${dayKey(Date.now())}.csv`, csv, 'text/csv;charset=utf-8');
          break;
        }
        case 'logout': {
          const ok = await confirmSheet({
            title: 'Sair da conta?',
            message: 'Este aparelho deixará de receber os lembretes até você entrar de novo.',
            confirmLabel: 'Sair', danger: true
          });
          if (ok) await handlers.logout();
          break;
        }
      }
    } catch (err) {
      console.error(err);
      toast('Algo deu errado. Tente novamente.', { type: 'error' });
    } finally {
      busy = false;
      if (store.getUser()) renderSettings(root);
    }
  });
}
