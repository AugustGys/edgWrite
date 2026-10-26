// storage.js - chrome.storage.local 便签元数据 CRUD
// 所有操作 Promise 化，错误通过 chrome.runtime.lastError 捕获

const Storage = (() => {
  const KEY = 'notes';

  /** 获取全部便签，按置顶优先 + updatedAt 倒序 */
  async function getAllNotes() {
    try {
      const data = await chrome.storage.local.get(KEY);
      let notes = data[KEY] || [];
      if (chrome.runtime.lastError) throw chrome.runtime.lastError;
      // 排序：置顶优先，其次 updatedAt 倒序
      notes.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
      return notes;
    } catch (err) {
      console.error('[Storage] getAllNotes 失败:', err);
      return [];
    }
  }

  /** 写入全部（替换） */
  async function setAllNotes(notes) {
    await chrome.storage.local.set({ [KEY]: notes });
    if (chrome.runtime.lastError) throw chrome.runtime.lastError;
  }

  /** 按 id 获取单条 */
  async function getNote(id) {
    if (!id) return null;
    const notes = await getAllNotes();
    return notes.find(n => n.id === id) || null;
  }

  /** 新增便签 */
  async function addNote(note) {
    const notes = await getAllNotes();
    notes.push(note);
    await setAllNotes(notes);
    return note;
  }

  /** 更新便签（全量替换单条） */
  async function updateNote(id, patch) {
    const notes = await getAllNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx < 0) return null;
    // 合并 patch，保留 id / createdAt
    const updated = { ...notes[idx], ...patch, id: notes[idx].id, updatedAt: Date.now() };
    notes[idx] = updated;
    await setAllNotes(notes);
    return updated;
  }

  /** 删除便签（只从 storage 删，调用方负责先删 IndexedDB 图片） */
  async function deleteNote(id) {
    const notes = await getAllNotes();
    const target = notes.find(n => n.id === id);
    const filtered = notes.filter(n => n.id !== id);
    await setAllNotes(filtered);
    return target || null;
  }

  /** 按关键词搜索（不区分大小写） */
  async function searchNotes(keyword) {
    const k = String(keyword || '').trim().toLowerCase();
    if (!k) return getAllNotes();
    const notes = await getAllNotes();
    return notes.filter(n =>
      (n.title || '').toLowerCase().includes(k) ||
      (n.content || '').toLowerCase().includes(k)
    );
  }

  /** 获取当前 notes 数组（不排序）——导出专用 */
  async function getAllNotesRaw() {
    const data = await chrome.storage.local.get(KEY);
    return data[KEY] || [];
  }

  return {
    getAllNotes,
    getNote,
    addNote,
    updateNote,
    deleteNote,
    deleteNotes: async function(ids) {
      const all = await getAllNotesRaw();
      const set = new Set(ids);
      const filtered = all.filter(n => !set.has(n.id));
      await setAllNotes(filtered);
      return all.filter(n => set.has(n.id)); // 返回被删除的项
    },
    searchNotes,
    setAllNotes,
    getAllNotesRaw
  };
})();

if (typeof globalThis !== 'undefined') globalThis.Storage = Storage;
