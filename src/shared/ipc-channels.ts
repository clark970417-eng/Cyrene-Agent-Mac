// IPC channel names shared between main and renderer
export interface ScreenshotInsertPayload {
  mime: "image/png";
  width: number;
  height: number;
  filePath: string;
  previewUrl: string;
  hasAnnotations: boolean;
}

export const IPC = {
  // pet window
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_CLOSE: "window:close",
  WINDOW_DRAG_START: "window:drag-start",
  WINDOW_SET_INTERACTIVE: "window:set-interactive",
  WINDOW_SET_TEXT_INPUT_ACTIVE: "window:set-text-input-active",
  WINDOW_MOVE: "window:move",
  WINDOW_MOVE_TO: "window:move-to",
  WINDOW_SET_DRAGGING: "window:set-dragging",
  WINDOW_CAPTURE_FRAME: "window:capture-frame",
  WINDOW_GET_CURSOR_POSITION: "window:get-cursor-position",
  PET_VISIBILITY_CHANGED: "pet:visibility-changed",
  PET_CHAT_INPUT_VISIBILITY: "pet-chat:input-visibility",
  APP_QUIT: "app:quit",

  // Web LLM (ChatGPT / Gemini Account Login)
  WEB_LLM_OPEN_LOGIN: "web-llm:open-login",
  WEB_LLM_CHECK_STATUS: "web-llm:check-status",

  // Gemini 網頁背景模型：登入／狀態／重新登入／測試連線／登出
  GEMINI_OPEN_LOGIN: "gemini:open-login",
  GEMINI_GET_STATUS: "gemini:get-status",
  GEMINI_TEST_CONNECTION: "gemini:test-connection",
  GEMINI_LOGOUT: "gemini:logout",

  // chat window
  CHAT_MINIMIZE: "chat:minimize",
  CHAT_CLOSE: "chat:close",
  CHAT_TOGGLE_MAXIMIZE: "chat:toggle-maximize",
  CHAT_IS_MAXIMIZED: "chat:is-maximized",
  WORKSPACE_NAVIGATE: "workspace:navigate",
  CHAT_INGEST_FILES: "chat:ingest-files",
  CHAT_PROCESS_DOCUMENTS: "chat:process-documents",
  CHAT_DOCUMENT_INDEX_PROGRESS: "chat:document-index-progress",
  CHAT_CANCEL_DOCUMENT_INDEX: "chat:cancel-document-index",
  CHAT_CAPTION_IMAGE: "chat:caption-image",
  CHAT_GET_IMAGE_PREVIEW: "chat:get-image-preview",
  CHAT_GET_IMAGE_SEND_STRATEGY: "chat:get-image-send-strategy",
  // 推理下拉（chat 窗口：原子读 + providerKey 写）
  CHAT_GET_REASONING_STATE: "chat:get-reasoning-state",
  CHAT_SET_REASONING: "chat:set-reasoning",

  // AG-UI 事件流
  AGUI_RUN: "agui:run",
  AGUI_EVENT: "agui:event",
  AGUI_CANCEL: "agui:cancel",
  HARNESS_GET_INTERRUPTED_RUN: "harness:get-interrupted-run",
  PLAN_SET_MODE: "plan:set-mode",
  PLAN_GET_STATE: "plan:get-state",
  PLAN_STATE_CHANGED: "plan:state-changed",
  EXAM_GENERATE: "exam:generate",
  EXAM_GENERATE_PROGRESS: "exam:generate-progress",
  EXAM_CANCEL: "exam:cancel",
  SCHEDULER_EVENT: "scheduler:event",

  CODE_GIT_STATUS: "code-git:status",
  CODE_GIT_CHANGED: "code-git:changed",
  CODE_GIT_WATCH: "code-git:watch",
  CODE_GIT_UNWATCH: "code-git:unwatch",
  CODE_GIT_SWITCH_BRANCH: "code-git:switch-branch",
  CODE_GIT_COMMIT: "code-git:commit",
  CODE_GIT_PUSH: "code-git:push",

  // sidebar window (status / schedule / settings entry)
  SIDEBAR_MINIMIZE: "sidebar:minimize",
  SIDEBAR_CLOSE: "sidebar:close",
  SIDEBAR_OPEN_SETTINGS: "sidebar:open-settings",
  SIDEBAR_OPEN_TASKS: "sidebar:open-tasks",
  SIDEBAR_OPEN_CALL: "sidebar:open-call",
  SIDEBAR_SET_PET_DOCK_VISIBLE: "sidebar:set-pet-dock-visible",
  SIDEBAR_REPORT_PET_SLOT: "sidebar:report-pet-slot",
  SIDEBAR_RECALL_PET: "sidebar:recall-pet",

  // tasks window (read-only display, no per-element interactions)
  TASKS_CLOSE: "tasks:close",
  TASKS_MINIMIZE: "tasks:minimize",

  // settings window
  SETTINGS_MINIMIZE: "settings:minimize",
  SETTINGS_CLOSE: "settings:close",
  // main → settings 窗口：要求切到指定标签（已打开时用）
  SETTINGS_SWITCH_SECTION: "settings:switch-section",
  SETTINGS_GET_CONFIG: "settings:get-config",
  SETTINGS_MODEL_PROFILES_LIST: "settings:model-profiles:list",
  SETTINGS_MODEL_PROFILE_DELETE: "settings:model-profiles:delete",
  SETTINGS_MODEL_PROFILE_SET_DEFAULT: "settings:model-profiles:set-default",
  SETTINGS_SAVE_CONFIG: "settings:save-config",
  SETTINGS_TEST_CONNECTION: "settings:test-connection",
  SETTINGS_TEST_VISION: "settings:test-vision",
  WAVES_UID_STATUS: "wavesuid:status",
  WAVES_UID_RUN: "wavesuid:run",
  WAVES_UID_PICK_FILE: "wavesuid:pick-file",
  WAVES_UID_CAPTURE_DISCORD: "wavesuid:capture-discord",
  WAVES_UID_LOGIN: "wavesuid:login",
  WAVES_UID_LOGIN_STATUS: "wavesuid:login-status",
  WAVES_UID_DATA_STATUS: "wavesuid:data-status",
  WAVES_UID_DELETE_DATA: "wavesuid:delete-data",
  HSR_DASHBOARD_STATUS: "hsr-dashboard:status",
  HSR_DASHBOARD_PROFILE: "hsr-dashboard:profile",
  SETTINGS_GET_GENERAL: "settings:get-general",
  SETTINGS_SAVE_GENERAL: "settings:save-general",
  SETTINGS_GET_TIMEOUT_SETTINGS: "settings:get-timeout-settings",
  SETTINGS_SAVE_TIMEOUT_SETTINGS: "settings:save-timeout-settings",
  UI_THEME_GET: "ui-theme:get",
  UI_THEME_CHANGED: "ui-theme:changed",
  UI_THEME_RADIUS_GET: "ui-theme-radius:get",
  UI_THEME_RADIUS_CHANGED: "ui-theme-radius:changed",
  UI_WINDOW_CORNER_RADIUS_GET: "ui-window-corner-radius:get",
  UI_WINDOW_CORNER_RADIUS_CHANGED: "ui-window-corner-radius:changed",
  UI_FONT_GET: "ui-font:get",
  UI_FONT_CHANGED: "ui-font:changed",
  CHAT_TYPOGRAPHY_CHANGED: "chat-typography:changed",
  SETTINGS_PICK_UI_FONT: "settings:pick-ui-font",
  SETTINGS_IMPORT_UI_FONT: "settings:import-ui-font",
  SETTINGS_RESET_UI_FONT: "settings:reset-ui-font",
  SETTINGS_OPEN_TASKS: "settings:open-tasks",
  SETTINGS_CLOSE_TASKS: "settings:close-tasks",
  SETTINGS_SET_PET_ALWAYS_ON_TOP: "settings:set-pet-always-on-top",
  SETTINGS_SET_PET_VISIBLE: "settings:set-pet-visible",
  SETTINGS_SET_PET_ZOOM: "settings:set-pet-zoom",
  // debugging
  SETTINGS_OPEN_CHROME_GPU: "settings:open-chrome-gpu",
  // main → pet window：推送当前 zoom 因子，渲染进程据此重算 scale
  PET_ZOOM: "pet:zoom",
  SETTINGS_PREVIEW_RUNTIME_SYNC: "settings:preview-runtime-sync",
  SETTINGS_OPEN_STICKER_MANAGER: "settings:open-sticker-manager",
  SETTINGS_OPEN_CUSTOM_STYLE_PROMPT: "settings:open-custom-style-prompt",
  SECURITY_GET_STATUS: "security:get-status",
  BACKUP_GET_CONFIG: "backup:get-config",
  BACKUP_SAVE_CONFIG: "backup:save-config",
  BACKUP_CREATE: "backup:create",
  BACKUP_PICK_INSPECT: "backup:pick-inspect",
  BACKUP_RESTORE: "backup:restore",
  SECURITY_RESTART_APP: "security:restart-app",

  // chat sessions (multi-conversation history, persisted to userData/cyrene-chats/)
  CHATS_LIST: "chats:list",
  CHATS_GET: "chats:get",
  CHATS_GET_PAGE: "chats:get-page",
  CHATS_CREATE: "chats:create",
  CHATS_APPEND: "chats:append",
  CHATS_SET_MESSAGE_TTS_CACHE: "chats:set-message-tts-cache",
  CHATS_REPLACE_MESSAGES: "chats:replace-messages",
  CHATS_REPLACE_TAIL: "chats:replace-tail",
  CHATS_RENAME: "chats:rename",
  CHATS_DELETE: "chats:delete",
  CHATS_SET_PINNED: "chats:set-pinned",
  CHATS_SET_MODEL_PROFILE: "chats:set-model-profile",
  CHATS_OPEN_FOLDER: "chats:open-folder",
  CHATS_OPEN_WORKSPACE: "chats:open-workspace",
  CHATS_MIGRATE_LEGACY: "chats:migrate-legacy",
  // 任意会话变动后 main → 所有渲染窗口 broadcast，触发列表/标题刷新
  CHATS_CHANGED: "chats:changed",
  // 状态栏 → main：要求打开/复用 reactChatWindow 并加载指定 sessionId
  CHATS_OPEN_IN_REACT_WINDOW: "chats:open-in-react-window",
  // main → reactChatWindow：要求切到指定 sessionId（窗口已存在时用）
  CHATS_REACT_SWITCH_SESSION: "chats:react-switch-session",
  // reactChatWindow → main：ChatPage 已挂好 IPC 监听，允许 flush pending sessionId
  CHATS_REACT_READY: "chats:react-ready",
  // 聊天窗口 → main：声明当前活跃 sessionId（用于设置面板"删除当前会话"时差异化提示）
  CHATS_SET_ACTIVE_SESSION: "chats:set-active-session",
  // renderer → main: 查询当前活跃 sessionId（设置面板初次打开时用）
  CHATS_GET_ACTIVE_SESSION: "chats:get-active-session",
  // main → 所有窗口：活跃 sessionId 变化时广播
  CHATS_ACTIVE_SESSION_CHANGED: "chats:active-session-changed",

  // 对话工作区绑定
  // renderer → main：设置当前对话的工作区目录
  CHATS_SET_WORKSPACE: "chats:set-workspace",
  // renderer → main：获取当前对话的工作区绑定
  CHATS_GET_WORKSPACE: "chats:get-workspace",
  // renderer → main：清除当前对话的工作区绑定
  CHATS_CLEAR_WORKSPACE: "chats:clear-workspace",
  // renderer → main：打开文件夹选择器
  CHATS_PICK_WORKSPACE_FOLDER: "chats:pick-workspace-folder",
  // renderer → main：为 Learn 模式初始化工作区结构（只创建缺失文件）
  CHATS_INIT_LEARN_WORKSPACE: "chats:init-learn-workspace",
  // main → 所有窗口：工作区绑定变更广播
  CHATS_WORKSPACE_CHANGED: "chats:workspace-changed",

  REVIEW_GET: "review:get",
  // Code 会话级 Cline plan/act 模式
  CHATS_SET_CODE_MODE: "chats:set-code-mode",

  // Code run 状态查询
  CODE_RUN_GET: "code:run:get",
  CODE_RUN_GET_ACTIVE: "code:run:get-active",
  CODE_RUN_LIST: "code:run:list",
  // Code 验证审批
  CODE_VERIFICATION_GET_PENDING: "code:verification:get-pending",
  CODE_VERIFICATION_APPROVE: "code:verification:approve",
  CODE_VERIFICATION_REJECT: "code:verification:reject",
  // main → renderer：验证审批广播
  CODE_VERIFICATION_APPROVAL_REQUESTED: "code:verification:approval-requested",
  // Code / Cline AskQuestionExecutor bridge
  CODE_ASK_GET_PENDING: "code:ask:get-pending",
  CODE_ASK_RESPOND: "code:ask:respond",
  CODE_ASK_CANCEL: "code:ask:cancel",
  CODE_SESSION_NEW_TASK: "code:session:new-task",

// sticker manager window
	  STICKERS_MINIMIZE: "stickers:minimize",
	  STICKERS_CLOSE: "stickers:close",
	  STICKERS_GET_CONFIG: "stickers:get-config",
	  STICKERS_SET_ENABLED: "stickers:set-enabled",
	  STICKERS_PICK_FILE: "stickers:pick-file",
	  STICKERS_ADD: "stickers:add",
	  STICKERS_DELETE: "stickers:delete",
	  STICKERS_GET_ENABLED: "stickers:get-enabled",

  // public model config updates (no API key)
  MODEL_CONFIG_GET: "model-config:get",
  MODEL_CONFIG_CHANGED: "model-config:changed",

  // runtime state updates (status / feeling / expression)
  RUNTIME_STATE_GET: "runtime-state:get",
  RUNTIME_STATE_CHANGED: "runtime-state:changed",

  // Live2D speech / mouth sync
  LIVE2D_SPEECH_PREPARE: "live2d:speech-prepare",
  LIVE2D_MOUTH_START: "live2d:mouth-start",
  LIVE2D_MOUTH_STOP: "live2d:mouth-stop",
  LIVE2D_PLAY_ACTION: "live2d:play-action",        // 主进程 → 桌宠窗口：执行动作（motion 或 expression）
  LIVE2D_GET_MAIN_DIAGNOSTICS: "live2d:get-main-diagnostics",
  // embedding model status
  EMBEDDING_GET_STATUS: "embedding:get-status",
  EMBEDDING_DOWNLOAD: "embedding:download",
  EMBEDDING_DELETE: "embedding:delete",
  EMBEDDING_PROGRESS: "embedding:progress",
  EMBEDDING_SET_MODEL: "embedding:set-model",
  RERANKER_SET_MODE: "reranker:set-mode",
  RERANKER_GET_STATUS: "reranker:get-status",
  // unified model install status
  MODEL_GET_INSTALL_STATUS: "model:get-install-status",
  // shell external URL
  OPEN_EXTERNAL: "shell:open-external",
  // user profile
  USER_GET_PROFILE: "user:get-profile",
  USER_SAVE_PROFILE: "user:save-profile",
  USER_UPLOAD_AVATAR: "user:upload-avatar",
  USER_GET_AVATAR: "user:get-avatar",
  USER_PROFILE_CHANGED: "user:profile-changed",
  USER_AVATAR_CHANGED: "user:avatar-changed",

  // memory panel
  MEMORY_PANEL_GET_DATA: "memory-panel:get-data",
  MEMORY_PANEL_DELETE_IMPORTED_DOC: "memory-panel:delete-imported-doc",
  MEMORY_PANEL_SAVE_L0: "memory-panel:save-l0",
  MEMORY_PANEL_SAVE_L1: "memory-panel:save-l1",
  MEMORY_PANEL_PIN_L2: "memory-panel:pin-l2",
  MEMORY_PANEL_DELETE_L2: "memory-panel:delete-l2",
  MEMORY_EXPORT_OBSIDIAN_VAULT: "memory:export-obsidian-vault",
  OBSIDIAN_VAULT_BIND: "obsidian-vault:bind",
  OBSIDIAN_VAULT_UNBIND: "obsidian-vault:unbind",
  OBSIDIAN_VAULT_GET_CONFIG: "obsidian-vault:get-config",
  OBSIDIAN_VAULT_SET_AUTO_SYNC: "obsidian-vault:set-auto-sync",
  OBSIDIAN_VAULT_SYNC_NOW: "obsidian-vault:sync-now",

  // MCP server management
  MCP_ADD_SERVER: "mcp:add-server",
  MCP_REMOVE_SERVER: "mcp:remove-server",
  MCP_LIST_SERVERS: "mcp:list-servers",

  // tool (plugin) toggle
  TOOL_SET_ENABLED: "tool:set-enabled",
  TOOL_GET_ENABLED: "tool:get-enabled",
  TOOL_GET_CATALOG: "tool:get-catalog",
  TOOL_GET_MODE_OVERRIDES: "tool:get-mode-overrides",
  TOOL_SET_MODE_OVERRIDE: "tool:set-mode-override",
  TOOL_CLEAR_MODE_OVERRIDE: "tool:clear-mode-override",

  // skill toggle
  SKILL_LIST: "skill:list",
  SKILL_GET_CATALOG: "skill:get-catalog",
  SKILL_RESCAN: "skill:rescan",
  SKILL_GET_MODE_OVERRIDES: "skill:get-mode-overrides",
  SKILL_SET_MODE_OVERRIDE: "skill:set-mode-override",
  SKILL_CLEAR_MODE_OVERRIDE: "skill:clear-mode-override",
  SKILL_SET_ENABLED: "skill:set-enabled",

  // scheduled tasks
  SCHEDULER_LIST: "scheduler:list",
  SCHEDULER_ADD: "scheduler:add",
  SCHEDULER_UPDATE: "scheduler:update",
  SCHEDULER_DELETE: "scheduler:delete",
  SCHEDULER_TOGGLE: "scheduler:toggle",
  SCHEDULER_FIRE_NOW: "scheduler:fire-now",
  SCHEDULER_GET_HISTORY: "scheduler:get-history",
  SCHEDULER_GET_TOOLS: "scheduler:get-tools",
  SCHEDULER_CHANGED: "scheduler:changed",  // main → renderer：任务列表变更通知

  // game-bot（游戏代肝）
  GAME_BOT_GET_CONFIG: "game-bot:get-config",
  GAME_BOT_SAVE_CONFIG: "game-bot:save-config",
  GAME_BOT_LIST_RECIPES: "game-bot:list-recipes",
  GAME_BOT_LIST_REFS: "game-bot:list-refs",
  GAME_BOT_REFS_DIR: "game-bot:refs-dir",
  GAME_BOT_START: "game-bot:start",
  GAME_BOT_STOP: "game-bot:stop",
  GAME_BOT_PROGRESS: "game-bot:progress",
  GAME_ROOM_GET_STATS: "game-room:get-stats",
  GAME_ROOM_RECORD_RESULT: "game-room:record-result",
  GAME_ROOM_RESET_STATS: "game-room:reset-stats",
  GAME_ROOM_REACT: "game-room:react",

  // token usage statistics
  TOKEN_USAGE_GET: "token-usage:get",
  CALL_USAGE_GET: "call-usage:get",
  AGENT_ACTIVITY_GET: "agent-activity:get",
  AGENT_DIAGNOSTIC_EXPORT: "agent-diagnostic:export",
  ASR_TEST_LOCAL: "asr:test-local",

  // TTS 语音合成
  TTS_UPLOAD: "tts:upload",          // 上传音频文件 → file_id
  TTS_CLONE: "tts:clone",           // 音色快速复刻 → voice_id
  TTS_SYNTHESIZE: "tts:synthesize", // 语音合成 → audio buffer(base64)
  TTS_SYNTHESIZE_CACHED: "tts:synthesize-cached", // 语音合成 + 本地音频缓存
  // 流式语音合成（边合成边播，首字延迟低）
  TTS_STREAM_START: "tts:stream-start",           // 渲染端 → main：启动流式合成
  TTS_AUDIO_CHUNK: "tts:audio-chunk",             // main → 渲染端：推一段音频 base64
  TTS_STREAM_END: "tts:stream-end",               // main → 渲染端：流式结束（含 cacheKey）
  TTS_STREAM_ERROR: "tts:stream-error",           // main → 渲染端：流式错误
  TTS_SESSION_START: "tts:session-start",
  TTS_SESSION_CANCEL: "tts:session-cancel",
  TTS_SESSION_EVENT: "tts:session-event",
  TTS_SAVE_SETTINGS: "tts:save-settings",   // 保存 TTS 配置
  TTS_LOAD_SETTINGS: "tts:load-settings",   // 加载 TTS 配置
  TTS_PICK_AUDIO: "tts:pick-audio",         // 选择音频文件（dialog）
  TTS_SYNTHESIZE_GPTSOVITS: "tts:synthesize-gptsovits",             // GPT-SoVITS 合成 → base64
  TTS_SYNTHESIZE_CACHED_GPTSOVITS: "tts:synthesize-cached-gptsovits", // GPT-SoVITS 合成 + 本地缓存
  TTS_SYNTHESIZE_CUSTOM_CLOUD: "tts:synthesize-custom-cloud",             // 自定义云端 TTS 合成 → base64
  TTS_SYNTHESIZE_CACHED_CUSTOM_CLOUD: "tts:synthesize-cached-custom-cloud", // 自定义云端 TTS 合成 + 本地缓存
  TTS_SYNTHESIZE_MIMO: "tts:synthesize-mimo",             // 小米 MiMo TTS 合成 → base64
  TTS_SYNTHESIZE_CACHED_MIMO: "tts:synthesize-cached-mimo", // 小米 MiMo TTS 合成 + 本地缓存
  TTS_SYNTHESIZE_MOSSLAND: "tts:synthesize-mossland",       // Mossland (api.mosi.cn) 合成 → base64
  TTS_SYNTHESIZE_CACHED_MOSSLAND: "tts:synthesize-cached-mossland", // Mossland 合成 + 本地缓存
  TTS_CLONE_MOSSLAND: "tts:clone-mossland",           // Mossland 克隆音色（multipart 上传）
  TTS_LIST_MOSSLAND_VOICES: "tts:list-mossland-voices", // Mossland 拉取账号下音色列表

  // agent permission level (file/shell access)
  PERMISSION_GET_LEVEL: "permission:get-level",
  PERMISSION_SET_LEVEL: "permission:set-level",
  // main → renderer：要求审批
  PERMISSION_APPROVAL_REQUEST: "permission:approval-request",
  // renderer → main：审批结果回传
  PERMISSION_APPROVAL_RESOLVE: "permission:approval-resolve",

  // user choice card (ambiguity resolver)
  // 卡片展示走 AGUI_EVENT 的 CUSTOM 事件（与天气卡片同通道）
  // renderer → main：回传用户选择
  CHOICE_RESOLVE: "choice:resolve",

  // call window (voice call)
  CALL_OPEN: "call:open",                 // sidebar → main：打开通话窗口
  CALL_START: "call:start",               // renderer → main：开始通话（初始化 ASR）
  CALL_SEND_TEXT: "call:send-text",         // renderer → main：直接发送文本消息（文字兜底）
  CALL_AUDIO_FRAME: "call:audio-frame",    // renderer → main：PCM 音频帧
  CALL_SCREEN_FRAME: "call:screen-frame",  // renderer → main：分享畫面的最新壓縮影格
  CALL_ASR_RESULT: "call:asr-result",     // main → renderer：ASR 识别结果
  CALL_TURN_END: "call:turn-end",         // renderer → main：VAD 静默，结束本轮
  CALL_INTERRUPT: "call:interrupt",       // renderer → main：Barge-in 人声打断当前说话
  CALL_TTS_AUDIO: "call:tts-audio",       // main → renderer：TTS 音频
  CALL_TTS_DONE: "call:tts-done",         // renderer → main：TTS 播放完毕
  CALL_STATE: "call:state",               // main → renderer：状态变更
  CALL_ERROR: "call:error",               // main → renderer：错误
  CALL_STOP: "call:stop",                 // renderer → main：挂断

  // 多渠道（Phase 0 骨架，Phase 1+ 实装微信/飞书）
  CHANNELS_GET_CONFIG: "channels:get-config",
  CHANNELS_SAVE_CONFIG: "channels:save-config",
  CHANNELS_LIST: "channels:list",
  CHANNELS_RESTART: "channels:restart",
  CHANNELS_GET_STATUS: "channels:get-status",
  CHANNELS_INSTALL_PROGRESS: "channels:install-progress",     // main → renderer
  CHANNELS_STATUS_CHANGED: "channels:status-changed",         // main → renderer
  // 微信专属
  CHANNELS_WECHAT_INSTALL: "channels:wechat:install",
  CHANNELS_WECHAT_LOGIN_START: "channels:wechat:login-start",
  CHANNELS_WECHAT_LOGIN_CANCEL: "channels:wechat:login-cancel",
  CHANNELS_WECHAT_QRCODE: "channels:wechat:qrcode",        // main → renderer, payload: dataURL string
  CHANNELS_WECHAT_LOGIN_DONE: "channels:wechat:login-done", // main → renderer, payload: { ok, botId?, error? }
  CHANNELS_WECHAT_LOGIN_RESULT: "channels:wechat:login-result",
  CHANNELS_WECHAT_PAIRING_LIST: "channels:wechat:pairing-list",
  CHANNELS_WECHAT_PAIRING_APPROVE: "channels:wechat:pairing-approve",
  CHANNELS_WECHAT_LOGOUT: "channels:wechat:logout",
  CHANNELS_WECHAT_RUNTIME_DETECT: "channels:wechat:runtime-detect",
  CHANNELS_WECHAT_RUNTIME_INSTALL: "channels:wechat:runtime-install",
  CHANNELS_WECHAT_RUNTIME_UPDATE: "channels:wechat:runtime-update",
  // 飞书专属
  CHANNELS_FEISHU_TEST_CONNECTION: "channels:feishu:test-connection",
  CHANNELS_FEISHU_TEST_WEBHOOK_REACHABLE: "channels:feishu:test-webhook-reachable",
  CHANNELS_DISCORD_TEST_CONNECTION: "channels:discord:test-connection",
  CHANNELS_DISCORD_GET_PROFILE: "channels:discord:get-profile",
  CHANNELS_DISCORD_GET_MUSIC_STATE: "channels:discord:get-music-state",
  CHANNELS_DISCORD_GET_MUSIC_HISTORY: "channels:discord:get-music-history",
  CHANNELS_DISCORD_GET_MUSIC_FAVORITES: "channels:discord:get-music-favorites",
  CHANNELS_DISCORD_CONTROL_MUSIC: "channels:discord:control-music",
  CHANNELS_DISCORD_UPDATE_PROFILE: "channels:discord:update-profile",
  CHANNELS_DISCORD_PICK_AVATAR: "channels:discord:pick-avatar",
  CHANNELS_DISCORD_PICK_BANNER: "channels:discord:pick-banner",
  CHANNELS_DISCORD_PICK_CLOUD_KEY: "channels:discord:pick-cloud-key",
  CHANNELS_DISCORD_CLOUD_STATUS: "channels:discord:cloud-status",
  CHANNELS_DISCORD_CLOUD_CONTROL: "channels:discord:cloud-control",
  CHANNELS_SPOTIFY_AUTHORIZE: "channels:spotify:authorize",
  CHANNELS_SPOTIFY_GET_STATUS: "channels:spotify:get-status",
  CHANNELS_SPOTIFY_CONTROL: "channels:spotify:control",
  CHANNELS_SPOTIFY_DISCONNECT: "channels:spotify:disconnect",
  CHANNELS_BILIBILI_CONNECT: "channels:bilibili:connect",
  CHANNELS_BILIBILI_GET_STATUS: "channels:bilibili:get-status",
  CHANNELS_BILIBILI_DISCONNECT: "channels:bilibili:disconnect",
  // Phase 3.4：消息日志
  CHANNELS_LOG_GET: "channels:log:get",
  CHANNELS_LOG_CLEAR: "channels:log:clear",

  // 舊版通知中心：沿用既有設定與已發送紀錄。
  X_NOTIFICATIONS_GET_CONFIG: "x-notifications:get-config",
  X_NOTIFICATIONS_SAVE_CONFIG: "x-notifications:save-config",
  X_NOTIFICATIONS_CHECK_NOW: "x-notifications:check-now",
  X_NOTIFICATIONS_TEST_POST: "x-notifications:test-post",
  X_NOTIFICATIONS_TEST_ALL: "x-notifications:test-all",
  ANILIST_NOTIFICATIONS_GET_CONFIG: "anilist-notifications:get-config",
  ANILIST_NOTIFICATIONS_SAVE_CONFIG: "anilist-notifications:save-config",
  ANILIST_NOTIFICATIONS_VERIFY_ACCOUNT: "anilist-notifications:verify-account",
  ANILIST_NOTIFICATIONS_CHECK_NOW: "anilist-notifications:check-now",
  ANILIST_NOTIFICATIONS_TEST_POST: "anilist-notifications:test-post",

  // Music
  MUSIC_GET_STATUS: "music:get-status",
  MUSIC_BEGIN_LOGIN: "music:begin-login",
  MUSIC_CANCEL_LOGIN: "music:cancel-login",
  MUSIC_LOGOUT: "music:logout",
  MUSIC_GET_DAILY: "music:get-daily",
  MUSIC_SEARCH: "music:search",
  MUSIC_PRESENT_TRACKS: "music:present-tracks",
  MUSIC_PLAY_TRACK: "music:play-track",
  MUSIC_PLAY_PLAYLIST: "music:play-playlist",
  MUSIC_DETECT_PLAYER: "music:detect-player",
  MUSIC_STATE_CHANGED: "music:state-changed",
  MUSIC_CARD: "music:card",

  // 昔漣唱歌：點歌清單、準備（下載＋唱詞對齊）與進度回報
  SONG_LIST: "song:list",                 // renderer → main：合集網址／歌名 → 歌單
  SONG_SEARCH: "song:search",             // renderer → main：關鍵字找歌
  SONG_AUDIO: "song:audio",               // renderer → main：只下載音訊（可以馬上播）
  SONG_TIMELINE: "song:timeline",         // renderer → main：唱詞對齊（沒練過的歌要跑一分多鐘）
  SONG_READY_IDS: "song:ready-ids",       // renderer → main：哪些歌已經練好了
  SONG_PROGRESS_CURRENT: "song:progress-current", // renderer → main：目前背景正在練哪首
  SONG_PROGRESS: "song:progress",         // main → renderer：準備進度

  // screenshot
  SCREENSHOT_START: "screenshot:start",
  SCREENSHOT_SAVE_TEMP: "screenshot:save-temp",
  SCREENSHOT_INSERT: "screenshot:insert",
  SCREENSHOT_HOTKEY_CAPTURE_START: "screenshot:hotkey-capture-start",
  SCREENSHOT_HOTKEY_CAPTURE_END: "screenshot:hotkey-capture-end",

  // TODO 卡片：初始加载当前状态（常驻需求）
  TODOS_GET_CURRENT: "todos:get-current",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
