const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const REMINDER_WINDOWS = [
  { field: 'notified1Day', offsetMs: 24 * 60 * 60 * 1000, label: 'amanhã' },
  { field: 'notified2h', offsetMs: 2 * 60 * 60 * 1000, label: 'em 2 horas' }
];

async function getAllTokens() {
  const snap = await db.collection('deviceTokens').get();
  const tokens = new Set();
  snap.forEach((doc) => {
    (doc.data().tokens || []).forEach((t) => tokens.add(t));
  });
  return Array.from(tokens);
}

function formatWhen(date) {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function main() {
  const now = new Date();
  const tokens = await getAllTokens();

  if (tokens.length === 0) {
    console.log('Nenhum token de dispositivo cadastrado ainda — ninguém vai receber push.');
  }

  const apptsSnap = await db.collection('appointments').get();
  let sentCount = 0;

  for (const apptDoc of apptsSnap.docs) {
    const appt = apptDoc.data();
    if (!appt.datetime) continue;
    const apptTime = appt.datetime.toDate();

    for (const w of REMINDER_WINDOWS) {
      if (appt[w.field]) continue;

      const triggerTime = new Date(apptTime.getTime() - w.offsetMs);
      if (triggerTime > now) continue;

      if (tokens.length > 0) {
        const bodyParts = [`${appt.clientName} — ${formatWhen(apptTime)}`];
        if (appt.address) bodyParts.push(appt.address);

        const response = await admin.messaging().sendEachForMulticast({
          tokens,
          notification: {
            title: `Compromisso ${w.label}`,
            body: bodyParts.join('\n')
          }
        });
        sentCount += response.successCount;
        console.log(`[${apptDoc.id}] lembrete "${w.label}": ${response.successCount} enviado(s), ${response.failureCount} falha(s)`);
      }

      await apptDoc.ref.update({ [w.field]: true });
    }
  }

  console.log(`Concluído. Notificações enviadas nesta execução: ${sentCount}.`);
}

main().catch((err) => {
  console.error('Erro ao checar lembretes:', err);
  process.exit(1);
});
