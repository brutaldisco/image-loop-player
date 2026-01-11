export type SessionImage = {
  id: string;
  name: string;
  dataUrl: string;
};

export type SessionData = {
  intervalMs: number;
  images: SessionImage[];
};

const DB_NAME = "image-loop-player";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const SESSION_KEY = "session";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not supported in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    };
  });
}

export async function saveSession(session: SessionData): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(session, SESSION_KEY);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save session"));
  });
}

export async function loadSession(): Promise<SessionData | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(SESSION_KEY);

    request.onsuccess = () => {
      resolve((request.result as SessionData | undefined) ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to load session"));
  });
}
