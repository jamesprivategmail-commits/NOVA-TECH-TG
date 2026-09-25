// auth.js - signup / login / session screens
import { api, ApiError } from './api.js';
import { state, saveToken, clearSession, emit } from './state.js';
import { $, toast, setBusy, icon } from './ui.js';

let els = {};

export function initAuth() {
  els = {
    screen: $('#auth-screen'),
    error: $('#auth-error'),
    signupForm: $('#signup-form'),
    loginForm: $('#login-form'),
    loginCredentials: $('#login-credentials'),
    login2faSection: $('#login-2fa-section'),
    login2faPin: $('#login-2fa-pin'),
    login2faBack: $('#login-2fa-back'),
    loginSubmit: $('#login-submit'),
    signupName: $('#signup-name'),
    signupPassword: $('#signup-password'),
    loginNovaId: $('#login-novaid'),
    loginPassword: $('#login-password'),
    reveal: $('#nova-id-reveal'),
    revealValue: $('#revealed-nova-id'),
    copyBtn: $('#copy-id-btn'),
    revealContinue: $('#reveal-continue'),
    toLogin: $('#toggle-to-login'),
    toSignup: $('#toggle-to-signup')
  };

  els.toLogin.querySelector('button')?.addEventListener('click', () => switchMode('login'));
  els.toSignup.querySelector('button')?.addEventListener('click', () => switchMode('signup'));
  els.signupForm.addEventListener('submit', onSignup);
  els.loginForm.addEventListener('submit', onLogin);
  els.login2faBack?.addEventListener('click', reset2faStep);
  els.copyBtn.addEventListener('click', copyId);
  els.revealContinue.addEventListener('click', () => {
    els.reveal.classList.add('hidden');
    emit('auth:signed-in', state.me);
  });
}

function reset2faStep() {
  showError('');
  els.loginCredentials?.classList.remove('hidden');
  els.login2faSection?.classList.add('hidden');
  if (els.login2faPin) els.login2faPin.value = '';
  if (els.loginSubmit) els.loginSubmit.textContent = 'Log in';
  els.loginPassword?.focus();
}

function switchMode(mode) {
  showError('');
  reset2faStep();
  const login = mode === 'login';
  els.signupForm.classList.toggle('hidden', login);
  els.loginForm.classList.toggle('hidden', !login);
  els.toLogin.classList.toggle('hidden', !login);
  els.toSignup.classList.toggle('hidden', login);
  els.reveal.classList.add('hidden');
  (login ? els.loginNovaId : els.signupName).focus();
}

function showError(message) {
  if (!message) {
    els.error.textContent = '';
    els.error.classList.add('hidden');
    return;
  }
  els.error.textContent = message;
  els.error.classList.remove('hidden');
}

async function onSignup(event) {
  event.preventDefault();
  showError('');
  const name = els.signupName.value.trim();
  const password = els.signupPassword.value;
  if (!name) return showError('Enter a display name');
  if (password.length < 6) return showError('Password must be at least 6 characters');

  const btn = $('#signup-submit');
  setBusy(btn, true, 'Creating...');
  try {
    const res = await api.signup(name, password);
    saveToken(res.token);
    state.me = res.user;
    els.revealValue.textContent = res.user.novaId;
    els.reveal.classList.remove('hidden');
    els.signupForm.classList.add('hidden');
    els.toLogin.classList.add('hidden');
    els.toSignup.classList.add('hidden');
    els.signupForm.reset();
  } catch (err) {
    showError(err instanceof ApiError ? err.message : 'Signup failed, try again');
  } finally {
    setBusy(btn, false);
  }
}

async function onLogin(event) {
  event.preventDefault();
  showError('');
  const novaId = els.loginNovaId.value.trim();
  const password = els.loginPassword.value;
  if (!novaId || !password) return showError('Enter your DARK CHAT ID and password');

  const is2faActive = els.login2faSection && !els.login2faSection.classList.contains('hidden');
  let pin = null;
  if (is2faActive) {
    pin = els.login2faPin ? els.login2faPin.value.trim() : '';
    if (!pin) return showError('Enter your 6-digit security PIN');
    if (!/^\d{6}$/.test(pin)) return showError('PIN must be exactly 6 digits');
  }

  const btn = $('#login-submit');
  setBusy(btn, true, is2faActive ? 'Verifying...' : 'Logging in...');
  try {
    const res = await api.login(novaId, password, pin);
    if (res.requireTwoFactor) {
      els.loginCredentials?.classList.add('hidden');
      els.login2faSection?.classList.remove('hidden');
      if (els.loginSubmit) els.loginSubmit.textContent = 'Verify PIN & Log in';
      els.login2faPin?.focus();
      return;
    }
    saveToken(res.token);
    state.me = res.user;
    reset2faStep();
    els.loginForm.reset();
    emit('auth:signed-in', res.user);
  } catch (err) {
    showError(err instanceof ApiError ? err.message : 'Login failed, try again');
  } finally {
    setBusy(btn, false);
  }
}

async function copyId() {
  const value = els.revealValue.textContent;
  try {
    await navigator.clipboard.writeText(value);
    toast('DARK CHAT ID copied', 'success');
  } catch {
    toast('Copy failed - select the ID manually');
  }
}

export function showAuth() {
  els.screen?.classList.remove('hidden');
  $('#app')?.classList.add('hidden');
  if (els.signupForm) {
    els.signupForm.classList.remove('hidden');
    els.loginForm.classList.add('hidden');
    els.reveal.classList.add('hidden');
    els.toLogin.classList.remove('hidden');
    els.toSignup.classList.add('hidden');
  }
  showError('');
}

export function hideAuth() {
  els.screen?.classList.add('hidden');
  $('#app')?.classList.remove('hidden');
}

export function forceLogout(message) {
  clearSession();
  showAuth();
  if (message) showError(message);
}

// exposed for the settings screen
export function logout() {
  clearSession();
  showAuth();
  toast('Logged out');
}

export { icon };
