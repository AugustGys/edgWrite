// background.js - Service Worker
// 职责：右键菜单、快捷键、badge 更新、跨页面消息中转

importScripts('imageUtils.js', 'imageStore.js', 'storage.js');

// ====== 初始化右键菜单 ======
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-selection',
    title: '保存选中文字到随心记',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'save-image',
    title: '保存图片到随心记',
    contexts: ['image']
  });
});

// ====== 右键菜单点击处理 ======
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'save-selection' && info.selectionText) {
      await saveNoteFromSelection(info.selectionText);
      updateBadge();
    } else if (info.menuItemId === 'save-image' && info.srcUrl) {
      await saveNoteFromImage(info.srcUrl);
      updateBadge();
    }
  } catch (err) {
    console.error('[随心记] 右键菜单处理失败:', err);
  }
});

// ====== 快捷键打开 popup ======
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-quick-note') {
    try {
      await chrome.action.openPopup();
      updateBadge();
    } catch (err) {
      // 兜底：openPopup 仅支持 MV3 + 用户手势；若不支持则忽略
      console.warn('[随心记] openPopup 失败:', err);
    }
  }
});

// ====== 保存选中文字 ======
async function saveNoteFromSelection(text) {
  const now = Date.now();
  const note = {
    id: crypto.randomUUID(),
    title: '',
    content: String(text || '').trim(),
    color: 'yellow',
    pinned: false,
    images: [],
    createdAt: now,
    updatedAt: now
  };
  await Storage.addNote(note);
  return note;
}

// ====== 保存图片（右键图片） ======
async function saveNoteFromImage(srcUrl) {
  try {
    let blob;
    // data: URL 直接解码
    if (srcUrl.startsWith('data:')) {
      blob = ImageUtils.dataURLToBlob(srcUrl);
    } else if (srcUrl.startsWith('blob:')) {
      // blob: URL 在 SW 里无法 fetch，跳过
      throw new Error('blob: URL 无法在 Service Worker 中获取');
    } else {
      // 网络图片
      const resp = await fetch(srcUrl, { credentials: 'omit' });
      if (!resp.ok) throw new Error('下载图片失败: ' + resp.status);
      blob = await resp.blob();
    }

    // 校验类型
    if (!ImageUtils.isAllowedImageType(blob.type)) {
      throw new Error('不支持的图片类型: ' + blob.type);
    }

    // 压缩
    const file = new File([blob], 'context-image', { type: blob.type });
    const processed = await ImageUtils.processImageFile(file);
    if (!processed) throw new Error('图片处理失败');

    // 存入 IndexedDB（SW 中需通过 indexedDB.open 打开扩展存储）
    const imageId = crypto.randomUUID();
    await ImageStore.putImage({
      id: imageId,
      blob: processed.blob,
      thumbBlob: processed.thumbBlob,
      w: processed.w,
      h: processed.h,
      size: processed.blob.size,
      type: processed.blob.type,
      createdAt: Date.now()
    });

    // 保存便签
    const now = Date.now();
    const note = {
      id: crypto.randomUUID(),
      title: '',
      content: '',
      color: 'yellow',
      pinned: false,
      images: [
        {
          id: imageId,
          w: processed.w,
          h: processed.h,
          size: processed.blob.size,
          type: processed.blob.type
        }
      ],
      createdAt: now,
      updatedAt: now
    };
    await Storage.addNote(note);
    return note;
  } catch (err) {
    console.error('[随心记] 保存图片失败:', err);
    // 尝试只保存文字
    return saveNoteFromSelection('[图片保存失败] ' + (err.message || srcUrl));
  }
}

// ====== Badge 更新 ======
async function updateBadge() {
  try {
    const notes = await Storage.getAllNotes();
    const unpinned = notes.filter(n => !n.pinned);
    if (unpinned.length === 0) {
      await chrome.action.setBadgeText({ text: '' });
    } else {
      await chrome.action.setBadgeText({ text: String(Math.min(unpinned.length, 99)) });
      await chrome.action.setBadgeBackgroundColor({ color: '#4F7CFF' });
    }
  } catch (err) {
    console.error('[随心记] badge 更新失败:', err);
  }
}

// 监听 popup 打开后请求清零 badge
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'popup-opened') {
    updateBadge();
    sendResponse({ ok: true });
  }
  return false;
});

// 安装时初始化 badge
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

// startup 也更新一次
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});
