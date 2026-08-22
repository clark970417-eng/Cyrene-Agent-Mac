// 昔漣 · 視訊通話／舞台渲染端 —— 3D PMX 模型 + 粒子背景 + 動作庫 + 摸摸頭
//
// 同一頁兩種模式，用網址參數 `?mode=stage` 切換：
//   通話（預設）：原本的視訊通話 UI —— 收音、VAD、ASR、TTS、鏡頭與畫面分享。
//   舞台：只有動作與歌單，不開麥克風也沒有掛斷；她在這裡唱歌。
// 兩邊共用同一個 3D 場景與模型，差別只在下半部的操作區與要不要啟動通話管線。
import "../ui/theme";
import {
  Cyrene3DViewer,
  type AvatarMood,
  type CyreneGestureName,
  type CompoundReactionOptions,
} from "./vrm-viewer";
import type { PropKind } from "./prop-models";
import { revealedCaptionByProgress, computeSyllableMouthOpen } from "./caption-align";
import { mouthShapeAt } from "./song-lipsync";
import type { SongLipTimeline, SongPrepareProgress, SongTrack } from "../../shared/song-types";
import {
  calculateDynamicVadSilenceMs,
  type CallAudioFormat,
  calibratedNoiseFloor,
  speechOnsetThreshold,
  speechReleaseThreshold,
  timeDomainRms,
  BARGE_IN_CONSECUTIVE_TICKS,
  BARGE_IN_THRESHOLD_RATIO,
} from "./audio-utils";

// ── DOM 元素 ──
const callContainer = document.getElementById("call-container") as HTMLElement;

/** `?mode=stage` 進來的是舞台；其餘（通話視窗、托盤開啟）維持原本的通話 UI。 */
const isStageMode = new URLSearchParams(window.location.search).get("mode") === "stage";
callContainer.dataset.page = isStageMode ? "stage" : "call";
document.title = isStageMode ? "昔漣 · 舞台" : "昔漣 · 視訊通話";
const callTitleEl = document.getElementById("call-title");
if (callTitleEl) callTitleEl.textContent = isStageMode ? "昔漣 · 舞台" : "昔漣 · 視訊通話";
const statusEl = document.getElementById("call-status") as HTMLElement;
const ringEl = document.getElementById("avatar-ring") as HTMLElement | null;
const waveformCanvas = document.getElementById("waveform-canvas") as HTMLCanvasElement | null;
const avatarZone = document.getElementById("avatar-zone") as HTMLElement | null;
const micWaveEl = document.getElementById("mic-wave") as HTMLElement | null;
const micBars = micWaveEl ? Array.from(micWaveEl.querySelectorAll(".call__mic-wave-bar")) : [];
const transcriptEl = document.getElementById("transcript") as HTMLElement | null;
const hangupBtn = document.getElementById("hangup-btn") as HTMLButtonElement | null;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement | null;
const durationEl = document.getElementById("call-duration") as HTMLElement | null;
const pttBtn = document.getElementById("ptt-btn") as HTMLButtonElement | null;
const shareBtn = document.getElementById("share-btn") as HTMLButtonElement | null;
const shareLabel = document.getElementById("share-label") as HTMLElement | null;
const sharePreview = document.getElementById("share-preview") as HTMLElement | null;
const shareVideo = document.getElementById("share-video") as HTMLVideoElement | null;

// 3D 視訊與鏡頭元素
const vrmCanvas = document.getElementById("vrm-canvas") as HTMLCanvasElement | null;
const modeToggleBtn = document.getElementById("mode-toggle-btn") as HTMLButtonElement | null;
const modeLabel = document.getElementById("mode-label") as HTMLElement | null;
const callTitle = document.getElementById("call-title") as HTMLElement | null;
const cameraBtn = document.getElementById("camera-btn") as HTMLButtonElement | null;
const muteBtn = document.getElementById("mute-btn") as HTMLButtonElement | null;
const muteLabel = document.getElementById("mute-label") as HTMLElement | null;
// 即時粉色浮動字幕元素
const captionContainer = document.getElementById("call-caption") as HTMLElement | null;
const captionTextEl = document.getElementById("caption-text") as HTMLElement | null;
const userPip = document.getElementById("user-pip") as HTMLElement | null;
const pipVideo = document.getElementById("pip-video") as HTMLVideoElement | null;
const pipCloseBtn = document.getElementById("pip-close-btn") as HTMLButtonElement | null;
const bgPickerBtn = document.getElementById("bg-picker-btn") as HTMLButtonElement | null;
const bgMenu = document.getElementById("bg-menu") as HTMLElement | null;

// 動作庫元素
const actionToggleBtn = document.getElementById("action-toggle-btn") as HTMLButtonElement | null;
const actionsDrawer = document.getElementById("actions-drawer") as HTMLElement | null;
const actionsDrawerClose = document.getElementById("actions-drawer-close") as HTMLButtonElement | null;
const actionItems = Array.from(document.querySelectorAll<HTMLButtonElement>(".call__action-item"));

// 點歌元素
const songToggleBtn = document.getElementById("song-toggle-btn") as HTMLButtonElement | null;
const songDrawer = document.getElementById("song-drawer") as HTMLElement | null;
const songDrawerClose = document.getElementById("song-drawer-close") as HTMLButtonElement | null;
const songShuffleBtn = document.getElementById("song-shuffle-btn") as HTMLButtonElement | null;
const songStatusEl = document.getElementById("song-status") as HTMLElement | null;
const songStatusTextEl = document.getElementById("song-status-text") as HTMLElement | null;
const songProgressEl = document.getElementById("song-progress") as HTMLElement | null;
const songProgressTrackEl = songProgressEl?.querySelector<HTMLElement>("[role='progressbar']") ?? null;
const songProgressFillEl = document.getElementById("song-progress-fill") as HTMLElement | null;
const songProgressLabelEl = document.getElementById("song-progress-label") as HTMLElement | null;
const songListEl = document.getElementById("song-list") as HTMLElement | null;
const songNowEl = document.getElementById("song-now") as HTMLElement | null;
const songNowTitleEl = document.getElementById("song-now-title") as HTMLElement | null;
const songStopBtn = document.getElementById("song-stop-btn") as HTMLButtonElement | null;

let displayStream: MediaStream | null = null;
let webcamStream: MediaStream | null = null;
let avatarViewer: Cyrene3DViewer | null = null;
let currentMode: "3d" | "2d" = "3d";

// ── 音訊狀態 ──
let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let analyser: AnalyserNode | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let isMuted = false;

// ── VAD 狀態 ──
let vadSilenceMs = 380;
let vadThreshold = 0.01;
let noiseFloor = 0.005;
let isSpeaking = false;
let speechStartTime = 0;
let lastSpeechTime = 0;
let consecutiveSpeechFrames = 0;
let consecutiveSilenceFrames = 0;
let hasSpoken = false;

// ── 通話狀態機 ──
type CallState = "CONNECTING" | "LISTENING" | "THINKING" | "SPEAKING" | "ENDED";
let currentState: CallState = "CONNECTING";
let pushToTalk = false;
let pttActive = false;
let showTranscript = true;

// ── 通話計時器 ──
let callStartTimestamp = 0;
let callTimerInterval: number | null = null;

function startCallTimer(): void {
  if (callStartTimestamp > 0) return;
  callStartTimestamp = Date.now();
  if (durationEl) durationEl.hidden = false;
  callTimerInterval = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTimestamp) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const secs = String(elapsed % 60).padStart(2, "0");
    if (durationEl) durationEl.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopCallTimer(): void {
  if (callTimerInterval !== null) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  callStartTimestamp = 0;
  if (durationEl) durationEl.hidden = true;
}

// ── 狀態切換 ──
function setState(state: CallState): void {
  currentState = state;
  if (!statusEl) return;
  statusEl.className = "call__status";

  switch (state) {
    case "CONNECTING":
      statusEl.textContent = "正在連線...";
      ringEl?.classList.remove("is-active");
      waveformCanvas?.classList.remove("is-active");
      micWaveEl?.classList.remove("is-speaking");
      avatarViewer?.setMood("neutral");
      break;

    case "LISTENING":
      // 舞台沒有收音，「正在聆聽」會誤導；那裡的狀態列留給唱歌用。
      statusEl.textContent = isStageMode
        ? ""
        : pushToTalk
          ? "按住空白鍵說話"
          : isMuted
            ? "已靜音"
            : "正在聆聽...";
      ringEl?.classList.add("is-active");
      waveformCanvas?.classList.add("is-active");
      micWaveEl?.classList.add("is-speaking");
      avatarViewer?.setMood("neutral");
      startCallTimer();
      break;

    case "THINKING":
      statusEl.textContent = "昔漣正在思考...";
      statusEl.classList.add("call__status--thinking");
      ringEl?.classList.remove("is-active");
      waveformCanvas?.classList.remove("is-active");
      micWaveEl?.classList.remove("is-speaking");
      avatarViewer?.setMood("thinking");
      break;

    case "SPEAKING":
      statusEl.textContent = "昔漣說話中...";
      ringEl?.classList.add("is-active");
      waveformCanvas?.classList.add("is-active");
      micWaveEl?.classList.remove("is-speaking");
      break;

    case "ENDED":
      statusEl.textContent = "通話已結束";
      ringEl?.classList.remove("is-active");
      waveformCanvas?.classList.remove("is-active");
      micWaveEl?.classList.remove("is-speaking");
      avatarViewer?.setMood("neutral");
      stopCallTimer();
      break;
  }
}

// ── 模式切換 (3D 視訊 / 2D 語音) ──
function setMode(mode: "3d" | "2d"): void {
  currentMode = mode;
  callContainer.setAttribute("data-mode", mode);

  if (mode === "3d") {
    if (avatarZone) avatarZone.hidden = true;
    if (modeLabel) modeLabel.textContent = "視訊";
    if (callTitle) callTitle.textContent = "昔漣 · 視訊通話";
    modeToggleBtn?.setAttribute("aria-pressed", "true");
    avatarViewer?.setPaused(false);
  } else {
    if (avatarZone) avatarZone.hidden = false;
    if (modeLabel) modeLabel.textContent = "省電語音";
    if (callTitle) callTitle.textContent = "昔漣 · 語音通話";
    modeToggleBtn?.setAttribute("aria-pressed", "false");
    avatarViewer?.setPaused(true);
    stopWebCam();
  }
}

modeToggleBtn?.addEventListener("click", () => {
  setMode(currentMode === "3d" ? "2d" : "3d");
});

// ── 動作庫綁定 ──
function setupInteractions(): void {
  // 動作庫抽屜開關
  const actionToggleButtons = [
    actionToggleBtn,
    document.getElementById("action-toggle-btn-call") as HTMLButtonElement | null,
  ];
  for (const button of actionToggleButtons) {
    button?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!actionsDrawer) return;
      actionsDrawer.hidden = !actionsDrawer.hidden;
      if (songDrawer) songDrawer.hidden = true;
    });
  }

  actionsDrawerClose?.addEventListener("click", () => {
    if (actionsDrawer) actionsDrawer.hidden = true;
  });

  document.addEventListener("click", (e) => {
    const onToggleButton = actionToggleButtons.some((button) => button && button.contains(e.target as Node));
    if (actionsDrawer && !actionsDrawer.hidden && !actionsDrawer.contains(e.target as Node) && !onToggleButton) {
      actionsDrawer.hidden = true;
    }
  });

  // 物理道具：丟進 3D 場景，會真的落地、被昔漣的身體推得動。
  // 跟動作分開處理 —— 它不是手勢，唱歌時也不需要擋（不會動到手臂）。
  document.querySelectorAll<HTMLButtonElement>("[data-prop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.prop;
      if (!kind) return;
      if (kind === "clear") {
        avatarViewer?.clearProps();
        renderCaption("「唔...玩具都收好囉～」", "bot");
        return;
      }
      const ok = avatarViewer?.spawnProp(kind as PropKind) ?? false;
      if (!ok) {
        renderCaption("「咦？現在好像丟不進來耶...」", "bot");
      }
    });
  });

  actionItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      // 唱歌時只保留嘴型和表情，動作庫不能插入任何可能帶動手臂的手勢。
      if (isSinging) {
        if (actionsDrawer) actionsDrawer.hidden = true;
        return;
      }
      const action = btn.dataset.action as CyreneGestureName | undefined;
      if (!action) return;

      const actMap: Record<CyreneGestureName, { line: string; mood: AvatarMood }> = {
        // 唱歌的持續姿勢不在動作庫裡（由點歌流程觸發），但型別要求列齊。
        singHold: { line: "「來聽我唱一段吧～🎤」", mood: "happy" },
        wave: { line: "「哈囉～看見你真開心！」", mood: "happy" },
        winkHeart: { line: "「最喜歡你啦！啾咪～💖」", mood: "winkHeart" },
        cheer: { line: "「耶～今天也要充滿元氣向前衝！」", mood: "excited" },
        stretch: { line: "「呼～伸展一下好放鬆喔～」", mood: "happy" },
        bow: { line: "「由衷感謝你的陪伴與支持～🙇」", mood: "happy" },
        clap: { line: "「哇！太棒了！為你鼓掌慶祝～👏」", mood: "excited" },
        shyBlush: { line: "「哎呀...你這樣看著我，人家會害羞啦 (//▽//)」", mood: "shyBlush" },
        think: { line: "「嗯...讓昔漣好好想想看～🤔」", mood: "thinking" },
        salute: { line: "「收到！指揮官指令已確認～🫡」", mood: "happy" },
        yawn: { line: "「呼啊...稍微有點睏意了呢～🥱」", mood: "yawn" },
        proud: { line: "「哼哼～昔漣很厲害吧！快誇誇我～👑」", mood: "proud" },
        pray: { line: "「願星光永遠守護著你，願望成真～🙏」", mood: "pray" },
        nod: { line: "「嗯嗯！我都明白的～」", mood: "happy" },
        shakeHead: { line: "「唔...好像不是這樣呢～」", mood: "thinking" },
        handsOnHeart: { line: "「這份心意，昔漣會永遠珍惜的。」", mood: "happy" },
        listen: { line: "「我在認真聽喔，慢慢說～」", mood: "happy" },
        headScratch: { line: "「哎呀...被你發現了嗎～」", mood: "shy" },
        gasp: { line: "「哇！真的嗎？好驚喜！」", mood: "surprised" },
        raiseHand: { line: "「昔漣報名！選我選我～」", mood: "excited" },
        tiltHead: { line: "「嗯？有什麼有趣的悄悄話嗎？」", mood: "curious" },
        angry: { line: "「哼～生氣氣了喔！要哄哄我才行～」", mood: "angry" },
        sweat: { line: "「這下有點尷尬了呢...哈哈 (汗)」", mood: "sweat" },
        headPat: { line: "「唔嗯～摸摸頭好舒服...再多摸一下嘛～」", mood: "shyBlush" },
      };

      const info = actMap[action] || { line: "「好呀～」", mood: "happy" };
      renderCaption(info.line, "bot");
      avatarViewer?.playReaction({ gesture: action, mood: info.mood });
      if (actionsDrawer) actionsDrawer.hidden = true;
    });
  });
}

// ── 畫面分享 (Screen Share) ──
async function toggleScreenShare(): Promise<void> {
  if (displayStream) {
    stopScreenShare();
    return;
  }
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 10, width: { max: 1280 } },
      audio: false,
    });
    if (shareVideo) shareVideo.srcObject = displayStream;
    if (sharePreview) sharePreview.hidden = false;
    shareBtn?.classList.add("is-active");
    if (shareLabel) shareLabel.textContent = "停止分享";
    displayStream.getVideoTracks()[0].onended = () => { stopScreenShare(); };
  } catch (err) {
    console.warn("Screen share cancelled or failed:", err);
  }
}

function stopScreenShare(): void {
  if (displayStream) {
    displayStream.getTracks().forEach((t) => t.stop());
    displayStream = null;
  }
  if (sharePreview) sharePreview.hidden = true;
  shareBtn?.classList.remove("is-active");
  if (shareLabel) shareLabel.textContent = "分享畫面";
  if (shareVideo) shareVideo.srcObject = null;
  window.call?.sendScreenFrame(null);
}

function sendSharedScreenFrame(): void {
  if (!displayStream || !shareVideo) return;
  try {
    const offscreen = document.createElement("canvas");
    offscreen.width = 640;
    offscreen.height = 360;
    const ctx2d = offscreen.getContext("2d");
    if (ctx2d) {
      ctx2d.drawImage(shareVideo, 0, 0, 640, 360);
      const dataUrl = offscreen.toDataURL("image/jpeg", 0.7);
      window.call?.sendScreenFrame(dataUrl);
    }
  } catch (err) {
    console.warn("Capture screen frame error:", err);
  }
}

// ── 使用者鏡頭 (WebCam PiP) ──
async function toggleWebCam(): Promise<void> {
  if (webcamStream) {
    stopWebCam();
    return;
  }
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    if (pipVideo) {
      pipVideo.srcObject = webcamStream;
      await pipVideo.play().catch(() => {});
    }
    if (userPip) userPip.hidden = false;
    cameraBtn?.classList.add("is-active");
  } catch (err) {
    console.warn("Webcam access error:", err);
  }
}

function stopWebCam(): void {
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
  }
  if (userPip) userPip.hidden = true;
  cameraBtn?.classList.remove("is-active");
  if (pipVideo) pipVideo.srcObject = null;
}

cameraBtn?.addEventListener("click", () => { void toggleWebCam(); });
pipCloseBtn?.addEventListener("click", () => { stopWebCam(); });

// ── 氛圍切換選單 ──
bgPickerBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (bgMenu) bgMenu.hidden = !bgMenu.hidden;
});

document.addEventListener("click", (e) => {
  if (bgMenu && !bgMenu.contains(e.target as Node) && e.target !== bgPickerBtn) {
    bgMenu.hidden = true;
  }
});

/**
 * 有 3D 背景板的氛圍要把 CSS 背景層關掉，不然同一張圖會疊兩份 ——
 * 一份在場景裡（會被景深糊掉），一份在 canvas 後面（永遠清晰），
 * 疊起來就是一張清晰的圖透出模糊的圖，很明顯的鬼影。
 */
function applySceneBackdropFlag(bg: string): void {
  const uses = avatarViewer?.usesSceneBackdrop(bg) ?? false;
  callContainer.setAttribute("data-bg-3d", uses ? "on" : "off");
}

bgMenu?.querySelectorAll<HTMLButtonElement>(".call__bg-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const bg = btn.dataset.bg || "starry";
    callContainer.setAttribute("data-bg", bg);
    avatarViewer?.setEnvironmentLighting(bg);
    applySceneBackdropFlag(bg);

    bgMenu.querySelectorAll(".call__bg-item").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    bgMenu.hidden = true;
  });
});

let currentTranscriptText = "";

// ── 麥克風與音訊管線 ──
async function initAudio(): Promise<void> {
  if (audioContext && micStream) {
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => {});
    }
    return;
  }
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // 必須明確指定 16000。不指定的話 macOS 會用硬體預設的 48kHz，而
    // getUserMedia 的 sampleRate 只是對 MediaStream 的提示，改不了 context 的速率
    // ——createMediaStreamSource 是把串流重新取樣「進入」context。
    // 結果送出去的 PCM 是 48kHz，主行程卻一律當 16kHz 處理（Whisper、阿里雲、
    // hasSpeechSignal 全部），等於讓 Whisper 聽放慢三倍的聲音，而且樣本數也多三倍。
    audioContext = new AudioCtx({ sampleRate: 16000 });
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => {});
    }
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,
      },
    });

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;

    const micSource = audioContext.createMediaStreamSource(micStream);
    micSource.connect(analyser);

    // 1024 @16kHz = 64ms 一次回呼。VAD 要連兩次超標才算開口，也就是 128ms 才
    // 察覺——跟舊版 100ms 定時器相當。用 2048 的話要 256ms，明顯感覺得到遲鈍。
    scriptProcessor = audioContext.createScriptProcessor(1024, 1, 1);
    scriptProcessor.onaudioprocess = onMicAudio;
    analyser.connect(scriptProcessor);
    // Connect to destination so AudioNode graph keeps processing
    scriptProcessor.connect(audioContext.destination);

    console.log("[Call] 麥克風音訊已就緒，採樣率:", audioContext.sampleRate);
  } catch (err) {
    console.error("[Call] 初始化麥克風失敗:", err);
    if (statusEl) {
      statusEl.textContent = "無法存取麥克風，請檢查權限";
      statusEl.className = "call__status call__status--error";
    }
  }
}

function stopMicrophone(): void {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }
  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }
  if (audioContext && audioContext.state !== "closed") {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
}

// ── 麥克風音訊處理 (VAD + 串流發送) ──
function onMicAudio(e: AudioProcessingEvent): void {
  if (isMuted) return;
  // 唱歌時整條收音管線停擺。喇叭放出來的歌聲會被麥克風收回去，VAD 會把它當成
  // 使用者在講話，一路觸發辨識與回話——歌才唱兩句她就自己插嘴了。
  if (isSinging) return;

  const input = e.inputBuffer.getChannelData(0);
  const rms = timeDomainRms(input);

  // 1. 動態噪音底線校準。
  // 昔漣出聲時麥克風收到的是她自己的殘響（喇叭外放），餵進噪音基準會把門檻一路
  // 推高，等她講完使用者真的開口反而偵測不到——而且一通電話越久越聾。
  // 這段期間連同 isSpeaking 一起凍結校準。
  if (currentState !== "SPEAKING") {
    noiseFloor = calibratedNoiseFloor(noiseFloor, rms, isSpeaking);
  }

  // 2. 靜音/說話閾值計算
  const onset = speechOnsetThreshold(noiseFloor, vadThreshold);
  const release = speechReleaseThreshold(noiseFloor, vadThreshold);

  // 3. VAD 狀態機判定
  if (rms > onset) {
    consecutiveSpeechFrames++;
    consecutiveSilenceFrames = 0;
    if (consecutiveSpeechFrames >= 2) {
      if (!isSpeaking) {
        isSpeaking = true;
        speechStartTime = Date.now();
        hasSpoken = true;
        console.log("[VAD] 說話開始 (RMS:", rms.toFixed(4), "onset:", onset.toFixed(4), ")");
      }
      lastSpeechTime = Date.now();
    }
  } else {
    consecutiveSpeechFrames = 0;
    if (rms < release) {
      consecutiveSilenceFrames++;
    }
    if (isSpeaking) {
      const dynamicSilence = calculateDynamicVadSilenceMs(currentTranscriptText || (Date.now() - speechStartTime), vadSilenceMs);
      const silenceDuration = Date.now() - lastSpeechTime;

      if (silenceDuration >= dynamicSilence) {
        isSpeaking = false;
        console.log("[VAD] 說話結束，靜默時長:", silenceDuration, "ms / 門檻:", dynamicSilence, "ms");
        if (!pushToTalk && hasSpoken && currentState === "LISTENING") {
          sendSharedScreenFrame();
          window.call?.turnEnd();
          hasSpoken = false;
          currentTranscriptText = "";
        }
      }
    }
  }

  // 4. 格式轉換為 16-bit PCM 並透過 IPC 串流送出（僅在 LISTENING 狀態下處理，避免播放回音干擾）
  const pcm16 = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  window.call?.sendAudioFrame(pcm16.buffer);
}

// ── 粒子背景動畫 ──
const canvas = document.getElementById("particles") as HTMLCanvasElement | null;
const ctx = canvas ? canvas.getContext("2d") : null;
interface Particle { x: number; y: number; size: number; alpha: number; speed: number; }
const particles: Particle[] = [];
const PARTICLE_COUNT = 36;

function resizeParticles(): void {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function spawnParticle(): Particle {
  return {
    x: Math.random() * (canvas?.width || 450),
    y: Math.random() * (canvas?.height || 800),
    size: Math.random() * 2.5 + 1.2,
    alpha: Math.random() * 0.45 + 0.2,
    speed: Math.random() * 0.4 + 0.2,
  };
}

function drawParticles(): void {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach((p) => {
    p.y -= p.speed;
    if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(244, 114, 182, ${p.alpha})`;
    ctx.fill();
  });
  requestAnimationFrame(drawParticles);
}

// ── 波形動畫 (2D 模式頭像外圈) ──
let waveCtx: CanvasRenderingContext2D | null = null;
function initWaveformCanvas(): void {
  if (!waveformCanvas) return;
  waveformCanvas.width = 240;
  waveformCanvas.height = 240;
  waveCtx = waveformCanvas.getContext("2d");
}

function drawWaveform(): void {
  if (!waveCtx || !waveformCanvas) return;
  waveCtx.clearRect(0, 0, 240, 240);

  if (analyser && currentState !== "CONNECTING" && currentState !== "ENDED") {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const radius = 90;
    const centerX = 120;
    const centerY = 120;
    const bars = 48;

    waveCtx.beginPath();
    for (let i = 0; i < bars; i++) {
      const angle = (i / bars) * Math.PI * 2;
      const val = data[i % data.length] / 255;
      const len = radius + val * 24;
      const x1 = centerX + Math.cos(angle) * radius;
      const y1 = centerY + Math.sin(angle) * radius;
      const x2 = centerX + Math.cos(angle) * len;
      const y2 = centerY + Math.sin(angle) * len;

      waveCtx.moveTo(x1, y1);
      waveCtx.lineTo(x2, y2);
    }
    waveCtx.strokeStyle = "rgba(244, 114, 182, 0.65)";
    waveCtx.lineWidth = 2;
    waveCtx.stroke();
  }
  requestAnimationFrame(drawWaveform);
}

// ── 底部柱狀麥克風波形動畫 ──
function animateMicWave(): void {
  if (analyser && micBars.length > 0 && isSpeaking) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    micBars.forEach((bar, idx) => {
      const val = (data[idx * 6] || 0) / 255;
      const h = Math.max(4, val * 18);
      (bar as HTMLElement).style.height = `${h}px`;
    });
  } else {
    micBars.forEach((bar) => {
      (bar as HTMLElement).style.height = "6px";
    });
  }
  requestAnimationFrame(animateMicWave);
}

// ── TTS 播放佇列與嘴型同步 ──
interface ScheduledChunk {
  audioUrl: string;
  text?: string;
  mood?: AvatarMood;
  gesture?: CyreneGestureName;
}
const ttsQueue: ScheduledChunk[] = [];
let isPlayingTts = false;

function enqueueTtsAudio(chunk: ScheduledChunk): void {
  ttsQueue.push(chunk);
  if (!isPlayingTts) {
    playNextTtsChunk();
  }
}

function stopTts(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute("src");
    currentAudio.load();
    currentAudio = null;
  }
  if (currentSource) {
    currentSource.stop();
    currentSource.disconnect();
    currentSource = null;
  }
  ttsQueue.length = 0;
  isPlayingTts = false;
  avatarViewer?.setMouthOpen(0);
}

function playNextTtsChunk(): void {
  if (ttsQueue.length === 0) {
    isPlayingTts = false;
    setState("LISTENING");
    window.call?.ttsDone();
    return;
  }

  isPlayingTts = true;
  setState("SPEAKING");
  const chunk = ttsQueue.shift()!;

  if (chunk.mood) avatarViewer?.setMood(chunk.mood);
  if (chunk.gesture && !isSinging) avatarViewer?.triggerGesture(chunk.gesture);

  const fullText = (chunk.text || "")
    .replace(/^(🌸?\s*昔漣[：:]\s*)/, "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();

  // 語音開始時立即呈現字幕，確保不延遲
  if (fullText) {
    renderCaption(fullText, "bot");
  }

  // 原生純淨音訊播放（不經由 WebAudio 濾波器或回音消除，保持 100% 原始立體聲純音音質）
  const audio = new Audio(chunk.audioUrl);
  currentAudio = audio;
  audio.preload = "auto";

  let animFrameId: number | null = null;

  const syncMouthAndCaption = () => {
    if (!currentAudio || currentAudio.paused || currentAudio.ended) {
      avatarViewer?.setMouthOpen(0);
      return;
    }

    const cur = audio.currentTime;
    const dur = audio.duration && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 2.5;

    // 1. 嘴型音節同步（隨發音音節張嘴、輔音與換氣標點自動閉合）
    const mouthOpen = computeSyllableMouthOpen(fullText, cur, dur);
    avatarViewer?.setMouthOpen(mouthOpen);

    // 2. 字幕進度同步
    if (fullText && audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
      const progress = Math.min(1, Math.max(0, cur / dur));
      const revealed = revealedCaptionByProgress(fullText, progress);
      if (revealed) {
        renderCaption(revealed, "bot");
      }
    }

    animFrameId = requestAnimationFrame(syncMouthAndCaption);
  };

  audio.addEventListener("play", () => {
    syncMouthAndCaption();
  });

  const cleanup = () => {
    if (animFrameId !== null) cancelAnimationFrame(animFrameId);
    avatarViewer?.setMouthOpen(0);
    if (fullText) renderCaption(fullText, "bot");
    URL.revokeObjectURL(chunk.audioUrl);
    currentAudio = null;
  };

  audio.onended = () => {
    cleanup();
    playNextTtsChunk();
  };

  audio.onerror = (e) => {
    console.warn("[TTS] 播放失敗:", e);
    cleanup();
    playNextTtsChunk();
  };

  audio.play().catch((err) => {
    console.warn("[TTS] Audio play rejected:", err);
    cleanup();
    playNextTtsChunk();
  });
}

// ── 即時對話字幕渲染（嚴格單行膠囊，使用者白/昔漣粉，無前綴標籤） ──
let captionClearTimer: number | null = null;
function renderCaption(text: string, speaker: "user" | "bot" = "bot"): void {
  if (!captionContainer || !captionTextEl) return;
  if (captionClearTimer !== null) {
    clearTimeout(captionClearTimer);
    captionClearTimer = null;
  }
  // 清洗去除任何既有 "你："、"昔漣：" 或 emoji 前綴
  const clean = text
    ? text
        .replace(/^(🎙️?\s*你[：:]\s*|🌸?\s*昔漣[：:]\s*)/, "")
        .replace(/[\r\n\t]+/g, " ")
        .trim()
    : "";
  if (!clean) {
    captionContainer.setAttribute("hidden", "true");
    captionTextEl.textContent = "";
    return;
  }
  captionContainer.removeAttribute("hidden");
  captionTextEl.textContent = clean;
  captionTextEl.className =
    speaker === "user"
      ? "call__caption-text call__caption-text--user"
      : "call__caption-text call__caption-text--bot";

  // 8 秒後自然淡出
  captionClearTimer = window.setTimeout(() => {
    if (captionContainer) captionContainer.setAttribute("hidden", "true");
    if (captionTextEl) captionTextEl.textContent = "";
  }, 8000);
}

// ── 點歌與唱歌 ──
//
// 新歌會先分離原唱與伴奏，再用昔漣的參考音色做歌聲轉換；嘴型則只拿隔離後的
// 昔漣人聲對齊，不看混音音量。這樣前奏、間奏與鼓點不會讓她誤張嘴。

let isSinging = false;
let songAudio: HTMLAudioElement | null = null;
let songAudioUrl: string | null = null;
let songTimeline: SongLipTimeline | null = null;
let songRafId: number | null = null;
let songTracks: SongTrack[] = [];
let playingTrackId: string | null = null;
let songMoodTimer: number | null = null;
let shuffleOn = true;
/** 還沒被抽到的曲目。整輪抽完才重新洗牌，這樣一輪之內不會重複同一首。 */
let shuffleBag: SongTrack[] = [];
/** 每次換歌就加一，背景跑完的對齊結果如果不是這一輪的就丟掉。 */
let songToken = 0;
/** 已完成歌聲轉換與嘴型對齊的歌。沒練過的會在背景自動練，練完才唱。 */
let readySongIds = new Set<string>();
let practicingTrackId: string | null = null;
let backgroundTrainingTrackId: string | null = null;
let practicePercent = 0;
let songProgressPollTimer: number | null = null;
let songProgressPollBusy = false;
let lastReadyIdsRefreshAt = 0;

/** 唱歌時的表情輪替。一首歌從頭到尾同一張臉會很假，但也不能每句都換，
 * 那會變成在扮鬼臉——十幾秒閃一次，接近真人唱歌時的神情變化。 */
const SINGING_MOODS: AvatarMood[] = ["happy", "shyBlush", "excited", "proud", "happy"];
/** 每個表情只掛這麼久就自然回到平常的臉。
 *
 * `setMood` 不給時長是「長駐」——笑瞇瞇的閉眼、害羞的臉紅會一直留在臉上，
 * 整首歌都閉著眼睛。表情是一閃而過的神情，不是狀態。 */
const SINGING_MOOD_HOLD_SEC = 4.5;

function setSongStatus(message: string): void {
  if (!songStatusEl || !songStatusTextEl) return;
  songStatusTextEl.textContent = message;
  songStatusEl.hidden = !message;
}

function setSongPracticeProgress(completed?: number, total?: number): void {
  if (!songProgressEl || !songProgressFillEl || !songProgressLabelEl || !songProgressTrackEl) return;
  const visible = Number.isFinite(completed) && Number.isFinite(total) && (total ?? 0) > 0;
  songProgressEl.hidden = !visible;
  if (!visible) return;
  const percent = Math.max(0, Math.min(100, Math.round(((completed ?? 0) / (total ?? 1)) * 100)));
  practicePercent = percent;
  songProgressFillEl.style.width = `${percent}%`;
  songProgressLabelEl.textContent = `${percent}%`;
  songProgressTrackEl.setAttribute("aria-valuenow", String(percent));
  renderSongList();
}

function renderSongList(): void {
  if (!songListEl) return;
  songListEl.textContent = "";
  for (const track of songTracks) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "call__song-item";
    if (track.id === playingTrackId) item.classList.add("is-playing");
    if (track.id === practicingTrackId) item.classList.add("is-training");

    const title = document.createElement("span");
    title.className = "call__song-item-title";
    title.textContent = track.title;
    item.append(title);
    if (!readySongIds.has(track.id)) {
      const badge = document.createElement("span");
      badge.className = "call__song-item-time";
      badge.textContent = track.id === practicingTrackId ? `${practicePercent}%` : "未練";
      item.append(badge);
    }
    item.addEventListener("click", () => { void startSong(track); });
    songListEl.append(item);
  }
}

async function loadSongList(): Promise<SongTrack[]> {
  setSongStatus("正在讀取昔漣的歌單…");
  const result = await window.song?.list("");
  if (!result?.ok) {
    setSongStatus(result?.message ?? "讀不到歌單。");
    return [];
  }
  songTracks = result.data.tracks;
  shuffleBag = [];
  const ready = await window.song?.readyIds();
  readySongIds = new Set(ready?.ok ? ready.data : []);
  const current = await window.song?.currentProgress();
  if (
    current?.ok && current.data &&
    current.data.stage !== "ready" && current.data.stage !== "failed" &&
    songTracks.some((track) => track.id === current.data?.trackId)
  ) {
    backgroundTrainingTrackId = current.data.trackId;
    practicingTrackId = current.data.trackId;
    if (current.data.message) setSongStatus(current.data.message);
    setSongPracticeProgress(current.data.completed, current.data.total);
  }
  renderSongList();
  if (!practicingTrackId) setSongStatus(songTracks.length ? `${songTracks.length} 首` : "歌單是空的。");
  return songTracks;
}

/** 抽下一首。整袋抽完才重新裝滿，避免同一輪裡重複。 */
function nextShuffleTrack(): SongTrack | null {
  if (!songTracks.length) return null;
  if (!shuffleBag.length) {
    shuffleBag = songTracks.filter((track) => track.id !== playingTrackId || songTracks.length === 1);
  }
  // 先從練好的裡面抽——沒練過的要先花一分多鐘練，隨機播放不該一開場就讓人乾等。
  const readyOnes = shuffleBag.filter((track) => readySongIds.has(track.id));
  // 沒有完成歌曲時先等背景練好；不可抽未練歌，否則會和開機佇列搶同一套模型。
  const pool = readyOnes;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  if (!picked) return null;
  shuffleBag = shuffleBag.filter((track) => track.id !== picked.id);
  return picked;
}

function handleSongProgress(data: SongPrepareProgress): void {
  const trackIsKnown = songTracks.some((track) => track.id === data.trackId);
  if (trackIsKnown && data.stage !== "ready" && data.stage !== "failed") {
    backgroundTrainingTrackId = data.trackId;
    practicingTrackId = data.trackId;
    if (data.message) setSongStatus(data.message);
    setSongPracticeProgress(data.completed, data.total);
    renderSongList();
    return;
  }
  if (data.stage === "ready") {
    readySongIds.add(data.trackId);
    if (practicingTrackId === data.trackId) practicingTrackId = null;
    if (backgroundTrainingTrackId === data.trackId) backgroundTrainingTrackId = null;
    setSongPracticeProgress();
    restoreSongStatusAfterTraining();
    renderSongList();
  } else if (data.stage === "failed") {
    if (practicingTrackId === data.trackId) practicingTrackId = null;
    if (backgroundTrainingTrackId === data.trackId) backgroundTrainingTrackId = null;
    setSongPracticeProgress();
    if (data.message) setSongStatus(`練習失敗：${data.message}`);
    renderSongList();
  } else if (data.trackId === playingTrackId && data.message) {
    setSongStatus(data.message);
  }
}

async function pollSongPracticeState(): Promise<void> {
  if (songProgressPollBusy || !songTracks.length) return;
  songProgressPollBusy = true;
  try {
    const current = await window.song?.currentProgress();
    if (current?.ok && current.data) handleSongProgress(current.data);
    const now = Date.now();
    if (now - lastReadyIdsRefreshAt >= 5_000) {
      lastReadyIdsRefreshAt = now;
      const ready = await window.song?.readyIds();
      if (ready?.ok) {
        readySongIds = new Set(ready.data);
        renderSongList();
      }
    }
  } finally {
    songProgressPollBusy = false;
  }
}

function stopSongPlayback(): void {
  songToken += 1;
  if (songMoodTimer !== null) {
    clearInterval(songMoodTimer);
    songMoodTimer = null;
  }
  if (songRafId !== null) {
    cancelAnimationFrame(songRafId);
    songRafId = null;
  }
  if (songAudio) {
    songAudio.onended = null;
    songAudio.pause();
    songAudio.removeAttribute("src");
    songAudio.load();
    songAudio = null;
  }
  if (songAudioUrl) {
    URL.revokeObjectURL(songAudioUrl);
    songAudioUrl = null;
  }
  songTimeline = null;
  playingTrackId = null;
  isSinging = false;
  if (!backgroundTrainingTrackId) {
    practicingTrackId = null;
    setSongPracticeProgress();
  }
  avatarViewer?.setMouthOpen(0);
  avatarViewer?.stopGesture();
  avatarViewer?.setMood("neutral");
  if (songNowEl) songNowEl.hidden = true;
  renderSongList();
  if (currentState === "LISTENING") statusEl.textContent = "";
}

/** 唱歌時只做嘴型與表情；先停掉任何尚未結束的手部動作。 */
function startSingingPerformance(): void {
  avatarViewer?.stopGesture();
  avatarViewer?.setMood("happy", SINGING_MOOD_HOLD_SEC);
  if (actionsDrawer) actionsDrawer.hidden = true;

  let moodIndex = 0;
  songMoodTimer = window.setInterval(() => {
    if (!isSinging) return;
    moodIndex = (moodIndex + 1) % SINGING_MOODS.length;
    avatarViewer?.setMood(SINGING_MOODS[moodIndex], SINGING_MOOD_HOLD_SEC);
  }, 13_000);
}

function driveSongMouth(): void {
  if (!songAudio || songAudio.paused || songAudio.ended) {
    avatarViewer?.setMouthOpen(0);
    return;
  }
  // 時間軸還在背景對齊時先閉著嘴，但迴圈要繼續跑——對齊一好就能無縫接上。
  if (songTimeline) {
    avatarViewer?.updateLipSync(mouthShapeAt(songTimeline, songAudio.currentTime * 1000));
  } else {
    avatarViewer?.setMouthOpen(0);
  }
  songRafId = requestAnimationFrame(driveSongMouth);
}

/** 這一首放完之後：隨機還開著就自動接下一首。 */
function handleSongEnded(): void {
  stopSongPlayback();
  if (!shuffleOn) return;
  const next = nextShuffleTrack();
  if (next) void startSong(next);
}

async function startSong(track: SongTrack): Promise<void> {
  stopSongPlayback();
  // 她正在講話就先讓她停下來，不然歌聲會疊在回話上。
  stopTts();

  const playToken = ++songToken;

  // 沒練過的歌先練：練的時候不出聲，只顯示狀態。嘴型對不上就放出來，看起來
  // 像壞掉；練好之後再唱，一開口就是對的。
  if (!readySongIds.has(track.id)) {
    practicingTrackId = track.id;
    setSongStatus(`正在練《${track.title}》中…`);
    setSongPracticeProgress(0, 1);
    if (songNowTitleEl) songNowTitleEl.textContent = `🎧 練習中：${track.title}`;
    if (songNowEl) songNowEl.hidden = false;
  }

  const timelineResult = await window.song?.timeline(track);
  if (playToken !== songToken) return;
  if (!timelineResult?.ok) {
    setSongStatus(timelineResult?.message ?? "這首練不起來。");
    if (songNowEl) songNowEl.hidden = true;
    return;
  }
  songTimeline = timelineResult.data;
  practicingTrackId = null;
  setSongPracticeProgress();
  if (songTimeline.refined === true) readySongIds.add(track.id);
  renderSongList();

  setSongStatus(`正在準備《${track.title}》…`);
  const audioResult = await window.song?.audio(track);
  if (playToken !== songToken) return;
  if (!audioResult?.ok) {
    setSongStatus(audioResult?.message ?? "這首拿不到音訊。");
    if (songNowEl) songNowEl.hidden = true;
    return;
  }

  songAudioUrl = URL.createObjectURL(
    new Blob([audioResult.data.audio as unknown as BlobPart], { type: audioResult.data.mimeType }),
  );
  const audio = new Audio(songAudioUrl);
  audio.preload = "auto";
  songAudio = audio;
  playingTrackId = track.id;
  isSinging = true;

  audio.addEventListener("play", () => {
    startSingingPerformance();
    driveSongMouth();
  });
  audio.onended = handleSongEnded;
  audio.onerror = () => {
    setSongStatus("這首放不出來，換一首試試。");
    handleSongEnded();
  };

  try {
    await audio.play();
  } catch (error) {
    console.warn("[Song] 播放被拒絕:", error);
    setSongStatus("播放被擋下了，點一下畫面再選一次。");
    stopSongPlayback();
    return;
  }

  setSongStatus(
    songTimeline.syllables.length
      ? `正在唱《${track.title}》`
      : `正在唱《${track.title}》（唱詞對不到，這首不會動嘴）`,
  );
  statusEl.textContent = "昔漣正在唱歌…";
  if (songNowTitleEl) songNowTitleEl.textContent = `🎵 ${track.title}`;
  if (songNowEl) songNowEl.hidden = false;
  renderSongList();
}

function setShuffle(enabled: boolean): void {
  shuffleOn = enabled;
  songShuffleBtn?.setAttribute("aria-pressed", String(enabled));
}

function restoreSongStatusAfterTraining(): void {
  const playing = songTracks.find((track) => track.id === playingTrackId);
  if (playing) {
    setSongStatus(`正在唱《${playing.title}》`);
    return;
  }
  const remaining = songTracks.some((track) => !readySongIds.has(track.id));
  setSongStatus(remaining ? "等待下一首練習…" : "所有歌曲都練好了。");
}

function setupSongDrawer(): void {
  songToggleBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!songDrawer) return;
    songDrawer.hidden = !songDrawer.hidden;
    if (actionsDrawer) actionsDrawer.hidden = true;
    if (!songDrawer.hidden && !songTracks.length) void loadSongList();
  });

  songDrawerClose?.addEventListener("click", () => {
    if (songDrawer) songDrawer.hidden = true;
  });

  document.addEventListener("click", (event) => {
    if (
      songDrawer &&
      !songDrawer.hidden &&
      !songDrawer.contains(event.target as Node) &&
      event.target !== songToggleBtn
    ) {
      songDrawer.hidden = true;
    }
  });

  songShuffleBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    setShuffle(!shuffleOn);
    if (shuffleOn && !isSinging) {
      const next = nextShuffleTrack();
      if (next) void startSong(next);
    }
  });

  songStopBtn?.addEventListener("click", () => {
    // 手動停止就別再自己接下一首，等他再點一次隨機或挑一首。
    setShuffle(false);
    stopSongPlayback();
    setSongStatus("停下來了。");
  });

  window.song?.onProgress((data) => {
    handleSongProgress(data);
  });

  if (songProgressPollTimer === null) {
    songProgressPollTimer = window.setInterval(() => { void pollSongPracticeState(); }, 1_000);
  }
}

/** 進到舞台就先把歌單讀好，隨機挑一首唱起來。 */
async function startShufflePlayback(): Promise<void> {
  const tracks = await loadSongList();
  if (!tracks.length) return;
  if (shuffleOn) {
    const first = nextShuffleTrack();
    if (first) await startSong(first);
    else setSongStatus("正在背景練習第一首歌，完成後就可以播放。");
  }
}

setupSongDrawer();

// ── 靜音按鈕 ──
muteBtn?.addEventListener("click", () => {
  isMuted = !isMuted;
  muteBtn.classList.toggle("is-muted", isMuted);
  if (muteLabel) muteLabel.textContent = isMuted ? "已靜音" : "靜音";
  if (isMuted) {
    statusEl.textContent = "已靜音";
  } else if (currentState === "LISTENING") {
    if (!isStageMode) statusEl.textContent = "正在聆聽...";
  }
});

// ── 掛斷 ──
function hangup(): void {
  window.call?.stop();
  stopSongPlayback();
  stopScreenShare();
  stopWebCam();
  stopMicrophone();
  stopTts();
  stopCallTimer();
  renderCaption("");
  avatarViewer?.dispose();
  setState("ENDED");
  setTimeout(() => window.close(), 300);
}

hangupBtn?.addEventListener("click", hangup);
closeBtn?.addEventListener("click", hangup);

pttBtn?.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (!pushToTalk || currentState !== "LISTENING") return;
  pttActive = true;
  hasSpoken = true;
  pttBtn.setAttribute("aria-pressed", "true");
  statusEl.textContent = "正在收音…";
});

const finishPushToTalk = () => {
  if (!pttActive) return;
  pttActive = false;
  pttBtn?.setAttribute("aria-pressed", "false");
  sendSharedScreenFrame();
  window.call?.turnEnd();
};

for (const eventName of ["pointerup", "pointercancel", "pointerleave"] as const) {
  pttBtn?.addEventListener(eventName, finishPushToTalk);
}
shareBtn?.addEventListener("click", () => { void toggleScreenShare(); });

// ── 鍵盤快捷操作（空白鍵說話與打斷） ──
window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !event.repeat) {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

    // 唱歌中按空白鍵＝停止這首，回到通話。
    if (isSinging) {
      event.preventDefault();
      stopSongPlayback();
      setSongStatus("停下來了。");
      return;
    }

    // 如果昔漣正在說話，按空白鍵可快速打斷 (Barge-in)
    if (currentState === "SPEAKING") {
      event.preventDefault();
      stopTts();
      window.call?.interrupt();
      setState("LISTENING");
      return;
    }

    if (currentState === "LISTENING") {
      event.preventDefault();
      pttActive = true;
      hasSpoken = true;
      pttBtn?.setAttribute("aria-pressed", "true");
      statusEl.textContent = "正在收音…";
    }
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (pttActive) {
      event.preventDefault();
      pttActive = false;
      pttBtn?.setAttribute("aria-pressed", "false");
      sendSharedScreenFrame();
      window.call?.turnEnd();
      hasSpoken = false;
      currentTranscriptText = "";
    }
  }
});

// 使用者點擊任何地方喚醒 AudioContext
window.addEventListener("pointerdown", () => {
  if (audioContext && audioContext.state === "suspended") {
    void audioContext.resume();
  }
}, { passive: true });

// ── 接收 IPC 語音與狀態 ──
window.call?.onState((state: string) => {
  console.log("[Call IPC] 狀態變更:", state);
  setState(state as CallState);
  if (state === "LISTENING" && !micStream) {
    void initAudio();
  }
});

window.call?.onAsrResult((data: { partial?: string; final?: string }) => {
  const text = data.final || data.partial;
  if (text) {
    currentTranscriptText = text;
    renderCaption(text, "user");
  }
});

window.call?.onTtsAudio((data: {
  audioBuffer?: Uint8Array;
  base64?: string;
  isFinal?: boolean;
  mood?: string;
  text?: string;
  format?: CallAudioFormat;
}) => {
  console.log("[Call IPC] 收到 TTS 語音:", data.text, "format:", data.format);
  let blob: Blob;
  const mime = data.format === "wav" ? "audio/wav" : "audio/mpeg";
  if (data.audioBuffer) {
    blob = new Blob([data.audioBuffer as unknown as BlobPart], { type: mime });
  } else if (data.base64) {
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    blob = new Blob([bytes], { type: mime });
  } else {
    return;
  }

  const text = data.text || "";
  let gesture: CyreneGestureName | undefined = (data as { gesture?: CyreneGestureName }).gesture;
  let mood: AvatarMood = (data.mood as AvatarMood) || "happy";

  if (!gesture) {
    if (text.includes("你好") || text.includes("哈囉") || text.includes("嗨") || text.includes("早安") || text.includes("晚安")) {
      gesture = "wave";
      mood = "happy";
    } else if (text.includes("喜歡") || text.includes("愛你") || text.includes("心動") || text.includes("開心") || text.includes("親親")) {
      gesture = "winkHeart";
      mood = "winkHeart";
    } else if (text.includes("加油") || text.includes("太棒") || text.includes("好耶") || text.includes("衝") || text.includes("耶")) {
      gesture = "cheer";
      mood = "excited";
    } else if (text.includes("謝謝") || text.includes("多謝") || text.includes("感恩") || text.includes("麻煩") || text.includes("拜託")) {
      gesture = "bow";
      mood = "happy";
    } else if (text.includes("害羞") || text.includes("臉紅") || text.includes("不好意思") || text.includes("討厭")) {
      gesture = "shyBlush";
      mood = "shyBlush";
    } else if (text.includes("想一想") || text.includes("思考") || text.includes("好奇") || text.includes("為什麼") || text.includes("研究")) {
      gesture = "think";
      mood = "thinking";
    } else if (text.includes("明白") || text.includes("收到") || text.includes("遵命") || text.includes("交給我") || text.includes("沒問題")) {
      gesture = "salute";
      mood = "happy";
    } else if (text.includes("恭喜") || text.includes("拍手") || text.includes("厲害") || text.includes("讚")) {
      gesture = "clap";
      mood = "excited";
    } else if (text.includes("累") || text.includes("睏") || text.includes("休息") || text.includes("睡覺")) {
      gesture = "yawn";
      mood = "yawn";
    } else if (text.includes("哼哼") || text.includes("厲害吧") || text.includes("誇獎") || text.includes("聰明")) {
      gesture = "proud";
      mood = "proud";
    } else if (text.includes("祈禱") || text.includes("保佑") || text.includes("願望") || text.includes("守護") || text.includes("祝福")) {
      gesture = "pray";
      mood = "pray";
    } else if (text.includes("是啊") || text.includes("當然")) {
      gesture = "nod";
      mood = "happy";
    }
  }

  const audioUrl = URL.createObjectURL(blob);
  enqueueTtsAudio({
    audioUrl,
    text: text ? `🌸 昔漣：${text}` : undefined,
    mood,
    gesture,
  });
});

window.call?.onError((data: { message: string }) => {
  console.error("[Call IPC] 錯誤:", data.message);
  statusEl.textContent = data.message;
  statusEl.className = "call__status call__status--error";
});

// ── 初始化 ──
async function init(): Promise<void> {
  try {
    const cfg = await window.tts?.loadSettings();
    if (cfg) {
      vadSilenceMs = typeof cfg.asrVadSilenceMs === "number" ? cfg.asrVadSilenceMs : 380;
      vadThreshold = typeof cfg.asrVadThreshold === "number" ? cfg.asrVadThreshold : 0.01;
      showTranscript = Boolean(cfg.asrShowTranscript);
      pushToTalk = Boolean(cfg.asrPushToTalk);
    }
  } catch { /* ignore */ }
  if (pttBtn) pttBtn.hidden = !pushToTalk;

  // 1. 初始化粒子背景
  if (canvas && ctx) {
    resizeParticles();
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawnParticle());
    requestAnimationFrame(drawParticles);
    window.addEventListener("resize", resizeParticles);
  }

  // 2. 初始化 3D VRM 渲染器
  if (vrmCanvas) {
    try {
      avatarViewer = new Cyrene3DViewer({
        canvas: vrmCanvas,
        onLoaded: () => {
          console.log("[Call] 3D 視訊渲染器已就緒");
          avatarViewer?.setEnvironmentLighting("room");
          applySceneBackdropFlag("room");
          if (!isSinging) avatarViewer?.triggerGesture("wave");
        },
        onError: (error) => {
          console.error("[Call] 3D 模型載入失敗，切換到 2D 備援:", error);
          setMode("2d");
        },
        onHeadpat: () => {
          if (isSinging) return;
          avatarViewer?.playReaction({ gesture: "headPat", mood: "shyBlush" });
          const sweetLines = [
            "「哇...摸摸頭好舒服～臉都有點紅了呢 (//▽//)」",
            "「嘿嘿，最喜歡被你摸摸頭了～✨」",
            "「感覺心裡暖洋洋的，謝謝你～」",
            "「唔嗯～摸摸頭好舒服...再多摸一下嘛～🥰」",
          ];
          const line = sweetLines[Math.floor(Math.random() * sweetLines.length)];
          renderCaption(line, "bot");
        },
      });
      callContainer.setAttribute("data-bg", "room");

      // 開發模式專用：把 viewer 掛到 window，讓自動化測試能自己驅動渲染並抓畫面
      // （預覽面板只在使用者實際看著它時才合成畫面，不能靠 rAF 截圖驗證動作）。
      if (import.meta.env.DEV) {
        (window as unknown as { __cyreneViewer?: Cyrene3DViewer }).__cyreneViewer = avatarViewer;
      }

      window.triggerCyreneGesture = (name: CyreneGestureName, duration?: number) => {
        if (isSinging) return;
        avatarViewer?.triggerGesture(name, duration);
      };
      window.triggerCyreneReaction = (options: CompoundReactionOptions) => {
        if (isSinging) {
          if (options.mood) avatarViewer?.setMood(options.mood);
          return;
        }
        avatarViewer?.playReaction(options);
      };
    } catch (e) {
      console.error("[Call] 3D 初始化異常:", e);
    }
  }

  // 3. 波形 canvas
  initWaveformCanvas();
  requestAnimationFrame(drawWaveform);
  requestAnimationFrame(animateMicWave);

  // 4. 綁定互動按鈕 (摸摸頭 & 動作庫)
  setupInteractions();

  // 5. 啟動自然日常閒置巡航小動作 (每 20~30 秒隨機自然微動)
  window.setInterval(() => {
    // 有動作在播就跳過這一輪：閒置巡航是「沒事做的時候動一下」，
    // 不該把使用者剛點的動作攔腰打斷（實測會在 1 秒內把動作換掉）。
    if (
      currentState === "LISTENING" && !isPlayingTts && !isSpeaking && !isSinging &&
      !avatarViewer?.isGesturePlaying
    ) {
      const idleActions: CyreneGestureName[] = ["tiltHead", "stretch", "headScratch", "think", "yawn"];
      const action = idleActions[Math.floor(Math.random() * idleActions.length)];
      avatarViewer?.triggerGesture(action, 2.5);
    }
  }, 22000);

  // 6. 依模式啟動：
  //    舞台不開麥，狀態直接進 LISTENING（閒置巡航的小動作才會跑），並隨機開始唱；
  //    通話則照原本的流程收音、接上通話管線。
  if (isStageMode) {
    setState("LISTENING");
    void startShufflePlayback();
  } else {
    await initAudio();
    window.call?.start();
  }
}

void init();

// 全域介面宣告
declare global {
  interface Window {
    call?: {
      start: () => void;
      sendAudioFrame: (frame: ArrayBuffer) => void;
      sendScreenFrame: (dataUrl: string | null) => void;
      turnEnd: () => void;
      interrupt: () => void;
      ttsDone: () => void;
      stop: () => void;
      onState: (callback: (state: string) => void) => () => void;
      onAsrResult: (callback: (data: { partial?: string; final?: string }) => void) => () => void;
      onTtsAudio: (callback: (data: {
        audioBuffer?: Uint8Array;
        base64?: string;
        isFinal?: boolean;
        mood?: string;
        text?: string;
        format?: CallAudioFormat;
      }) => void) => () => void;
      onError: (callback: (data: { message: string }) => void) => () => void;
    };
    tts?: {
      loadSettings: () => Promise<Record<string, unknown>>;
    };
    song?: {
      list: (
        source: string,
        refresh?: boolean,
      ) => Promise<{ ok: true; data: { tracks: SongTrack[] } } | { ok: false; message: string }>;
      search: (
        keyword: string,
        limit?: number,
      ) => Promise<{ ok: true; data: SongTrack[] } | { ok: false; message: string }>;
      audio: (
        track: SongTrack,
      ) => Promise<
        { ok: true; data: { audio: Uint8Array; mimeType: string } } | { ok: false; message: string }
      >;
      timeline: (
        track: SongTrack,
      ) => Promise<{ ok: true; data: SongLipTimeline } | { ok: false; message: string }>;
      readyIds: () => Promise<{ ok: true; data: string[] } | { ok: false; message: string }>;
      currentProgress: () => Promise<
        { ok: true; data: SongPrepareProgress | null } | { ok: false; message: string }
      >;
      onProgress: (callback: (data: SongPrepareProgress) => void) => () => void;
    };
    triggerCyreneGesture?: (name: CyreneGestureName, duration?: number) => void;
    triggerCyreneReaction?: (options: CompoundReactionOptions) => void;
  }
}
