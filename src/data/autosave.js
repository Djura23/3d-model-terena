// Automatsko čuvanje projekta u IndexedDB pregledača (localStorage je premali za veće DMT-ove).
// Čuva se JSON tekst istog oblika kao izvoz projekta; sve greške se tiho ignorišu (privatni prozor i sl.).

const DB = 'geoteren-3d', STORE = 'kv', KEY = 'poslednji-projekat';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(r?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export async function saveProject(json, meta = {}) {
  try {
    await tx('readwrite', (s) => s.put({ json, savedAt: Date.now(), ...meta }, KEY));
    return true;
  } catch { return false; }
}

export async function loadSavedProject() {
  try { return (await tx('readonly', (s) => s.get(KEY))) || null; } catch { return null; }
}

export async function clearSavedProject() {
  try { await tx('readwrite', (s) => s.delete(KEY)); } catch { /* nema veze */ }
}
