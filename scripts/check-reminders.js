import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { runReminders } from './reminders-core.js';
import { firestoreRepo, fcmSender, dryRunSender } from './firebase-adapters.js';

const TZ = process.env.APP_TIMEZONE || 'America/Sao_Paulo';
const log = (msg) => console.log(msg);

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
if (!serviceAccount.project_id) {
  console.error('FIREBASE_SERVICE_ACCOUNT_KEY não configurada.');
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const repo = firestoreRepo(getFirestore());
const sender = process.env.DRY_RUN ? dryRunSender(log) : fcmSender(getMessaging());
const lastCommitMs = process.env.LAST_COMMIT_AT ? Number(process.env.LAST_COMMIT_AT) * 1000 : null;

try {
  const stats = await runReminders({ repo, sender, nowMs: Date.now(), tz: TZ, lastCommitMs, log });
  log(`Concluído: ${JSON.stringify(stats)}`);
} catch (err) {
  console.error('Erro ao checar lembretes:', err);
  await repo.writeStatus({
    ok: false,
    error: String(err && err.message ? err.message : err).slice(0, 500),
    lastRunMs: Date.now(),
    lastCommitMs
  }).catch(() => {});
  process.exit(1);
}
