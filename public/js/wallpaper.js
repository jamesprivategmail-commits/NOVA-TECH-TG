// wallpaper.js - Custom chat wallpaper support per-chat & all chats
import { api } from './api.js';
import { state, emit } from './state.js';
import { $, icon, toast, openSheet, closeSheet, fileToDataUrl, promptSheet } from './ui.js';

export const WALLPAPER_PRESETS = [
  { id: 'default', name: 'Pure Dark', style: '#000000', preview: '#000000' },
  { id: 'midnight', name: 'Midnight', style: 'linear-gradient(180deg, #0b111e 0%, #03060a 100%)', preview: 'linear-gradient(180deg, #0b111e 0%, #03060a 100%)' },
  { id: 'cyber', name: 'Cyber Slate', style: 'linear-gradient(135deg, #0f172a 0%, #020617 100%)', preview: 'linear-gradient(135deg, #0f172a 0%, #020617 100%)' },
  { id: 'crimson', name: 'Crimson Dusk', style: 'linear-gradient(180deg, #20080b 0%, #0a0203 100%)', preview: 'linear-gradient(180deg, #20080b 0%, #0a0203 100%)' },
  { id: 'emerald', name: 'Emerald Abyss', style: 'linear-gradient(180deg, #041d14 0%, #010805 100%)', preview: 'linear-gradient(180deg, #041d14 0%, #010805 100%)' },
  { id: 'amethyst', name: 'Amethyst Void', style: 'linear-gradient(180deg, #190928 0%, #06020b 100%)', preview: 'linear-gradient(180deg, #190928 0%, #06020b 100%)' },
  { id: 'sunset', name: 'Sunset Ember', style: 'linear-gradient(180deg, #241103 0%, #0b0501 100%)', preview: 'linear-gradient(180deg, #241103 0%, #0b0501 100%)' },
  { id: 'doodle', name: 'Chat Texture', style: 'radial-gradient(rgba(255,255,255,0.08) 1.2px, transparent 1.2px) 0 0 / 24px 24px, #070707', preview: 'radial-gradient(rgba(255,255,255,0.25) 1.2px, transparent 1.2px) 0 0 / 12px 12px, #070707' },
  { id: 'matrix', name: 'Matrix Grid', style: 'linear-gradient(rgba(0,255,136,0.05) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, rgba(0,255,136,0.05) 1px, transparent 1px) 0 0 / 24px 24px, #030a06', preview: 'linear-gradient(rgba(0,255,136,0.2) 1px, transparent 1px) 0 0 / 12px 12px, linear-gradient(90deg, rgba(0,255,136,0.2) 1px, transparent 1px) 0 0 / 12px 12px, #030a06' },
  { id: 'stars', name: 'Deep Space', style: 'radial-gradient(ellipse at bottom, #1b263b 0%, #080a11 100%)', preview: 'radial-gradient(ellipse at bottom, #1b263b 0%, #080a11 100%)' },
  { id: 'charcoal', name: 'Charcoal Minimal', style: '#141416', preview: '#141416' }
];

export function getPerChatWallpapers() {
  const settingsMap = state.settings?.privacySettings?.chatWallpapers || {};
  let localMap = {};
  try {
    localMap = JSON.parse(localStorage.getItem('darkchat_wallpapers_by_conv') || '{}');
  } catch (e) {}
  return { ...localMap, ...settingsMap };
}

export function getGlobalWallpaper() {
  return state.settings?.privacySettings?.chatWallpaper || localStorage.getItem('darkchat_wallpaper_global') || null;
}

export function getActiveWallpaper(conv = state.activeConv) {
  if (conv && conv.id) {
    const perChat = getPerChatWallpapers();
    if (perChat[conv.id]) return { value: perChat[conv.id], isPerChat: true };
    if (conv.wallpaper) return { value: conv.wallpaper, isPerChat: true };
  }
  const globalWp = getGlobalWallpaper();
  if (globalWp) return { value: globalWp, isPerChat: false };
  return { value: 'default', isPerChat: false };
}

function applyWallpaperStyleToElement(el, wpValue) {
  if (!el) return;
  if (!wpValue || wpValue === 'default' || wpValue === 'none' || wpValue === '#000000') {
    el.style.backgroundImage = '';
    el.style.background = '';
    el.classList.remove('has-wallpaper');
    return;
  }

  el.classList.add('has-wallpaper');
  const str = String(wpValue).trim();

  // Preset lookup
  const preset = WALLPAPER_PRESETS.find(p => p.id === str);
  if (preset) {
    el.style.backgroundImage = '';
    el.style.background = preset.style;
    return;
  }

  // Image URL / base64
  if (str.startsWith('url(') || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:') || str.startsWith('/api/')) {
    const cleanUrl = str.startsWith('url(') ? str : `url("${str}")`;
    el.style.background = '';
    el.style.backgroundImage = cleanUrl;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
    return;
  }

  // Gradient or solid color
  el.style.backgroundImage = '';
  el.style.background = str;
}

export function applyActiveWallpaper(conv = state.activeConv) {
  const wallpaperEl = $('#chat-wallpaper');
  if (!wallpaperEl) return;
  const { value } = getActiveWallpaper(conv);
  applyWallpaperStyleToElement(wallpaperEl, value);
}

export async function saveWallpaperForChat(convId, wallpaperValue) {
  if (!convId) return;
  const perChat = getPerChatWallpapers();
  if (!wallpaperValue || wallpaperValue === 'default') {
    delete perChat[convId];
  } else {
    perChat[convId] = wallpaperValue;
  }

  try {
    localStorage.setItem('darkchat_wallpapers_by_conv', JSON.stringify(perChat));
  } catch (e) {}

  if (!state.settings.privacySettings) state.settings.privacySettings = {};
  state.settings.privacySettings.chatWallpapers = perChat;

  // Persist to server profile
  api.updateProfileSettings({ chatWallpapers: perChat }).catch(console.warn);

  // If conversation exists in state, update it
  if (state.activeConv && String(state.activeConv.id) === String(convId)) {
    state.activeConv.wallpaper = wallpaperValue === 'default' ? null : wallpaperValue;
    applyActiveWallpaper(state.activeConv);
  }

  const convInList = (state.conversations || []).find(c => String(c.id) === String(convId));
  if (convInList) {
    convInList.wallpaper = wallpaperValue === 'default' ? null : wallpaperValue;
  }

  // Also update conversation object on server if owner/admin
  api.updateConversation(convId, { wallpaper: wallpaperValue === 'default' ? null : wallpaperValue }).catch(() => {});
  emit('wallpaper:changed', { convId, wallpaper: wallpaperValue });
}

export async function saveWallpaperForAllChats(wallpaperValue) {
  const val = (!wallpaperValue || wallpaperValue === 'default') ? null : wallpaperValue;
  try {
    if (val) localStorage.setItem('darkchat_wallpaper_global', val);
    else localStorage.removeItem('darkchat_wallpaper_global');
  } catch (e) {}

  if (!state.settings.privacySettings) state.settings.privacySettings = {};
  state.settings.privacySettings.chatWallpaper = val;

  api.updateProfileSettings({ chatWallpaper: val }).catch(console.warn);
  applyActiveWallpaper(state.activeConv);
  emit('wallpaper:changed', { convId: null, wallpaper: val });
}

export function openWallpaperPicker({ conv = null, onSelect = null } = {}) {
  const targetConv = conv || state.activeConv;
  const current = getActiveWallpaper(targetConv);
  let selected = current.value || 'default';

  const isPerChatMode = Boolean(targetConv && targetConv.id);
  const convTypeLabel = targetConv
    ? (targetConv.type === 'channel' ? 'channel' : targetConv.type === 'group' ? 'group' : 'chat')
    : 'chat';

  const bodyHtml = `
    <div class="wallpaper-picker-wrap">
      <!-- Live Preview Card -->
      <div class="wallpaper-preview-box" id="wp-live-preview">
        <div class="wallpaper-preview-layer" id="wp-preview-layer"></div>
        <div class="wallpaper-preview-bubble">Hey! How does this wallpaper look? 👋</div>
        <div class="wallpaper-preview-bubble own">It looks fantastic on DARK CHAT 🔥</div>
      </div>

      <div class="wallpaper-section-label">Select preset theme</div>
      <div class="wallpaper-grid" id="wp-preset-grid">
        ${WALLPAPER_PRESETS.map((p) => `
          <button type="button" class="wallpaper-thumb ${selected === p.id || selected === p.style ? 'selected' : ''}" data-wp-val="${p.id}" style="background:${p.preview}">
            <span>${p.name}</span>
            <div class="wp-check ${selected === p.id || selected === p.style ? '' : 'hidden'}">${icon('check')}</div>
          </button>
        `).join('')}
      </div>

      <div class="wallpaper-section-label">Custom background</div>
      <div class="row" style="gap:8px;margin-bottom:14px">
        <label class="btn btn-ghost btn-sm" style="flex:1;cursor:pointer">
          ${icon('image')} Upload photo
          <input type="file" id="wp-file-input" accept="image/*" hidden>
        </label>
        <button type="button" class="btn btn-ghost btn-sm" id="wp-url-btn" style="flex:1">
          ${icon('link')} Image URL
        </button>
        <label class="btn btn-ghost btn-sm" style="flex:1;cursor:pointer">
          ${icon('edit')} Color
          <input type="color" id="wp-color-input" value="#121824" style="opacity:0;position:absolute;width:1px;height:1px">
        </label>
      </div>

      <!-- Action buttons -->
      <div class="stack" style="gap:8px;margin-top:6px">
        ${isPerChatMode ? `
          <button type="button" class="btn btn-primary btn-block" id="wp-btn-this">
            ${icon('check')} Set for this ${convTypeLabel}
          </button>
          <button type="button" class="btn btn-ghost btn-block" id="wp-btn-all">
            ${icon('check-check')} Set for all chats
          </button>
          <button type="button" class="btn btn-ghost btn-block danger" id="wp-btn-reset">
            ${icon('trash')} Reset to default
          </button>
        ` : `
          <button type="button" class="btn btn-primary btn-block" id="wp-btn-all">
            ${icon('check')} Set for all chats
          </button>
          <button type="button" class="btn btn-ghost btn-block danger" id="wp-btn-reset">
            ${icon('trash')} Reset to default
          </button>
        `}
      </div>
    </div>
  `;

  openSheet({
    title: isPerChatMode ? `Wallpaper for ${targetConv.name || convTypeLabel}` : 'Chat Wallpaper',
    body: bodyHtml,
    onMount(sheet) {
      const previewLayer = sheet.querySelector('#wp-preview-layer');

      const updatePreview = (val) => {
        selected = val;
        applyWallpaperStyleToElement(previewLayer, val);

        sheet.querySelectorAll('.wallpaper-thumb').forEach((thumb) => {
          const tVal = thumb.dataset.wpVal;
          const match = (tVal === val) || (WALLPAPER_PRESETS.find(p => p.id === tVal)?.style === val);
          thumb.classList.toggle('selected', match);
          const chk = thumb.querySelector('.wp-check');
          if (chk) chk.classList.toggle('hidden', !match);
        });
      };

      updatePreview(selected);

      // Preset click
      sheet.querySelectorAll('.wallpaper-thumb').forEach((thumb) => {
        thumb.addEventListener('click', () => {
          updatePreview(thumb.dataset.wpVal);
        });
      });

      // Photo upload
      const fileInput = sheet.querySelector('#wp-file-input');
      fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await fileToDataUrl(file);
          updatePreview(dataUrl);
          toast('Photo loaded into preview', 'success');
        } catch (err) {
          toast('Failed to load image');
        }
      });

      // Image URL
      const urlBtn = sheet.querySelector('#wp-url-btn');
      urlBtn?.addEventListener('click', async () => {
        const url = await promptSheet({
          title: 'Wallpaper image URL',
          label: 'Direct image link (https://...)',
          placeholder: 'https://example.com/wallpaper.jpg',
          confirmText: 'Use image'
        });
        if (url && url.trim()) {
          updatePreview(url.trim());
        }
      });

      // Color picker
      const colorInput = sheet.querySelector('#wp-color-input');
      colorInput?.addEventListener('input', (e) => {
        updatePreview(e.target.value);
      });

      // Save for this chat
      const btnThis = sheet.querySelector('#wp-btn-this');
      btnThis?.addEventListener('click', async () => {
        closeSheet();
        if (targetConv && targetConv.id) {
          await saveWallpaperForChat(targetConv.id, selected);
          toast(`Wallpaper set for this ${convTypeLabel}`, 'success');
          if (typeof onSelect === 'function') onSelect(selected, 'this');
        }
      });

      // Save for all chats
      const btnAll = sheet.querySelector('#wp-btn-all');
      btnAll?.addEventListener('click', async () => {
        closeSheet();
        await saveWallpaperForAllChats(selected);
        toast('Wallpaper set for all chats', 'success');
        if (typeof onSelect === 'function') onSelect(selected, 'all');
      });

      // Reset
      const btnReset = sheet.querySelector('#wp-btn-reset');
      btnReset?.addEventListener('click', async () => {
        closeSheet();
        if (isPerChatMode && targetConv?.id) {
          await saveWallpaperForChat(targetConv.id, 'default');
          toast(`Wallpaper reset for this ${convTypeLabel}`, 'success');
        } else {
          await saveWallpaperForAllChats('default');
          toast('Wallpaper reset for all chats', 'success');
        }
        if (typeof onSelect === 'function') onSelect('default', 'reset');
      });
    }
  });
}
