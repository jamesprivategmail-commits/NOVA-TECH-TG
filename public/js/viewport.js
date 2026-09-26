// viewport.js - Mobile visual viewport & keyboard layout controller
import { emit } from './state.js';

let isKeyboardOpen = false;
let currentKeyboardHeight = 0;
let rafId = null;

export function resetWindowScroll() {
  if (window.scrollY !== 0 || window.scrollX !== 0) {
    window.scrollTo(0, 0);
  }
  if (document.documentElement.scrollTop !== 0) {
    document.documentElement.scrollTop = 0;
  }
  if (document.body && document.body.scrollTop !== 0) {
    document.body.scrollTop = 0;
  }
}

export function initViewport() {
  const root = document.documentElement;

  function updateViewport() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const vv = window.visualViewport;
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;

      // Use visualViewport height when available, otherwise window.innerHeight
      const vHeight = vv ? Math.round(vv.height) : windowHeight;
      const vWidth = vv ? Math.round(vv.width) : windowWidth;

      // Calculate keyboard height (ignoring subtle browser address bar changes < 60px)
      const rawDiff = windowHeight - vHeight;
      const activeEl = document.activeElement;
      const isInputFocused = Boolean(
        activeEl && (
          activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable
        )
      );

      const keyboardHeight = Math.max(0, rawDiff);
      const keyboardVisible = keyboardHeight > 100 || (isInputFocused && keyboardHeight > 40);

      // Set CSS custom properties on documentElement for CSS styling
      root.style.setProperty('--visual-viewport-height', `${vHeight}px`);
      root.style.setProperty('--visual-viewport-width', `${vWidth}px`);
      root.style.setProperty('--keyboard-height', `${keyboardVisible ? keyboardHeight : 0}px`);

      if (keyboardVisible !== isKeyboardOpen) {
        isKeyboardOpen = keyboardVisible;
        currentKeyboardHeight = keyboardVisible ? keyboardHeight : 0;

        if (keyboardVisible) {
          document.body.classList.add('keyboard-open');
          root.classList.add('keyboard-open');
          emit('keyboard:open', { height: keyboardHeight });
        } else {
          document.body.classList.remove('keyboard-open');
          root.classList.remove('keyboard-open');
          emit('keyboard:close');
        }
      }

      // Always keep window scroll position strictly zero to prevent entire website shifting
      resetWindowScroll();
    });
  }

  // Initial calculation
  updateViewport();

  // Visual Viewport API event listeners
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateViewport);
    window.visualViewport.addEventListener('scroll', () => {
      resetWindowScroll();
    });
  }

  window.addEventListener('resize', updateViewport);
  window.addEventListener('orientationchange', () => {
    setTimeout(updateViewport, 80);
    setTimeout(updateViewport, 250);
  });

  // Guard against any native browser attempt to scroll the document window
  window.addEventListener('scroll', resetWindowScroll, { passive: true });
  document.addEventListener('scroll', resetWindowScroll, { passive: true });

  document.addEventListener('focusin', (e) => {
    resetWindowScroll();
    setTimeout(updateViewport, 30);
    setTimeout(updateViewport, 120);
    setTimeout(resetWindowScroll, 50);
    setTimeout(resetWindowScroll, 150);
  }, { passive: true });

  document.addEventListener('focusout', () => {
    setTimeout(updateViewport, 30);
    setTimeout(updateViewport, 120);
    setTimeout(resetWindowScroll, 50);
  }, { passive: true });
}

export function getIsKeyboardOpen() {
  return isKeyboardOpen;
}

export function getKeyboardHeight() {
  return currentKeyboardHeight;
}
