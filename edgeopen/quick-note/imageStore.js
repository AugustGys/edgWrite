// imageStore.js - IndexedDB 图片存储
// 职责：管理图片二进制（原图 + 缩略图），Promise 化所有操作
// 数据库：quicknote-db v1
// objectStore：images, keyPath = "id"

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

  /** 包装一个事务，统一错误处理 */
  async function withStore(mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('事务中止'));
      const store = tx.objectStore(STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result);
    });
  }

  /** 写入一张图片 */
  async function putImage(record) {
    if (!record || !record.id) throw new Error('缺少 id');
    return withStore('readwrite', (store) => {
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

  /** 获取完整记录 */
  async function getRecord(id) {
    if (!id) return null;
    return withStore('readonly', (store) => {
      const req = store.get(id);
      req.onsuccess = () => { /* 通过 tx.oncomplete 返回 */ };
      return req.result || null;
    });
  }

  /** 删除一张图片 */
  async function deleteImage(id) {
    if (!id) return;
    return withStore('readwrite', (store) => {
      store.delete(id);
    });
  }

  /** 批量删除（按 id 列表） */
  async function deleteImagesByIds(ids) {
    if (!ids || !ids.length) return;
    return withStore('readwrite', (store) => {
      ids.forEach(id => store.delete(id));
    });
  }

  /** 按 note 删除关联图片（传入 note.images 数组） */
  async function deleteImagesByNote(noteImages) {
    if (!noteImages || !noteImages.length) return;
    const ids = noteImages.map(img => img.id).filter(Boolean);
    return deleteImagesByIds(ids);
  }

  /** 获取所有图片 id */
  async function getAllImageIds() {
    return withStore('readonly', (store) => {
      const req = store.getAllKeys();
      return req.result || [];
    });
  }

  /** 统计占用体积（字节） */
  async function getTotalSize() {
    return withStore('readonly', (store) => {
      const req = store.getAll();
      if (!req.result) return 0;
      return req.result.reduce((acc, rec) => acc + (rec.size || 0) + (rec.thumbBlob ? rec.thumbBlob.size : 0), 0);
    });
  }

  /** 获取所有记录（遍历用） */
  async function getAllRecords() {
    return withStore('readonly', (store) => {
      const req = store.getAll();
      return req.result || [];
    });
  }

  /** 清空整个库 */
  async function clearAll() {
    return withStore('readwrite', (store) => {
      store.clear();
    });
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
