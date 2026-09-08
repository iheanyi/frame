/** Local-only raw takes and editable project data. Never uploads media. */
export interface TakeSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bytes: number;
  mimeType: string;
  width: number;
  height: number;
  duration: number;
  kind?: 'original' | 'export' | 'screenshot';
  thumbnail?: string;
}
export interface SavedTake extends TakeSummary {
  blob: Blob;
  project?: unknown;
}
const DATABASE = 'frame-local-studio';
const STORE = 'takes';
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Local project storage is unavailable in this browser. Download your original before closing this tab.'));
        return;
      }
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Frame tabs to finish opening local storage.'));
    }).catch((error) => { database = undefined; throw error; });
  }
  return database;
}
async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => {
      const error = transaction.error || request.error;
      reject(new Error(error?.name === 'QuotaExceededError'
        ? 'Browser storage is full. Download this take and remove older local projects before closing the tab.'
        : error?.message || 'Could not save your take locally. Keep this tab open and download the original.'));
    };
    transaction.onerror = () => {}; // The abort event reports the transaction outcome.
  });
}
export async function saveTake(blob: Blob, metadata: Partial<Pick<TakeSummary, 'name' | 'width' | 'height' | 'duration' | 'kind' | 'thumbnail'>> = {}): Promise<TakeSummary> {
  const now = Date.now();
  const take: SavedTake = {
    id: crypto.randomUUID(), name: metadata.name || `Recording ${new Date(now).toLocaleString()}`,
    createdAt: now, updatedAt: now, bytes: blob.size, mimeType: blob.type,
    width: metadata.width || 0, height: metadata.height || 0, duration: metadata.duration || 0, kind: metadata.kind || (blob.type.startsWith('image/') ? 'screenshot' : 'original'), thumbnail: metadata.thumbnail, blob,
  };
  await transact('readwrite', (store) => store.add(take));
  const { blob: _blob, project: _project, ...summary } = take;
  return summary;
}
export async function listTakes(): Promise<TakeSummary[]> {
  // Cursors avoid materializing all video blobs in JavaScript while listing the library.
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).openCursor();
    const summaries: TakeSummary[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const { blob: _blob, project: _project, ...summary } = cursor.value as SavedTake;
      summaries.push(summary);
      cursor.continue();
    };
    transaction.oncomplete = () => resolve(summaries.sort((a, b) => b.updatedAt - a.updatedAt));
    transaction.onabort = () => reject(transaction.error || request.error);
  });
}
export async function loadTake(id: string): Promise<SavedTake | undefined> {
  return transact('readonly', (store) => store.get(id));
}
export async function saveProject(id: string, project: unknown): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) { transaction.abort(); return; }
      store.put({ ...request.result, project, updatedAt: Date.now() });
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('The local take is no longer available.'));
  });
}
export async function deleteTake(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id));
}
export async function updateTake(id: string, values: Partial<Pick<TakeSummary,'name'|'width'|'height'|'duration'|'thumbnail'>>): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'), store=tx.objectStore(STORE), req=store.get(id);
    req.onsuccess=()=>{if(!req.result){tx.abort();return}store.put({...req.result,...values,updatedAt:Date.now()})};
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('Take no longer exists.'));
  });
}
export async function localStorageEstimate(): Promise<StorageEstimate | undefined> {
  return navigator.storage?.estimate?.();
}
