/**
 * Minimal IndexedDB helper for storing the app state as a fallback when localStorage is unavailable.
 * Exposes async getState() and setState(payload) functions.
 */
const DB_NAME = "atlas_idb";
const STORE_NAME = "kv";
const STATE_KEY = "industrial_planning_intelligence_state_v1";

function openDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

export async function idbGetState() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const r = store.get(STATE_KEY);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch (err) {
    return null;
  }
}

export async function idbSetState(value) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const r = store.put(value, STATE_KEY);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  } catch (err) {
    return false;
  }
}

