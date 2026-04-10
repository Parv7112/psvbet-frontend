import { useEffect, useRef, useState, useCallback } from "react";
import { flushSync } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import Peer from "peerjs";
import socket from "../socket";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

/** Readable status line (e.g. "1 run" vs "1 runs") */
function formatCricketStatusText(text) {
  if (text == null) return text;
  return String(text).replace(/\b(\d+)\s+runs\b/gi, (_, n) => {
    const num = Number(n);
    return `${n} ${num === 1 ? "run" : "runs"}`;
  });
}

function teamAcronymFromFullName(fullName) {
  const words = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return words.map((w) => w[0]).join("").toLowerCase();
  }
  return "";
}

function teamNameMatchesShortGuess(guess, fullName) {
  const g = String(guess || "")
    .trim()
    .toLowerCase();
  const f = String(fullName || "")
    .trim()
    .toLowerCase();
  if (!g || !f) return false;
  if (f.includes(g) || g.includes(f)) return true;
  const acronym = teamAcronymFromFullName(fullName);
  const gAlnum = g.replace(/[^a-z0-9]/g, "");
  if (acronym && gAlnum === acronym) return true;
  if (gAlnum.length <= 4 && acronym.startsWith(gAlnum)) return true;
  const first = f.split(/\s+/)[0] || "";
  if (g.length >= 3 && first.startsWith(g)) return true;
  return false;
}

/** Team currently batting in a chase — status often uses abbreviations (e.g. "LSG need 1 run"). */
function battingTeamFromChaseStatus(statusInfo, homeTeam, awayTeam) {
  const s = String(statusInfo || "").trim();
  let m = s.match(/^(.+?)\s+need\s+\d+\s+runs?\b/im);
  if (!m) m = s.match(/^(.+?)\s+require(?:s)?\s+\d+\s+runs?\b/im);
  if (!m) m = s.match(/^(.+?)\s+need\s+\d+\s+more\s+runs?\b/im);
  if (!m) return null;
  const guess = m[1].trim();
  if (teamNameMatchesShortGuess(guess, homeTeam)) return homeTeam;
  if (teamNameMatchesShortGuess(guess, awayTeam)) return awayTeam;
  return null;
}

/** Finished match — "LSG won by 3 wickets", "Lucknow Super Giants won by …" */
function winningTeamFromResultStatus(statusInfo, homeTeam, awayTeam) {
  const s = String(statusInfo || "").trim();
  if (!s) return null;
  const patterns = [/^(.+?)\s+won\s+by\b/i, /^(.+?)\s+won\b/i, /\b(.+?)\s+won\s+by\b/i];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    let guess = m[1].trim();
    guess = guess.replace(/\s*\([^)]*\)\s*$/, "").trim();
    guess = guess.replace(/^(result|score)\s*:\s*/i, "").trim();
    if (teamNameMatchesShortGuess(guess, homeTeam)) return homeTeam;
    if (teamNameMatchesShortGuess(guess, awayTeam)) return awayTeam;
  }
  return null;
}

/** Ball-by-ball: stable chronological order */
function getSortedCommentBalls(comments) {
  if (!comments || typeof comments !== "object") return [];
  const keys = Object.keys(comments).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  });
  const balls = [];
  for (const k of keys) {
    const chunk = comments[k];
    if (Array.isArray(chunk)) balls.push(...chunk);
  }
  balls.sort((a, b) => {
    const oa = parseFloat(String(a?.overs ?? "").replace(/[^\d.]/g, "")) || 0;
    const ob = parseFloat(String(b?.overs ?? "").replace(/[^\d.]/g, "")) || 0;
    if (oa !== ob) return oa - ob;
    return 0;
  });
  return balls;
}

/** Integer before decimal in over notation (19.4 and 19.5 share same "over" group in many feeds). */
function getOverIntegerKey(overs) {
  if (overs == null || overs === "") return null;
  const s = String(overs).trim();
  const dot = s.indexOf(".");
  const head = dot === -1 ? s : s.slice(0, dot);
  const n = parseInt(head, 10);
  return Number.isNaN(n) ? null : n;
}

function getBallsInCurrentOver(sortedBalls) {
  if (!sortedBalls.length) return [];
  const latest = sortedBalls[sortedBalls.length - 1];
  const key = getOverIntegerKey(latest.overs);
  if (key === null) return sortedBalls.slice(-6);
  const out = [];
  for (let i = sortedBalls.length - 1; i >= 0; i--) {
    if (getOverIntegerKey(sortedBalls[i].overs) !== key) break;
    out.push(sortedBalls[i]);
  }
  out.reverse();
  return out.length ? out : sortedBalls.slice(-6);
}

function cleanupClientMeetingCapture(c) {
  try {
    if (c.raf) cancelAnimationFrame(c.raf);
  } catch {
    /* ignore */
  }
  c.raf = null;
  c.canvas = null;
  c.ctx = null;
  if (c.audioSources) {
    for (const source of c.audioSources.values()) {
      try {
        source.disconnect();
      } catch {
        /* ignore */
      }
    }
    c.audioSources.clear();
  }
  if (c.videoEls) c.videoEls.clear();
  try {
    c.audioCtx?.close();
  } catch {
    /* ignore */
  }
  c.audioCtx = null;
  c.dest = null;
  c.mixedStream = null;
}

export default function Meeting() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  /** peerId -> whether their camera is on (from socket; WebRTC track mute is unreliable for “camera off”). */
  const [remoteCameraOnByPeer, setRemoteCameraOnByPeer] = useState({});
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [meetingInfo, setMeetingInfo] = useState(null);
  const [showCopied, setShowCopied] = useState(false);
  const [userName, setUserName] = useState("");
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [tempName, setTempName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientPassword, setClientPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [userId, setUserId] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [privateCallActive, setPrivateCallActive] = useState(null); // peerId of private call
  const [showPrivateMenu, setShowPrivateMenu] = useState(null); // peerId to show menu for
  const [matchData, setMatchData] = useState(null);
  const [liveScore, setLiveScore] = useState(null);
  const [loadingScore, setLoadingScore] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [teamAOdds, setTeamAOdds] = useState("");
  const [teamBOdds, setTeamBOdds] = useState("");
  const [sharedOdds, setSharedOdds] = useState(null);
  const [oddsShared, setOddsShared] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [recordings, setRecordings] = useState([]);
  const [showRecordings, setShowRecordings] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  const [peerConnected, setPeerConnected] = useState(false);
  const [webrtcIssue, setWebrtcIssue] = useState("");
  const [clientRecordingError, setClientRecordingError] = useState("");
  const [clientMicCaptureActive, setClientMicCaptureActive] = useState(false);

  const remoteStreamsRef = useRef({});
  remoteStreamsRef.current = remoteStreams;
  
  const localVideoRef = useRef();
  const peerInstance = useRef(null);
  // peerId -> PeerJS MediaConnection (so we can access RTCPeerConnection/sendors)
  const activeCalls = useRef(new Map());
  const isInitialized = useRef(false);
  const audioContext = useRef(null);
  const localAnalyser = useRef(null);
  const privateAudioStream = useRef(null);
  const silentAudioTracks = useRef(new Map()); // peerId -> MediaStreamTrack (disabled clone)
  const hasJoinedMeeting = useRef(false);
  const isHostRef = useRef(false);
  const recordingRef = useRef({
    recorder: null,
    chunks: [],
    audioRecorder: null,
    audioChunks: [],
    audioStopPromise: null,
    resolveAudioStop: null,
    canvas: null,
    ctx: null,
    raf: null,
    audioCtx: null,
    dest: null,
    videoEls: new Map(),
    audioSources: new Map(),
    mixedStream: null
  });
  const clientMicRecorderRef = useRef({
    recorder: null,
    chunks: [],
    segmentStartedAt: null,
    canvas: null,
    ctx: null,
    raf: null,
    audioCtx: null,
    dest: null,
    videoEls: new Map(),
    audioSources: new Map(),
    mixedStream: null
  });
  const stopClientMicResolverRef = useRef(null);

  const getClientJwt = useCallback(() => {
    let token = null;
    try {
      const raw = sessionStorage.getItem("clientAuth");
      if (raw) {
        const p = JSON.parse(raw);
        if (p.token) token = p.token;
      }
    } catch {
      /* ignore */
    }
    if (!token) token = localStorage.getItem("clientToken");
    if (token) {
      try {
        const raw = sessionStorage.getItem("clientAuth");
        if (raw) {
          const p = JSON.parse(raw);
          if (!p.token) {
            sessionStorage.setItem("clientAuth", JSON.stringify({ ...p, token }));
          }
        }
      } catch {
        /* ignore */
      }
    }
    return token;
  }, []);

  const stopClientMicRecordingAndUpload = useCallback(() => {
    return new Promise((resolve) => {
      const c = clientMicRecorderRef.current;
      if (!c.recorder) {
        resolve();
        return;
      }
      stopClientMicResolverRef.current = resolve;
      try {
        if (c.raf) cancelAnimationFrame(c.raf);
      } catch {
        /* ignore */
      }
      c.raf = null;
      try {
        if (c.recorder.state === "recording") {
          c.recorder.requestData();
        }
      } catch {
        /* ignore */
      }
      try {
        c.recorder.stop();
      } catch {
        stopClientMicResolverRef.current = null;
        setClientMicCaptureActive(false);
        cleanupClientMeetingCapture(c);
        resolve();
      }
    });
  }, []);

  const startClientCaptureSegment = useCallback(async () => {
    setClientRecordingError("");
    const c = clientMicRecorderRef.current;
    if (c.recorder || !localStream) return false;
    if (!window.MediaRecorder) {
      setClientRecordingError("Recording is not supported in this browser.");
      return false;
    }
    const jwt = getClientJwt();
    if (!jwt) {
      setClientRecordingError(
        "Sign in with your Client ID and password on this page (or client portal) so recordings can upload."
      );
      return false;
    }

    const audioTrack = localStream.getAudioTracks?.()?.[0];
    if (!audioTrack || !audioTrack.enabled) return false;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      c.audioCtx = new AudioContext();
      c.dest = c.audioCtx.createMediaStreamDestination();
      try {
        await c.audioCtx.resume();
      } catch {
        /* ignore */
      }

      ensureClientCaptureAudio("local", localStream);
      const remotes = remoteStreamsRef.current;
      for (const [peerId, data] of Object.entries(remotes)) {
        ensureClientCaptureAudio(peerId, data?.stream);
        await ensureClientCaptureVideoEl(peerId, data?.stream);
      }
      await ensureClientCaptureVideoEl("local", localStream);

      c.canvas = document.createElement("canvas");
      c.canvas.width = 1280;
      c.canvas.height = 720;
      c.ctx = c.canvas.getContext("2d");

      const canvasStream = c.canvas.captureStream(30);
      const mixed = new MediaStream();
      canvasStream.getVideoTracks().forEach((t) => mixed.addTrack(t));
      c.dest.stream.getAudioTracks().forEach((t) => mixed.addTrack(t));
      c.mixedStream = mixed;

      const mimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm"
      ];
      const mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t));
      c.chunks = [];
      c.segmentStartedAt = new Date().toISOString();
      c.recorder = new MediaRecorder(mixed, mimeType ? { mimeType } : undefined);
    } catch {
      c.segmentStartedAt = null;
      c.recorder = null;
      cleanupClientMeetingCapture(c);
      setClientRecordingError("Could not start meeting view recorder.");
      return false;
    }

    const jwtForUpload = jwt;
    c.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) c.chunks.push(e.data);
    };
    c.recorder.onerror = () => {
      setClientRecordingError("Recording failed.");
      c.recorder = null;
      c.chunks = [];
      c.segmentStartedAt = null;
      setClientMicCaptureActive(false);
      try {
        if (c.raf) cancelAnimationFrame(c.raf);
      } catch {
        /* ignore */
      }
      c.raf = null;
      cleanupClientMeetingCapture(c);
      try {
        stopClientMicResolverRef.current?.();
      } catch {
        /* ignore */
      }
      stopClientMicResolverRef.current = null;
    };
    c.recorder.onstop = async () => {
      const mime = c.recorder?.mimeType || "video/webm";
      const blob = new Blob(c.chunks, { type: mime });
      const segStart = c.segmentStartedAt;
      c.chunks = [];
      c.recorder = null;
      c.segmentStartedAt = null;
      try {
        if (c.raf) cancelAnimationFrame(c.raf);
      } catch {
        /* ignore */
      }
      c.raf = null;
      cleanupClientMeetingCapture(c);
      setClientMicCaptureActive(false);
      try {
        stopClientMicResolverRef.current?.();
      } catch {
        /* ignore */
      }
      stopClientMicResolverRef.current = null;
      if (!jwtForUpload) {
        setClientRecordingError("Session expired. Sign in again to save recordings.");
        return;
      }
      if (!blob.size) {
        setClientRecordingError("Recording was empty. Stay unmuted a little longer.");
        return;
      }
      try {
        const form = new FormData();
        form.append("recording", blob, `client-meeting-${roomId}-${Date.now()}.webm`);
        if (segStart) form.append("segmentStartedAt", segStart);
        const response = await fetch(`${API_BASE_URL}/api/meeting/${roomId}/client-recordings`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwtForUpload}` },
          body: form
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setClientRecordingError(data.message || "Could not save your recording.");
        }
      } catch {
        setClientRecordingError("Could not save your recording.");
      }
    };

    const draw = () => {
      if (!c.ctx || !c.canvas) return;
      const ctx = c.ctx;
      const W = c.canvas.width;
      const H = c.canvas.height;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);

      const tiles = [];
      if (localVideoRef.current) {
        tiles.push({ label: `${userName || "You"}`, el: localVideoRef.current });
      }
      for (const [peerId, data] of Object.entries(remoteStreamsRef.current)) {
        const el = c.videoEls.get(peerId);
        if (el) tiles.push({ label: data?.userName || "Participant", el });
      }

      const n = Math.max(1, tiles.length);
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const pad = 8;
      const tileW = Math.floor((W - pad * (cols + 1)) / cols);
      const tileH = Math.floor((H - pad * (rows + 1)) / rows);

      tiles.forEach((t, idx) => {
        const r = Math.floor(idx / cols);
        const col = idx % cols;
        const x = pad + col * (tileW + pad);
        const y = pad + r * (tileH + pad);
        try {
          ctx.drawImage(t.el, x, y, tileW, tileH);
        } catch {
          /* ignore draw until frames ready */
        }
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(x, y + tileH - 26, tileW, 26);
        ctx.fillStyle = "#fff";
        ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.fillText(t.label, x + 10, y + tileH - 8);
      });

      c.raf = requestAnimationFrame(draw);
    };

    draw();
    try {
      c.recorder.start(1000);
      setClientMicCaptureActive(true);
      return true;
    } catch {
      c.recorder = null;
      c.segmentStartedAt = null;
      setClientMicCaptureActive(false);
      try {
        if (c.raf) cancelAnimationFrame(c.raf);
      } catch {
        /* ignore */
      }
      c.raf = null;
      cleanupClientMeetingCapture(c);
      setClientRecordingError("Could not start recording.");
      return false;
    }
  }, [localStream, roomId, getClientJwt, userName, stopClientMicRecordingAndUpload]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    fetchMeetingInfo();
    checkUserAuth();

    // Set up odds-update listener early
    socket.on("odds-update", (data) => {
      console.log('📊 [Component Level] Odds update received:', data);
      setSharedOdds(data);
    });

    return () => {
      console.log("Cleaning up...");
      isInitialized.current = false;
      hasJoinedMeeting.current = false;
      activeCalls.current.clear();
      // stop any per-peer silent tracks we created
      for (const track of silentAudioTracks.current.values()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      silentAudioTracks.current.clear();
      
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (peerInstance.current) {
        peerInstance.current.destroy();
        peerInstance.current = null;
      }
      if (audioContext.current) {
        audioContext.current.close();
        audioContext.current = null;
      }
      if (privateAudioStream.current) {
        privateAudioStream.current.getTracks().forEach(track => track.stop());
      }
      
      // Clear remote streams
      setRemoteStreams({});
      setRemoteCameraOnByPeer({});
      
      socket.emit("leave-meeting", { roomId });
      socket.off("user-joined");
      socket.off("user-left");
      socket.off("meeting-video-state");
      socket.off("private-call-request");
      socket.off("private-call-ended");
      socket.off("odds-update");
    };
  }, [roomId]);

  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  const getAuthToken = () => localStorage.getItem("token");

  const fetchRecordings = useCallback(async () => {
    try {
      const token = getAuthToken();
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/meeting/${roomId}/recordings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) return;
      const data = await response.json();
      setRecordings(data.recordings || []);
    } catch {
      // ignore
    }
  }, [roomId]);

  const unlockAudio = async () => {
    try {
      // Best-effort: attempt to play all media elements after user gesture
      const els = Array.from(document.querySelectorAll("video,audio"));
      await Promise.allSettled(els.map(el => el.play?.()));
    } catch {
      // ignore
    } finally {
      setAudioUnlocked(true);
      setAudioPlaybackBlocked(false);
    }
  };

  useEffect(() => {
    if (isHost) {
      fetchRecordings();
    }
  }, [isHost, fetchRecordings]);

  const setupAudioDetection = (stream, setSpeakingState) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioContext.current = ctx;
      
      const audioSource = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.85;
      
      audioSource.connect(analyser);
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const detectSound = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;
        
        // Threshold for speaking detection
        setSpeakingState(average > 20);
        
        requestAnimationFrame(detectSound);
      };
      
      detectSound();
    } catch (error) {
      console.error('Audio detection setup failed:', error);
    }
  };

  const getPeerConnectionFromCall = (call) => {
    if (!call) return null;
    return (
      call.peerConnection ||
      call._pc ||
      call?.connection?.peerConnection ||
      call?._negotiator?._pc ||
      call?._negotiator?.peerConnection ||
      null
    );
  };

  const getAudioSenderFromCall = (call) => {
    const pc = getPeerConnectionFromCall(call);
    if (!pc || !pc.getSenders) return null;
    const senders = pc.getSenders() || [];
    return senders.find((s) => s?.track?.kind === "audio") || null;
  };

  const getSilentTrackForPeer = (peerId) => {
    const existing = silentAudioTracks.current.get(peerId);
    if (existing) return existing;
    const mic = localStream?.getAudioTracks?.()[0];
    if (!mic || !mic.clone) return null;
    const silent = mic.clone();
    silent.enabled = false;
    silentAudioTracks.current.set(peerId, silent);
    return silent;
  };

  const applyPrivateOutgoingAudioRouting = useCallback(
    async (targetPeerId) => {
      // Only the host has connections to multiple participants in this app.
      if (!localStream) return;
      const mic = localStream.getAudioTracks?.()[0] || null;

      for (const [peerId, call] of activeCalls.current.entries()) {
        const sender = getAudioSenderFromCall(call);
        if (!sender || !sender.replaceTrack) continue;

        const shouldSendMic = !targetPeerId || peerId === targetPeerId;
        // Avoid replaceTrack(null) (can break audio on some browsers/PeerJS combos).
        // Instead, swap in a disabled "silent" track for non-selected peers.
        const silent = shouldSendMic ? null : getSilentTrackForPeer(peerId);
        const desiredTrack = shouldSendMic ? mic : silent;

        try {
          await sender.replaceTrack(desiredTrack);
        } catch {
          // Best-effort retry: if mic failed, try again; if silent missing, do nothing.
          try {
            if (shouldSendMic && mic) await sender.replaceTrack(mic);
            if (!shouldSendMic && silent) await sender.replaceTrack(silent);
          } catch {
            // ignore
          }
        }
      }
    },
    [localStream]
  );

  const startPrivateCall = async (targetPeerId, targetUserName) => {
    if (!isHost) return;
    
    console.log('Starting private call with:', targetUserName);
    setPrivateCallActive(targetPeerId);
    setShowPrivateMenu(null);
    
    // Notify the participant
    socket.emit("start-private-call", { 
      roomId, 
      targetPeerId,
      fromPeerId: peerInstance.current.id,
      fromUserName: userName
    });
  };

  const endPrivateCall = () => {
    console.log('Ending private call');
    setPrivateCallActive(null);
    
    socket.emit("end-private-call", { 
      roomId,
      targetPeerId: privateCallActive
    });
  };

  useEffect(() => {
    // When private mode toggles, adjust which peers receive our mic audio.
    // (If not host, this is effectively a no-op in current room topology.)
    applyPrivateOutgoingAudioRouting(privateCallActive);
  }, [privateCallActive, applyPrivateOutgoingAudioRouting]);

  const checkUserAuth = async () => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    const storedClient = sessionStorage.getItem("clientAuth");
    
    // Check if user is the host
    let userIsHost = false;
    let uid = null;
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/meeting/${roomId}`);
      const meetingData = await response.json();
      
      console.log('Meeting data:', meetingData);
      console.log('Current user:', user);
      
      // Use 'id' field from localStorage (not '_id')
      if (user.id) {
        uid = user.id;
        // Compare as strings since MongoDB ObjectId comes as string in JSON
        if (meetingData.hostId === user.id || meetingData.hostId.toString() === user.id.toString()) {
          userIsHost = true;
          isHostRef.current = true;
          setIsHost(true);
          setUserId(user.id);
          console.log('User is HOST');
        } else {
          isHostRef.current = false;
          console.log('User is PARTICIPANT');
        }
      }
    } catch (error) {
      console.error("Failed to check host status:", error);
    }
    
    if (user.name) {
      setUserName(user.name);
      if (!user.id) isHostRef.current = false;
      initializeMedia(user.name, uid, userIsHost);
    } else if (storedClient) {
      isHostRef.current = false;
      const clientData = JSON.parse(storedClient);
      setUserName(clientData.name);
      initializeMedia(clientData.name, null, false);
    } else {
      setShowNamePrompt(true);
    }
  };

  const handleClientLogin = async () => {
    setAuthError("");
    
    if (!clientId.trim() || !clientPassword.trim()) {
      setAuthError("Please enter both Client ID and Password");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/client/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ clientId, password: clientPassword })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        sessionStorage.setItem(
          "clientAuth",
          JSON.stringify({ ...data.client, token: data.token })
        );
        setUserName(data.client.name);
        setShowNamePrompt(false);
        isHostRef.current = false;
        initializeMedia(data.client.name, null, false);
      } else {
        setAuthError(data.message || "Invalid credentials");
      }
    } catch (error) {
      setAuthError("Failed to verify credentials");
    }
  };

  const fetchMeetingInfo = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/meeting/${roomId}`);
      const data = await response.json();
      setMeetingInfo(data);
      
      // If meeting has a selected match, fetch its live score
      if (data.selectedMatch && data.selectedMatch.matchId) {
        setMatchData(data.selectedMatch);
        fetchLiveScore(data.selectedMatch.matchId);
      }
    } catch (error) {
      console.error("Failed to fetch meeting info");
    }
  };

  const isMatchEnded = (score) => {
    const status = String(score?.event_status || "").toLowerCase();
    return status === "finished";
  };

  const getBattingTeamName = (score) => {
    if (!score) return null;
    if (isMatchEnded(score)) return null;
    const homeTeam = score.event_home_team;
    const awayTeam = score.event_away_team;
    const homeScore = String(score.event_home_final_result || "").trim();
    const awayScore = String(score.event_away_final_result || "").trim();
    const infoRaw = String(score.event_status_info || "");

    // First innings: one side has a score, the other is still empty.
    if (homeScore && !awayScore) return homeTeam || null;
    if (awayScore && !homeScore) return awayTeam || null;

    // Second innings: status almost always names the chasing side ("LSG need 2 runs").
    const chaseBat = battingTeamFromChaseStatus(infoRaw, homeTeam, awayTeam);
    if (chaseBat) return chaseBat;

    // Full team names sometimes appear in status
    const info = infoRaw.toLowerCase();
    if (homeTeam && info.includes(String(homeTeam).toLowerCase())) return homeTeam;
    if (awayTeam && info.includes(String(awayTeam).toLowerCase())) return awayTeam;

    // Last resort: avoid always defaulting to home when both innings have totals
    if (homeScore && awayScore) {
      const g = teamAcronymFromFullName(homeTeam);
      const a = teamAcronymFromFullName(awayTeam);
      if (g && info.includes(g)) return homeTeam;
      if (a && info.includes(a)) return awayTeam;
    }

    return homeTeam || awayTeam || null;
  };

  const getBattingScore = (score) => {
    if (!score) return "0/0";
    const homeTeam = score.event_home_team;
    const awayTeam = score.event_away_team;
    const homeScore = String(score.event_home_final_result || "").trim();
    const awayScore = String(score.event_away_final_result || "").trim();

    if (isMatchEnded(score)) {
      const winner = winningTeamFromResultStatus(
        score.event_status_info,
        homeTeam,
        awayTeam
      );
      if (winner === homeTeam) return homeScore || awayScore || "0/0";
      if (winner === awayTeam) return awayScore || homeScore || "0/0";
      if (homeScore && awayScore) return awayScore;
      return awayScore || homeScore || "0/0";
    }

    const battingTeam = getBattingTeamName(score);
    if (battingTeam && battingTeam === homeTeam) return homeScore || awayScore || "0/0";
    if (battingTeam && battingTeam === awayTeam) return awayScore || homeScore || "0/0";
    return homeScore || awayScore || "0/0";
  };

  const getHeadlineTeamLabel = (score) => {
    if (!score) return null;
    if (isMatchEnded(score)) {
      return winningTeamFromResultStatus(
        score.event_status_info,
        score.event_home_team,
        score.event_away_team
      );
    }
    return getBattingTeamName(score);
  };

  const fetchLiveScore = async (matchId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/cricket/match/${matchId}`);
      const data = await response.json();
      
      if (data.success && data.result && data.result.length > 0) {
        const score = data.result[0];
        // Use flushSync for immediate UI update
        flushSync(() => {
          setLiveScore(score);
        });
        return isMatchEnded(score);
      }
    } catch (error) {
      console.error("Failed to fetch live score:", error);
    }
    return false;
  };

  useEffect(() => {
    if (!matchData?.matchId) return;

    let interval = null;

    const tick = async () => {
      const ended = await fetchLiveScore(matchData.matchId);
      if (ended && interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    tick();

    interval = setInterval(tick, 1000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [matchData?.matchId]);

  const initializeMedia = async (name, uid, userIsHost) => {
    // Prevent double initialization (React Strict Mode)
    if (isInitialized.current) {
      console.log('Already initialized, skipping...');
      return;
    }

    isHostRef.current = userIsHost;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      
      isInitialized.current = true; // Set after getting stream

      const mic = stream.getAudioTracks?.()?.[0];
      if (mic) mic.enabled = false;
      const cam = stream.getVideoTracks?.()?.[0];
      if (cam) cam.enabled = false;
      setIsMuted(true);
      setIsVideoOff(true);

      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Set up audio level detection for local stream
      setupAudioDetection(stream, setIsSpeaking);

      // Initialize PeerJS
      const apiUrl = new URL(API_BASE_URL);
      const isSecure = apiUrl.protocol === 'https:';
      const peerHost = apiUrl.hostname;
      const peerPort = apiUrl.port || (isSecure ? 443 : 80);

      // Fetch ICE servers from backend (enables TURN in production)
      let iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ];
      try {
        const iceRes = await fetch(`${API_BASE_URL}/api/ice`);
        if (iceRes.ok) {
          const iceData = await iceRes.json();
          if (Array.isArray(iceData.iceServers) && iceData.iceServers.length) {
            iceServers = iceData.iceServers;
          }
        }
      } catch {
        // ignore, fallback to default STUN
      }
      
      const peer = new Peer(undefined, {
        host: peerHost,
        port: peerPort,
        path: '/peerjs',
        secure: isSecure,
        config: {
          iceServers
        }
      });

      peerInstance.current = peer;

      peer.on('open', (id) => {
        console.log('My peer ID is:', id, 'isHost:', userIsHost);
        setPeerConnected(true);
        
        // Prevent duplicate join-meeting events
        if (hasJoinedMeeting.current) {
          console.log('Already joined meeting, skipping duplicate join');
          return;
        }
        
        hasJoinedMeeting.current = true;
        
        // Clear any existing active calls
        activeCalls.current.clear();
        
        socket.emit("join-meeting", { 
          roomId, 
          userName: name, 
          peerId: id,
          userId: uid 
        });

        window.setTimeout(() => {
          const v = stream.getVideoTracks?.()?.[0];
          socket.emit("meeting-video-state", {
            roomId,
            peerId: id,
            cameraOn: !!(v && v.enabled)
          });
        }, 500);
      });

      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        setPeerConnected(false);
        setWebrtcIssue(err?.message || err?.type || "PeerJS error");
        if (err.type === 'unavailable-id') {
          // Peer ID already taken, destroy and retry
          peer.destroy();
          isInitialized.current = false;
        } else if (err.type === 'peer-unavailable') {
          // Peer doesn't exist anymore, remove from active calls
          const peerId = err.message.match(/peer (.+)/)?.[1];
          if (peerId) {
            console.log('Peer unavailable, removing:', peerId);
            activeCalls.current.delete(peerId);
            setRemoteStreams(prev => {
              const updated = { ...prev };
              delete updated[peerId];
              return updated;
            });
          }
        }
      });

      // Answer incoming calls
      peer.on('call', (call) => {
        console.log('Receiving call from:', call.peer, 'metadata:', call.metadata);
        // Track this call so we can route audio per-peer (private mode)
        activeCalls.current.set(call.peer, call);
        call.on('error', (err) => {
          setWebrtcIssue(err?.message || "Call error");
        });
        call.on('close', () => {
          // keep last issue, but don't spam
          activeCalls.current.delete(call.peer);
        });
        call.on('iceStateChanged', () => {});
        call.answer(stream, { metadata: { userName: name, isHost: userIsHost } });
        
        call.on('stream', (remoteStream) => {
          console.log('Received remote stream from:', call.peer);
          const metadata = call.metadata || {};
          setRemoteStreams(prev => ({
            ...prev,
            [call.peer]: { 
              stream: remoteStream, 
              userName: metadata.userName || 'Participant', 
              isHost: metadata.isHost || false 
            }
          }));
        });

        // Apply current private routing to newly established call
        if (privateCallActive) {
          applyPrivateOutgoingAudioRouting(privateCallActive);
        }
      });

      // Remove old listeners before adding new ones
      socket.off("user-joined");
      socket.off("user-left");
      socket.off("meeting-video-state");

      socket.on("meeting-video-state", ({ peerId: pid, cameraOn }) => {
        if (!pid || typeof cameraOn !== "boolean") return;
        setRemoteCameraOnByPeer((prev) => ({ ...prev, [pid]: cameraOn }));
      });

      // Listen for new users
      socket.on("user-joined", (data) => {
        console.log('User joined:', data);
        const { peerId, userName: remoteUserName, isHost: remoteIsHost } = data;
        
        // Prevent duplicate calls to the same peer
        if (activeCalls.current.has(peerId)) {
          console.log('Already have active call with:', peerId);
          return;
        }
        
        // Call the new user with metadata
        const call = peer.call(peerId, stream, { 
          metadata: { userName: name, isHost: userIsHost } 
        });
        
        if (!call) {
          console.error('Failed to create call to:', peerId);
          return;
        }

        activeCalls.current.set(peerId, call);
        
        call.on('stream', (remoteStream) => {
          console.log('Received stream from:', peerId, remoteIsHost ? '(HOST)' : '(PARTICIPANT)');
          setRemoteStreams(prev => ({
            ...prev,
            [peerId]: { stream: remoteStream, userName: remoteUserName, isHost: remoteIsHost }
          }));
        });
        
        call.on('error', (err) => {
          console.error('Call error with peer:', peerId, err);
          setWebrtcIssue(err?.message || "Call error");
          activeCalls.current.delete(peerId);
          setRemoteStreams(prev => {
            const updated = { ...prev };
            delete updated[peerId];
            return updated;
          });
        });
        
        call.on('close', () => {
          console.log('Call closed with:', peerId);
          activeCalls.current.delete(peerId);
        });

        // Apply current private routing to newly established outgoing call
        if (privateCallActive) {
          applyPrivateOutgoingAudioRouting(privateCallActive);
        }

        window.setTimeout(() => {
          const pid = peerInstance.current?.id;
          if (!pid || !stream) return;
          const v = stream.getVideoTracks?.()?.[0];
          socket.emit("meeting-video-state", {
            roomId,
            peerId: pid,
            cameraOn: !!(v && v.enabled)
          });
        }, 300);
      });

      socket.on("user-left", (peerId) => {
        console.log("User left:", peerId);
        activeCalls.current.delete(peerId);
        setRemoteStreams(prev => {
          const updated = { ...prev };
          delete updated[peerId];
          return updated;
        });
        setRemoteCameraOnByPeer((prev) => {
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
        
        // End private call if active with this user
        if (privateCallActive === peerId) {
          endPrivateCall();
        }
      });

      // Listen for private call requests
      socket.on("private-call-request", (data) => {
        const { fromPeerId, fromUserName } = data;
        console.log('Private call request from:', fromUserName);
        setPrivateCallActive(fromPeerId);
      });

      socket.on("private-call-ended", () => {
        console.log('Private call ended');
        setPrivateCallActive(null);
      });

    } catch (error) {
      console.error("Failed to get media:", error);
      alert("Please allow camera and microphone access");
      isInitialized.current = false; // Reset on error
      setWebrtcIssue(error?.message || "getUserMedia failed");
    }
  };

  const ensureRecordingVideoEl = async (key, stream) => {
    if (!stream) return null;
    const rec = recordingRef.current;
    if (rec.videoEls.has(key)) return rec.videoEls.get(key);

    const el = document.createElement("video");
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    el.srcObject = stream;
    try {
      await el.play();
    } catch {
      // Some browsers block autoplay; drawing will still work once it starts
    }
    rec.videoEls.set(key, el);
    return el;
  };

  const ensureRecordingAudioSource = (key, stream) => {
    const rec = recordingRef.current;
    if (!rec.audioCtx || !rec.dest || !stream) return;
    if (rec.audioSources.has(key)) return;

    const hasAudio = stream.getAudioTracks && stream.getAudioTracks().length > 0;
    if (!hasAudio) return;

    try {
      const source = rec.audioCtx.createMediaStreamSource(stream);
      source.connect(rec.dest);
      rec.audioSources.set(key, source);
    } catch {
      // ignore
    }
  };

  const ensureClientCaptureVideoEl = async (key, stream) => {
    if (!stream) return null;
    const rec = clientMicRecorderRef.current;
    if (rec.videoEls.has(key)) return rec.videoEls.get(key);

    const el = document.createElement("video");
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    el.srcObject = stream;
    try {
      await el.play();
    } catch {
      /* ignore */
    }
    rec.videoEls.set(key, el);
    return el;
  };

  const ensureClientCaptureAudio = (key, stream) => {
    const rec = clientMicRecorderRef.current;
    if (!rec.audioCtx || !rec.dest || !stream) return;
    if (rec.audioSources.has(key)) return;

    const hasAudio = stream.getAudioTracks && stream.getAudioTracks().length > 0;
    if (!hasAudio) return;

    try {
      const source = rec.audioCtx.createMediaStreamSource(stream);
      source.connect(rec.dest);
      rec.audioSources.set(key, source);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!isRecording) return;

    // Keep the recording mix updated as participants join/leave
    if (localStream) {
      ensureRecordingAudioSource("local", localStream);
    }

    Object.entries(remoteStreams).forEach(([peerId, data]) => {
      ensureRecordingAudioSource(peerId, data?.stream);
      ensureRecordingVideoEl(peerId, data?.stream);
    });

    const rec = recordingRef.current;
    // cleanup removed peers
    for (const peerId of Array.from(rec.videoEls.keys())) {
      if (peerId === "local") continue;
      if (!remoteStreams[peerId]) {
        rec.videoEls.delete(peerId);
      }
    }
    for (const peerId of Array.from(rec.audioSources.keys())) {
      if (peerId === "local") continue;
      if (!remoteStreams[peerId]) {
        try {
          rec.audioSources.get(peerId)?.disconnect();
        } catch {
          // ignore
        }
        rec.audioSources.delete(peerId);
      }
    }
  }, [isRecording, remoteStreams, localStream]);

  useEffect(() => {
    if (!clientMicCaptureActive || isHost) return;
    const c = clientMicRecorderRef.current;
    if (!c.audioCtx || !c.dest) return;

    ensureClientCaptureAudio("local", localStream);
    void ensureClientCaptureVideoEl("local", localStream);
    Object.entries(remoteStreams).forEach(([peerId, data]) => {
      ensureClientCaptureAudio(peerId, data?.stream);
      void ensureClientCaptureVideoEl(peerId, data?.stream);
    });

    for (const peerId of Array.from(c.videoEls.keys())) {
      if (peerId === "local") continue;
      if (!remoteStreams[peerId]) c.videoEls.delete(peerId);
    }
    for (const peerId of Array.from(c.audioSources.keys())) {
      if (peerId === "local") continue;
      if (!remoteStreams[peerId]) {
        try {
          c.audioSources.get(peerId)?.disconnect();
        } catch {
          /* ignore */
        }
        c.audioSources.delete(peerId);
      }
    }
  }, [clientMicCaptureActive, isHost, remoteStreams, localStream]);

  const startRecording = async () => {
    setRecordingError("");
    if (!isHost) return;
    if (!localStream) {
      setRecordingError("Local media is not ready yet.");
      return;
    }
    if (!window.MediaRecorder) {
      setRecordingError("Recording is not supported in this browser.");
      return;
    }

    const rec = recordingRef.current;
    if (rec.recorder) return;

    try {
      // Audio mix
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      rec.audioCtx = new AudioContext();
      rec.dest = rec.audioCtx.createMediaStreamDestination();
      ensureRecordingAudioSource("local", localStream);

      // Ensure remote sources existing now
      for (const [peerId, data] of Object.entries(remoteStreams)) {
        ensureRecordingAudioSource(peerId, data?.stream);
        await ensureRecordingVideoEl(peerId, data?.stream);
      }

      // Canvas video mix (simple grid)
      rec.canvas = document.createElement("canvas");
      rec.canvas.width = 1280;
      rec.canvas.height = 720;
      rec.ctx = rec.canvas.getContext("2d");

      const canvasStream = rec.canvas.captureStream(30);
      const mixed = new MediaStream();
      canvasStream.getVideoTracks().forEach(t => mixed.addTrack(t));
      rec.dest.stream.getAudioTracks().forEach(t => mixed.addTrack(t));
      rec.mixedStream = mixed;

      const mimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm"
      ];
      const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t));

      rec.chunks = [];
      rec.recorder = new MediaRecorder(mixed, mimeType ? { mimeType } : undefined);
      rec.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) rec.chunks.push(e.data);
      };
      rec.recorder.onerror = () => setRecordingError("Recording failed.");
      rec.recorder.onstop = async () => {
        try {
          const blob = new Blob(rec.chunks, { type: rec.recorder?.mimeType || "video/webm" });
          rec.chunks = [];

          let audioBlob = null;
          try {
            audioBlob = await (rec.audioStopPromise || Promise.resolve(null));
          } catch {
            audioBlob = null;
          } finally {
            rec.audioStopPromise = null;
            rec.resolveAudioStop = null;
            rec.audioRecorder = null;
            rec.audioChunks = [];
          }

          const token = getAuthToken();
          if (!token) {
            setRecordingError("You must be logged in as host to upload recordings.");
            return;
          }

          const form = new FormData();
          form.append("recording", blob, `meeting-${roomId}-${Date.now()}.webm`);
          if (audioBlob) {
            form.append("audio", audioBlob, `meeting-${roomId}-${Date.now()}-audio.webm`);
          }
          form.append("byName", userName || "Host");

          const response = await fetch(`${API_BASE_URL}/api/meeting/${roomId}/recordings`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form
          });

          if (!response.ok) {
            setRecordingError("Upload failed.");
            return;
          }

          await fetchRecordings();
          setShowRecordings(true);
        } catch {
          setRecordingError("Failed to upload recording.");
        } finally {
          try {
            if (rec.raf) cancelAnimationFrame(rec.raf);
          } catch {
            // ignore
          }

          rec.raf = null;
          rec.canvas = null;
          rec.ctx = null;

          for (const source of rec.audioSources.values()) {
            try {
              source.disconnect();
            } catch {
              // ignore
            }
          }
          rec.audioSources.clear();
          rec.videoEls.clear();

          try {
            rec.audioCtx?.close();
          } catch {
            // ignore
          }
          rec.audioCtx = null;
          rec.dest = null;
          rec.mixedStream = null;
          rec.recorder = null;
          setIsRecording(false);
        }
      };

      // Audio-only recorder for transcription (smaller than video)
      rec.audioChunks = [];
      rec.audioStopPromise = new Promise((resolve) => {
        rec.resolveAudioStop = resolve;
      });
      try {
        const audioMimeTypes = ["audio/webm;codecs=opus", "audio/webm"];
        const audioMimeType = audioMimeTypes.find(t => MediaRecorder.isTypeSupported(t));
        rec.audioRecorder = new MediaRecorder(rec.dest.stream, audioMimeType ? { mimeType: audioMimeType } : undefined);
        rec.audioRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) rec.audioChunks.push(e.data);
        };
        rec.audioRecorder.onerror = () => {
          try {
            rec.resolveAudioStop?.(null);
          } catch {
            // ignore
          }
        };
        rec.audioRecorder.onstop = () => {
          try {
            const aBlob = new Blob(rec.audioChunks, { type: rec.audioRecorder?.mimeType || "audio/webm" });
            rec.resolveAudioStop?.(aBlob);
          } catch {
            try {
              rec.resolveAudioStop?.(null);
            } catch {
              // ignore
            }
          }
        };
        rec.audioRecorder.start(1000);
      } catch {
        try {
          rec.resolveAudioStop?.(null);
        } catch {
          // ignore
        }
      }

      const draw = () => {
        if (!rec.ctx || !rec.canvas) return;
        const ctx = rec.ctx;
        const W = rec.canvas.width;
        const H = rec.canvas.height;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);

        const tiles = [];
        if (localVideoRef.current) tiles.push({ label: `${userName || "You"}`, el: localVideoRef.current });
        for (const [peerId, data] of Object.entries(remoteStreams)) {
          const el = rec.videoEls.get(peerId);
          if (el) tiles.push({ label: data?.userName || "Participant", el });
        }

        const n = Math.max(1, tiles.length);
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        const pad = 8;
        const tileW = Math.floor((W - pad * (cols + 1)) / cols);
        const tileH = Math.floor((H - pad * (rows + 1)) / rows);

        tiles.forEach((t, idx) => {
          const r = Math.floor(idx / cols);
          const c = idx % cols;
          const x = pad + c * (tileW + pad);
          const y = pad + r * (tileH + pad);
          try {
            ctx.drawImage(t.el, x, y, tileW, tileH);
          } catch {
            // ignore draw failures until video is ready
          }
          // name overlay
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fillRect(x, y + tileH - 26, tileW, 26);
          ctx.fillStyle = "#fff";
          ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
          ctx.fillText(t.label, x + 10, y + tileH - 8);
        });

        rec.raf = requestAnimationFrame(draw);
      };

      draw();
      rec.recorder.start(1000);
      setIsRecording(true);
    } catch (e) {
      setRecordingError("Failed to start recording.");
      try {
        recordingRef.current.audioCtx?.close();
      } catch {
        // ignore
      }
      recordingRef.current.audioCtx = null;
      recordingRef.current.dest = null;
      recordingRef.current.recorder = null;
      recordingRef.current.audioRecorder = null;
      recordingRef.current.audioChunks = [];
      recordingRef.current.audioStopPromise = null;
      recordingRef.current.resolveAudioStop = null;
    }
  };

  const stopRecording = () => {
    const rec = recordingRef.current;
    if (!rec.recorder) return;

    try {
      rec.audioRecorder?.stop();
    } catch {
      // ignore
    }

    try {
      rec.recorder.stop();
    } catch {
      // ignore
    }

    try {
      if (rec.raf) cancelAnimationFrame(rec.raf);
    } catch {
      // ignore
    }
  };

  const transcribeRecording = async (recordingId) => {
    setRecordingError("");
    try {
      const token = getAuthToken();
      if (!token) return;
      const response = await fetch(`${API_BASE_URL}/api/meeting/${roomId}/recordings/${recordingId}/transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setRecordingError(data.message || "Transcription failed.");
        return;
      }
      await fetchRecordings();
      setShowRecordings(true);
    } catch {
      setRecordingError("Transcription failed.");
    }
  };

  const toggleMute = async () => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    const willBeUnmuted = isMuted;
    const jwt = getClientJwt();
    const isClientGuest = !isHostRef.current && !!jwt;

    if (isClientGuest && !willBeUnmuted) {
      await stopClientMicRecordingAndUpload();
    }

    if (isClientGuest && willBeUnmuted) {
      track.enabled = true;
      setIsMuted(false);
      const ok = await startClientCaptureSegment();
      if (!ok) {
        track.enabled = false;
        setIsMuted(true);
      }
      return;
    }

    track.enabled = willBeUnmuted;
    setIsMuted(!isMuted);
  };

  const toggleVideo = () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      if (track) track.enabled = isVideoOff;
      const nextOff = !isVideoOff;
      setIsVideoOff(nextOff);
      const pid = peerInstance.current?.id;
      if (pid) {
        socket.emit("meeting-video-state", {
          roomId,
          peerId: pid,
          cameraOn: !nextOff
        });
      }
    }
  };

  const copyJoinLink = () => {
    const link = window.location.href;
    navigator.clipboard.writeText(link);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const leaveMeeting = async () => {
    await stopClientMicRecordingAndUpload();
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerInstance.current) {
      peerInstance.current.destroy();
    }
    socket.emit("leave-meeting", { roomId });

    if (isHostRef.current) {
      sessionStorage.removeItem("clientAuth");
      navigate("/");
      return;
    }
    if (localStorage.getItem("clientToken")) {
      navigate("/client?tab=meetings");
      return;
    }
    sessionStorage.removeItem("clientAuth");
    navigate("/");
  };

  if (showNamePrompt) {
    return (
      <div style={{
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{
          background: "white",
          padding: 40,
          borderRadius: 15,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          maxWidth: 400,
          width: "90%"
        }}>
          <h2 style={{ margin: "0 0 10px 0", color: "#333" }}>Join Meeting</h2>
          <p style={{ margin: "0 0 20px 0", color: "#666", fontSize: 14 }}>
            {meetingInfo?.title || "Meeting Room"}
          </p>
          
          {authError && (
            <div style={{
              padding: 12,
              background: "#fee",
              border: "1px solid #fcc",
              borderRadius: 8,
              color: "#c33",
              fontSize: 14,
              marginBottom: 15
            }}>
              {authError}
            </div>
          )}
          
          <label style={{ display: "block", marginBottom: 8, color: "#333", fontWeight: 500 }}>
            Client ID
          </label>
          <input
            type="text"
            placeholder="Enter your Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleClientLogin()}
            style={{
              width: "100%",
              padding: 12,
              border: "2px solid #e0e0e0",
              borderRadius: 8,
              fontSize: 16,
              marginBottom: 15,
              boxSizing: "border-box"
            }}
            autoFocus
          />

          <label style={{ display: "block", marginBottom: 8, color: "#333", fontWeight: 500 }}>
            Password
          </label>
          <input
            type="password"
            placeholder="Enter your password"
            value={clientPassword}
            onChange={(e) => setClientPassword(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleClientLogin()}
            style={{
              width: "100%",
              padding: 12,
              border: "2px solid #e0e0e0",
              borderRadius: 8,
              fontSize: 16,
              marginBottom: 20,
              boxSizing: "border-box"
            }}
          />
          
          <button
            onClick={handleClientLogin}
            disabled={!clientId.trim() || !clientPassword.trim()}
            style={{
              width: "100%",
              padding: 12,
              background: (clientId.trim() && clientPassword.trim()) ? "#667eea" : "#ccc",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 500,
              cursor: (clientId.trim() && clientPassword.trim()) ? "pointer" : "not-allowed",
              transition: "all 0.3s"
            }}
          >
            Join Meeting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", 
      minHeight: "100vh", 
      display: "flex",
      flexDirection: "column"
    }}>
      {/* <div style={{
        position: "fixed",
        top: 70,
        left: 20,
        zIndex: 1500,
        padding: "8px 10px",
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 12,
        color: "white",
        fontSize: 12,
        backdropFilter: "blur(8px)",
        display: "flex",
        gap: 10,
        alignItems: "center",
        maxWidth: "calc(100vw - 40px)"
      }}>
        <span>Socket: <b style={{ color: socketConnected ? "#27ae60" : "#e74c3c" }}>{socketConnected ? "OK" : "DOWN"}</b></span>
        <span>Peer: <b style={{ color: peerConnected ? "#27ae60" : "#e74c3c" }}>{peerConnected ? "OK" : "DOWN"}</b></span>
        {!!webrtcIssue && (
          <span style={{ opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {webrtcIssue}
          </span>
        )}
      </div> */}
      {(audioPlaybackBlocked || !audioUnlocked) && (
        <div style={{
          position: "fixed",
          top: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 2000,
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.25)",
          color: "white",
          borderRadius: 14,
          padding: "12px 14px",
          backdropFilter: "blur(10px)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          maxWidth: "calc(100vw - 40px)"
        }}>
          <div style={{ fontSize: 13, opacity: 0.95 }}>
            If you can’t hear others, tap to enable audio.
          </div>
          <button
            onClick={unlockAudio}
            style={{
              padding: "8px 12px",
              background: "#27ae60",
              border: "none",
              borderRadius: 12,
              color: "white",
              cursor: "pointer",
              fontWeight: 700,
              whiteSpace: "nowrap"
            }}
          >
            Enable Audio
          </button>
        </div>
      )}

      {/* Hidden audio elements to improve remote audio playback across browsers */}
      <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
        {Object.entries(remoteStreams).map(([peerId, data]) => (
          <RemoteAudio
            key={`audio-${peerId}`}
            stream={data?.stream}
            audioUnlocked={audioUnlocked}
            onBlocked={() => setAudioPlaybackBlocked(true)}
          />
        ))}
      </div>

      <div style={{ 
        padding: "15px 30px", 
        background: "rgba(0,0,0,0.3)",
        backdropFilter: "blur(10px)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: "white"
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>{meetingInfo?.title || "Meeting Room"}</h2>
          <p style={{ margin: "5px 0 0 0", fontSize: 12, opacity: 0.8 }}>
            {userName} {isHost && '(Host)'} • {Object.keys(remoteStreams).length + 1} participant{Object.keys(remoteStreams).length !== 0 ? 's' : ''}
          </p>
        </div>
        {isHost && (
          <div style={{ position: "relative" }}>
            <button 
              onClick={copyJoinLink} 
              style={{ 
                padding: "10px 20px", 
                background: "rgba(255,255,255,0.2)", 
                border: "1px solid rgba(255,255,255,0.3)",
                color: "white", 
                borderRadius: 8, 
                cursor: "pointer",
                fontWeight: 500,
                transition: "all 0.3s"
              }}
              onMouseOver={(e) => e.target.style.background = "rgba(255,255,255,0.3)"}
              onMouseOut={(e) => e.target.style.background = "rgba(255,255,255,0.2)"}
            >
              📋 Copy Invite Link
            </button>
            {showCopied && (
              <div style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 5,
                padding: "5px 10px",
                background: "#27ae60",
                color: "white",
                borderRadius: 5,
                fontSize: 12,
                whiteSpace: "nowrap"
              }}>
                ✓ Link copied!
              </div>
            )}
          </div>
        )}
      </div>

      {!isHost && clientMicCaptureActive && (
        <div
          style={{
            background: "linear-gradient(90deg, #922b21 0%, #e74c3c 50%, #922b21 100%)",
            color: "white",
            textAlign: "center",
            padding: "11px 20px",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 0.4,
            boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            flexWrap: "wrap"
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 0 10px #fff",
              flexShrink: 0
            }}
            aria-hidden
          />
          <span>
            Recording — this meeting&apos;s video tiles and your voice are being saved while unmuted.
            Mute to finish and upload this clip.
          </span>
        </div>
      )}

      {recordingError && (
        <div style={{
          margin: "12px 30px 0 30px",
          padding: 12,
          background: "rgba(231,76,60,0.25)",
          border: "1px solid rgba(231,76,60,0.5)",
          borderRadius: 10,
          color: "white",
          fontSize: 13
        }}>
          {recordingError}
        </div>
      )}

      {clientRecordingError && (
        <div style={{
          margin: "12px 30px 0 30px",
          padding: 12,
          background: "rgba(231,76,60,0.25)",
          border: "1px solid rgba(231,76,60,0.5)",
          borderRadius: 10,
          color: "white",
          fontSize: 13
        }}>
          {clientRecordingError}
        </div>
      )}

      {/* Compact Score & Odds Bar */}
      {matchData && liveScore && (
        <div style={{
          display: "flex",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          borderBottom: "2px solid rgba(255,255,255,0.2)"
        }}>
          {/* Left: Batting Team Score & Ball-by-Ball */}
          <div style={{
            flex: 1,
            padding: "20px 30px",
            color: "white"
          }}>
            {/* Top: Match Info and Score */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 15 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
                {/* Team Logos */}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {liveScore.event_home_team_logo && (
                    <img 
                      src={liveScore.event_home_team_logo} 
                      alt={liveScore.event_home_team}
                      style={{ width: 40, height: 40, borderRadius: "50%", background: "white", padding: 4 }}
                    />
                  )}
                  <span style={{ fontSize: 16, fontWeight: 700, opacity: 0.9 }}>vs</span>
                  {liveScore.event_away_team_logo && (
                    <img 
                      src={liveScore.event_away_team_logo} 
                      alt={liveScore.event_away_team}
                      style={{ width: 40, height: 40, borderRadius: "50%", background: "white", padding: 4 }}
                    />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, textTransform: "uppercase", marginBottom: 4 }}>
                    🏏 {matchData.league}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.95, marginBottom: 8 }}>
                    {matchData.matchName}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.85 }}>
                    {isMatchEnded(liveScore) ? "Winner" : "Batting"}:{" "}
                    <span style={{ fontWeight: 700, fontSize: 13 }}>
                      {getHeadlineTeamLabel(liveScore) || "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Center: Latest Ball Result */}
              {(() => {
                if (isMatchEnded(liveScore)) {
                  return (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6
                    }}>
                      <div style={{
                        fontSize: 10,
                        opacity: 0.85,
                        fontWeight: 700,
                        letterSpacing: 0.6
                      }}>
                        MATCH RESULT
                      </div>
                      <div style={{
                        background: "rgba(255,255,255,0.18)",
                        padding: '10px 14px',
                        borderRadius: 10,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                        maxWidth: 320
                      }}>
                        <span style={{ fontSize: 18 }}>🏁</span>
                        <span style={{
                          fontSize: 12,
                          fontWeight: 700,
                          lineHeight: 1.25,
                          textAlign: "center"
                        }}>
                          {liveScore.event_status_info || "Match finished"}
                        </span>
                      </div>
                    </div>
                  );
                }
                if (liveScore.comments) {
                  const allBalls = getSortedCommentBalls(liveScore.comments);
                  if (allBalls.length > 0) {
                    const latestBall = allBalls[allBalls.length - 1];
                    const runs = latestBall.runs;
                    
                    let displayText = '';
                    let bgColor = '';
                    let emoji = '';
                    
                    if (runs === 'W') {
                      displayText = 'WICKET!';
                      bgColor = '#e74c3c';
                      emoji = '🔴';
                    } else if (runs === '6') {
                      displayText = 'SIX!';
                      bgColor = '#e74c3c';
                      emoji = '🚀';
                    } else if (runs === '4') {
                      displayText = 'FOUR!';
                      bgColor = '#3498db';
                      emoji = '💥';
                    } else if (runs === '0') {
                      displayText = 'DOT';
                      bgColor = '#95a5a6';
                      emoji = '⚪';
                    } else if (runs === 'WD' || runs === 'NB') {
                      displayText = runs === 'WD' ? 'WIDE' : 'NO BALL';
                      bgColor = '#f39c12';
                      emoji = '⚠️';
                    } else if (runs === '1') {
                      displayText = 'SINGLE';
                      bgColor = '#27ae60';
                      emoji = '1️⃣';
                    } else if (runs === '2') {
                      displayText = 'TWO';
                      bgColor = '#27ae60';
                      emoji = '2️⃣';
                    } else if (runs === '3') {
                      displayText = 'THREE';
                      bgColor = '#27ae60';
                      emoji = '3️⃣';
                    } else {
                      displayText = runs;
                      bgColor = '#27ae60';
                      emoji = '✅';
                    }
                    
                    return (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4
                      }}>
                        <div style={{
                          fontSize: 10,
                          opacity: 0.8,
                          fontWeight: 600
                        }}>
                          LAST BALL
                        </div>
                        <div style={{
                          background: bgColor,
                          padding: '8px 20px',
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                          animation: 'pulse 0.5s ease-in-out'
                        }}>
                          <span style={{ fontSize: 20 }}>{emoji}</span>
                          <span style={{ 
                            fontSize: 16, 
                            fontWeight: 700,
                            letterSpacing: '1px'
                          }}>
                            {displayText}
                          </span>
                        </div>
                      </div>
                    );
                  }
                }
                return null;
              })()}

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, letterSpacing: "-2px" }}>
                  {(() => {
                    return getBattingScore(liveScore);
                  })()}
                </div>
                {liveScore.event_status_info && (
                  <div style={{ 
                    fontSize: 10, 
                    opacity: 0.9,
                    marginTop: 6,
                    padding: "4px 8px",
                    background: "rgba(255,255,255,0.2)",
                    borderRadius: 4,
                    display: "inline-block"
                  }}>
                    {formatCricketStatusText(liveScore.event_status_info)}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom: Players & Ball-by-Ball Current Over */}
            <div>
              {isMatchEnded(liveScore) ? (
                <div style={{
                  padding: "10px 12px",
                  background: "rgba(0,0,0,0.18)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 12
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.95, marginBottom: 8 }}>
                    🏁 Match Result
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.95, marginBottom: 8 }}>
                    {liveScore.event_status_info || "Match finished"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12, opacity: 0.95 }}>
                    <div>
                      <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 4 }}>{liveScore.event_home_team}</div>
                      <div style={{ fontWeight: 800 }}>{liveScore.event_home_final_result || "-"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 4 }}>{liveScore.event_away_team}</div>
                      <div style={{ fontWeight: 800 }}>{liveScore.event_away_final_result || "-"}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Batsman and Bowler Names - Extract from comments */}
                  {(() => {
                    let batsmen = [];
                    let bowler = null;
                    
                    // Extract bowler and one batsman from comments
                    if (liveScore.comments) {
                      const allBalls = getSortedCommentBalls(liveScore.comments);
                      if (allBalls.length > 0) {
                        const latestBall = allBalls[allBalls.length - 1];
                        if (latestBall.post && latestBall.post.includes(' to ')) {
                          const parts = latestBall.post.split(' to ');
                          if (parts.length >= 2) {
                            bowler = { name: parts[0].trim() };
                          }
                        }
                      }
                    }
                    
                    // Get BOTH batting batsmen from scorecard
                    if (liveScore.scorecard) {
                  const battingTeamName = getBattingTeamName(liveScore);
                  const scorecardKeys = Object.keys(liveScore.scorecard);
                  const battingKey =
                    (battingTeamName && scorecardKeys.find(k => k.toLowerCase().includes(String(battingTeamName).toLowerCase()))) ||
                    scorecardKeys[0];

                  const teamScorecard = battingKey ? liveScore.scorecard[battingKey] : null;
                      if (teamScorecard) {
                        // Find ALL not out batsmen
                        const notOutBatsmen = teamScorecard.filter(p => 
                          p.type === 'Batsman' && p.status === 'not out'
                        );
                        
                        if (notOutBatsmen.length > 0) {
                          batsmen = notOutBatsmen.map(b => ({
                            name: b.player,
                            score: `${b.R}(${b.B})`
                          }));
                        }
                      }
                      
                      // Get bowler stats from scorecard
                      if (bowler) {
                    const homeTeam = liveScore.event_home_team;
                    const awayTeam = liveScore.event_away_team;
                    const bowlingTeamName =
                      battingTeamName === homeTeam ? awayTeam : homeTeam;
                    const bowlingKey =
                      (bowlingTeamName && scorecardKeys.find(k => k.toLowerCase().includes(String(bowlingTeamName).toLowerCase()))) ||
                      scorecardKeys.find(k => k !== battingKey);

                    const teamScorecard = bowlingKey ? liveScore.scorecard[bowlingKey] : null;
                        if (teamScorecard) {
                          const bowlerData = teamScorecard.find(p => 
                            p.type === 'Bowler' && p.player && bowler.name && 
                            p.player.toLowerCase().includes(bowler.name.toLowerCase().split(' ')[0])
                          );
                          if (bowlerData) {
                            bowler.score = `${bowlerData.W}-${bowlerData.R}`;
                          }
                        }
                      }
                    }
                    
                    // Display player info if available
                    if (batsmen.length > 0 || bowler) {
                      return (
                        <div style={{ 
                          display: "flex", 
                          gap: 20, 
                          marginBottom: 12,
                          fontSize: 11,
                          opacity: 0.95,
                          flexWrap: "wrap"
                        }}>
                          {batsmen.map((batsman, idx) => (
                            <div key={`bat-${idx}`}>
                              <span style={{ opacity: 0.8 }}>🏏 </span>
                              <span style={{ fontWeight: 600 }}>{batsman.name}</span>
                              {batsman.score && (
                                <span style={{ marginLeft: 6, opacity: 0.8 }}>
                                  {batsman.score}
                                </span>
                              )}
                            </div>
                          ))}
                          {bowler && (
                            <div>
                              <span style={{ opacity: 0.8 }}>⚾ </span>
                              <span style={{ fontWeight: 600 }}>{bowler.name}</span>
                              {bowler.score && (
                                <span style={{ marginLeft: 6, opacity: 0.8 }}>
                                  {bowler.score}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Ball-by-Ball Current Over */}
                  {liveScore.comments && Object.keys(liveScore.comments).length > 0 && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>
                          ⚾ Current Over
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>
                          {(() => {
                            const allBalls = getSortedCommentBalls(liveScore.comments);
                            if (allBalls.length > 0) {
                              const cur = getBallsInCurrentOver(allBalls);
                              const latestBall = cur.length ? cur[cur.length - 1] : allBalls[allBalls.length - 1];
                              return `Over ${latestBall.overs ?? "0"}`;
                            }
                            return "Over 0";
                          })()}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(() => {
                          const allBalls = getSortedCommentBalls(liveScore.comments);
                          const currentOverBalls = getBallsInCurrentOver(allBalls);
                          
                          return currentOverBalls.map((ball, idx) => (
                            <div key={`${String(ball.overs)}-${idx}-${ball.runs}`} style={{
                              minWidth: 32,
                              height: 32,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: ball.runs === "0" ? "rgba(255,255,255,0.3)" : 
                                          ball.runs === "4" ? "#3498db" : 
                                          ball.runs === "6" ? "#e74c3c" : 
                                          ball.runs === "W" ? "#2c3e50" : "rgba(255,255,255,0.5)",
                              color: "white",
                              borderRadius: 6,
                              fontWeight: 700,
                              fontSize: 14,
                              border: "2px solid rgba(255,255,255,0.4)"
                            }}>
                              {ball.runs === "0" ? "•" : ball.runs}
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right: Betting Odds */}
          <div style={{
            width: 320,
            padding: "20px",
            background: "white",
            borderLeft: "1px solid rgba(0,0,0,0.1)",
            display: "flex",
            flexDirection: "column"
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#2c3e50", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <span>💰</span>
              <span>Betting Odds</span>
            </div>
            
            {isHost ? (
              <>
                <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "#7f8c8d", fontWeight: 500 }}>
                  Select Team
                </label>
                <select
                  value={selectedTeam}
                  onChange={(e) => setSelectedTeam(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "2px solid #e0e0e0",
                    borderRadius: 6,
                    fontSize: 12,
                    marginBottom: 10,
                    cursor: "pointer"
                  }}
                >
                  <option value="">Select team...</option>
                  <option value={liveScore.event_home_team}>{liveScore.event_home_team}</option>
                  <option value={liveScore.event_away_team}>{liveScore.event_away_team}</option>
                </select>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={{ display: "block", marginBottom: 4, fontSize: 10, color: "#7f8c8d", fontWeight: 500 }}>
                      {liveScore.event_home_team} Odds
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 1.85"
                      value={teamAOdds}
                      onChange={(e) => setTeamAOdds(e.target.value)}
                      step="0.01"
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        border: "2px solid #e0e0e0",
                        borderRadius: 6,
                        fontSize: 12,
                        boxSizing: "border-box"
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: 4, fontSize: 10, color: "#7f8c8d", fontWeight: 500 }}>
                      {liveScore.event_away_team} Odds
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 2.10"
                      value={teamBOdds}
                      onChange={(e) => setTeamBOdds(e.target.value)}
                      step="0.01"
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        border: "2px solid #e0e0e0",
                        borderRadius: 6,
                        fontSize: 12,
                        boxSizing: "border-box"
                      }}
                    />
                  </div>
                </div>

                <button
                  onClick={() => {
                    console.log('Share Odds clicked', { selectedTeam, teamAOdds, teamBOdds });
                    if (selectedTeam && (teamAOdds || teamBOdds)) {
                      const oddsData = {
                        roomId,
                        selectedTeam,
                        teamA: liveScore.event_home_team,
                        teamB: liveScore.event_away_team,
                        oddsA: teamAOdds,
                        oddsB: teamBOdds
                      };
                      console.log('Emitting share-odds:', oddsData);
                      socket.emit("share-odds", oddsData);
                      setSharedOdds(oddsData);
                      setOddsShared(true);
                      setTimeout(() => setOddsShared(false), 2000);
                      console.log('Odds shared successfully');
                    } else {
                      console.log('Validation failed:', { selectedTeam, teamAOdds, teamBOdds });
                    }
                  }}
                  disabled={!selectedTeam || (!teamAOdds && !teamBOdds)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: oddsShared ? "#27ae60" : ((selectedTeam && (teamAOdds || teamBOdds)) ? "#667eea" : "#ccc"),
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: (selectedTeam && (teamAOdds || teamBOdds)) ? "pointer" : "not-allowed",
                    transition: "background 0.3s"
                  }}
                >
                  {oddsShared ? "✓ Odds Shared!" : "Share Odds"}
                </button>
              </>
            ) : (
              <>
                {sharedOdds ? (
                  <div>
                    <div style={{ 
                      padding: "10px 12px", 
                      background: "#f0f4ff", 
                      borderRadius: 8,
                      marginBottom: 8,
                      border: "2px solid #667eea"
                    }}>
                      <div style={{ fontSize: 11, color: "#667eea", fontWeight: 600, marginBottom: 6 }}>
                        Favourite: {sharedOdds.selectedTeam}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                        <div>
                          <div style={{ color: "#7f8c8d", marginBottom: 2 }}>{sharedOdds.teamA}</div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: "#2c3e50" }}>
                            {sharedOdds.oddsA || '-'}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: "#7f8c8d", marginBottom: 2 }}>{sharedOdds.teamB}</div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: "#2c3e50" }}>
                            {sharedOdds.oddsB || '-'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ 
                    padding: "20px 10px", 
                    textAlign: "center", 
                    fontSize: 11, 
                    color: "#95a5a6" 
                  }}>
                    Waiting for host to share odds...
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ 
        flex: 1, 
        padding: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: Object.keys(remoteStreams).length > 0 ? "repeat(auto-fit, minmax(400px, 1fr))" : "1fr",
          gap: 20,
          width: "100%",
          maxWidth: 1400
        }}>
          <div style={{ 
            position: "relative", 
            background: "#000", 
            borderRadius: 15,
            overflow: "hidden",
            boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
            aspectRatio: "16/9",
            border: isSpeaking ? "3px solid #27ae60" : "3px solid transparent",
            transition: "border 0.2s"
          }}>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)",
                opacity: isVideoOff ? 0 : 1
              }}
            />
            {isVideoOff && <CameraOffPlaceholder userName={userName} />}
            {isSpeaking && (
              <div
                style={{
                  position: "absolute",
                  top: 15,
                  right: 15,
                  background: "#27ae60",
                  padding: "6px 12px",
                  borderRadius: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  animation: "pulse 1s infinite",
                  zIndex: 3
                }}
              >
                <span style={{ fontSize: 16 }}>🎤</span>
                <span style={{ fontSize: 12, color: "white", fontWeight: 500 }}>Speaking</span>
              </div>
            )}
            {privateCallActive && (
              <div
                style={{
                  position: "absolute",
                  top: 15,
                  left: 15,
                  background: "#e74c3c",
                  padding: "6px 12px",
                  borderRadius: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  zIndex: 3
                }}
              >
                <span style={{ fontSize: 16 }}>🔒</span>
                <span style={{ fontSize: 12, color: "white", fontWeight: 500 }}>Private Mode</span>
              </div>
            )}
            <div
              style={{
                position: "absolute",
                bottom: 15,
                left: 15,
                background: "rgba(0,0,0,0.7)",
                padding: "8px 15px",
                borderRadius: 8,
                color: "white",
                fontSize: 14,
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: 8,
                zIndex: 3
              }}
            >
              <span>
                {userName} (You) {isHost && "👑"}
              </span>
              {isMuted && <span>🔇</span>}
            </div>
          </div>

          {Object.entries(remoteStreams).map(([peerId, data]) => (
            <RemoteVideo 
              key={peerId} 
              stream={data.stream} 
              userName={data.userName}
              isHost={data.isHost}
              peerId={peerId}
              showHostControls={isHost}
              isPrivateCallActive={privateCallActive === peerId}
              onStartPrivateCall={() => startPrivateCall(peerId, data.userName)}
              onEndPrivateCall={endPrivateCall}
              signaledCameraOn={remoteCameraOnByPeer[peerId]}
            />
          ))}
        </div>
      </div>

      <div style={{ 
        position: "fixed",
        bottom: 40,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex", 
        justifyContent: "center",
        gap: 20,
        zIndex: 1000
      }}>
        <button 
          onClick={toggleMute} 
          style={{ 
            width: 60,
            height: 60,
            background: isMuted ? "#e74c3c" : "rgba(255,255,255,0.2)", 
            border: "2px solid rgba(255,255,255,0.3)",
            color: "white", 
            borderRadius: "50%", 
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            lineHeight: 1,
            transition: "all 0.3s",
            backdropFilter: "blur(10px)",
            boxShadow: "0 4px 15px rgba(0,0,0,0.2)"
          }}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? "🔇" : "🎤"}
        </button>

        <button 
          onClick={toggleVideo} 
          style={{ 
            width: 60,
            height: 60,
            background: isVideoOff ? "#e74c3c" : "rgba(255,255,255,0.2)", 
            border: "2px solid rgba(255,255,255,0.3)",
            color: "white", 
            borderRadius: "50%", 
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            lineHeight: 1,
            transition: "all 0.3s",
            backdropFilter: "blur(10px)",
            boxShadow: "0 4px 15px rgba(0,0,0,0.2)"
          }}
          title={isVideoOff ? "Start Video" : "Stop Video"}
        >
          {isVideoOff ? "📹" : "🎥"}
        </button>

        <button 
          onClick={leaveMeeting} 
          style={{ 
            width: 60,
            height: 60,
            background: "#e74c3c", 
            border: "2px solid rgba(255,255,255,0.3)",
            color: "white", 
            borderRadius: "50%", 
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            lineHeight: 1,
            transition: "all 0.3s",
            boxShadow: "0 4px 15px rgba(231,76,60,0.4)"
          }}
          title="Leave Meeting"
        >
          📞
        </button>
      </div>

      {isHost && showRecordings && (
        <div style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          width: 420,
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "60vh",
          overflow: "auto",
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 14,
          padding: 16,
          backdropFilter: "blur(10px)",
          color: "white",
          zIndex: 1100
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>Recordings</div>
            <button
              onClick={() => setShowRecordings(false)}
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.25)",
                color: "white",
                borderRadius: 10,
                padding: "6px 10px",
                cursor: "pointer"
              }}
            >
              Close
            </button>
          </div>

          {recordings.length === 0 ? (
            <div style={{ fontSize: 13, opacity: 0.9 }}>No recordings yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {recordings.slice().reverse().map((r) => (
                <div key={r._id} style={{
                  padding: 12,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 12
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontSize: 12, opacity: 0.9 }}>
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                    <a
                      href={`${API_BASE_URL}/uploads/${r.relativePath}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "white", fontSize: 12, textDecoration: "underline" }}
                    >
                      Download
                    </a>
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      onClick={() => transcribeRecording(r._id)}
                      disabled={!!r.transcript?.text}
                      style={{
                        padding: "8px 10px",
                        background: r.transcript?.text ? "rgba(39,174,96,0.35)" : "rgba(255,255,255,0.15)",
                        border: "1px solid rgba(255,255,255,0.25)",
                        color: "white",
                        borderRadius: 10,
                        cursor: r.transcript?.text ? "default" : "pointer",
                        fontSize: 12
                      }}
                      title={r.transcript?.text ? "Already transcribed" : "Transcribe"}
                    >
                      {r.transcript?.text ? "✓ Transcribed" : "Transcribe"}
                    </button>
                  </div>

                  {r.transcript?.text && (
                    <div style={{
                      marginTop: 10,
                      fontSize: 12,
                      lineHeight: 1.4,
                      opacity: 0.95,
                      whiteSpace: "pre-wrap"
                    }}>
                      {r.transcript.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isHost && !showRecordings && recordings.length > 0 && (
        <button
          onClick={() => setShowRecordings(true)}
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            background: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.25)",
            color: "white",
            borderRadius: 999,
            padding: "10px 14px",
            cursor: "pointer",
            backdropFilter: "blur(10px)",
            zIndex: 1100
          }}
          title="Show recordings"
        >
          Recordings ({recordings.length})
        </button>
      )}
    </div>
  );
}

function RemoteAudio({ stream, audioUnlocked, onBlocked }) {
  const ref = useRef();

  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    el.srcObject = stream;

    const tryPlay = async () => {
      try {
        await el.play();
      } catch {
        onBlocked?.();
      }
    };

    // attempt immediately and again after user unlock
    tryPlay();
  }, [stream, onBlocked]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    if (!audioUnlocked) return;
    el.play().catch(() => {
      onBlocked?.();
    });
  }, [audioUnlocked, stream, onBlocked]);

  return <audio ref={ref} autoPlay playsInline />;
}

function CameraOffPlaceholder({ userName }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 2,
        background: "linear-gradient(180deg, #2c2f3d 0%, #1a1d28 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <div
        style={{
          width: 88,
          height: 88,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 44,
          boxShadow: "0 8px 24px rgba(102, 126, 234, 0.35)",
          marginBottom: 14
        }}
      >
        👤
      </div>
      <div style={{ fontSize: 17, color: "white", fontWeight: 600 }}>{userName || "Guest"}</div>
      <div style={{ fontSize: 13, color: "#8b92a8", marginTop: 6 }}>Camera off</div>
    </div>
  );
}

/** Remote tracks often stay enabled while sending black frames; sample luma to detect that. */
function sampleVideoFrameLuma(videoEl) {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return null;
  const w = 48;
  const h = 48;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(videoEl, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) {
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      n++;
    }
    return n ? sum / n : null;
  } catch {
    return null;
  }
}

function RemoteVideo({
  stream,
  userName,
  isHost,
  peerId,
  showHostControls,
  isPrivateCallActive,
  onStartPrivateCall,
  onEndPrivateCall,
  signaledCameraOn
}) {
  const ref = useRef();
  const signalRef = useRef(signaledCameraOn);
  signalRef.current = signaledCameraOn;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  /** Track-level block: ended, disabled, muted, or no decoded dimensions yet. */
  const [trackBlocksContent, setTrackBlocksContent] = useState(true);
  /** When track "live" but frames are black (common when sender camera off), stay false until luma rises. */
  const [seesBrightPixels, setSeesBrightPixels] = useState(false);
  const darkStreakRef = useRef(0);
  const audioContextRef = useRef(null);

  useEffect(() => {
    if (!stream) {
      setTrackBlocksContent(true);
      setSeesBrightPixels(false);
      darkStreakRef.current = 0;
      return undefined;
    }

    const video = ref.current;
    if (!video) {
      setTrackBlocksContent(true);
      setSeesBrightPixels(false);
      darkStreakRef.current = 0;
      return undefined;
    }

    video.srcObject = stream;
    const vt = stream.getVideoTracks()[0];
    darkStreakRef.current = 0;
    setSeesBrightPixels(false);

    const syncTrackBlocks = () => {
      if (!vt || vt.readyState === "ended") {
        setTrackBlocksContent(true);
        setSeesBrightPixels(false);
        darkStreakRef.current = 0;
        return;
      }
      if (!vt.enabled || vt.muted) {
        setTrackBlocksContent(true);
        setSeesBrightPixels(false);
        darkStreakRef.current = 0;
        return;
      }
      const el = ref.current;
      if (
        el &&
        el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        el.videoWidth === 0 &&
        el.videoHeight === 0
      ) {
        setTrackBlocksContent(true);
        return;
      }
      setTrackBlocksContent(false);
    };

    const tick = () => {
      syncTrackBlocks();
      if (signalRef.current !== undefined) return;

      const el = ref.current;
      if (!el || !vt || vt.readyState === "ended" || !vt.enabled || vt.muted) return;
      if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !el.videoWidth) return;

      const luma = sampleVideoFrameLuma(el);
      if (luma == null) {
        setSeesBrightPixels(true);
        darkStreakRef.current = 0;
        return;
      }
      const BLACK = 4;
      const BRIGHT = 8;
      const BLACK_TICKS = 5;
      if (luma >= BRIGHT) {
        darkStreakRef.current = 0;
        setSeesBrightPixels(true);
      } else if (luma <= BLACK) {
        darkStreakRef.current += 1;
        if (darkStreakRef.current >= BLACK_TICKS) {
          setSeesBrightPixels(false);
        }
      } else {
        darkStreakRef.current = 0;
        setSeesBrightPixels(true);
      }
    };

    tick();

    const onVideoEvent = () => tick();
    video.addEventListener("loadedmetadata", onVideoEvent);
    video.addEventListener("loadeddata", onVideoEvent);
    video.addEventListener("playing", onVideoEvent);
    video.addEventListener("resize", onVideoEvent);

    if (vt) {
      vt.addEventListener("mute", tick);
      vt.addEventListener("unmute", tick);
      vt.addEventListener("ended", tick);
    }

    const poll = window.setInterval(tick, 450);

    setupRemoteAudioDetection(stream);

    return () => {
      window.clearInterval(poll);
      video.removeEventListener("loadedmetadata", onVideoEvent);
      video.removeEventListener("loadeddata", onVideoEvent);
      video.removeEventListener("playing", onVideoEvent);
      video.removeEventListener("resize", onVideoEvent);
      if (vt) {
        vt.removeEventListener("mute", tick);
        vt.removeEventListener("unmute", tick);
        vt.removeEventListener("ended", tick);
      }
      video.srcObject = null;
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {
          /* ignore */
        }
        audioContextRef.current = null;
      }
    };
  }, [stream]);

  const showPlaceholder =
    signaledCameraOn !== undefined
      ? !signaledCameraOn
      : trackBlocksContent || !seesBrightPixels;

  const setupRemoteAudioDetection = (mediaStream) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      
      const audioSource = ctx.createMediaStreamSource(mediaStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.85;
      
      audioSource.connect(analyser);
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const detectSound = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;
        
        setIsSpeaking(average > 20);
        
        requestAnimationFrame(detectSound);
      };
      
      detectSound();
    } catch (error) {
      console.error('Remote audio detection setup failed:', error);
    }
  };

  return (
    <div style={{ 
      position: "relative", 
      background: "#000", 
      borderRadius: 15,
      overflow: "hidden",
      boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
      aspectRatio: "16/9",
      border: isSpeaking ? "3px solid #27ae60" : isPrivateCallActive ? "3px solid #e74c3c" : "3px solid transparent",
      transition: "border 0.2s"
    }}>
      <video
        ref={ref}
        autoPlay
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: showPlaceholder ? 0 : 1
        }}
      />
      {showPlaceholder && <CameraOffPlaceholder userName={userName} />}
      {isSpeaking && (
        <div
          style={{
            position: "absolute",
            top: 15,
            right: 15,
            background: "#27ae60",
            padding: "6px 12px",
            borderRadius: 20,
            display: "flex",
            alignItems: "center",
            gap: 6,
            zIndex: 3
          }}
        >
          <span style={{ fontSize: 16 }}>🎤</span>
          <span style={{ fontSize: 12, color: "white", fontWeight: 500 }}>Speaking</span>
        </div>
      )}
      {isPrivateCallActive && (
        <div
          style={{
            position: "absolute",
            top: 15,
            left: 15,
            background: "#e74c3c",
            padding: "6px 12px",
            borderRadius: 20,
            display: "flex",
            alignItems: "center",
            gap: 6,
            zIndex: 3
          }}
        >
          <span style={{ fontSize: 16 }}>🔒</span>
          <span style={{ fontSize: 12, color: "white", fontWeight: 500 }}>Private</span>
        </div>
      )}
      {showHostControls && !isHost && (
        <div style={{ position: "absolute", top: 15, left: 15, zIndex: 3 }}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            style={{
              background: "rgba(0,0,0,0.7)",
              border: "none",
              color: "white",
              padding: "8px 12px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 16
            }}
          >
            ⋮
          </button>
          {showMenu && (
            <div style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 5,
              background: "white",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              minWidth: 150,
              zIndex: 10
            }}>
              {!isPrivateCallActive ? (
                <button
                  onClick={() => {
                    onStartPrivateCall();
                    setShowMenu(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 15px",
                    background: "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#333",
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}
                  onMouseOver={(e) => e.target.style.background = "#f0f0f0"}
                  onMouseOut={(e) => e.target.style.background = "transparent"}
                >
                  <span>🔒</span>
                  <span>Talk Privately</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    onEndPrivateCall();
                    setShowMenu(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 15px",
                    background: "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#e74c3c",
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}
                  onMouseOver={(e) => e.target.style.background = "#f0f0f0"}
                  onMouseOut={(e) => e.target.style.background = "transparent"}
                >
                  <span>🔓</span>
                  <span>End Private Call</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          bottom: 15,
          left: 15,
          background: "rgba(0,0,0,0.7)",
          padding: "8px 15px",
          borderRadius: 8,
          color: "white",
          fontSize: 14,
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: 8,
          zIndex: 3
        }}
      >
        <span>{userName}</span>
        {isHost && <span>👑</span>}
      </div>
    </div>
  );
}
