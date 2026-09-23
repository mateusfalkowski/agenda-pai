# Agenda de Compromissos

App simples (PWA) pra marcar compromissos com clientes e receber lembrete push
no celular: **1 dia antes** e **2 horas antes** do horário marcado.

Como funciona:
- Você acessa o app pelo celular (funciona como app instalado, ícone na tela
  inicial) e cadastra os compromissos (cliente, data/hora, endereço, observações).
- Os dados ficam salvos no Firebase (Firestore).
- A cada 5 minutos, uma automação no GitHub (GitHub Actions) confere se algum
  compromisso está entrando na janela de "1 dia antes" ou "2 horas antes" e,
  se estiver, dispara a notificação push pro celular.
- Tudo isso no plano gratuito do Firebase e do GitHub — sem custo e sem cartão
  de crédito.

> A notificação pode chegar com até ~5 minutos de atraso em relação ao horário
> exato (é o intervalo da checagem automática). Pra lembrete de compromisso
> isso não costuma fazer diferença.

## Passo a passo da configuração (só precisa fazer uma vez)

### 1. Criar o projeto no Firebase
1. Acesse https://console.firebase.google.com e crie um projeto novo (ex:
   "agenda-pai"). Pode desativar o Google Analytics, não precisa.

### 2. Ativar o login (Authentication)
1. No menu lateral, vá em **Build > Authentication > Get started**.
2. Ative o provedor **E-mail/senha**.
3. Na aba **Users**, clique em **Add user** e crie um usuário com o e-mail e
   senha que seu pai vai usar pra entrar no app. Anote o **User UID** que
   aparece na lista depois de criado — vai precisar dele no passo 4.

### 3. Ativar o banco de dados (Firestore)
1. Vá em **Build > Firestore Database > Create database**.
2. Pode criar em modo de produção, na região padrão (ex: `southamerica-east1`
   se disponível, ou a região sugerida).

### 4. Colar as regras de segurança
1. Ainda no Firestore, vá na aba **Rules**.
2. Abra o arquivo [`firestore.rules`](firestore.rules) deste projeto, troque
   `COLOQUE_O_UID_AQUI` pelo UID do usuário criado no passo 2, e cole o
   conteúdo inteiro no editor de regras do console, substituindo o que já
   está lá. Clique em **Publish**.

### 5. Registrar o app da Web e pegar as credenciais
1. Na página inicial do projeto (ícone de engrenagem > **Project settings**),
   role até "Your apps" e clique no ícone `</>` (Web).
2. Dê um nome (ex: "agenda-web") e registre o app. **Não** marque Firebase
   Hosting.
3. Copie o objeto `firebaseConfig` que aparece e cole os valores no arquivo
   [`firebase-config.js`](firebase-config.js) deste projeto, substituindo os
   `"COLOQUE_AQUI"`.
4. Copie os mesmos valores também dentro do arquivo
   [`firebase-messaging-sw.js`](firebase-messaging-sw.js) (o objeto de
   configuração duplicado lá no topo).

### 6. Gerar a chave de notificação push (VAPID)
1. Em **Project settings > Cloud Messaging**, role até "Web configuration" e
   clique em **Generate key pair**.
2. Copie a chave gerada e cole em `vapidKey` no arquivo `firebase-config.js`.

### 7. Gerar a chave de serviço (pra automação do GitHub)
1. Em **Project settings > Service accounts**, clique em
   **Generate new private key**. Isso baixa um arquivo `.json`.
2. **Não coloque esse arquivo dentro da pasta do projeto** (ele já está no
   `.gitignore` por segurança, mas evite mesmo assim). Guarde em outro lugar
   por enquanto — você vai precisar do conteúdo dele no próximo passo.

### 8. Subir o projeto pro GitHub
Depois que eu (Claude) inicializar o repositório e você confirmar, crie um
repositório novo no GitHub (pode ser privado, já que tem dados de clientes) e
faça o push.

### 9. Configurar o segredo no GitHub Actions
1. No repositório do GitHub, vá em **Settings > Secrets and variables >
   Actions > New repository secret**.
2. Nome: `FIREBASE_SERVICE_ACCOUNT_KEY`.
3. Valor: cole o conteúdo **inteiro** do arquivo `.json` baixado no passo 7.

### 10. Ativar o GitHub Pages
1. Em **Settings > Pages**, em "Build and deployment", selecione a branch
   `main` e a pasta `/ (root)`.
2. Depois de alguns minutos, o app fica disponível em
   `https://SEU_USUARIO.github.io/NOME_DO_REPOSITORIO/`.

### 11. Instalar no celular do seu pai
1. Abra o link do GitHub Pages no Chrome do Android.
2. Faça login com o e-mail/senha criados no passo 2.
3. Toque em "Ativar" no aviso de notificações e permita.
4. No menu do Chrome (⋮), toque em **Adicionar à tela inicial** — isso
   instala o app como se fosse nativo.

Pronto: a partir daí, todo compromisso cadastrado vai gerar lembrete
automático 1 dia antes e 2 horas antes.
