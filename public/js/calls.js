// calls.js - voice/video calls over the existing WebRTC signalling events
import { api } from './api.js';
import { state, emit, on } from './state.js';
import { inviteCall, signalCall, stateCall } from './socket.js';
import {
  $, avatar, icon, escapeHtml, conversationAvatarUser, toast, confirmSheet
} from './ui.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

let els = {};
let session = null; // { call, kind, targetUserId, pc, localStream, remoteStream, direction, muted, cameraOff, state }

export function initCalls() {
  els = {
    screen: $('#screen-call'),
    peerName: $('#call-peer-name'),
    mode: $('#call-mode'),
    avatar: $('#call-avatar'),
    name: $('#call-name'),
    stateText: $('#call-state'),
    center: $('#call-center'),
    remoteVideo: $('#remote-video'),
    localVideo: $('#local-video'),
    remoteAudio: $('#remote-audio'),
    controls: $('#call-controls'),
    incoming: $('#call-incoming'),
    mute: $('#call-mute'),
    camera: $('#call-camera'),
    end: $('#call-end'),
    accept: $('#call-accept'),
    decline: $('#call-decline')
  };

  els.mute?.addEventListener('click', toggleMute);
  els.camera?.addEventListener('click', toggleCamera);
  els.end?.addEventListener('click', () => endCall('ended'));
  els.accept?.addEventListener('click', acceptIncoming);
  els.decline?.addEventListener('click', () => endCall('declined'));

  on('call:start', ({ conversation, kind }) => startCall(conversation, kind));
  on('call:incoming', onIncoming);
  on('call:signal', onSignal);
  on('call:state', onCallState);
}

// ---------------- outgoing ----------------
async function startCall(conversation, kind) {
  if (session) { toast('A call is already in progress'); return; }
  const target = conversation.other_user;
  if (!target) { toast('Calls need a direct message'); return; }
  try {
    const res = await api.startCall(conversation.id, kind);
    const call = res.call;
    session = {
      call, kind, targetUserId: target.id, direction: 'outgoing',
      pc: null, localStream: null, remoteStream: null, muted: false, cameraOff: kind !== 'video', state: 'ringing'
    };
    showCallUi(conversation, target, kind, 'Ringing...', 'outgoing');
    await setupPeer();
    const offer = await session.pc.createOffer();
    await session.pc.setLocalDescription(offer);
    inviteCall(target.id, call);
    signalCall(target.id, call.id, { type: 'offer', sdp: session.pc.localDescription });
  } catch (err) {
    toast(err.message || 'Could not start call');
    cleanup();
  }
}

// ---------------- incoming ----------------
async function onIncoming({ call, fromUserId }) {
  if (session) { stateCall(fromUserId, call.id, 'busy'); return; }
  const conv = state.conversations.find((c) => c.id === call.conversation_id);
  const peer = conv?.other_user || { id: fromUserId, display_name: 'Incoming call' };
  session = {
    call, kind: call.kind, targetUserId: fromUserId, direction: 'incoming',
    pc: null, localStream: null, remoteStream: null, muted: false, cameraOff: call.kind !== 'video', state: 'ringing'
  };
  showCallUi(conv || { name: peer.display_name }, peer, call.kind, 'Incoming call', 'incoming');
}

async function acceptIncoming() {
  if (!session) return;
  try {
    await setupPeer();
    stateCall(session.targetUserId, session.call.id, 'accepted');
    api.updateCall(session.call.id, 'accepted').catch(() => {});
    session.state = 'connected';
    els.incoming.hidden = true;
    els.controls.hidden = false;
    els.stateText.textContent = 'Connected';
  } catch (err) {
    toast('Could not start media');
    endCall('ended');
  }
}

// ---------------- peer ----------------
async function setupPeer() {
  const kind = session.kind;
  const constraints = kind === 'video' ? { audio: true, video: true } : { audio: true, video: false };
  try {
    session.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    session.localStream = null;
    toast('Microphone/camera permission denied');
  }
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  session.pc = pc;
  session.remoteStream = new MediaStream();

  if (session.localStream) {
    session.localStream.getTracks().forEach((t) => pc.addTrack(t, session.localStream));
    if (kind === 'video') {
      els.localVideo.srcObject = session.localStream;
      els.localVideo.classList.remove('hidden');
      session.cameraOff = false;
    }
  }

  pc.ontrack = (event) => {
    event.streams[0]?.getTracks().forEach((t) => session.remoteStream.addTrack(t));
    if (kind === 'video') {
      els.remoteVideo.srcObject = session.remoteStream;
      els.remoteVideo.classList.remove('hidden');
    } else {
      els.remoteAudio.srcObject = session.remoteStream;
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) signalCall(session.targetUserId, session.call.id, { type: 'ice', candidate: event.candidate });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      session.state = 'connected';
      els.stateText.textContent = 'Connected';
      els.incoming.hidden = true;
      els.controls.hidden = false;
    } else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && session) {
      els.stateText.textContent = 'Call ended';
      endCall('ended');
    }
  };
}

async function onSignal({ callId, signal, fromUserId }) {
  if (!session || session.call.id !== callId) return;
  if (!session.pc) return;
  try {
    if (signal.type === 'offer') {
      await session.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await session.pc.createAnswer();
      await session.pc.setLocalDescription(answer);
      signalCall(fromUserId, callId, { type: 'answer', sdp: session.pc.localDescription });
    } else if (signal.type === 'answer') {
      await session.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.type === 'ice' && signal.candidate) {
      await session.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  } catch { /* ignore transient signalling errors */ }
}

function onCallState({ callId, state: callState, fromUserId }) {
  if (!session || session.call.id !== callId) return;
  if (callState === 'accepted') {
    els.stateText.textContent = 'Connected';
    els.incoming.hidden = true;
    els.controls.hidden = false;
    session.state = 'connected';
  } else if (callState === 'declined') {
    els.stateText.textContent = 'Declined';
    toast('Call declined');
    setTimeout(() => cleanup(), 900);
  } else if (callState === 'busy') {
    els.stateText.textContent = 'Busy';
    setTimeout(() => cleanup(), 900);
  } else if (['ended', 'missed'].includes(callState)) {
    els.stateText.textContent = 'Call ended';
    setTimeout(() => cleanup(), 900);
  }
  void fromUserId;
}

// ---------------- ui ----------------
function showCallUi(conversation, peer, kind, stateText, direction) {
  const peerUser = peer || {};
  els.screen.hidden = false;
  els.peerName.textContent = peerUser.display_name || conversation?.name || 'Call';
  els.mode.textContent = kind === 'video' ? 'VIDEO' : 'VOICE';
  els.name.textContent = peerUser.display_name || conversation?.name || 'Call';
  els.stateText.textContent = stateText;
  els.avatar.outerHTML = avatar(peerUser, { size: 'xl', id: 'call-avatar' });
  els.avatar = $('#call-avatar');
  els.remoteVideo.classList.toggle('hidden', kind !== 'video');
  els.localVideo.classList.add('hidden');
  els.center.classList.toggle('hidden', kind === 'video' && direction === 'incoming');
  if (direction === 'incoming') {
    els.incoming.hidden = false;
    els.controls.hidden = true;
  } else {
    els.incoming.hidden = true;
    els.controls.hidden = false;
  }
}

function toggleMute() {
  if (!session?.localStream) return;
  session.muted = !session.muted;
  session.localStream.getAudioTracks().forEach((t) => { t.enabled = !session.muted; });
  els.mute.classList.toggle('off', session.muted);
  els.mute.innerHTML = icon(session.muted ? 'mic-off' : 'mic');
}

function toggleCamera() {
  if (!session?.localStream) return;
  session.cameraOff = !session.cameraOff;
  session.localStream.getVideoTracks().forEach((t) => { t.enabled = !session.cameraOff; });
  els.camera.classList.toggle('off', session.cameraOff);
  els.camera.innerHTML = icon(session.cameraOff ? 'video-off' : 'video');
}

async function endCall(finalState) {
  if (!session) return;
  const { targetUserId, call } = session;
  stateCall(targetUserId, call.id, finalState);
  api.updateCall(call.id, finalState).catch(() => {});
  els.stateText.textContent = 'Call ended';
  setTimeout(() => cleanup(), 500);
}

function cleanup() {
  if (session?.pc) { try { session.pc.close(); } catch { /* ignore */ } }
  if (session?.localStream) session.localStream.getTracks().forEach((t) => t.stop());
  session = null;
  els.screen.hidden = true;
  els.remoteVideo.srcObject = null;
  els.localVideo.srcObject = null;
  els.remoteAudio.srcObject = null;
  els.remoteVideo.classList.add('hidden');
  els.localVideo.classList.add('hidden');
  els.mute.classList.remove('off');
  els.camera.classList.remove('off');
  els.mute.innerHTML = icon('mic');
  els.camera.innerHTML = icon('video');
}

void conversationAvatarUser;
void escapeHtml;
void confirmSheet;
void emit;