// imageUtils.js - 图片处理工具
// 职责：校验、压缩、缩略图生成、格式互转
// 关键 API：createImageBitmap + OffscreenCanvas（不可用时降级 DOM canvas）

const ImageUtils = (() => {
  const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
  const MAX_ORIGINAL_EDGE = 1280;          // 长边最大
  const MAX_THUMB_EDGE = 240;              // 缩略图长边
  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const MAX_IMAGES_PER_NOTE = 6;

  function isAllowedImageType(type) {
    return ALLOWED_TYPES.includes(type);
  }

  /** 单文件校验：返回 null 表示通过，否则错误消息 */
  function validateFile(file) {
    if (!file) return '文件为空';
    if (!isAllowedImageType(file.type)) {
      return `不支持的图片类型：${file.type || '未知'}。允许：PNG / JPEG / WEBP / GIF`;
    }
    if (file.size > MAX_SIZE_BYTES) {
      return `图片太大（${(file.size / 1024 / 1024).toFixed(1)}MB），请控制在 10MB 以内`;
    }
    return null;
  }

  /** 长边等比缩放 */
  function fitEdge(w, h, maxEdge) {
    if (w <= maxEdge && h <= maxEdge) return { w, h };
    const ratio = Math.min(maxEdge / w, maxEdge / h);
    return { w: Math.round(w * ratio), h: Math.round(h * ratio) };
  }

  /** dataURL → Blob */
  function dataURLToBlob(dataURL) {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }

  /** Blob → dataURL */
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  /** ImageBitmap → Blob（OffscreenCanvas 优先，降级 DOM canvas） */
  async function bitmapToBlob(bitmap, { width, height, type, quality }) {
    // 带透明的 PNG 保持 PNG
    const targetType = type === 'image/png' || type === 'image/webp'
      ? type
      : 'image/jpeg';
    const targetQuality = targetType === 'image/png' ? undefined : quality;

    if (typeof OffscreenCanvas !== 'undefined') {
      const off = new OffscreenCanvas(width, height);
      const ctx = off.getContext('2d');
      // JPEG 必须填充白底，否则透明区变黑
      if (targetType === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      return await off.convertToBlob({ type: targetType, quality: targetQuality });
    }

    // 降级：DOM canvas
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (targetType === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise((resolve, reject) => {
      c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob 失败')), targetType, targetQuality);
    });
  }

  /** 主处理管线：File → { blob, thumbBlob, w, h, size, type } */
  async function processImageFile(file) {
    const err = validateFile(file);
    if (err) throw new Error(err);

    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (e) {
      throw new Error('图片解析失败：' + (e.message || e));
    }

    const { width: origW, height: origH } = bitmap;

    // 压缩原图
    const fitted = fitEdge(origW, origH, MAX_ORIGINAL_EDGE);
    const outType = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg';
    let blob = await bitmapToBlob(bitmap, {
      width: fitted.w,
      height: fitted.h,
      type: outType,
      quality: 0.85
    });

    // 缩略图
    const th = fitEdge(origW, origH, MAX_THUMB_EDGE);
    const thumbBlob = await bitmapToBlob(bitmap, {
      width: th.w,
      height: th.h,
      type: 'image/jpeg',
      quality: 0.8
    });

    bitmap.close?.();

    return {
      blob,
      thumbBlob,
      w: fitted.w,
      h: fitted.h,
      size: blob.size,
      type: blob.type
    };
  }

  /** 从 clipboard HTML 提取 <img> 的 data: / blob: src 并转 File */
  async function extractImagesFromHTML(html) {
    if (!html) return [];
    const list = [];
    // 用 DOMParser 在隔离上下文解析
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const imgs = doc.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (!src) continue;
      try {
        if (src.startsWith('data:')) {
          const blob = dataURLToBlob(src);
          const file = new File([blob], `paste-${Date.now()}.${blob.type.split('/')[1] || 'bin'}`, { type: blob.type });
          list.push(file);
        } else if (src.startsWith('blob:')) {
          // 在 popup / manager 页上下文中可以 fetch blob:
          const resp = await fetch(src);
          const blob = await resp.blob();
          list.push(new File([blob], `paste-${Date.now()}`, { type: blob.type }));
        }
      } catch (e) {
        console.warn('[随心记] 提取 img 失败:', src, e);
      }
    }
    return list;
  }

  /** 格式化字节为易读字符串 */
  function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v < 10 && i > 0 ? 2 : 1) + ' ' + units[i];
  }

  return {
    isAllowedImageType,
    validateFile,
    processImageFile,
    dataURLToBlob,
    blobToDataURL,
    extractImagesFromHTML,
    formatSize,
    MAX_IMAGES_PER_NOTE,
    MAX_ORIGINAL_EDGE,
    MAX_THUMB_EDGE
  };
})();

if (typeof globalThis !== 'undefined') globalThis.ImageUtils = ImageUtils;
