import { firebaseConfig } from '../firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

// Modo de teste local: http://localhost:PORTA/?mock usa um backend falso em memória (dev/mock-firebase.js),
// sem tocar nos dados reais. Nunca é ativado fora do localhost.
const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
export const MOCK = isLocalhost && new URLSearchParams(location.search).has('mock');

let appApi, authApi, fs, messagingApi, mock = null;
if (MOCK) {
  mock = await import('../dev/mock-firebase.js');
  ({ appApi, authApi, fs, messagingApi } = mock);
} else {
  [appApi, authApi, fs, messagingApi] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
    import(`${SDK}/firebase-messaging.js`)
  ]);
}

export const app = appApi.initializeApp(firebaseConfig);
export const auth = authApi.getAuth(app);

// Cache local persistente: a agenda abre e funciona sem internet, e as alterações sincronizam depois.
let firestore;
try {
  firestore = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
  });
} catch (err) {
  console.warn('Cache offline indisponível, usando só memória.', err);
  firestore = fs.getFirestore(app);
}

export const db = firestore;
export { authApi, fs, messagingApi, mock };
