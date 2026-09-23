importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Mesmas credenciais de firebase-config.js (precisa duplicar aqui porque o
// service worker roda num contexto separado e não pode importar o outro arquivo).
firebase.initializeApp({
  apiKey: "AIzaSyDvS4XhhbdaR8XzrrHyNiKNZ2xlGzv2zSM",
  authDomain: "agenda-326fa.firebaseapp.com",
  projectId: "agenda-326fa",
  storageBucket: "agenda-326fa.firebasestorage.app",
  messagingSenderId: "678737410276",
  appId: "1:678737410276:web:4ba11057e40587cecc54f1"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Lembrete de compromisso';
  const options = {
    body: payload.notification?.body || '',
    icon: 'icons/icon.svg',
    badge: 'icons/icon.svg'
  };
  self.registration.showNotification(title, options);
});
