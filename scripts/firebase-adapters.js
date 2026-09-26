import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

const toMs = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : (typeof v === 'number' ? v : null));

export function firestoreRepo(db) {
  return {
    async getUsers() {
      const [tokensSnap, usersSnap] = await Promise.all([
        db.collection('deviceTokens').get(),
        db.collection('users').get()
      ]);
      const byUid = new Map();
      const entry = (uid) => {
        if (!byUid.has(uid)) byUid.set(uid, { uid, tokens: [], settings: {} });
        return byUid.get(uid);
      };
      tokensSnap.forEach((d) => { entry(d.id).tokens = [...new Set(d.data().tokens || [])]; });
      usersSnap.forEach((d) => { entry(d.id).settings = d.data() || {}; });
      return [...byUid.values()];
    },

    async removeTokens(uid, tokens) {
      await db.collection('deviceTokens').doc(uid).update({ tokens: FieldValue.arrayRemove(...tokens) });
    },

    async getAppointmentsBetween(fromMs, toMs_) {
      const snap = await db.collection('appointments')
        .where('datetime', '>=', Timestamp.fromMillis(fromMs))
        .where('datetime', '<=', Timestamp.fromMillis(toMs_))
        .get();
      return snap.docs.map((d) => ({ ...d.data(), id: d.id, datetimeMs: toMs(d.get('datetime')), _updateTime: d.updateTime }));
    },

    async updateAppointment(appt, updates) {
      try {
        // Pré-condição: se o compromisso foi editado entre a leitura e agora, não sobrescreve os lembretes.
        await db.collection('appointments').doc(appt.id).update(updates, { lastUpdateTime: appt._updateTime });
      } catch (err) {
        if (err.code === 9 || err.code === 5) return; // FAILED_PRECONDITION / NOT_FOUND
        throw err;
      }
    },

    async getPendingTestPushes() {
      const snap = await db.collection('testPushes').where('status', '==', 'pending').get();
      return snap.docs.map((d) => ({ id: d.id, uid: d.get('uid'), createdMs: toMs(d.get('createdAt')) }));
    },

    async completeTestPush(id, data) {
      await db.collection('testPushes').doc(id).update(data);
    },

    async updateUser(uid, data) {
      await db.collection('users').doc(uid).set(data, { merge: true });
    },

    async writeStatus(data) {
      const { lastRunMs, lastSuccessMs, lastCommitMs, ...rest } = data;
      const doc = { ...rest, lastRunAt: Timestamp.fromMillis(lastRunMs) };
      if (lastSuccessMs) doc.lastSuccessAt = Timestamp.fromMillis(lastSuccessMs);
      if (lastCommitMs) doc.lastCommitAt = Timestamp.fromMillis(lastCommitMs);
      await db.collection('system').doc('status').set(doc, { merge: true });
    }
  };
}

// Mensagens "data-only": o service worker do app monta a notificação (evita notificação duplicada
// e permite abrir o compromisso certo ao tocar).
export function fcmSender(messaging) {
  return {
    async send(messages) {
      const results = [];
      for (let i = 0; i < messages.length; i += 500) {
        const chunk = messages.slice(i, i + 500);
        const resp = await messaging.sendEach(chunk.map(({ token, payload }) => {
          const { ttlSeconds, ...data } = payload;
          return {
            token,
            data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '')])),
            webpush: { headers: { TTL: String(ttlSeconds || 3600), Urgency: 'high' } }
          };
        }));
        for (const r of resp.responses) {
          const code = r.error ? r.error.code : null;
          results.push({ ok: r.success, error: code, invalidToken: INVALID_TOKEN_CODES.has(code) });
        }
      }
      return results;
    }
  };
}

export function dryRunSender(log) {
  return {
    async send(messages) {
      for (const m of messages) log(`[simulação] ${m.uid}: ${m.payload.title} | ${m.payload.body}`);
      return messages.map(() => ({ ok: true }));
    }
  };
}
