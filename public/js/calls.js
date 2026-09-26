// calls.js - Real WebRTC 1-to-1 voice/video, group voice/video calling, responsive video grid, active speaker detection, device switching, and floating mini bar.
import { api } from './api.js';
import { pref } from './settings.js';
import { state, emit, on } from './state.js';
import {
  inviteCall, signalCall, stateCall,
  startGroupCall, joinGroupCall, signalGroupCall, mediaStateGroupCall, leaveGroupCall, endGroupCall
} from './socket.js';
import {
  $, avatar, icon, escapeHtml, toast, confirmSheet
} from './ui.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];
let iceServersPromise = null;

let els = {};
let session = null;
let callTimer = null;
let ringTimeout = null;

// Web Audio synthesizer for ringtones and call chimes
let audioCtx = null;
let currentToneNodes = [];

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function stopAudioTones() {
  currentToneNodes.forEach((node) => {
    try {
      if (typeof node.stop === 'function') node.stop();
      if (typeof node.disconnect === 'function') node.disconnect();
    } catch {}
  });
  currentToneNodes = [];
}

function playToneSequence(steps, loopInterval = 0) {
  stopAudioTones();
  const ctx = getAudioContext();
  if (!ctx) return;

  function runOnce() {
    steps.forEach(({ freq, type = 'sine', startTime, duration, gain = 0.14 }) => {
      try {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
        gainNode.gain.setValueAtTime(0.001, ctx.currentTime + startTime);
        gainNode.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + startTime + 0.04);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(ctx.currentTime + startTime);
        osc.stop(ctx.currentTime + startTime + duration);
        currentToneNodes.push(osc, gainNode);
      } catch {}
    });
  }

  runOnce();
  if (loopInterval > 0) {
    const timer = setInterval(() => {
      if (!session) {
        clearInterval(timer);
        stopAudioTones();
      } else {
        runOnce();
      }
    }, loopInterval);
    currentToneNodes.push({ stop: () => clearInterval(timer) });
  }
}

function playRingback() {
  playToneSequence([
    { freq: 440, startTime: 0, duration: 1.8, gain: 0.1 },
    { freq: 480, startTime: 0, duration: 1.8, gain: 0.1 }
  ], 4000);
}

function playIncomingRingtone() {
  playToneSequence([
    { freq: 523.25, startTime: 0, duration: 0.22, gain: 0.15 },
    { freq: 659.25, startTime: 0.18, duration: 0.22, gain: 0.15 },
    { freq: 783.99, startTime: 0.36, duration: 0.3, gain: 0.18 },
    { freq: 1046.50, startTime: 0.62, duration: 0.45, gain: 0.2 }
  ], 2600);
}

function playConnectChime() {
  playToneSequence([
    { freq: 587.33, startTime: 0, duration: 0.12, gain: 0.12 },
    { freq: 880.00, startTime: 0.1, duration: 0.22, gain: 0.15 }
  ], 0);
}

function playDisconnectChime() {
  playToneSequence([
    { freq: 440.00, startTime: 0, duration: 0.15, gain: 0.12 },
    { freq: 330.00, startTime: 0.12, duration: 0.25, gain: 0.12 }
  ], 0);
}

// Active Speaker Detection using Web Audio API
function setupAudioEnergyMonitoring(stream, onEnergyChange) {
  const ctx = getAudioContext();
  if (!ctx || !stream || !stream.getAudioTracks().length) return null;
  try {
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let speaking = false;
    const interval = setInterval(() => {
      if (!session) {
        clearInterval(interval);
        try { source.disconnect(); } catch {}
        return;
      }
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      const nowSpeaking = avg > 16;
      if (nowSpeaking !== speaking) {
        speaking = nowSpeaking;
        onEnergyChange(speaking);
      }
    }, 120);

    return {
      cleanup: () => {
        clearInterval(interval);
        try { source.disconnect(); } catch {}
      }
    };
  } catch {
    return null;
  }
}

export function initCalls() {
  els = {
    screen: $('#screen-call'),
    minimize: $('#call-minimize'),
    peerName: $('#call-peer-name'),
    participantsCount: $('#call-participants-count'),
    mode: $('#call-mode'),
    avatar: $('#call-avatar'),
    name: $('#call-name'),
    stateText: $('#call-state'),
    center: $('#call-center'),
    stage: $('#call-stage'),
    remoteVideo: $('#remote-video'),
    localVideo: $('#local-video'),
    remoteAudio: $('#remote-audio'),
    groupGrid: $('#call-group-grid'),
    controls: $('#call-controls'),
    incoming: $('#call-incoming'),
    mute: $('#call-mute'),
    speaker: $('#call-speaker'),
    camera: $('#call-camera'),
    flip: $('#call-flip'),
    end: $('#call-end'),
    accept: $('#call-accept'),
    decline: $('#call-decline'),
    // Floating mini bar
    miniBar: $('#call-mini-bar'),
    miniExpand: $('#call-mini-expand'),
    miniName: $('#call-mini-name'),
    miniTime: $('#call-mini-time'),
    miniMute: $('#call-mini-mute'),
    miniEnd: $('#call-mini-end')
  };

  els.mute?.addEventListener('click', toggleMute);
  els.speaker?.addEventListener('click', toggleSpeaker);
  els.camera?.addEventListener('click', toggleCamera);
  els.flip?.addEventListener('click', flipCamera);
  els.end?.addEventListener('click', onEndButtonClicked);
  els.accept?.addEventListener('click', acceptIncoming);
  els.decline?.addEventListener('click', () => endCall('declined'));
  els.minimize?.addEventListener('click', minimizeCall);

  // Mini bar buttons
  els.miniExpand?.addEventListener('click', expandCall);
  els.miniMute?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMute();
  });
  els.miniEnd?.addEventListener('click', (e) => {
    e.stopPropagation();
    onEndButtonClicked();
  });

  on('call:start', ({ conversation, kind, isGroup, joinOnly }) => {
    startCall(conversation, kind, isGroup, joinOnly);
  });
  on('call:incoming', onIncoming);
  on('call:signal', onSignal);
  on('call:state', onCallState);

  // Group events
  on('call:group:incoming', onGroupIncoming);
  on('call:group:user-joined', onGroupUserJoined);
  on('call:group:user-left', onGroupUserLeft);
  on('call:group:signal', onGroupSignal);
  on('call:group:media-state', onGroupMediaState);
  on('call:group:ended', onGroupEnded);
}

// ----------------------------------------------------
// CALL DISPATCH (1-to-1 or GROUP)
// ----------------------------------------------------
async function startCall(conversation, kind, forceGroup = false, joinOnly = false) {
  if (session) {
    if (session.call?.conversation_id === conversation.id) {
      expandCall();
      return;
    }
    toast('A call is already in progress');
    return;
  }

  const isGroup = forceGroup || conversation.type === 'group' || conversation.type === 'channel' || (conversation.member_ids || []).length > 2;

  if (kind === 'video' && !pref('allowVideoCalls', true)) {
    toast('Video calls are turned off in Settings');
    return;
  }
  if (kind === 'voice' && !pref('allowVoiceCalls', true)) {
    toast('Voice calls are turned off in Settings');
    return;
  }

  if (isGroup) {
    startGroupCallSession(conversation, kind, joinOnly);
  } else {
    startDmCallSession(conversation, kind);
  }
}

// ----------------------------------------------------
// 1-TO-1 CALL SESSION
// ----------------------------------------------------
async function startDmCallSession(conversation, kind) {
  const target = conversation.other_user;
  if (!target) {
    toast('Calls need a valid recipient');
    return;
  }

  try {
    const res = await api.startCall(conversation.id, kind);
    const call = res.call;
    session = {
      isGroup: false,
      conversation,
      call,
      kind,
      targetUserId: target.id,
      direction: 'outgoing',
      pc: null,
      localStream: null,
      remoteStream: null,
      pendingSignals: [],
      pendingIce: [],
      muted: false,
      speakerOn: false,
      outputDeviceId: null,
      cameraOff: kind !== 'video',
      facingMode: 'user',
      state: 'ringing'
    };

    showCallUi(conversation, target, kind, 'Ringing...', 'outgoing');
    playRingback();

    // 40 second ringing timeout for unanswered calls
    clearTimeout(ringTimeout);
    ringTimeout = setTimeout(() => {
      if (session && session.state === 'ringing') {
        toast('No answer');
        endCall('missed');
      }
    }, 40000);

    await setup1to1Peer();
    const offer = await session.pc.createOffer();
    await session.pc.setLocalDescription(offer);

    inviteCall(target.id, call);
    signalCall(target.id, call.id, { type: 'offer', sdp: session.pc.localDescription });
  } catch (err) {
    stopAudioTones();
    toast(err.message || 'Could not start call');
    cleanup();
  }
}

async function onIncoming({ call, fromUserId }) {
  if (session) {
    stateCall(fromUserId, call.id, 'busy');
    return;
  }
  const kind = call.kind || 'voice';
  if (kind === 'video' && !pref('allowVideoCalls', true)) {
    stateCall(fromUserId, call.id, 'declined');
    api.updateCall(call.id, 'declined').catch(() => {});
    return;
  }
  if (kind === 'voice' && !pref('allowVoiceCalls', true)) {
    stateCall(fromUserId, call.id, 'declined');
    api.updateCall(call.id, 'declined').catch(() => {});
    return;
  }

  const conv = state.conversations.find((c) => c.id === call.conversation_id);
  const peer = conv?.other_user || { id: fromUserId, display_name: 'Incoming call' };

  if (pref('callNotifications', true)) {
    toast(`${peer.display_name || 'Someone'} is calling…`);
  }
  playIncomingRingtone();

  session = {
    isGroup: false,
    conversation: conv,
    call,
    kind: call.kind,
    targetUserId: fromUserId,
    direction: 'incoming',
    pc: null,
    localStream: null,
    remoteStream: null,
    pendingSignals: [],
    pendingIce: [],
    muted: false,
    speakerOn: false,
    outputDeviceId: null,
    cameraOff: call.kind !== 'video',
    facingMode: 'user',
    state: 'ringing'
  };

  showCallUi(conv || { name: peer.display_name }, peer, call.kind, 'Incoming call', 'incoming');
}

async function acceptIncoming() {
  if (!session) return;
  stopAudioTones();
  clearTimeout(ringTimeout);

  if (session.isGroup) {
    acceptGroupIncoming();
    return;
  }

  try {
    await setup1to1Peer();
    stateCall(session.targetUserId, session.call.id, 'accepted');
    api.updateCall(session.call.id, 'accepted').catch(() => {});
    session.state = 'connected';
    playConnectChime();

    els.incoming.hidden = true;
    els.controls.hidden = false;
    els.stateText.textContent = 'Connected';
    startCallTimer();
  } catch (err) {
    toast('Could not start media: ' + (err.message || err));
    endCall('ended');
  }
}

async function setup1to1Peer() {
  const kind = session.kind;
  const constraints = kind === 'video'
    ? { audio: true, video: { facingMode: session.facingMode || 'user', width: { ideal: 1280 }, height: { ideal: 720 } } }
    : { audio: true, video: false };

  try {
    session.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (kind === 'video') {
      try {
        session.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        session.kind = 'voice';
        session.cameraOff = true;
        toast('Camera unavailable, continuing with voice only');
      } catch {
        toast('Microphone permission is required');
        throw err;
      }
    } else {
      toast('Microphone permission is required');
      throw err;
    }
  }

  let iceServers = ICE_SERVERS;
  try {
    iceServersPromise ||= api.iceServers();
    iceServers = (await iceServersPromise).iceServers || ICE_SERVERS;
  } catch {}

  const pc = new RTCPeerConnection({ iceServers });
  session.pc = pc;
  session.remoteStream = new MediaStream();

  if (session.localStream) {
    session.localStream.getTracks().forEach((t) => pc.addTrack(t, session.localStream));
    if (session.kind === 'video') {
      els.localVideo.srcObject = session.localStream;
      els.localVideo.classList.remove('hidden');
      els.flip?.classList.remove('hidden');
      session.cameraOff = false;
    }
    // Monitor local speaking energy
    setupAudioEnergyMonitoring(session.localStream, (speaking) => {
      if (els.avatar) els.avatar.parentElement?.classList.toggle('speaking', speaking);
    });
  }

  pc.ontrack = (event) => {
    event.streams[0]?.getTracks().forEach((t) => session.remoteStream.addTrack(t));
    if (session.kind === 'video') {
      els.remoteVideo.srcObject = session.remoteStream;
      els.remoteVideo.classList.remove('hidden');
      els.remoteVideo.play?.().catch(() => {});
      if (els.remoteAudio) {
        els.remoteAudio.srcObject = session.remoteStream;
        els.remoteAudio.play?.().catch(() => {});
      }
      applySpeakerOutput().catch(() => {});
    } else {
      els.remoteAudio.srcObject = session.remoteStream;
      els.remoteAudio.play?.().catch(() => {});
      applySpeakerOutput().catch(() => {});
    }

    // Monitor remote speaking energy
    setupAudioEnergyMonitoring(session.remoteStream, (speaking) => {
      if (els.avatar && session.kind !== 'video') {
        els.avatar.parentElement?.classList.toggle('speaking', speaking);
      }
    });
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && session?.targetUserId) {
      signalCall(session.targetUserId, session.call.id, { type: 'ice', candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (!session || session.pc !== pc) return;
    if (pc.connectionState === 'connected') {
      stopAudioTones();
      clearTimeout(ringTimeout);
      session.state = 'connected';
      els.stateText.textContent = 'Connected';
      els.incoming.hidden = true;
      els.controls.hidden = false;
      if (els.camera) els.camera.hidden = session.kind !== 'video';
      startCallTimer();
    } else if (pc.connectionState === 'disconnected' && session) {
      els.stateText.textContent = 'Reconnecting...';
      session.state = 'reconnecting';
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = setTimeout(() => {
        if (session && session.pc === pc && pc.connectionState === 'disconnected') {
          els.stateText.textContent = 'Call ended';
          endCall('ended');
        }
      }, 8000);
    } else if (['failed', 'closed'].includes(pc.connectionState) && session) {
      els.stateText.textContent = 'Call ended';
      endCall('ended');
    }
  };

  const queuedSignals = session.pendingSignals.splice(0);
  for (const signal of queuedSignals) await handle1to1Signal(signal.fromUserId, signal.signal);
  await flush1to1PendingIce();
}

async function onSignal({ callId, signal, fromUserId }) {
  if (!session || session.isGroup || session.call.id !== callId) return;
  if (!session.pc) {
    session.pendingSignals.push({ fromUserId, signal });
    return;
  }
  await handle1to1Signal(fromUserId, signal);
}

async function handle1to1Signal(fromUserId, signal) {
  if (!session?.pc) return;
  const pc = session.pc;
  try {
    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      await flush1to1PendingIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signalCall(fromUserId, session.call.id, { type: 'answer', sdp: session.pc.localDescription });
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      await flush1to1PendingIce();
    } else if (signal.type === 'ice' && signal.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      else session.pendingIce.push(signal.candidate);
    }
  } catch (err) {
    console.error('Signal handling error:', err);
  }
}

async function flush1to1PendingIce() {
  if (!session?.pc?.remoteDescription) return;
  const candidates = session.pendingIce.splice(0);
  for (const candidate of candidates) {
    try { await session.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  }
}

function onCallState({ callId, state: callState }) {
  if (!session || session.isGroup || session.call.id !== callId) return;
  stopAudioTones();
  clearTimeout(ringTimeout);

  if (callState === 'accepted') {
    playConnectChime();
    els.stateText.textContent = 'Connected';
    els.incoming.hidden = true;
    els.controls.hidden = false;
    if (els.camera) els.camera.hidden = session.kind !== 'video';
    session.state = 'connected';
    startCallTimer();
  } else if (callState === 'declined') {
    els.stateText.textContent = 'Declined';
    toast('Call declined');
    playDisconnectChime();
    setTimeout(() => cleanup(), 800);
  } else if (callState === 'busy') {
    els.stateText.textContent = 'Busy';
    toast('Recipient is on another call');
    playDisconnectChime();
    setTimeout(() => cleanup(), 800);
  } else if (['ended', 'missed'].includes(callState)) {
    els.stateText.textContent = callState === 'missed' ? 'Missed call' : 'Call ended';
    playDisconnectChime();
    setTimeout(() => cleanup(), 800);
  }
}

// ----------------------------------------------------
// GROUP CALL SESSION (SFU / Multi-Peer WebRTC)
// ----------------------------------------------------
async function startGroupCallSession(conversation, kind) {
  try {
    const res = await api.startCall(conversation.id, kind);
    const call = res.call;

    session = {
      isGroup: true,
      conversation,
      call,
      kind,
      direction: 'outgoing',
      peers: new Map(), // userId -> { pc, stream, tile, audioEl, videoEl, isSpeaking, monitoring }
      localStream: null,
      muted: false,
      speakerOn: false,
      outputDeviceId: null,
      cameraOff: kind !== 'video',
      facingMode: 'user',
      state: 'connected'
    };

    showCallUi(conversation, { display_name: conversation.name || 'Group Call' }, kind, 'Connecting...', 'outgoing');
    startCallTimer();

    // Start local media
    await setupGroupLocalMedia();

    // Notify backend and join call room
    startGroupCall(conversation.id, call);
    const joinResult = await joinGroupCall({
      conversationId: conversation.id,
      callId: call.id,
      kind,
      mediaState: { muted: session.muted, cameraOff: session.cameraOff }
    });

    els.stateText.textContent = 'Connected';
    renderGroupGrid();

    // Connect with any participants already in room
    const existing = joinResult.participants || [];
    for (const p of existing) {
      if (p.userId !== state.me?.id) {
        initiateGroupPeerConnection(p);
      }
    }
  } catch (err) {
    stopAudioTones();
    toast(err.message || 'Could not start group call');
    cleanup();
  }
}

function onGroupIncoming({ call, fromUserId, conversationId, caller }) {
  if (session) return; // already in a call
  const kind = call.kind || 'video';
  const conv = state.conversations.find((c) => c.id === conversationId);

  playIncomingRingtone();
  if (pref('callNotifications', true)) {
    toast(`Group ${kind} call started in ${conv?.name || 'group'}`);
  }

  session = {
    isGroup: true,
    conversation: conv,
    call,
    kind,
    targetUserId: fromUserId,
    direction: 'incoming',
    peers: new Map(),
    localStream: null,
    muted: false,
    speakerOn: false,
    outputDeviceId: null,
    cameraOff: kind !== 'video',
    facingMode: 'user',
    state: 'ringing'
  };

  showCallUi(conv || { name: 'Group Call' }, caller || { display_name: conv?.name || 'Group Call' }, kind, 'Incoming group call', 'incoming');
}

async function acceptGroupIncoming() {
  if (!session || !session.isGroup) return;
  stopAudioTones();
  try {
    els.incoming.hidden = true;
    els.controls.hidden = false;
    els.stateText.textContent = 'Connecting...';
    session.state = 'connected';
    playConnectChime();
    startCallTimer();

    await setupGroupLocalMedia();

    const joinResult = await joinGroupCall({
      conversationId: session.conversation?.id || session.call.conversation_id,
      callId: session.call.id,
      kind: session.kind,
      mediaState: { muted: session.muted, cameraOff: session.cameraOff }
    });

    els.stateText.textContent = 'Connected';
    renderGroupGrid();

    const existing = joinResult.participants || [];
    for (const p of existing) {
      if (p.userId !== state.me?.id) {
        initiateGroupPeerConnection(p);
      }
    }
  } catch (err) {
    toast('Could not join group call');
    cleanup();
  }
}

async function setupGroupLocalMedia() {
  const kind = session.kind;
  const constraints = kind === 'video'
    ? { audio: true, video: { facingMode: session.facingMode || 'user', width: { ideal: 1280 }, height: { ideal: 720 } } }
    : { audio: true, video: false };

  try {
    session.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (kind === 'video') {
      try {
        session.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        session.kind = 'voice';
        session.cameraOff = true;
        toast('Camera unavailable, joining with voice only');
      } catch {
        toast('Microphone permission is required');
        throw err;
      }
    } else {
      toast('Microphone permission is required');
      throw err;
    }
  }

  if (session.kind === 'video') {
    els.flip?.classList.remove('hidden');
  }

  // Setup local speaking monitor
  setupAudioEnergyMonitoring(session.localStream, (speaking) => {
    const localTile = els.groupGrid?.querySelector(`[data-user="${state.me?.id}"]`);
    if (localTile) localTile.classList.toggle('is-speaking', speaking);
  });
}

async function initiateGroupPeerConnection(remoteParticipant) {
  const remoteUserId = remoteParticipant.userId;
  if (!session || !session.isGroup || session.peers.has(remoteUserId)) return;

  let iceServers = ICE_SERVERS;
  try {
    iceServersPromise ||= api.iceServers();
    iceServers = (await iceServersPromise).iceServers || ICE_SERVERS;
  } catch {}

  const pc = new RTCPeerConnection({ iceServers });
  const remoteStream = new MediaStream();

  const peerData = {
    userId: remoteUserId,
    info: remoteParticipant,
    pc,
    stream: remoteStream,
    isSpeaking: false,
    muted: remoteParticipant.muted,
    cameraOff: remoteParticipant.cameraOff
  };
  session.peers.set(remoteUserId, peerData);

  // Add local tracks
  if (session.localStream) {
    session.localStream.getTracks().forEach((t) => pc.addTrack(t, session.localStream));
  }

  pc.ontrack = (event) => {
    event.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
    updateGroupPeerMedia(remoteUserId);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      signalGroupCall({
        callId: session.call.id,
        targetUserId: remoteUserId,
        signal: { type: 'ice', candidate: event.candidate }
      });
    }
  };

  // Monitor remote speaker energy
  peerData.monitoring = setupAudioEnergyMonitoring(remoteStream, (speaking) => {
    peerData.isSpeaking = speaking;
    const tile = els.groupGrid?.querySelector(`[data-user="${remoteUserId}"]`);
    if (tile) tile.classList.toggle('is-speaking', speaking);
  });

  renderGroupGrid();

  // Create offer to newcomer
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signalGroupCall({
      callId: session.call.id,
      targetUserId: remoteUserId,
      signal: { type: 'offer', sdp: pc.localDescription }
    });
  } catch (err) {
    console.error('Error creating group offer:', err);
  }
}

async function onGroupUserJoined({ callId, user }) {
  if (!session || !session.isGroup || session.call.id !== callId) return;
  if (user.userId === state.me?.id) return;
  toast(`${user.displayName || 'Someone'} joined the call`);
  initiateGroupPeerConnection(user);
}

function onGroupUserLeft({ callId, userId }) {
  if (!session || !session.isGroup || session.call.id !== callId) return;
  const peer = session.peers.get(userId);
  if (peer) {
    if (peer.monitoring) peer.monitoring.cleanup();
    if (peer.pc) {
      try { peer.pc.close(); } catch {}
    }
    session.peers.delete(userId);
    toast(`${peer.info?.displayName || 'A participant'} left the call`);
    renderGroupGrid();
  }
}

async function onGroupSignal({ callId, fromUserId, signal }) {
  if (!session || !session.isGroup || session.call.id !== callId) return;

  let peer = session.peers.get(fromUserId);
  if (!peer) {
    // Received incoming offer from a peer
    let iceServers = ICE_SERVERS;
    try {
      iceServersPromise ||= api.iceServers();
      iceServers = (await iceServersPromise).iceServers || ICE_SERVERS;
    } catch {}

    const pc = new RTCPeerConnection({ iceServers });
    const remoteStream = new MediaStream();
    peer = {
      userId: fromUserId,
      info: { userId: fromUserId, displayName: 'Participant' },
      pc,
      stream: remoteStream,
      isSpeaking: false,
      muted: false,
      cameraOff: session.kind !== 'video'
    };
    session.peers.set(fromUserId, peer);

    if (session.localStream) {
      session.localStream.getTracks().forEach((t) => pc.addTrack(t, session.localStream));
    }

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
      updateGroupPeerMedia(fromUserId);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signalGroupCall({
          callId: session.call.id,
          targetUserId: fromUserId,
          signal: { type: 'ice', candidate: event.candidate }
        });
      }
    };

    peer.monitoring = setupAudioEnergyMonitoring(remoteStream, (speaking) => {
      peer.isSpeaking = speaking;
      const tile = els.groupGrid?.querySelector(`[data-user="${fromUserId}"]`);
      if (tile) tile.classList.toggle('is-speaking', speaking);
    });

    renderGroupGrid();
  }

  const pc = peer.pc;
  try {
    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signalGroupCall({
        callId: session.call.id,
        targetUserId: fromUserId,
        signal: { type: 'answer', sdp: pc.localDescription }
      });
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.type === 'ice' && signal.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    }
  } catch (err) {
    console.error('Group signal error:', err);
  }
}

function onGroupMediaState({ callId, userId, muted, cameraOff }) {
  if (!session || !session.isGroup || session.call.id !== callId) return;
  const peer = session.peers.get(userId);
  if (peer) {
    if (muted !== undefined) peer.muted = muted;
    if (cameraOff !== undefined) peer.cameraOff = cameraOff;
    updateGroupPeerMedia(userId);
  }
}

function onGroupEnded({ callId }) {
  if (!session || !session.isGroup || session.call.id !== callId) return;
  toast('Group call ended');
  playDisconnectChime();
  cleanup();
}

// ----------------------------------------------------
// RESPONSIVE VIDEO GRID RENDERING
// ----------------------------------------------------
function renderGroupGrid() {
  if (!els.groupGrid || !session?.isGroup) return;

  const totalTiles = 1 + session.peers.size; // local + remotes
  els.groupGrid.setAttribute('data-count', String(Math.min(totalTiles, 9)));
  if (els.participantsCount) {
    els.participantsCount.textContent = `${totalTiles} participant${totalTiles > 1 ? 's' : ''}`;
    els.participantsCount.classList.remove('hidden');
  }

  // Preserve existing video elements to avoid re-play hitches
  const existingTiles = new Map();
  els.groupGrid.querySelectorAll('.call-tile').forEach((tile) => {
    existingTiles.set(tile.dataset.user, tile);
  });

  // Local tile
  let localTile = existingTiles.get(state.me?.id);
  if (!localTile) {
    localTile = createParticipantTile(state.me, true);
    els.groupGrid.appendChild(localTile);
  }
  updateTileContent(localTile, state.me, true, session.muted, session.cameraOff, session.localStream);

  // Remote tiles
  for (const [userId, peer] of session.peers.entries()) {
    let tile = existingTiles.get(userId);
    if (!tile) {
      tile = createParticipantTile(peer.info || { id: userId, display_name: 'User' }, false);
      els.groupGrid.appendChild(tile);
    }
    updateTileContent(tile, peer.info, false, peer.muted, peer.cameraOff, peer.stream);
  }

  // Clean up removed peers
  for (const [userId, tile] of existingTiles.entries()) {
    if (userId !== state.me?.id && !session.peers.has(userId)) {
      tile.remove();
    }
  }
}

function createParticipantTile(user, isLocal) {
  const tile = document.createElement('div');
  tile.className = 'call-tile';
  tile.dataset.user = user.id;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  if (isLocal) video.muted = true;
  tile.appendChild(video);

  const audio = document.createElement('audio');
  audio.autoplay = true;
  if (isLocal) audio.muted = true;
  tile.appendChild(audio);

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'call-tile-avatar-wrap';
  tile.appendChild(avatarWrap);

  const meta = document.createElement('div');
  meta.className = 'call-tile-meta';
  meta.innerHTML = `
    <span class="call-tile-name">${escapeHtml(user.display_name || (isLocal ? 'You' : 'User'))}</span>
    <span class="call-tile-mute hidden">${icon('mic-off')}</span>
  `;
  tile.appendChild(meta);

  return tile;
}

function updateTileContent(tile, user, isLocal, muted, cameraOff, stream) {
  const video = tile.querySelector('video');
  const audio = tile.querySelector('audio');
  const avatarWrap = tile.querySelector('.call-tile-avatar-wrap');
  const muteBadge = tile.querySelector('.call-tile-mute');
  const nameBadge = tile.querySelector('.call-tile-name');

  if (nameBadge) {
    nameBadge.textContent = isLocal ? 'You' : (user?.displayName || user?.display_name || 'Participant');
  }

  if (muteBadge) {
    muteBadge.classList.toggle('hidden', !muted);
  }

  const showVideo = !cameraOff && session.kind === 'video' && stream;
  if (video) {
    video.classList.toggle('hidden', !showVideo);
    if (showVideo && video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
  }

  if (audio && !isLocal && stream) {
    if (audio.srcObject !== stream) {
      audio.srcObject = stream;
      audio.play().catch(() => {});
      if (session.outputDeviceId && typeof audio.setSinkId === 'function') {
        audio.setSinkId(session.outputDeviceId).catch(() => {});
      }
    }
  }

  if (avatarWrap) {
    avatarWrap.classList.toggle('hidden', showVideo);
    if (!showVideo && !avatarWrap.querySelector('.avatar')) {
      avatarWrap.innerHTML = avatar(user || { display_name: isLocal ? 'You' : 'User' }, { size: 'lg' });
    }
  }
}

function updateGroupPeerMedia(userId) {
  if (!session?.isGroup) return;
  const peer = session.peers.get(userId);
  if (!peer) return;
  const tile = els.groupGrid?.querySelector(`[data-user="${userId}"]`);
  if (tile) {
    updateTileContent(tile, peer.info, false, peer.muted, peer.cameraOff, peer.stream);
  }
}

// ----------------------------------------------------
// UI CONTROLS & STATE
// ----------------------------------------------------
function showCallUi(conversation, peer, kind, stateText, direction) {
  const peerUser = peer || {};
  els.screen.hidden = false;
  els.miniBar?.classList.add('hidden');

  els.peerName.textContent = peerUser.display_name || conversation?.name || 'Call';
  els.mode.textContent = kind === 'video' ? 'VIDEO' : 'VOICE';
  els.name.textContent = peerUser.display_name || conversation?.name || 'Call';
  els.stateText.textContent = stateText;

  if (els.miniName) els.miniName.textContent = peerUser.display_name || conversation?.name || 'Call';

  if (session?.isGroup) {
    els.center.classList.add('hidden');
    els.remoteVideo.classList.add('hidden');
    els.localVideo.classList.add('hidden');
    els.groupGrid.classList.remove('hidden');
  } else {
    els.groupGrid.classList.add('hidden');
    els.avatar.outerHTML = avatar(peerUser, { size: 'xl', id: 'call-avatar' });
    els.avatar = $('#call-avatar');
    els.remoteVideo.classList.toggle('hidden', kind !== 'video');
    els.localVideo.classList.add('hidden');
    els.center.classList.toggle('hidden', kind === 'video' && direction !== 'incoming');
    if (els.participantsCount) els.participantsCount.classList.add('hidden');
  }

  if (els.camera) {
    els.camera.hidden = kind !== 'video';
    els.camera.classList.remove('off');
    els.camera.innerHTML = icon('video');
  }
  if (els.flip) {
    els.flip.classList.toggle('hidden', kind !== 'video');
  }
  if (els.mute) {
    els.mute.classList.remove('off');
    els.mute.innerHTML = icon('mic');
  }
  if (els.speaker) {
    els.speaker.classList.remove('off');
    els.speaker.setAttribute('aria-pressed', 'false');
    els.speaker.innerHTML = icon('volume-off');
  }

  if (direction === 'incoming') {
    els.incoming.hidden = false;
    els.controls.hidden = true;
  } else {
    els.incoming.hidden = true;
    els.controls.hidden = false;
  }
}

function startCallTimer() {
  clearInterval(callTimer);
  const startedAt = session?.call?.started_at ? new Date(session.call.started_at).getTime() : Date.now();
  callTimer = setInterval(() => {
    if (!session || (session.state !== 'connected' && session.state !== 'ongoing')) return;
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const timeFormatted = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    els.stateText.textContent = `Ongoing · ${timeFormatted}`;
    if (els.miniTime) els.miniTime.textContent = timeFormatted;
  }, 1000);
}

function toggleMute() {
  if (!session?.localStream) return;
  session.muted = !session.muted;
  session.localStream.getAudioTracks().forEach((t) => { t.enabled = !session.muted; });

  els.mute?.classList.toggle('off', session.muted);
  if (els.mute) els.mute.innerHTML = icon(session.muted ? 'mic-off' : 'mic');
  els.miniMute?.classList.toggle('off', session.muted);
  if (els.miniMute) els.miniMute.innerHTML = icon(session.muted ? 'mic-off' : 'mic');

  if (session.isGroup) {
    mediaStateGroupCall({ callId: session.call.id, muted: session.muted, cameraOff: session.cameraOff });
    const localTile = els.groupGrid?.querySelector(`[data-user="${state.me?.id}"]`);
    if (localTile) {
      localTile.querySelector('.call-tile-mute')?.classList.toggle('hidden', !session.muted);
    }
  }
}

function toggleCamera() {
  if (!session?.localStream) return;
  session.cameraOff = !session.cameraOff;
  session.localStream.getVideoTracks().forEach((t) => { t.enabled = !session.cameraOff; });

  els.camera?.classList.toggle('off', session.cameraOff);
  if (els.camera) els.camera.innerHTML = icon(session.cameraOff ? 'video-off' : 'video');
  els.flip?.classList.toggle('hidden', session.cameraOff);

  if (!session.isGroup) {
    els.localVideo?.classList.toggle('hidden', session.cameraOff);
  } else {
    mediaStateGroupCall({ callId: session.call.id, muted: session.muted, cameraOff: session.cameraOff });
    renderGroupGrid();
  }
}

async function flipCamera() {
  if (!session?.localStream) return;
  const currentVideoTrack = session.localStream.getVideoTracks()[0];
  if (!currentVideoTrack) return;

  const currentFacing = session.facingMode || 'user';
  const newFacing = currentFacing === 'user' ? 'environment' : 'user';

  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: newFacing } }
    }).catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: newFacing } }));

    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) return;

    if (session.pc) {
      const senders = session.pc.getSenders();
      const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
      if (videoSender) videoSender.replaceTrack(newVideoTrack);
    }

    if (session.peers) {
      for (const peer of session.peers.values()) {
        const sender = peer.pc?.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(newVideoTrack);
      }
    }

    currentVideoTrack.stop();
    session.localStream.removeTrack(currentVideoTrack);
    session.localStream.addTrack(newVideoTrack);
    session.facingMode = newFacing;

    if (els.localVideo) els.localVideo.srcObject = session.localStream;
    if (session.isGroup) renderGroupGrid();
    toast(`Switched to ${newFacing === 'user' ? 'front' : 'rear'} camera`);
  } catch {
    toast('Camera flip not supported on this device');
  }
}

async function setAudioOutput(element, deviceId) {
  if (element && typeof element.setSinkId === 'function') {
    await element.setSinkId(deviceId);
    return true;
  }
  return false;
}

async function applySpeakerOutput() {
  if (!session) return false;
  const elements = [els.remoteAudio, els.remoteVideo].filter(Boolean);
  if (session.isGroup && els.groupGrid) {
    els.groupGrid.querySelectorAll('audio').forEach((a) => elements.push(a));
  }
  const supported = await Promise.all(
    elements.map((element) => setAudioOutput(element, session.outputDeviceId || 'default'))
  );
  return supported.some(Boolean);
}

async function toggleSpeaker() {
  if (!session) return;
  const next = !session.speakerOn;
  session.speakerOn = next;
  try {
    if (next && !session.outputDeviceId && typeof navigator.mediaDevices?.selectAudioOutput === 'function') {
      const output = await navigator.mediaDevices.selectAudioOutput();
      session.outputDeviceId = output?.deviceId || null;
    }
    if (!next) session.outputDeviceId = null;
    const supported = await applySpeakerOutput();
    els.speaker?.classList.toggle('off', !next);
    els.speaker?.setAttribute('aria-pressed', String(next));
    els.speaker?.setAttribute('aria-label', next ? 'Speaker on' : 'Speaker off');
    if (els.speaker) els.speaker.innerHTML = icon(next ? 'volume' : 'volume-off');
    if (!supported && next) toast('Speaker routing controlled by device/browser');
  } catch {
    session.speakerOn = !next;
    toast('Could not change speaker output');
  }
}

// ----------------------------------------------------
// MINIMIZE / BACKGROUND CALLING
// ----------------------------------------------------
function minimizeCall() {
  if (!session) return;
  els.screen.hidden = true;
  els.miniBar?.classList.remove('hidden');
}

function expandCall() {
  if (!session) return;
  els.miniBar?.classList.add('hidden');
  els.screen.hidden = false;
}

// ----------------------------------------------------
// END OR LEAVE CALL
// ----------------------------------------------------
async function onEndButtonClicked() {
  if (!session) return;

  if (session.isGroup && session.peers.size > 0) {
    const isOwner = session.call?.initiator_id === state.me?.id;
    if (isOwner) {
      confirmSheet({
        title: 'Group Call',
        message: 'Do you want to leave or end the call for everyone?',
        confirmText: 'Leave Call',
        dangerText: 'End Call for Everyone',
        onConfirm: () => leaveCurrentGroupCall(),
        onDanger: () => endCall('ended')
      });
      return;
    } else {
      leaveCurrentGroupCall();
      return;
    }
  }

  endCall('ended');
}

async function leaveCurrentGroupCall() {
  if (!session || !session.isGroup) return;
  const { call, conversation } = session;
  leaveGroupCall({ callId: call.id, conversationId: conversation?.id || call.conversation_id });
  api.leaveCall(call.id).catch(() => {});
  playDisconnectChime();
  cleanup();
  toast('You left the call');
}

async function endCall(finalState) {
  if (!session || session.ending) return;
  session.ending = true;
  stopAudioTones();
  clearTimeout(ringTimeout);
  clearTimeout(session.disconnectTimer);

  const { targetUserId, call, isGroup, conversation } = session;

  if (isGroup) {
    endGroupCall({ callId: call.id, conversationId: conversation?.id || call.conversation_id });
  } else if (targetUserId) {
    try { stateCall(targetUserId, call.id, finalState); } catch {}
  }

  api.updateCall(call.id, finalState).catch(() => {});
  playDisconnectChime();

  if (els.stateText) {
    els.stateText.textContent = finalState === 'declined' ? 'Declined' : 'Call ended';
  }
  setTimeout(() => cleanup(), 500);
}

function cleanup() {
  stopAudioTones();
  clearTimeout(ringTimeout);
  clearInterval(callTimer);
  callTimer = null;

  if (session?.disconnectTimer) clearTimeout(session.disconnectTimer);

  if (session?.pc) {
    try { session.pc.close(); } catch {}
  }

  if (session?.peers) {
    for (const peer of session.peers.values()) {
      if (peer.monitoring) peer.monitoring.cleanup();
      if (peer.pc) {
        try { peer.pc.close(); } catch {}
      }
    }
  }

  if (session?.localStream) {
    session.localStream.getTracks().forEach((t) => t.stop());
  }

  session = null;

  if (els.screen) els.screen.hidden = true;
  if (els.miniBar) els.miniBar.classList.add('hidden');

  if (els.remoteVideo) {
    els.remoteVideo.srcObject = null;
    els.remoteVideo.classList.add('hidden');
  }
  if (els.localVideo) {
    els.localVideo.srcObject = null;
    els.localVideo.classList.add('hidden');
  }
  if (els.remoteAudio) {
    els.remoteAudio.srcObject = null;
  }
  if (els.groupGrid) {
    els.groupGrid.innerHTML = '';
    els.groupGrid.classList.add('hidden');
  }
  if (els.participantsCount) {
    els.participantsCount.classList.add('hidden');
  }

  els.mute?.classList.remove('off');
  els.speaker?.classList.remove('off');
  els.speaker?.setAttribute('aria-pressed', 'false');
  if (els.speaker) els.speaker.innerHTML = icon('volume-off');
  els.camera?.classList.remove('off');
  els.flip?.classList.add('hidden');
  if (els.mute) els.mute.innerHTML = icon('mic');
  if (els.camera) {
    els.camera.innerHTML = icon('video');
    els.camera.hidden = false;
  }
}
