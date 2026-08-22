// icons —— 統一的線條圖示集（Tabler 風格：24x24、stroke 2、round cap/join）。
//
// 用途：取代散落在各頁面的 emoji UI 圖示。頁面裡只寫
//   <span class="cy-icon" data-icon="key"></span>
// 載入後由 hydrateIcons() 一次填入 SVG，避免同一顆圖示在多處複製貼上。
//
// 注意：昔漣的狀態／心情 emoji（🌸🌿💭…）與 Discord 頻道分類 emoji 屬於人設與資料，
// 不在此集合內，也不應被替換。

const P = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** name → SVG 內層路徑（不含 <svg> 外框）。 */
const PATHS: Record<string, string> = {
  key: `<path ${P} d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z" /><path ${P} d="M15 9h.01" />`,
  settings: `<path ${P} d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" /><path ${P} d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />`,
  brain: `<path ${P} d="M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8" /><path ${P} d="M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8" /><path ${P} d="M17.5 16a3.5 3.5 0 0 0 0 -7h-.5" /><path ${P} d="M6.5 16a3.5 3.5 0 0 1 0 -7h.5" /><path ${P} d="M12 4a2.5 2.5 0 0 0 -2.5 2.5v10" /><path ${P} d="M12 4a2.5 2.5 0 0 1 2.5 2.5v10" />`,
  user: `<path ${P} d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" /><path ${P} d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />`,
  message: `<path ${P} d="M8 9h8" /><path ${P} d="M8 13h6" /><path ${P} d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3z" />`,
  briefcase: `<path ${P} d="M3 7m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" /><path ${P} d="M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2" /><path ${P} d="M12 12l0 .01" /><path ${P} d="M3 13a20 20 0 0 0 18 0" />`,
  shield: `<path ${P} d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" />`,
  scroll: `<path ${P} d="M14 3v4a1 1 0 0 0 1 1h4" /><path ${P} d="M5 8v-3a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-3" /><path ${P} d="M3 12h9" /><path ${P} d="M9 15l3 -3l-3 -3" />`,
  chart: `<path ${P} d="M3 3v18h18" /><path ${P} d="M20 18v-6" /><path ${P} d="M16 18v-9" /><path ${P} d="M12 18v-4" /><path ${P} d="M8 18v-2" />`,
  chartLine: `<path ${P} d="M3 3v18h18" /><path ${P} d="M20 9l-6 6l-4 -4l-4 4" />`,
  wave: `<path ${P} d="M3 12c2 -3 4 -3 6 0s4 3 6 0s4 -3 6 0" /><path ${P} d="M3 18c2 -3 4 -3 6 0" opacity=".5" />`,
  microphone: `<path ${P} d="M9 2m0 3a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3z" /><path ${P} d="M5 10a7 7 0 0 0 14 0" /><path ${P} d="M8 21l8 0" /><path ${P} d="M12 17l0 4" />`,
  headphones: `<path ${P} d="M4 14v-3a8 8 0 1 1 16 0v3" /><path ${P} d="M18 19c0 1.657 -.895 3 -2 3h-1.5a1.5 1.5 0 0 1 0 -3h1.5a2 2 0 0 0 2 -2v-4a2 2 0 1 1 2 2" /><path ${P} d="M4 14a2 2 0 1 1 2 2v4" />`,
  book: `<path ${P} d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><path ${P} d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><path ${P} d="M3 6l0 13" /><path ${P} d="M12 6l0 13" /><path ${P} d="M21 6l0 13" />`,
  books: `<path ${P} d="M5 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" /><path ${P} d="M9 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" /><path ${P} d="M14 5l3 -1l4 13l-3 1z" />`,
  globe: `<path ${P} d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path ${P} d="M3.6 9h16.8" /><path ${P} d="M3.6 15h16.8" /><path ${P} d="M11.5 3a17 17 0 0 0 0 18" /><path ${P} d="M12.5 3a17 17 0 0 1 0 18" />`,
  cloud: `<path ${P} d="M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.286 -1.877 1.68 -3.526 3.66 -4.325c1.98 -.8 4.303 -.626 6.096 .454c1.793 1.08 2.786 2.91 2.605 4.8c1.72 .054 3.51 1.198 3.982 3.017" />`,
  cloudSun: `<path ${P} d="M12 8a4 4 0 0 0 -3.446 6.033" /><path ${P} d="M12 4v-1" /><path ${P} d="M5.6 5.6l.7 .7" /><path ${P} d="M4 12h-1" /><path ${P} d="M14.5 19a3.5 3.5 0 0 0 0 -7h-.5a5 5 0 1 0 -9 3" /><path ${P} d="M7 19h7.5" />`,
  car: `<path ${P} d="M5 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path ${P} d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path ${P} d="M5 17h-2v-6l2 -5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0h-6" /><path ${P} d="M3 11h14" />`,
  search: `<path ${P} d="M3 10a7 7 0 1 0 14 0a7 7 0 0 0 -14 0" /><path ${P} d="M21 21l-6 -6" />`,
  mail: `<path ${P} d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" /><path ${P} d="M3 7l9 6l9 -6" />`,
  folder: `<path ${P} d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />`,
  folderOpen: `<path ${P} d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2" />`,
  file: `<path ${P} d="M14 3v4a1 1 0 0 0 1 1h4" /><path ${P} d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" /><path ${P} d="M9 13h6" /><path ${P} d="M9 17h3" />`,
  clipboard: `<path ${P} d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2" /><path ${P} d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z" /><path ${P} d="M9 12h6" /><path ${P} d="M9 16h6" />`,
  spider: `<path ${P} d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /><path ${P} d="M12 9v-3" /><path ${P} d="M9 10l-3 -3v-2" /><path ${P} d="M15 10l3 -3v-2" /><path ${P} d="M9 14l-4 2v3" /><path ${P} d="M15 14l4 2v3" /><path ${P} d="M9 12h-6" /><path ${P} d="M15 12h6" />`,
  coin: `<path ${P} d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path ${P} d="M14.8 9a2 2 0 0 0 -1.8 -1h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1 -1.8 -1" /><path ${P} d="M12 6v2m0 8v2" />`,
  plug: `<path ${P} d="M9.785 6l8.215 8.215l-2.054 2.054a5.81 5.81 0 1 1 -8.215 -8.215l2.054 -2.054z" /><path ${P} d="M4 20l3.5 -3.5" /><path ${P} d="M15 4l-3.5 3.5" /><path ${P} d="M20 9l-3.5 3.5" />`,
  desktop: `<path ${P} d="M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1z" /><path ${P} d="M7 20h10" /><path ${P} d="M9 16v4" /><path ${P} d="M15 16v4" />`,
  home: `<path ${P} d="M5 12l-2 0l9 -9l9 9l-2 0" /><path ${P} d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" /><path ${P} d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />`,
  language: `<path ${P} d="M4 5h7" /><path ${P} d="M9 3v2c0 4.418 -2.239 8 -5 8" /><path ${P} d="M5 9c0 2.144 2.952 3.908 6.7 4" /><path ${P} d="M12 20l4 -9l4 9" /><path ${P} d="M19.1 18h-6.2" />`,
  photo: `<path ${P} d="M15 8h.01" /><path ${P} d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z" /><path ${P} d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5" /><path ${P} d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3" />`,
  camera: `<path ${P} d="M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2" /><path ${P} d="M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />`,
  eye: `<path ${P} d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /><path ${P} d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />`,
  edit: `<path ${P} d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" /><path ${P} d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z" /><path ${P} d="M16 5l3 3" />`,
  download: `<path ${P} d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><path ${P} d="M7 11l5 5l5 -5" /><path ${P} d="M12 4l0 12" />`,
  upload: `<path ${P} d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><path ${P} d="M7 9l5 -5l5 5" /><path ${P} d="M12 4l0 12" />`,
  volume: `<path ${P} d="M15 8a5 5 0 0 1 0 8" /><path ${P} d="M17.7 5a9 9 0 0 1 0 14" /><path ${P} d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" />`,
  volumeOff: `<path ${P} d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" /><path ${P} d="M16 10l4 4m0 -4l-4 4" />`,
  speaker: `<path ${P} d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /><path ${P} d="M5 3m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" /><path ${P} d="M12 7h.01" />`,
  rocket: `<path ${P} d="M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3" /><path ${P} d="M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3" /><path ${P} d="M15 9m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />`,
  inbox: `<path ${P} d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /><path ${P} d="M4 13h3l3 3h4l3 -3h3" />`,
  moon: `<path ${P} d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" />`,
  sparkles: `<path ${P} d="M12 3l1.9 5.1l5.1 1.9l-5.1 1.9l-1.9 5.1l-1.9 -5.1l-5.1 -1.9l5.1 -1.9z" /><path ${P} d="M18 16l.7 1.9l1.9 .7l-1.9 .7l-.7 1.9l-.7 -1.9l-1.9 -.7l1.9 -.7z" />`,
  target: `<path ${P} d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path ${P} d="M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0" /><path ${P} d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />`,
  arrowDownBox: `<path ${P} d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /><path ${P} d="M9 12l3 3l3 -3" /><path ${P} d="M12 8v7" />`,
  arrowUpBox: `<path ${P} d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /><path ${P} d="M9 12l3 -3l3 3" /><path ${P} d="M12 16v-7" />`,
  hash: `<path ${P} d="M5 9h14" /><path ${P} d="M5 15h14" /><path ${P} d="M11 4l-2 16" /><path ${P} d="M15 4l-2 16" />`,
  lock: `<path ${P} d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" /><path ${P} d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" /><path ${P} d="M8 11v-4a4 4 0 1 1 8 0v4" />`,
  gamepad: `<path ${P} d="M2 6m0 2a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2z" /><path ${P} d="M6 12h4m-2 -2v4" /><path ${P} d="M15 11h.01" /><path ${P} d="M18 13h.01" />`,
  device: `<path ${P} d="M13 16v4h3" /><path ${P} d="M8 20h3" /><path ${P} d="M3 4m0 1a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1z" />`,
  bird: `<path ${P} d="M16 7h.01" /><path ${P} d="M3.4 18h15.6a3 3 0 0 0 3 -3v-4a5 5 0 0 0 -5 -5h-1a4 4 0 0 0 -4 -3a4 4 0 0 0 -4 4v7a4 4 0 0 1 -4.6 4z" /><path ${P} d="M12 10l-2 4" />`,
  music: `<path ${P} d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path ${P} d="M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path ${P} d="M9 17v-13h10v13" /><path ${P} d="M9 8h10" />`,
  tv: `<path ${P} d="M3 7m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" /><path ${P} d="M16 3l-4 4l-4 -4" />`,
  news: `<path ${P} d="M16 6h3a1 1 0 0 1 1 1v11a2 2 0 0 1 -4 0v-13a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1v12a3 3 0 0 0 3 3h11" /><path ${P} d="M8 8h4" /><path ${P} d="M8 12h4" /><path ${P} d="M8 16h4" />`,
  bulb: `<path ${P} d="M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7" /><path ${P} d="M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3" /><path ${P} d="M9.7 17h4.6" />`,
  construction: `<path ${P} d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path ${P} d="M12 8v4" /><path ${P} d="M12 16h.01" />`,
  pin: `<path ${P} d="M9 4v6l-2 4v2h10v-2l-2 -4v-6" /><path ${P} d="M12 16l0 5" /><path ${P} d="M8 4l8 0" />`,
  seedling: `<path ${P} d="M12 10a6 6 0 0 0 -6 -6h-3v2a6 6 0 0 0 6 6h3" /><path ${P} d="M12 14a6 6 0 0 1 6 -6h3v1a6 6 0 0 1 -6 6h-3" /><path ${P} d="M12 20v-10" />`,
  heart: `<path ${P} d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />`,
  mask: `<path ${P} d="M4 5m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v6a5 5 0 0 1 -5 5h-6a5 5 0 0 1 -5 -5z" /><path ${P} d="M9 10h.01" /><path ${P} d="M15 10h.01" /><path ${P} d="M9.5 14a3.5 3.5 0 0 0 5 0" />`,
  robot: `<path ${P} d="M6 4m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" /><path ${P} d="M9 9h.01" /><path ${P} d="M15 9h.01" /><path ${P} d="M9.5 13a3.5 3.5 0 0 0 5 0" /><path ${P} d="M12 4v-2" /><path ${P} d="M9 18v3" /><path ${P} d="M15 18v3" />`,
  star: `<path ${P} d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" />`,
  calendar: `<path ${P} d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /><path ${P} d="M16 3v4" /><path ${P} d="M8 3v4" /><path ${P} d="M4 11h16" />`,
  palette: `<path ${P} d="M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25" /><path ${P} d="M8.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path ${P} d="M12.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path ${P} d="M16.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />`,
  megaphone: `<path ${P} d="M18 8a3 3 0 0 1 0 6" /><path ${P} d="M10 8v11a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-3" /><path ${P} d="M12 8h0l4.524 -3.77a.9 .9 0 0 1 1.476 .692v12.156a.9 .9 0 0 1 -1.476 .692l-4.524 -3.77h-8a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1z" />`,
};

/**
 * 取得單一圖示的 SVG 字串；未知名稱回傳空字串（呼叫端自行決定 fallback）。
 *
 * 預設尺寸用 1em，好讓既有容器上的 font-size（原本用來控制 emoji 大小）
 * 直接沿用，不必為每個容器另外寫尺寸規則。
 */
export function iconSvg(name: string, size: string | number = "1em"): string {
  const body = PATHS[name];
  if (!body) return "";
  const dim = typeof size === "number" ? `${size}px` : size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** 是否存在該圖示。 */
export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}

/**
 * 把 root 底下所有 `.cy-icon[data-icon]` 佔位元素填成 SVG。
 * 已填過的（data-icon-ready）會跳過，可安全重複呼叫（動態插入內容後再叫一次即可）。
 */
export function hydrateIcons(root: ParentNode = document): void {
  const nodes = root.querySelectorAll<HTMLElement>(".cy-icon[data-icon]:not([data-icon-ready])");
  for (const el of nodes) {
    const name = el.dataset.icon ?? "";
    const svg = iconSvg(name, el.dataset.iconSize || "1em");
    if (!svg) {
      console.warn("[icons] 未知圖示:", name);
      continue;
    }
    el.innerHTML = svg;
    el.dataset.iconReady = "1";
  }
}

/** DOM ready 後自動填一次；動態內容請於插入後自行再呼叫 hydrateIcons()。 */
export function autoHydrateIcons(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => hydrateIcons(), { once: true });
  } else {
    hydrateIcons();
  }
}
