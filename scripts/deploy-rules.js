import { readFile } from 'node:fs/promises';
import { initializeApp, cert } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
if (!serviceAccount.project_id) {
  console.error('FIREBASE_SERVICE_ACCOUNT_KEY não configurada.');
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const source = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const ruleset = await getSecurityRules().releaseFirestoreRulesetFromSource(source);
console.log(`Regras do Firestore publicadas: ${ruleset.name}`);
