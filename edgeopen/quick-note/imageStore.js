// imageStore.js - IndexedDB 图片存储
// 职责：管理图片二进制（原图 + 缩略图），Promise 化所有操作
// 数据库：quicknote-db v1
// objectStore：images, keyPath = "id"
//
// 关键：IDB 请求是异步的 —— 读操作必须在 req.onsuccess 回调里取 req.result；
// 写操作以 tx.oncomplete 作为完成信号。严禁同步读取 req.result（永远是 undefined）。

const ImageStore = (() => {
  const DB_NAME = 'quicknote-db';
  const DB_VERSION = 1;
  const STORE = 'images';

  let _dbPromise = null;

  /** 打开数据库（单例 Promise） */
  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };

      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
      req.onblocked = () => reject(new Error('IndexedDB 被其他标签页阻塞'));
    });
    return _dbPromise;
  }

  /**
   * 写事务包装：txFn(store) 内发起任意数量写/删请求，
   * 整个事务提交完成（tx.oncomplete）后才 resolve，保证落库。
   */
  async function withTx(mode, txFn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('事务中止'));
      tx.oncomplete = () => resolve();
      txFn(tx.objectStore(STORE));
    });
  }

  /**
   * 单个读请求包装：在 req.onsuccess 里取 req.result，
   * 这才是 IndexedDB 读操作的唯一正确时机。
   */
  async function readOne(requestFn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      tx.onerror = () => reject(tx.error);
      const req = requestFn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** 写入一张图片 */
  function putImage(record) {
    if (!record || !record.id) return Promise.reject(new Error('缺少 id'));
    return withTx('readwrite', (store) => {
      store.put({
        id: record.id,
        blob: record.blob,
        thumbBlob: record.thumbBlob,
        w: record.w,
        h: record.h,
        size: record.size,
        type: record.type,
        createdAt: record.createdAt || Date.now()
      });
    });
  }

  /** 获取完整记录 */
  function getRecord(id) {
    if (!id) return Promise.resolve(null);
    return readOne((store) => store.get(id)).then((rec) => rec || null);
  }

  /** 获取原图 Blob */
  async function getImage(id) {
    const rec = await getRecord(id);
    return rec ? rec.blob : null;
  }

  /** 获取缩略图 Blob */
  async function getThumb(id) {
    const rec = await getRecord(id);
    return rec ? rec.thumbBlob : null;
  }

  /** 删除一张图片 */
  function deleteImage(id) {
    if (!id) return Promise.resolve();
    return withTx('readwrite', (store) => { store.delete(id); });
  }

  /** 批量删除（按 id 列表） */
  function deleteImagesByIds(ids) {
    if (!ids || !ids.length) return Promise.resolve();
    return withTx('readwrite', (store) => {
      ids.forEach((id) => store.delete(id));
    });
  }

  /** 按 note 删除关联图片（传入 note.images 数组） */
  function deleteImagesByNote(noteImages) {
    if (!noteImages || !noteImages.length) return Promise.resolve();
    const ids = noteImages.map((img) => img.id).filter(Boolean);
    return deleteImagesByIds(ids);
  }

  /** 获取所有图片 id */
  function getAllImageIds() {
    return readOne((store) => store.getAllKeys()).then((r) => r || []);
  }

  /** 获取所有记录（遍历用） */
  function getAllRecords() {
    return readOne((store) => store.getAll()).then((r) => r || []);
  }

  /** 统计占用体积（字节） */
  async function getTotalSize() {
    const all = await getAllRecords();
    return all.reduce((acc, rec) =>
      acc + (rec.size || 0) + (rec.thumbBlob ? rec.thumbBlob.size : 0), 0);
  }

  /** 清空整个库 */
  function clearAll() {
    return withTx('readwrite', (store) => { store.clear(); });
  }

  return {
    putImage,
    getImage,
    getThumb,
    getRecord,
    deleteImage,
    deleteImagesByIds,
    deleteImagesByNote,
    getAllImageIds,
    getTotalSize,
    getAllRecords,
    clearAll
  };
})();

// Service Worker / popup 双环境兼容：挂到 globalThis
if (typeof globalThis !== 'undefined') globalThis.ImageStore = ImageStore;
