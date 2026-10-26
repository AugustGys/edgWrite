// popup.js - 便签主交互
// 职责：渲染列表、新建/编辑/删除便签、图片三通道输入、lightbox、自动保存

'use strict';

// ======== DOM ========
const $ = (id) => document.getElementById(id);
const els = {
  list: $('notes-list'),
  empty: $('empty-state'),
  search: $('search-input'),
  clearSearch: $('btn-clear-search'),
  btnManager: $('btn-manager'),
  btnNewEmpty: $('btn-new-empty'),

  editor: $('editor'),
  title: $('note-title'),
  content: $('note-content'),
  colorRow: $('color-row'),
  imgRow: $('image-preview-row'),
  dropOverlay: $('drop-overlay'),
  saveStatus: $('save-status'),
  btnAddImg: $('btn-add-image'),
  fileInput: $('file-input'),
  btnCancel: $('btn-cancel'),
  btnSave: $('btn-save'),

  lightbox: $('lightbox'),
  lbImg: $('lb-img'),
  lbClose: $('lb-close'),
  lbPrev: $('lb-prev'),
  lbNext: $('lb-next'),

  toast: $('toast')
};

// ======== 状态 ========
let notes = [];
let currentEdit = null;           // 编辑中的便签 id（null = 新建）
let currentColor = 'yellow';
let currentImages = [];           // [{id, thumbUrl, w, h, size, type, status}]
let currentImageIdSet = new Set();
let lbImages = [];                // lightbox 图片 id 数组
let lbIndex = 0;
let allUrls = new Set();          // 所有 createObjectURL 产生的 URL，统一 revoke
let saveDebounceTimer = null;
let autoSaveTimer = null;
let isDragging = false;           // 当前是否在拖拽中（全局标记）

// ======== Toast ========
function showToast(msg, duration = 1800) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(els.toast._t);
  els.toast._t = setTimeout(() => { els.toast.hidden = true; }, duration);
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

// ======== 保存状态提示 ========
function setSaveStatus(kind, text) {
  els.saveStatus.className = 'save-status ' + (kind || '');
  els.saveStatus.textContent = text;
}

// ======== 清理拖拽态（关键：多处调用防止卡死） ========
function clearDragState() {
  isDragging = false;
  els.editor.classList.remove('dragover');
  els.dropOverlay.hidden = true;
}

// ======== 加载列表 ========
async function loadList(keyword = '') {
  try {
    notes = keyword
      ? await Storage.searchNotes(keyword)
      : await Storage.getAllNotes();
  } catch (err) {
    console.error('[随心记] 加载失败:', err);
    notes = [];
    showToast('加载失败: ' + err.message);
  }
  renderList();
}

// ======== 渲染列表 ========
function renderList() {
  const oldUrls = new Set(allUrls);
  els.list.innerHTML = '';

  if (notes.length === 0) {
    els.empty.hidden = false;
    els.list.hidden = true;
    return;
  }
  els.empty.hidden = true;
  els.list.hidden = false;

  const frag = document.createDocumentFragment();
  for (const note of notes) {
    frag.appendChild(buildCard(note));
  }
  els.list.appendChild(frag);

  // 释放旧 URL（新加载的会重新 add 到 allUrls）
  oldUrls.forEach(u => {
    if (!allUrls.has(u)) { try { URL.revokeObjectURL(u); } catch (e) {} }
  });
}

function buildCard(note) {
  const card = document.createElement('article');
  card.className = 'note-card';
  card.dataset.color = note.color || 'yellow';
  card.dataset.id = note.id;
  card.tabIndex = 0;

  const header = document.createElement('div');
  header.className = 'card-header';

  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = note.title || '';

  const pin = document.createElement('span');
  pin.className = 'card-pin' + (note.pinned ? ' active' : '');
  pin.title = note.pinned ? '取消置顶' : '置顶';
  pin.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M14 4v5h5v2h-5v7l-2-2-2 2v-7H5V9h5V4h4z"/></svg>`;
  pin.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePin(note);
  });

  header.appendChild(title);
  header.appendChild(pin);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.textContent = note.content || '';

  const lineCount = (note.content || '').split('\n').length;
  const needCollapse = (note.content || '').length > 140 || lineCount > 6;
  if (needCollapse) body.classList.add('collapsed');

  const bodyWrap = document.createElement('div');
  bodyWrap.appendChild(body);
  if (needCollapse) {
    const expand = document.createElement('button');
    expand.className = 'card-expand';
    expand.textContent = '展开全文';
    expand.addEventListener('click', (e) => {
      e.stopPropagation();
      body.classList.toggle('collapsed');
      expand.textContent = body.classList.contains('collapsed') ? '展开全文' : '收起';
    });
    bodyWrap.appendChild(expand);
  }

  card.appendChild(header);
  card.appendChild(bodyWrap);

  if (note.images && note.images.length) {
    const thumbRow = document.createElement('div');
    thumbRow.className = 'thumb-row';
    const showCount = Math.min(3, note.images.length);
    for (let i = 0; i < showCount; i++) {
      const img = note.images[i];
      const wrap = document.createElement('div');
      wrap.className = 'thumb-wrap';
      const imgEl = document.createElement('img');
      imgEl.className = 'thumb';
      imgEl.alt = '';
      imgEl.dataset.imgId = img.id;
      imgEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(note, img.id);
      });
      wrap.appendChild(imgEl);
      thumbRow.appendChild(wrap);
      loadThumbIntoImg(imgEl, img.id);
    }
    if (note.images.length > 3) {
      const more = document.createElement('div');
      more.className = 'thumb-more';
      more.textContent = `+${note.images.length - 3}`;
      more.title = `共 ${note.images.length} 张图片`;
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(note, note.images[0].id);
      });
      thumbRow.appendChild(more);
    }
    card.appendChild(thumbRow);
  }

  const footer = document.createElement('div');
  footer.className = 'card-footer';
  const timeStr = formatTime(note.updatedAt || note.createdAt);
  const timeEl = document.createElement('span');
  timeEl.textContent = timeStr;
  const delBtn = document.createElement('button');
  delBtn.className = 'card-del';
  delBtn.textContent = '删除';
  delBtn.title = '删除便签';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmDelete(note);
  });
  footer.appendChild(timeEl);
  footer.appendChild(delBtn);
  card.appendChild(footer);

  card.addEventListener('click', () => openEditor(note));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(note); }
  });

  return card;
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

async function loadThumbIntoImg(imgEl, imgId) {
  try {
    const thumbBlob = await ImageStore.getThumb(imgId);
    if (!thumbBlob) return;
    imgEl.src = objUrl(thumbBlob);
  } catch (err) {
    console.warn('[随心记] 缩略图加载失败:', err);
  }
}

// ======== 置顶 ========
async function togglePin(note) {
  try {
    const updated = await Storage.updateNote(note.id, { pinned: !note.pinned });
    note.pinned = updated.pinned;
    await loadList(els.search.value);
    showToast(note.pinned ? '已置顶' : '已取消置顶');
  } catch (err) {
    showToast('操作失败: ' + err.message);
  }
}

// ======== 删除 ========
async function confirmDelete(note) {
  const imgCount = (note.images && note.images.length) ? note.images.length : 0;
  if (!confirm(`确定删除这条便签${imgCount ? `（含 ${imgCount} 张图片）` : ''}？`)) return;
  try {
    if (note.images && note.images.length) {
      await ImageStore.deleteImagesByNote(note.images);
    }
    await Storage.deleteNote(note.id);
    await loadList(els.search.value);
    try { chrome.runtime.sendMessage({ type: 'popup-opened' }); } catch (e) {}
    showToast('已删除');
  } catch (err) {
    showToast('删除失败: ' + err.message);
  }
}

// ======== 打开编辑器 ========
function openEditor(note) {
  clearDragState();

  els.editor.hidden = false;
  els.list.hidden = true;
  els.empty.hidden = true;
  els.search.value = '';

  if (note) {
    currentEdit = note.id;
    els.title.value = note.title || '';
    els.content.value = note.content || '';
    currentColor = note.color || 'yellow';
    applyColor(currentColor);
    currentImages = [];
    currentImageIdSet.clear();
    if (note.images && note.images.length) {
      for (const img of note.images) {
        currentImageIdSet.add(img.id);
        currentImages.push({ id: img.id, status: 'done', w: img.w, h: img.h, size: img.size, type: img.type });
      }
    }
  } else {
    currentEdit = null;
    els.title.value = '';
    els.content.value = '';
    currentColor = 'yellow';
    applyColor('yellow');
    currentImages = [];
    currentImageIdSet.clear();
  }
  renderImagePreview();
  autoResize();
  els.content.focus();
  setSaveStatus('', '已保存');
  startAutoSave();
}

function closeEditor() {
  clearDragState();
  stopAutoSave();
  els.editor.hidden = true;
  els.list.hidden = false;
  revokeEditorUrls();
  currentEdit = null;
  currentImages = [];
  currentImageIdSet.clear();
  loadList(els.search.value);
}

// ======== 颜色 ========
function applyColor(c) {
  currentColor = c;
  els.colorRow.querySelectorAll('.color-dot').forEach(d => {
    d.classList.toggle('active', d.dataset.color === c);
  });
}

// ======== 图片预览区 ========
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

async function renderImagePreview() {
  els.imgRow.innerHTML = '';
  if (!currentImages.length) { els.imgRow.hidden = true; return; }
  els.imgRow.hidden = false;
  for (const img of currentImages) {
    const wrap = document.createElement('div');
    wrap.className = 'editor-thumb-wrap';
    if (img.status === 'processing') {
      const sk = document.createElement('div');
      sk.className = 'skeleton';
      wrap.appendChild(sk);
    } else if (img.thumbUrl) {
      const im = document.createElement('img');
      im.className = 'thumb';
      im.src = img.thumbUrl;
      im.alt = '';
      wrap.appendChild(im);
    } else if (img.id) {
      const im = document.createElement('img');
      im.className = 'thumb';
      im.alt = '';
      wrap.appendChild(im);
      loadEditorThumb(img, im);
    }
    const del = document.createElement('button');
    del.className = 'thumb-del';
    del.innerHTML = '×';
    del.title = '移除图片';
    del.addEventListener('click', async () => {
      await removeCurrentImage(img);
    });
    wrap.appendChild(del);
    els.imgRow.appendChild(wrap);
  }
}

async function loadEditorThumb(imgItem, imgEl) {
  try {
    const thumbBlob = await ImageStore.getThumb(imgItem.id);
    if (thumbBlob) {
      imgItem.thumbUrl = editorObjUrl(thumbBlob);
      imgEl.src = imgItem.thumbUrl;
    }
  } catch (err) {
    console.warn(err);
  }
}

async function removeCurrentImage(imgItem) {
  try {
    if (imgItem.id) {
      await ImageStore.deleteImage(imgItem.id);
      currentImageIdSet.delete(imgItem.id);
    }
    currentImages = currentImages.filter(i => i !== imgItem);
    revokeEditorUrls();
    renderImagePreview();
    scheduleSave();
  } catch (err) {
    showToast('删除图片失败: ' + err.message);
  }
}

// ======== 自动保存 ========
function startAutoSave() {
  stopAutoSave();
  autoSaveTimer = setInterval(() => scheduleSave(), 3000);
}
function stopAutoSave() {
  if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; }
  if (saveDebounceTimer) { clearTimeout(saveDebounceTimer); saveDebounceTimer = null; }
}

function scheduleSave() {
  setSaveStatus('saving', '保存中…');
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => doSave(), 500);
}

async function doSave() {
  try {
    const patch = {
      title: els.title.value.trim(),
      content: els.content.value,
      color: currentColor,
      pinned: currentEdit ? (await Storage.getNote(currentEdit)).pinned : false,
      images: currentImages
        .filter(i => i.status === 'done' && i.id)
        .map(i => ({ id: i.id, w: i.w, h: i.h, size: i.size, type: i.type }))
    };
    if (currentEdit) {
      await Storage.updateNote(currentEdit, patch);
    } else {
      if (!patch.title && !patch.content && patch.images.length === 0) {
        setSaveStatus('', '已保存');
        return;
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
      currentEdit = note.id;
    }
    setSaveStatus('', '已保存');
  } catch (err) {
    console.error('[随心记] 保存失败:', err);
    setSaveStatus('error', '保存失败');
  }
}

// ======== 图片处理 ========
async function handleImageFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const doneCount = currentImages.filter(i => i.status === 'done').length;
  if (doneCount >= ImageUtils.MAX_IMAGES_PER_NOTE) {
    showToast(`每条便签最多 ${ImageUtils.MAX_IMAGES_PER_NOTE} 张图片`);
    return;
  }
  const slots = ImageUtils.MAX_IMAGES_PER_NOTE - doneCount;
  const accept = files.slice(0, slots);

  setSaveStatus('processing', '图片处理中…');

  for (const file of accept) {
    try {
      const err = ImageUtils.validateFile(file);
      if (err) { showToast(err); continue; }

      const placeholder = { status: 'processing', _placeholder: true };
      currentImages.push(placeholder);
      renderImagePreview();

      const processed = await ImageUtils.processImageFile(file);
      const id = crypto.randomUUID();
      await ImageStore.putImage({
        id,
        blob: processed.blob,
        thumbBlob: processed.thumbBlob,
        w: processed.w, h: processed.h, size: processed.blob.size, type: processed.blob.type,
        createdAt: Date.now()
      });

      const idx = currentImages.indexOf(placeholder);
      const thumbUrl = editorObjUrl(processed.thumbBlob);
      currentImages[idx] = {
        id,
        status: 'done',
        thumbUrl,
        w: processed.w, h: processed.h, size: processed.blob.size, type: processed.blob.type
      };
      currentImageIdSet.add(id);
      renderImagePreview();
    } catch (err) {
      console.error('[随心记] 图片处理失败:', err);
      showToast('图片处理失败: ' + err.message);
      currentImages = currentImages.filter(i => i !== placeholder);
      renderImagePreview();
    }
  }
  setSaveStatus('', '已保存');
  scheduleSave();
}

// ======== 粘贴 ========
function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const fileItems = [];
  const html = e.clipboardData.getData('text/html');
  const hasHTMLImg = html && html.includes('<img');

  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) fileItems.push(f);
    }
  }

  if (fileItems.length) {
    e.preventDefault();
    handleImageFiles(fileItems);
    return;
  }

  if (hasHTMLImg) {
    e.preventDefault();
    handlePastedHTML(html);
  }
}

async function handlePastedHTML(html) {
  setSaveStatus('processing', '图片处理中…');
  try {
    const files = await ImageUtils.extractImagesFromHTML(html);
    if (files.length) {
      await handleImageFiles(files);
    } else {
      setSaveStatus('', '已保存');
    }
  } catch (err) {
    showToast('粘贴处理失败: ' + err.message);
    setSaveStatus('error', '处理失败');
  }
}

// ======== 拖拽（挂在 .editor 整体上，避免子元素间事件丢失） ========
function setupDragDrop() {
  const editor = els.editor;

  ['dragenter', 'dragover'].forEach(ev => {
    editor.addEventListener(ev, (e) => {
      // 只处理带文件的拖拽（避免把普通文本拖进 editor 也触发遮罩）
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      if (!isDragging) {
        isDragging = true;
        editor.classList.add('dragover');
        els.dropOverlay.hidden = false;
      }
    });
  });

  ['dragleave', 'drop', 'dragend'].forEach(ev => {
    editor.addEventListener(ev, (e) => {
      if (ev === 'dragleave') {
        // relatedTarget 仍在 editor 内部时不清理（避免子元素间穿越频繁闪烁）
        if (e.relatedTarget && editor.contains(e.relatedTarget)) return;
      }
      if (ev === 'drop') {
        e.preventDefault();
        e.stopPropagation();
      }
      clearDragState();
    });
  });

  // 全局 drop 兜底：drop 在非 editor 区域 → 清理
  document.addEventListener('drop', (e) => {
    if (!editor.contains(e.target)) clearDragState();
  });

  // popup 失焦时强制清理（拖出窗口时 dragleave 可能不触发）
  window.addEventListener('blur', () => clearDragState());
}

// ======== 自动高度 ========
function autoResize() {
  const ta = els.content;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
}

// ======== Lightbox ========
function openLightbox(note, startImgId) {
  lbImages = (note.images || []).map(i => i.id);
  lbIndex = Math.max(0, lbImages.indexOf(startImgId));
  renderLightbox();
  els.lightbox.hidden = false;
}
async function renderLightbox() {
  try {
    const id = lbImages[lbIndex];
    const blob = await ImageStore.getImage(id);
    if (!blob) { showToast('图片加载失败'); closeLightbox(); return; }
    const url = objUrl(blob);
    els.lbImg.src = url;
  } catch (err) {
    console.error(err);
    showToast('加载失败');
  }
}
function closeLightbox() { els.lightbox.hidden = true; els.lbImg.src = ''; }

// ======== 事件绑定 ========
function bindEvents() {
  els.btnNewEmpty.addEventListener('click', () => openEditor(null));
  els.btnManager.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
  });

  els.search.addEventListener('input', () => {
    const kw = els.search.value;
    els.clearSearch.hidden = !kw;
    loadList(kw);
  });
  els.clearSearch.addEventListener('click', () => { els.search.value = ''; els.clearSearch.hidden = true; loadList(''); });

  els.colorRow.addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    applyColor(dot.dataset.color);
    scheduleSave();
  });

  els.title.addEventListener('input', scheduleSave);
  els.content.addEventListener('input', () => { autoResize(); scheduleSave(); });

  els.content.addEventListener('paste', handlePaste);
  els.title.addEventListener('paste', handlePaste);

  setupDragDrop();

  els.btnAddImg.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', async () => {
    if (!els.fileInput.files.length) return;
    await handleImageFiles(els.fileInput.files);
    els.fileInput.value = '';
  });

  els.btnCancel.addEventListener('click', closeEditor);
  els.btnSave.addEventListener('click', async () => {
    await doSave();
    showToast('已保存');
    closeEditor();
  });

  els.lbClose.addEventListener('click', closeLightbox);
  els.lightbox.addEventListener('click', (e) => { if (e.target === els.lightbox) closeLightbox(); });
  els.lbPrev.addEventListener('click', () => { if (lbIndex > 0) { lbIndex--; renderLightbox(); } });
  els.lbNext.addEventListener('click', () => { if (lbIndex < lbImages.length - 1) { lbIndex++; renderLightbox(); } });
  document.addEventListener('keydown', (e) => {
    if (!els.lightbox.hidden) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft' && lbIndex > 0) { lbIndex--; renderLightbox(); }
      else if (e.key === 'ArrowRight' && lbIndex < lbImages.length - 1) { lbIndex++; renderLightbox(); }
    }
  });

  document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      if (!els.editor.hidden) {
        e.preventDefault();
        await doSave();
        showToast('已保存');
        closeEditor();
      }
    }
    if (e.key === 'Escape' && !els.editor.hidden && els.lightbox.hidden) {
      closeEditor();
    }
  });

  try { chrome.runtime.sendMessage({ type: 'popup-opened' }); } catch (e) {}

  window.addEventListener('unload', () => {
    stopAutoSave();
    clearDragState();
    try { closeEditorSilent(); } catch(e) {}
    revokeAllUrls();
  });
}

function closeEditorSilent() {
  if (currentEdit !== null || els.title.value || els.content.value || currentImages.length) {
    try { stopAutoSave(); } catch(e) {}
  }
}

// ======== 启动 ========
async function init() {
  bindEvents();
  await loadList();
  if (notes.length === 0) {
    openEditor(null);
  }
}

init().catch(err => {
  console.error('[随心记] 初始化失败:', err);
  showToast('初始化失败: ' + err.message);
});
