// manager.js - 便签完整管理页
// 职责：列表（多选/批量）、详情编辑、图片增删、导入导出

'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  // 左栏
  list: $('m-list'),
  empty: $('m-empty'),
  search: $('search-input'),
  btnClearSearch: $('btn-clear-search'),
  chkAll: $('chk-all'),
  btnBatchDel: $('btn-batch-del'),
  mStat: $('m-stat'),

  // 顶部
  btnNew: $('btn-new'),
  btnExport: $('btn-export'),
  btnExportText: $('btn-export-text'),
  fileImport: $('file-import'),

  // 右栏
  detail: $('m-detail'),
  noSelection: $('m-no-selection'),
  dTitle: $('d-title'),
  dContent: $('d-content'),
  dColorRow: $('d-color-row'),
  dImages: $('d-images'),
  dImgCount: $('d-img-count'),
  dDropzone: $('d-dropzone'),
  dBtnAdd: $('d-btn-add'),
  dFileInput: $('d-file-input'),
  dBtnSave: $('d-btn-save'),
  dBtnDel: $('d-btn-del'),
  dSaveStatus: $('d-save-status'),

  toast: $('toast')
};

let notes = [];
let currentId = null;
let selectedSet = new Set();   // 左侧勾选
let currentColor = 'yellow';
let currentImages = [];       // {id, thumbUrl?}
let allUrls = new Set();
let saveTimer = null;
let autoSaveInterval = null;

// ======== 图片加载失败占位图（内联 SVG） ========
const ERROR_PLACEHOLDER_INLINE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">' +
  '<rect width="80" height="80" rx="8" fill="#e5e7eb"/>' +
  '<path d="M16 64 L64 16 M16 16 L64 64" stroke="#9ca3af" stroke-width="3" stroke-linecap="round"/>' +
  '</svg>'
);

// ======== Toast ========
function showToast(msg, duration = 1800) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(els.toast._t);
  els.toast._t = setTimeout(() => els.toast.hidden = true, duration);
}

// ======== URL 管理 ========
function objUrl(blob) {
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  allUrls.add(u);
  return u;
}
function revokeAllUrls() {
  allUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  allUrls.clear();
}

// ======== 列表 ========
async function loadList(keyword = '') {
  try {
    notes = keyword ? await Storage.searchNotes(keyword) : await Storage.getAllNotes();
  } catch (err) {
    notes = [];
    showToast('加载失败: ' + err.message);
  }
  renderList();
  updateStat();
}

function renderList() {
  els.list.innerHTML = '';
  if (!notes.length) {
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;
  const frag = document.createDocumentFragment();
  for (const note of notes) {
    frag.appendChild(buildListItem(note));
  }
  els.list.appendChild(frag);
  updateBatchButtons();
}

function buildListItem(note) {
  const li = document.createElement('li');
  li.className = 'm-item' + (currentId === note.id ? ' selected' : '');
  li.dataset.id = note.id;
  li.dataset.color = note.color || 'yellow';

  const ck = document.createElement('input');
  ck.type = 'checkbox';
  ck.className = 'm-item-ck';
  ck.checked = selectedSet.has(note.id);
  ck.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ck.checked) selectedSet.add(note.id); else selectedSet.delete(note.id);
    updateBatchButtons();
  });

  const body = document.createElement('div');
  body.className = 'm-item-body';

  const title = document.createElement('div');
  title.className = 'm-item-title';
  title.textContent = note.title || '(无标题)';

  const content = document.createElement('div');
  content.className = 'm-item-content';
  content.textContent = note.content || '(无内容)';

  const meta = document.createElement('div');
  meta.className = 'm-item-meta';
  if (note.pinned) meta.innerHTML += '<span class="pin">📌</span>';
  if (note.images && note.images.length) {
    const b = document.createElement('span');
    b.className = 'm-item-badge';
    b.textContent = `🖼 ${note.images.length}`;
    meta.appendChild(b);
  }
  meta.appendChild(document.createTextNode('· ' + formatTime(note.updatedAt || note.createdAt)));

  body.appendChild(title);
  body.appendChild(content);
  body.appendChild(meta);

  li.appendChild(ck);
  li.appendChild(body);
  li.addEventListener('click', () => openDetail(note));
  return li;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  if (diffDays === 0) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diffDays === 1) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function updateBatchButtons() {
  const n = selectedSet.size;
  els.btnBatchDel.disabled = n === 0;
  els.chkAll.checked = n > 0 && n === notes.length;
}

async function updateStat() {
  try {
    const size = await ImageStore.getTotalSize();
    els.mStat.textContent = `图片占用：${ImageUtils.formatSize(size)}`;
  } catch (e) {}
}

// ======== 详情 ========
async function openDetail(note) {
  currentId = note.id;
  els.noSelection.hidden = true;
  els.detail.hidden = false;
  els.dTitle.value = note.title || '';
  els.dContent.value = note.content || '';
  applyColor(note.color || 'yellow');

  currentImages = [];
  if (note.images && note.images.length) {
    for (const img of note.images) {
      currentImages.push({ id: img.id, w: img.w, h: img.h, size: img.size, type: img.type, status: 'done' });
    }
  }
  renderDetailImages();
  setSaveStatus('', '已保存');
  startAutoSave();
  // 重新渲染左栏以高亮选中
  renderList();
}

function applyColor(c) {
  currentColor = c;
  els.dColorRow.querySelectorAll('.color-dot').forEach(d => {
    d.classList.toggle('active', d.dataset.color === c);
  });
}

function closeDetail() {
  stopAutoSave();
  currentId = null;
  revokeEditorUrls();
  currentImages = [];
  renderDetailImages();
  els.detail.hidden = true;
  els.noSelection.hidden = false;
  renderList();
}

const editorUrls = new Set();
function revokeEditorUrls() {
  editorUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  editorUrls.clear();
}
function editorObjUrl(blob) {
  const u = URL.createObjectURL(blob);
  editorUrls.add(u);
  return u;
}

async function renderDetailImages() {
  els.dImages.innerHTML = '';
  els.dImgCount.textContent = currentImages.length;
  if (!currentImages.length) return;
  for (const img of currentImages) {
    const card = document.createElement('div');
    card.className = 'm-img-card';
    if (img.status === 'processing') {
      const sk = document.createElement('div');
      sk.className = 'skeleton';
      sk.style.cssText = 'width:100%;height:100%;background:linear-gradient(90deg,var(--surface-2) 25%,var(--border) 50%,var(--surface-2) 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;';
      card.appendChild(sk);
    } else {
      const im = document.createElement('img');
      im.alt = '';
      im.dataset.imgId = img.id;
      im.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url: chrome.runtime.getURL(`preview.html?id=${encodeURIComponent(img.id)}`) });
      });
      card.appendChild(im);
      loadDetailThumb(img, im);
    }
    const del = document.createElement('button');
    del.className = 'm-img-del';
    del.innerHTML = '×';
    del.title = '移除图片';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeDetailImage(img);
    });
    card.appendChild(del);
    els.dImages.appendChild(card);
  }
}

async function loadDetailThumb(imgItem, imgEl) {
  imgEl.addEventListener('error', () => {
    console.warn('[随心记] 管理页图片渲染失败, imgId =', imgItem.id);
    if (imgEl.src !== ERROR_PLACEHOLDER_INLINE) imgEl.src = ERROR_PLACEHOLDER_INLINE;
  });
  try {
    // 优先缩略图；缺失时降级为原图
    let blob = await ImageStore.getThumb(imgItem.id);
    if (!blob) blob = await ImageStore.getImage(imgItem.id);
    if (blob) {
      imgEl.src = editorObjUrl(blob);
    } else {
      imgEl.src = ERROR_PLACEHOLDER_INLINE;
    }
  } catch (e) {
    console.warn('[随心记] 管理页缩略图加载失败:', e);
    imgEl.src = ERROR_PLACEHOLDER_INLINE;
  }
}

async function removeDetailImage(imgItem) {
  try {
    if (imgItem.id) await ImageStore.deleteImage(imgItem.id);
    currentImages = currentImages.filter(i => i !== imgItem);
    revokeEditorUrls();
    renderDetailImages();
    scheduleSave();
    updateStat();
  } catch (err) {
    showToast('删除失败: ' + err.message);
  }
}

// ======== 自动保存 ========
function startAutoSave() {
  stopAutoSave();
  autoSaveInterval = setInterval(() => scheduleSave(), 3000);
}
function stopAutoSave() {
  if (autoSaveInterval) { clearInterval(autoSaveInterval); autoSaveInterval = null; }
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}

function setSaveStatus(kind, text) {
  els.dSaveStatus.className = 'save-status ' + (kind || '');
  els.dSaveStatus.textContent = text;
}

function scheduleSave() {
  setSaveStatus('saving', '保存中…');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => doSave(), 500);
}

async function doSave() {
  try {
    const patch = {
      title: els.dTitle.value.trim(),
      content: els.dContent.value,
      color: currentColor,
      images: currentImages.filter(i => i.status === 'done' && i.id).map(i => ({ id: i.id, w: i.w, h: i.h, size: i.size, type: i.type }))
    };
    if (currentId) {
      const existing = await Storage.getNote(currentId);
      patch.pinned = existing.pinned;
      await Storage.updateNote(currentId, patch);
    } else {
      if (!patch.title && !patch.content && patch.images.length === 0) {
        setSaveStatus('', '已保存'); return;
      }
      const note = await Storage.addNote({
        id: crypto.randomUUID(),
        title: patch.title,
        content: patch.content,
        color: patch.color,
        pinned: false,
        images: patch.images,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      currentId = note.id;
    }
    setSaveStatus('', '已保存');
    renderList();
    // background badge
    try { chrome.runtime.sendMessage({ type: 'popup-opened' }); } catch (e) {}
  } catch (err) {
    console.error(err);
    setSaveStatus('error', '保存失败');
    showToast('保存失败: ' + err.message);
  }
}

// ======== 图片输入 ========
async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  if (currentImages.filter(i => i.status === 'done').length >= ImageUtils.MAX_IMAGES_PER_NOTE) {
    showToast(`每条便签最多 ${ImageUtils.MAX_IMAGES_PER_NOTE} 张图片`);
    return;
  }
  const doneCount = currentImages.filter(i => i.status === 'done').length;
  const slots = ImageUtils.MAX_IMAGES_PER_NOTE - doneCount;
  const accept = files.slice(0, slots);
  setSaveStatus('processing', '图片处理中…');

  for (const file of accept) {
    try {
      const err = ImageUtils.validateFile(file);
      if (err) { showToast(err); continue; }

      const placeholder = { status: 'processing' };
      currentImages.push(placeholder);
      renderDetailImages();

      const processed = await ImageUtils.processImageFile(file);
      const id = crypto.randomUUID();
      await ImageStore.putImage({
        id, blob: processed.blob, thumbBlob: processed.thumbBlob,
        w: processed.w, h: processed.h, size: processed.blob.size, type: processed.blob.type,
        createdAt: Date.now()
      });
      const idx = currentImages.indexOf(placeholder);
      currentImages[idx] = { id, status: 'done', w: processed.w, h: processed.h, size: processed.blob.size, type: processed.blob.type };
      renderDetailImages();
    } catch (err) {
      console.error(err);
      showToast('图片处理失败: ' + err.message);
      currentImages = currentImages.filter(i => i.status !== 'processing');
      renderDetailImages();
    }
  }
  setSaveStatus('', '已保存');
  scheduleSave();
  updateStat();
}

// ======== 导入导出 ========
async function doExport() {
  const wantImages = confirm('是否包含图片？\n\n· 点「确定」：导出完整 JSON（含 base64 图片，文件会很大）\n· 点「取消」：仅导出文字便签');
  try {
    const raw = await Storage.getAllNotesRaw();
    const payload = {
      version: 1,
      exportedAt: Date.now(),
      notes: []
    };

    if (wantImages) {
      const allRecs = await ImageStore.getAllRecords();
      const recMap = new Map();
      for (const r of allRecs) {
        try { recMap.set(r.id, await ImageUtils.blobToDataURL(r.blob)); } catch (e) {}
      }
      for (const note of raw) {
        const n = { ...note, images: (note.images || []).map(img => ({ ...img, dataUrl: recMap.get(img.id) || null })) };
        payload.notes.push(n);
      }
    } else {
      for (const note of raw) {
        const n = { ...note, images: (note.images || []).map(img => ({ id: img.id })) };
        payload.notes.push(n);
      }
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `quick-note-${new Date().toISOString().slice(0,10)}.json`);
    showToast('导出完成');
  } catch (err) {
    showToast('导出失败: ' + err.message);
  }
}

async function doExportTextOnly() {
  try {
    const raw = await Storage.getAllNotesRaw();
    const text = raw.map(n => {
      const t = n.title || '(无标题)';
      const c = n.content || '';
      const time = new Date(n.updatedAt || n.createdAt).toLocaleString();
      return `【${t}】\n${c}\n— ${time}`;
    }).join('\n\n———\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, `quick-note-text-${new Date().toISOString().slice(0,10)}.txt`);
    showToast('文字导出完成');
  } catch (err) {
    showToast('导出失败: ' + err.message);
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
}

async function doImport(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!payload || !Array.isArray(payload.notes)) throw new Error('不是有效的随心记导出文件');

    if (!confirm(`检测到 ${payload.notes.length} 条便签，是否导入？（会覆盖当前所有便签）`)) return;

    // 先清理旧图片
    const oldImgs = await ImageStore.getAllImageIds();
    if (oldImgs.length) await ImageStore.deleteImagesByIds(oldImgs);

    const newNotes = [];
    for (const n of payload.notes) {
      const newNote = {
        id: n.id || crypto.randomUUID(),
        title: n.title || '',
        content: n.content || '',
        color: n.color || 'yellow',
        pinned: !!n.pinned,
        images: [],
        createdAt: n.createdAt || Date.now(),
        updatedAt: n.updatedAt || Date.now()
      };
      for (const img of (n.images || [])) {
        try {
          let id = img.id || crypto.randomUUID();
          if (img.dataUrl) {
            // 重建图片
            const blob = ImageUtils.dataURLToBlob(img.dataUrl);
            // 重新处理一下尺寸，缩略图也一起建
            const file = new File([blob], 'imported', { type: blob.type });
            const processed = await ImageUtils.processImageFile(file);
            await ImageStore.putImage({
              id, blob: processed.blob, thumbBlob: processed.thumbBlob,
              w: processed.w, h: processed.h, size: processed.blob.size, type: processed.blob.type,
              createdAt: Date.now()
            });
            newNote.images.push({ id, w: processed.w, h: processed.h, size: processed.blob.size, type: processed.blob.type });
          } else {
            // 只有 id，图片不在库内；跳过
            console.warn('[随心记] 导入时跳过无 dataUrl 的图片 id:', img.id);
          }
        } catch (err) {
          console.warn('[随心记] 导入图片失败:', err);
        }
      }
      newNotes.push(newNote);
    }

    await Storage.setAllNotes(newNotes);
    currentId = null;
    closeDetail();
    await loadList();
    showToast(`导入成功，共 ${newNotes.length} 条便签`);
  } catch (err) {
    showToast('导入失败: ' + err.message);
  }
}

// ======== 批量删除 ========
async function batchDelete() {
  const ids = Array.from(selectedSet);
  if (!ids.length) return;
  const count = ids.length;
  if (!confirm(`确定删除选中的 ${count} 条便签？（图片也会一起删除）`)) return;
  try {
    const toDelete = await Storage.getAllNotesRaw();
    const delSet = new Set(ids);
    const deletedImgs = [];
    for (const n of toDelete) {
      if (delSet.has(n.id) && n.images) {
        deletedImgs.push(...n.images.map(i => i.id));
      }
    }
    if (deletedImgs.length) await ImageStore.deleteImagesByIds(deletedImgs);
    await Storage.deleteNotes(ids);
    selectedSet.clear();
    currentId = null;
    closeDetail();
    await loadList();
    showToast(`已删除 ${count} 条`);
  } catch (err) {
    showToast('批量删除失败: ' + err.message);
  }
}

// ======== 事件绑定 ========
function bindEvents() {
  els.btnNew.addEventListener('click', () => {
    els.noSelection.hidden = true;
    els.detail.hidden = false;
    openDetail({ id: null, title: '', content: '', color: 'yellow', pinned: false, images: [], createdAt: Date.now(), updatedAt: Date.now() });
  });

  // 搜索
  els.search.addEventListener('input', () => {
    const kw = els.search.value;
    els.btnClearSearch.hidden = !kw;
    loadList(kw);
  });
  els.btnClearSearch.addEventListener('click', () => { els.search.value = ''; els.btnClearSearch.hidden = true; loadList(); });

  // 全选
  els.chkAll.addEventListener('change', () => {
    if (els.chkAll.checked) { notes.forEach(n => selectedSet.add(n.id)); }
    else selectedSet.clear();
    renderList(); updateBatchButtons();
  });

  // 批量删除
  els.btnBatchDel.addEventListener('click', batchDelete);

  // 导出
  els.btnExport.addEventListener('click', doExport);
  els.btnExportText.addEventListener('click', doExportTextOnly);
  els.fileImport.addEventListener('change', () => {
    if (els.fileImport.files && els.fileImport.files[0]) {
      doImport(els.fileImport.files[0]);
      els.fileImport.value = '';
    }
  });

  // 颜色
  els.dColorRow.addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    applyColor(dot.dataset.color);
    scheduleSave();
  });

  // 输入自动保存
  els.dTitle.addEventListener('input', scheduleSave);
  els.dContent.addEventListener('input', scheduleSave);

  // 粘贴（正文 + 标题都捕获）
  els.dContent.addEventListener('paste', (e) => {
    handlePasteInEditor(e);
  });

  // 拖拽
  ['dragenter', 'dragover'].forEach(ev => {
    els.dDropzone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      els.dDropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    els.dDropzone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      if (ev === 'dragleave' && e.target !== els.dDropzone && els.dDropzone.contains(e.relatedTarget)) return;
      els.dDropzone.classList.remove('dragover');
    });
  });
  els.dDropzone.addEventListener('drop', (e) => {
    els.dDropzone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) handleFiles(files);
  });

  // 添加图片按钮
  els.dBtnAdd.addEventListener('click', () => els.dFileInput.click());
  els.dFileInput.addEventListener('change', async () => {
    if (!els.dFileInput.files.length) return;
    await handleFiles(els.dFileInput.files);
    els.dFileInput.value = '';
  });

  // 保存 / 删除
  els.dBtnSave.addEventListener('click', async () => {
    await doSave();
    showToast('已保存');
  });
  els.dBtnDel.addEventListener('click', async () => {
    if (!currentId) { showToast('当前是新建便签，直接关闭即可'); closeDetail(); return; }
    if (!confirm('确定删除这条便签？')) return;
    try {
      const note = await Storage.getNote(currentId);
      if (note && note.images && note.images.length) {
        await ImageStore.deleteImagesByNote(note.images);
      }
      await Storage.deleteNote(currentId);
      currentId = null;
      closeDetail();
      await loadList();
      showToast('已删除');
    } catch (err) {
      showToast('删除失败: ' + err.message);
    }
  });

  // Esc
  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape' && !els.detail.hidden) closeDetail();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      if (!els.detail.hidden) { e.preventDefault(); await doSave(); showToast('已保存'); }
    }
  });

  window.addEventListener('unload', () => {
    stopAutoSave();
    revokeAllUrls();
  });
}

async function handlePasteInEditor(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const fileItems = [];
  const html = e.clipboardData.getData('text/html');
  let hasHTMLImg = false;
  if (html && html.includes('<img')) hasHTMLImg = true;

  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) fileItems.push(f);
    }
  }

  if (fileItems.length) {
    e.preventDefault();
    await handleFiles(fileItems);
    return;
  }
  if (hasHTMLImg) {
    e.preventDefault();
    try {
      const files = await ImageUtils.extractImagesFromHTML(html);
      if (files.length) await handleFiles(files);
    } catch (err) {
      showToast('粘贴处理失败: ' + err.message);
    }
  }
}

// ======== 启动 ========
async function init() {
  bindEvents();
  await loadList();
}

init().catch(err => {
  console.error('[随心记] 管理页初始化失败:', err);
  showToast('初始化失败: ' + err.message);
});
