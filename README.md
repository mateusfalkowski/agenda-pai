# Agenda de Compromissos

App (PWA) para organizar visitas a clientes, registrar o que foi feito em cada visita e receber
lembretes no celular **1 dia antes** e **2 horas antes** de cada compromisso.

**Endereço:** https://mateusfalkowski.github.io/agenda-pai/

## Funcionalidades

- **Agenda**: calendário do mês com marcação dos dias ocupados, lista de próximos compromissos agrupada
  por dia, resumo do mês (agendados, concluídos, valores recebidos e a receber).
- **Aguardando relatório**: visitas que já passaram e ainda não foram concluídas aparecem no topo, com
  botão "Concluir".
- **Concluir visita**: registrar o que foi feito, valor cobrado e se já foi pago. Depois é possível
  "Agendar retorno" com um toque.
- **Clientes**: cadastro automático ao agendar (o app reconhece o nome mesmo sem acento/maiúscula),
  busca por nome, telefone ou endereço, ficha com histórico completo de visitas e valores.
- **Atalhos**: ligar, WhatsApp, abrir no Google Maps ou no Waze, e **mensagem de confirmação pronta**
  para o cliente pelo WhatsApp.
- **Compromissos repetidos**: semanal, quinzenal ou mensal (até 52 vezes); dá para excluir só um ou
  "este e os próximos".
- **Aviso de conflito**: ao agendar, mostra os outros compromissos do dia e avisa se o horário choca.
- **Remarcar**: ao mudar data/hora, os lembretes voltam a valer para o novo horário.
- **Notificações**: lembretes 1 dia e 2 horas antes, com botão "Abrir no mapa"; tocar na notificação
  abre o compromisso. Opcional: resumo da agenda às 7h.
- **Funciona sem internet**: a agenda abre e aceita alterações offline; sincroniza quando a conexão volta.
- **Ajustes**: status das notificações do aparelho, botão de **notificação de teste**, saúde do sistema de
  lembretes, exportação de todos os compromissos em planilha (CSV para Excel), nome para assinar as
  mensagens.
- Tema claro/escuro automático, ícone próprio e atalho "Novo compromisso" ao segurar o ícone do app.

## Como usar no celular (Android)

1. Abra o endereço acima no **Google Chrome** e entre com o e-mail e a senha.
2. Toque em **Ativar** no aviso de notificações e permita.
3. No menu do Chrome (⋮), toque em **Adicionar à tela inicial** (ou use o botão "Instalar" do app).
4. Em **Ajustes › Enviar notificação de teste**, confirme que as notificações chegam.

## Como funciona

```
Celular (PWA)  ──grava──▶  Firestore  ◀──lê/marca──  GitHub Actions (a cada ~5 min)
      ▲                                                     │
      └──────────── push (Firebase Cloud Messaging) ◀───────┘
```

- O app grava os compromissos no **Firestore** (plano gratuito do Firebase).
- O workflow [`Lembretes`](.github/workflows/check-reminders.yml) roda a cada ~5 minutos no GitHub
  Actions, lê **só os compromissos das próximas ~24h** (economiza a cota gratuita), decide quais
  lembretes enviar ([`js/logic.js`](js/logic.js)) e envia o push. Tokens de aparelhos inválidos são
  removidos automaticamente, e uma falha temporária do FCM é repetida na rodada seguinte.
- O [service worker](firebase-messaging-sw.js) monta a notificação no aparelho e mantém o app
  disponível offline.
- A cada rodada, o verificador grava um "sinal de vida" em `system/status`; se ele parar, o app mostra
  um aviso na agenda.

### Limitações conhecidas

- **Atraso**: o agendamento do GitHub é "melhor esforço" — o lembrete pode chegar alguns minutos depois
  do horário exato (normalmente 5–15 min; em horários de pico, mais).
- **60 dias sem commits**: em repositório público, o GitHub **desativa** agendamentos após 60 dias sem
  atividade. O app avisa em **Ajustes** a partir de 45 dias, e quem ativar "Alertas técnicos" recebe
  uma notificação a partir de 50 dias. Para renovar, basta qualquer commit. Se já tiver sido desativado:
  aba **Actions › Lembretes › Enable workflow** (ou `gh workflow enable check-reminders.yml`).
  (Não usamos commits automáticos "falsos" para contornar isso — o GitHub considera abuso.)

## Manutenção

### Liberar acesso para uma nova pessoa
1. Firebase Console › Authentication › **Add user** (e-mail e senha) e copie o UID.
2. Adicione o UID na lista de [`firestore.rules`](firestore.rules) e faça commit/push.
3. O workflow [`Publicar regras do Firestore`](.github/workflows/deploy-rules.yml) publica as regras
   automaticamente. Se ele falhar, cole o conteúdo do arquivo em Firestore › **Rules** › Publish.

### Segredo do GitHub
`FIREBASE_SERVICE_ACCOUNT_KEY` (Settings › Secrets and variables › Actions) contém a chave da conta de
serviço do Firebase. Ela nunca deve ser commitada no repositório.

## Desenvolvimento

```bash
npm install
npm test
```

Testes (Node, sem dependências extras) cobrem a lógica de datas/lembretes, o verificador com banco e
envio simulados e o service worker.

**Testar a interface sem tocar nos dados reais:** sirva a pasta localmente e abra com `?mock`:

```bash
python -m http.server 5544
```

Depois abra `http://localhost:5544/?mock&reset` e entre com `teste@agenda.dev` / `teste123`.
O [`dev/mock-firebase.js`](dev/mock-firebase.js) imita o Firebase no navegador com dados de exemplo
(`?mock&deny=clients` simula regras do banco desatualizadas). Esse modo só funciona em `localhost`.

### Estrutura

| Caminho | Conteúdo |
| --- | --- |
| `index.html`, `styles.css` | Estrutura e visual do app |
| `js/app.js` | Inicialização, login, abas, links vindos de notificações |
| `js/store.js` | Sincronização com o Firestore e todas as gravações |
| `js/logic.js` | Regras puras (datas, lembretes, telefone, valores, CSV) — usada no app e no servidor |
| `js/views/*` | Telas: agenda, compromisso, clientes, ajustes |
| `js/notifications.js` | Permissão, token do aparelho, instalação, service worker |
| `firebase-messaging-sw.js` | Service worker (push + offline) |
| `scripts/` | Verificador de lembretes e publicação das regras (GitHub Actions) |
| `test/` | Testes automatizados |
| `dev/` | Backend falso para testes locais |

### Modelo de dados (Firestore)

- `appointments/{id}`: cliente, telefone, endereço, observações, `datetime`, `durationMin`, `status`
  (`scheduled` · `done` · `canceled`), `visitReport`, `price`, `paid`, série (`seriesId`), marcações de
  lembrete (`notified1Day`, `notified2h`, `remindersInfo`).
- `clients/{id}`: nome, telefone, endereço, anotações.
- `users/{uid}`: preferências (lembretes, resumo diário, alertas, nome de assinatura).
- `deviceTokens/{uid}`: aparelhos cadastrados para receber push.
- `testPushes/{id}`: pedidos de notificação de teste feitos pelo app.
- `system/status`: sinal de vida do verificador.
