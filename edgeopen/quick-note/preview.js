// preview.js - 图片全屏预览页
// 支持缩放、平移、下载
'use strict';

const imgEl = document.getElementById('img');
const viewer = document.getElementById('viewer');
const loading = document.getElementById('loading');
const errorEl = document.getElementById('error');
const zoomLabel = document.getElementById('zoom-label');

let blob = null;
let url = null;
let scale = 1;
let panX = 0, panY = 0;
let isDragging = false, dragStart = { x: 0, y: 0, px: 0, py: 0 };

function applyTransform() {
  imgEl.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  zoomLabel.textContent = Math.round(scale * 100) + '%';
}

function setScale(s) {
  scale = Math.max(0.1, Math.min(10, s));
  applyTransform();
}

function resetView() {
  scale = 1; panX = 0; panY = 0;
  applyTransform();
}

function zoomAtCenter(delta) {
  // 缩放中心为视图中心
  const factor = delta > 0 ? 1.15 : 1 / 1.15;
  setScale(scale * factor);
}

async function load() {
  try {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) throw new Error('缺少图片 id');

    loading.hidden = false;
    errorEl.hidden = true;

    blob = await ImageStore.getImage(id);
    if (!blob) throw new Error('图片不存在');

    url = URL.createObjectURL(blob);
    imgEl.src = url;
    imgEl.addEventListener('load', () => {
      loading.hidden = true;
      resetView();
    }, { once: true });
  } catch (err) {
    console.error(err);
    loading.hidden = true;
    errorEl.hidden = false;
  }
}

// ===== 按钮 =====
document.getElementById('btn-zoom-in').addEventListener('click', () => setScale(scale * 1.2));
document.getElementById('btn-zoom-out').addEventListener('click', () => setScale(scale / 1.2));
document.getElementById('btn-reset').addEventListener('click', resetView);
document.getElementById('btn-close').addEventListener('click', () => window.close());
document.getElementById('btn-download').addEventListener('click', () => {
  if (!blob) return;
  const a = document.createElement('a');
  const u = URL.createObjectURL(blob);
  a.href = u;
  const ext = (blob.type || 'image/png').split('/')[1];
  a.download = `quick-note-${Date.now()}.${ext}`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(u); }, 500);
});

// ===== 滚轮缩放 =====
viewer.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAtCenter(e.deltaY > 0 ? -1 : 1);
}, { passive: false });

// ===== 拖拽平移 =====
viewer.addEventListener('mousedown', (e) => {
  isDragging = true;
  viewer.classList.add('panning');
  dragStart = { x: e.clientX, y: e.clientY, px: panX, py: panY };
});
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  panX = dragStart.px + (e.clientX - dragStart.x);
  panY = dragStart.py + (e.clientY - dragStart.y);
  applyTransform();
});
window.addEventListener('mouseup', () => {
  isDragging = false;
  viewer.classList.remove('panning');
});

// ===== 双击切换 1x / fit =====
let lastClick = 0;
viewer.addEventListener('click', (e) => {
  const now = Date.now();
  if (now - lastClick < 350) {
    // 双击 → 交替 1x 和适应
    if (Math.abs(scale - 1) < 0.01) {
      // 适应视图
      const iw = imgEl.naturalWidth || 1;
      const ih = imgEl.naturalHeight || 1;
      const vw = viewer.clientWidth;
      const vh = viewer.clientHeight;
      const fitScale = Math.min(vw / iw, vh / ih);
      scale = Math.min(1, fitScale);
      panX = 0; panY = 0;
      applyTransform();
    } else {
      resetView();
    }
  }
  lastClick = now;
});

// ===== 键盘 =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
  else if (e.key === '+' || e.key === '=') setScale(scale * 1.15);
  else if (e.key === '-') setScale(scale / 1.15);
  else if (e.key === '0') resetView();
  else if (e.key === 'ArrowUp') panY -= 40;
  else if (e.key === 'ArrowDown') panY += 40;
  else if (e.key === 'ArrowLeft') panX -= 40;
  else if (e.key === 'ArrowRight') panX += 40;
  applyTransform();
});

// 窗口大小变化时重算
window.addEventListener('resize', applyTransform);

load();
