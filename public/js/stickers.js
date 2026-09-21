// stickers.js - sticker packs, create (image crop / video 15s trim), send, save from chat
import { api, ApiError , mediaSrc} from './api.js';
import { state, emit } from './state.js';
import {
  $, icon, escapeHtml, toast, openSheet, closeSheet, setBusy, fileToDataUrl, promptSheet
} from './ui.js';

const STICKER_SIZE = 512;
const MAX_VIDEO_SEC = 15;

let packsCache = null;

export async function loadStickerPacks(force = false) {
  if (packsCache && !force) return packsCache;
  try {
    const res = await api.stickerPacks();
    packsCache = res.packs || [{ id: 'default', name: 'My stickers', stickers: [] }];
  } catch {
    packsCache = [{ id: 'default', name: 'My stickers', stickers: [] }];
  }
  return packsCache;
}

export function openStickerPicker({ onPick }) {
  openSheet({
    title: 'Stickers',
    body: `<div class="sheet-pad">
      <div class="row" style="gap:8px;margin-bottom:12px">
        <button class="btn btn-primary btn-sm" id="sticker-create">${icon('plus')} Create</button>
        <button class="btn btn-ghost btn-sm" id="sticker-refresh">Refresh</button>
      </div>
      <div id="sticker-packs-host">${skeletonPacks()}</div>
    </div>`,
    onMount(sheet) {
      const host = sheet.querySelector('#sticker-packs-host');
      const render = async (force = false) => {
        host.innerHTML = skeletonPacks();
        const packs = await loadStickerPacks(force);
        if (!packs.length) {
          host.innerHTML = `<div class="empty"><div class="title">No stickers yet</div><div class="subtitle">Create one from a photo or short video.</div></div>`;
          return;
        }
        host.innerHTML = packs.map((pack) => `
          <div class="sticker-pack">
            <div class="sticker-pack-title">${escapeHtml(pack.name || 'Pack')}</div>
            <div class="sticker-grid">
              ${(pack.stickers || []).map((s) => `
                <button type="button" class="sticker-cell" data-sticker-url="${escapeHtml(s.url)}" data-sticker-mime="${escapeHtml(s.mime || '')}" data-sticker-type="${escapeHtml(s.type || 'image')}" title="Send sticker">
                  ${s.type === 'video'
                    ? `<video src="${escapeHtml(mediaSrc(s.url))}" muted loop playsinline autoplay></video>`
                    : `<img src="${escapeHtml(mediaSrc(s.url))}" alt="">`}
                </button>`).join('') || '<div class="muted" style="padding:8px">Empty pack — create a sticker</div>'}
            </div>
          </div>`).join('');
        host.querySelectorAll('[data-sticker-url]').forEach((btn) => {
          btn.addEventListener('click', () => {
            closeSheet();
            onPick?.({
              url: btn.dataset.stickerUrl,
              mime: btn.dataset.stickerMime,
              type: btn.dataset.stickerType || 'image'
            });
          });
        });
      };
      sheet.querySelector('#sticker-create').addEventListener('click', () => {
        closeSheet();
        openCreateStickerSheet({ onCreated: () => openStickerPicker({ onPick }) });
      });
      sheet.querySelector('#sticker-refresh').addEventListener('click', () => render(true));
      render();
    }
  });
}

function skeletonPacks() {
  return '<div class="muted" style="padding:12px">Loading packs…</div>';
}

export function openCreateStickerSheet({ onCreated } = {}) {
  openSheet({
    title: 'Create sticker',
    body: `<div class="sheet-pad">
      <div id="sticker-create-error" class="alert alert-error hidden"></div>
      <label class="field"><span class="field-label">Pack name</span>
        <input class="input" id="sticker-pack-name" value="My stickers" maxlength="40"></label>
      <label class="field"><span class="field-label">Photo or video (max 15s)</span>
        <input class="input" type="file" id="sticker-file" accept="image/*,video/*"></label>
      <div id="sticker-preview" class="sticker-preview"></div>
      <p class="muted" style="font-size:12.5px;margin-top:8px">Images are auto centre-cropped to a square. Videos are trimmed to 15 seconds and centre-cropped.</p>
    </div>`,
    footer: `<div class="sheet-pad"><button class="btn btn-primary btn-block" id="sticker-save-btn">Add to pack</button></div>`,
    onMount(sheet) {
      let prepared = null;
      const errBox = sheet.querySelector('#sticker-create-error');
      const fail = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
      sheet.querySelector('#sticker-file').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        prepared = null;
        sheet.querySelector('#sticker-preview').innerHTML = '';
        errBox.classList.add('hidden');
        if (!file) return;
        try {
          prepared = await prepareStickerFile(file);
          const preview = prepared.type === 'video'
            ? `<video src="${prepared.dataUrl}" muted loop playsinline controls style="max-width:180px;border-radius:16px"></video>`
            : `<img src="${prepared.dataUrl}" alt="" style="width:160px;height:160px;object-fit:cover;border-radius:16px">`;
          sheet.querySelector('#sticker-preview').innerHTML = preview;
        } catch (err) {
          fail(err.message || 'Could not process file');
          e.target.value = '';
        }
      });
      sheet.querySelector('#sticker-save-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!prepared) return fail('Choose a photo or video first');
        const packName = sheet.querySelector('#sticker-pack-name').value.trim() || 'My stickers';
        setBusy(btn, true, 'Saving...');
        try {
          await api.addSticker({
            packName,
            data: prepared.dataUrl,
            mimeType: prepared.mime,
            type: prepared.type
          });
          packsCache = null;
          closeSheet();
          toast('Sticker added to ' + packName, 'success');
          onCreated?.();
        } catch (err) {
          fail(err instanceof ApiError ? err.message : 'Could not save sticker');
        } finally {
          setBusy(btn, false);
        }
      });
    }
  });
}

/** Centre-crop image to square sticker size. */
export function cropImageToSticker(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = STICKER_SIZE;
      canvas.height = STICKER_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, size, size, 0, 0, STICKER_SIZE, STICKER_SIZE);
      resolve({ dataUrl: canvas.toDataURL('image/png'), mime: 'image/png', type: 'image' });
    };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = dataUrl;
  });
}

/** Trim video to 15s and centre-crop frames into a short looping webm when possible. */
export async function trimVideoToSticker(file) {
  const dataUrl = await fileToDataUrl(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.src = dataUrl;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('Could not load video'));
  });
  const duration = Math.min(video.duration || MAX_VIDEO_SEC, MAX_VIDEO_SEC);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid video');

  // Prefer recording a centre-cropped stream when captureStream is available.
  if (typeof video.captureStream === 'function' && typeof MediaRecorder !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = STICKER_SIZE;
      canvas.height = STICKER_SIZE;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(15);
      // Try to keep audio off for stickers
      const recorder = new MediaRecorder(stream, { mimeType: pickRecorderMime() });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

      video.currentTime = 0;
      await video.play();
      recorder.start(100);
      const start = performance.now();
      const draw = () => {
        if (video.paused || video.ended) return;
        const size = Math.min(video.videoWidth, video.videoHeight) || STICKER_SIZE;
        const sx = (video.videoWidth - size) / 2;
        const sy = (video.videoHeight - size) / 2;
        ctx.drawImage(video, sx, sy, size, size, 0, 0, STICKER_SIZE, STICKER_SIZE);
        if ((performance.now() - start) / 1000 < duration) requestAnimationFrame(draw);
        else {
          video.pause();
          recorder.stop();
        }
      };
      requestAnimationFrame(draw);
      await stopped;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      if (blob.size > 0) {
        const outUrl = await blobToDataUrl(blob);
        return { dataUrl: outUrl, mime: blob.type || 'video/webm', type: 'video' };
      }
    } catch {
      // fall through to original trimmed-as-is path
    }
  }

  // Fallback: use original file if already short enough, else reject long videos
  if ((video.duration || 0) > MAX_VIDEO_SEC + 0.25) {
    throw new Error('Video must be 15 seconds or shorter on this device');
  }
  return { dataUrl, mime: file.type || 'video/mp4', type: 'video' };
}

function pickRecorderMime() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return 'video/webm';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read sticker'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareStickerFile(file) {
  if (!file) throw new Error('No file selected');
  if (file.type.startsWith('image/')) {
    if (file.size > 12 * 1024 * 1024) throw new Error('Image too large (max 12MB)');
    const dataUrl = await fileToDataUrl(file);
    return cropImageToSticker(dataUrl);
  }
  if (file.type.startsWith('video/')) {
    if (file.size > 40 * 1024 * 1024) throw new Error('Video too large (max 40MB)');
    return trimVideoToSticker(file);
  }
  throw new Error('Stickers support photos and videos only');
}

/** Save an already-sent sticker into a named pack (any user). */
export async function saveSentStickerToPack(sticker, packName) {
  const name = packName || await promptSheet({
    title: 'Save sticker',
    label: 'Pack name',
    value: 'My stickers',
    confirmText: 'Save'
  });
  if (!name) return null;
  let data = null;
  let mime = sticker.mime || sticker.media_mime || 'image/png';
  let type = sticker.type || sticker.media_type || 'image';
  if (sticker.url || sticker.media_url) {
    const res = await fetch(sticker.url || sticker.media_url, { credentials: 'include' });
    if (!res.ok) throw new Error('Could not download sticker');
    const blob = await res.blob();
    data = await blobToDataUrl(blob);
    mime = blob.type || mime;
  } else if (sticker.dataUrl || sticker.media_data) {
    data = sticker.dataUrl || sticker.media_data;
  } else {
    throw new Error('No sticker media');
  }
  const result = await api.addSticker({ packName: name, data, mimeType: mime, type: type === 'sticker' ? 'image' : type });
  packsCache = null;
  toast('Saved to ' + name, 'success');
  return result;
}

export function stickerMessageHtml(msg) {
  const url = msg.media_url || msg.media_data || '';
  const isVideo = msg.media_mime?.startsWith('video/') || msg.media_type === 'video';
  const media = isVideo
    ? `<video class="sticker-media" src="${escapeHtml(url)}" autoplay loop muted playsinline></video>`
    : `<img class="sticker-media" src="${escapeHtml(url)}" alt="Sticker">`;
  return `<div class="sticker-bubble" data-msg-sticker="${escapeHtml(msg.id || '')}">${media}</div>`;
}
