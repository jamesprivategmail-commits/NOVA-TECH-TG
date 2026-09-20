// router.js - SPA history management for proper back-button behavior
// Pushes history entries for overlays (chat, status viewer, sheets) so the
// browser back button navigates within the app instead of leaving the site.

let initialized = false;
let currentTab = 'chats';
let overlayOpen = false; // chat or viewer is open
let sheetOpen = false;

const listeners = new Set();

export function initRouter() {
  if (initialized) return;
  initialized = true;

  // Replace the initial state so we have a baseline to return to
  window.history.replaceState({ tab: currentTab, base: true }, '', location.pathname);

  window.addEventListener('popstate', (e) => {
    const st = e.state || {};
    if (sheetOpen) {
      // Close the sheet first, stay on current tab
      sheetOpen = false;
      notify('sheet:close');
      // If we popped past the sheet entry, push back to current tab
      if (!st.overlay && !st.sheet) {
        // We're back at base state — good
      }
      return;
    }
    if (overlayOpen && !st.overlay) {
      // Back from overlay to base tab
      overlayOpen = false;
      notify('overlay:close');
      if (st.tab) {
        currentTab = st.tab;
        notify('tab:show', st.tab);
      }
      return;
    }
    if (st.tab) {
      currentTab = st.tab;
      notify('tab:show', st.tab);
    }
  });
}

export function setTab(tab) {
  currentTab = tab;
  // Replace current state (don't push — tab switches shouldn't create history entries)
  window.history.replaceState({ tab, base: true }, '', location.pathname);
}

export function pushOverlay(type) {
  overlayOpen = true;
  window.history.pushState({ tab: currentTab, overlay: true, type }, '', location.pathname);
}

export function popOverlay() {
  if (overlayOpen) {
    overlayOpen = false;
    window.history.back();
  }
}

export function pushSheet() {
  sheetOpen = true;
  window.history.pushState({ tab: currentTab, sheet: true }, '', location.pathname);
}

export function popSheet() {
  if (sheetOpen) {
    sheetOpen = false;
    window.history.back();
  }
}

export function clearSheet() {
  sheetOpen = false;
}

export function clearOverlay() {
  overlayOpen = false;
}

export function on(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify(event, data) {
  for (const cb of listeners) {
    try { cb(event, data); } catch (err) { console.error('router listener error', err); }
  }
}
