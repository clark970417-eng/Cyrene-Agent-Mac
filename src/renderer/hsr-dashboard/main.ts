import "../ui/theme";
import "./hsr-dashboard.css";

type BoundAccount = { uid: string; nickname: string | null; region: string | null; lastUpdate: string | null; invalid: boolean };
type Property = { type: string; name: string; value: number; percent: boolean };
type Relic = { id: string; name: string; level: number; icon: string; slot: string; mainStat: Property | null; subStats: Property[] };
type LightCone = { id: string; name: string; level: number; rank: number; icon: string };
type Character = {
  id: string; name: string; level: number; eidolon: number; rarity: number; icon: string; portrait: string;
  path: string; element: string; lightCone: string | null; lightConeDetail: LightCone | null;
  relics: Relic[]; bonusStats: Property[]; skillLevels: number[];
};
type Profile = {
  uid: string; nickname: string; level: number; worldLevel: number; signature: string; avatar: string;
  achievements: number | null; charactersCount: number | null; lightConesCount: number | null;
  memoryLevel: number | null; memoryChaosLevel: number | null; memoryChaosStars: number | null; universeLevel: number | null;
  characters: Character[]; fetchedAt: string;
};
type Status = { installed: boolean; databaseReady: boolean; accounts: BoundAccount[]; activeUid: string | null };

declare global {
  interface Window {
    hsrDashboard?: {
      status: () => Promise<Status>;
      profile: (uid?: string) => Promise<{ ok: boolean; profile?: Profile; error?: string }>;
    };
  }
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const views = ["loading-view", "empty-view", "error-view", "profile-view"].map((id) => byId<HTMLElement>(id));
const uidInput = byId<HTMLInputElement>("uid-input");
const accountSelect = byId<HTMLSelectElement>("account-select");
const accountSelectWrap = byId<HTMLElement>("account-select-wrap");
const accountState = byId<HTMLElement>("account-state");
const sourceState = byId<HTMLElement>("source-state");
let currentUid = "";
let lastFocusedCard: HTMLElement | null = null;

function showView(id: string): void {
  for (const view of views) view.hidden = view.id !== id;
}

function value(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("zh-TW").format(value);
}

function setText(id: string, text: string): void {
  byId<HTMLElement>(id).textContent = text;
}

function imageFallback(image: HTMLImageElement, label: string): void {
  image.onerror = () => {
    image.hidden = true;
    image.parentElement?.classList.add("is-image-missing");
    image.parentElement?.setAttribute("data-fallback", label.slice(0, 1));
  };
}

function formatProperty(property: Property): string {
  if (property.percent) return `${(property.value * 100).toFixed(1).replace(/\.0$/, "")}%`;
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(property.value);
}

function appendImage(container: HTMLElement, src: string, alt: string): HTMLImageElement {
  const image = document.createElement("img");
  image.src = src;
  image.alt = alt;
  image.loading = "lazy";
  imageFallback(image, alt);
  container.appendChild(image);
  return image;
}

function openCharacterDetail(character: Character, index: number): void {
  const dialog = byId<HTMLDialogElement>("character-dialog");
  dialog.dataset.element = character.element;
  setText("detail-index", `ARCHIVE / ${String(index + 1).padStart(2, "0")} · ${character.id}`);
  setText("detail-meta", `${character.element || "未知屬性"} · ${character.path || "未知命途"}`);
  setText("detail-name", character.name);
  setText("detail-visual-name", character.name);
  setText("detail-level", `等級 ${character.level}  ·  ${character.eidolon} 魂  ·  ${character.rarity} 星角色`);

  const portrait = byId<HTMLImageElement>("detail-portrait");
  portrait.hidden = false;
  portrait.parentElement?.classList.remove("is-image-missing");
  portrait.src = character.portrait || character.icon;
  portrait.alt = `${character.name}角色立繪`;
  imageFallback(portrait, character.name);

  const statGrid = byId<HTMLElement>("detail-stat-grid");
  statGrid.replaceChildren();
  const featuredStats = character.bonusStats.filter((property) => !/^Base/.test(property.type)).slice(0, 8);
  if (!featuredStats.length) {
    const empty = document.createElement("p");
    empty.className = "detail-inline-empty";
    empty.textContent = "公開資料未提供遺器屬性。";
    statGrid.appendChild(empty);
  } else {
    for (const property of featuredStats) {
      const item = document.createElement("div");
      const label = document.createElement("span");
      const number = document.createElement("strong");
      label.textContent = property.name;
      number.textContent = formatProperty(property);
      item.append(label, number);
      statGrid.appendChild(item);
    }
  }

  const lightCone = byId<HTMLElement>("detail-lightcone");
  lightCone.replaceChildren();
  const coneLabel = document.createElement("span");
  coneLabel.textContent = "LIGHT CONE";
  const coneArt = document.createElement("div");
  coneArt.className = "lightcone-art";
  const coneCopy = document.createElement("div");
  const coneTitle = document.createElement("h3");
  coneTitle.textContent = character.lightConeDetail?.name || character.lightCone || "未裝備光錐";
  const coneDetail = document.createElement("p");
  coneDetail.textContent = character.lightConeDetail
    ? `Lv.${character.lightConeDetail.level} · 疊影 ${character.lightConeDetail.rank}`
    : "公開資料未提供光錐詳情";
  if (character.lightConeDetail?.icon) appendImage(coneArt, character.lightConeDetail.icon, character.lightConeDetail.name);
  coneCopy.append(coneTitle, coneDetail);
  lightCone.append(coneLabel, coneArt, coneCopy);

  const traces = byId<HTMLElement>("detail-traces");
  traces.replaceChildren();
  const levels = character.skillLevels.length ? character.skillLevels : [0, 0, 0, 0];
  for (const [traceIndex, level] of levels.entries()) {
    const trace = document.createElement("span");
    trace.innerHTML = `<i>${traceIndex + 1}</i><b>${level ? `Lv.${level}` : "—"}</b>`;
    traces.appendChild(trace);
  }

  const relics = byId<HTMLElement>("detail-relics");
  relics.replaceChildren();
  if (!character.relics.length) {
    const empty = document.createElement("p");
    empty.className = "detail-inline-empty";
    empty.textContent = "公開資料未提供遺器配置。";
    relics.appendChild(empty);
  } else {
    for (const relic of character.relics) {
      const item = document.createElement("article");
      item.className = "relic-card";
      const icon = document.createElement("div");
      icon.className = "relic-icon";
      if (relic.icon) appendImage(icon, relic.icon, relic.name);
      const copy = document.createElement("div");
      const slot = document.createElement("span");
      slot.textContent = `${relic.slot} · +${relic.level}`;
      const name = document.createElement("strong");
      name.textContent = relic.name;
      const main = document.createElement("p");
      main.textContent = relic.mainStat ? `${relic.mainStat.name} ${formatProperty(relic.mainStat)}` : "主詞條未提供";
      copy.append(slot, name, main);
      item.append(icon, copy);
      relics.appendChild(item);
    }
  }

  if (!dialog.open) dialog.showModal();
}

function renderRoster(characters: Character[]): void {
  const roster = byId<HTMLElement>("roster");
  const empty = byId<HTMLElement>("roster-empty");
  roster.replaceChildren();
  empty.hidden = characters.length > 0;
  for (const character of characters) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `character-card rarity-${Math.min(5, Math.max(3, character.rarity))}`;
    card.setAttribute("aria-label", `查看 ${character.name} 的角色面板`);
    card.addEventListener("click", () => {
      lastFocusedCard = card;
      openCharacterDetail(character, characters.indexOf(character));
    });

    const art = document.createElement("div");
    art.className = "character-art";
    const image = document.createElement("img");
    image.src = character.portrait || character.icon;
    image.alt = character.name;
    image.loading = "lazy";
    imageFallback(image, character.name);
    art.appendChild(image);

    const copy = document.createElement("div");
    copy.className = "character-copy";
    const meta = document.createElement("span");
    meta.textContent = `${character.element || "未知屬性"} · ${character.path || "未知命途"}`;
    const name = document.createElement("strong");
    name.textContent = character.name;
    const details = document.createElement("small");
    details.textContent = `Lv.${character.level} · ${character.eidolon} 魂${character.lightCone ? ` · ${character.lightCone}` : ""}`;
    copy.append(meta, name, details);
    card.append(art, copy);
    roster.appendChild(card);
  }
}

function renderProfile(profile: Profile): void {
  currentUid = profile.uid;
  uidInput.value = profile.uid;
  setText("player-uid", profile.uid);
  setText("player-name", profile.nickname);
  setText("player-signature", profile.signature || "這位開拓者沒有留下簽名。 ");
  setText("player-level", String(profile.level));
  setText("world-level", String(profile.worldLevel));
  setText("stat-achievements", value(profile.achievements));
  setText("stat-characters", value(profile.charactersCount));
  setText("stat-lightcones", value(profile.lightConesCount));
  const memory = profile.memoryChaosLevel ?? profile.memoryLevel;
  setText("stat-memory", memory === null ? "—" : `${memory}${profile.memoryChaosStars === null ? "" : ` / ${profile.memoryChaosStars}★`}`);
  setText("stat-universe", value(profile.universeLevel));
  setText("sync-time", `最後同步 ${new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(profile.fetchedAt))}`);
  const avatar = byId<HTMLImageElement>("player-avatar");
  avatar.hidden = !profile.avatar;
  avatar.src = profile.avatar;
  if (profile.avatar) imageFallback(avatar, profile.nickname);
  renderRoster(profile.characters);
  showView("profile-view");
}

async function loadProfile(uid: string): Promise<void> {
  const normalized = uid.replace(/\D/g, "").slice(0, 9);
  uidInput.value = normalized;
  if (!/^\d{9}$/.test(normalized)) {
    byId<HTMLElement>("error-message").textContent = "請輸入完整的 9 位數 UID。";
    showView("error-view");
    return;
  }
  currentUid = normalized;
  showView("loading-view");
  const result = await window.hsrDashboard?.profile(normalized).catch((error) => ({ ok: false, error: String(error) }));
  if (!result?.ok || !result.profile) {
    byId<HTMLElement>("error-message").textContent = result?.error || "主程式尚未提供崩鐵資料介面，請重新啟動 App。";
    showView("error-view");
    return;
  }
  renderProfile(result.profile);
}

async function initialize(): Promise<void> {
  showView("loading-view");
  const status = await window.hsrDashboard?.status().catch(() => null);
  if (!status) {
    accountState.textContent = "無法連接主程式";
    sourceState.className = "source-state is-offline";
    sourceState.querySelector("b")!.textContent = "主程式未就緒";
    showView("empty-view");
    return;
  }
  sourceState.className = status.installed ? "source-state is-online" : "source-state is-offline";
  sourceState.querySelector("b")!.textContent = status.installed ? "HSR Bot 已連接" : "僅使用公開資料";
  accountState.textContent = status.accounts.length
    ? `已找到 ${status.accounts.length} 個 Bot 綁定角色`
    : status.databaseReady ? "Bot 尚未綁定帳號，可直接輸入 UID" : "尚未建立 Bot 資料庫，可直接輸入 UID";
  accountSelect.replaceChildren(...status.accounts.map((account) => {
    const option = document.createElement("option");
    option.value = account.uid;
    option.textContent = `${account.nickname || "開拓者"} · ${account.uid}${account.invalid ? "（需更新登入）" : ""}`;
    return option;
  }));
  accountSelectWrap.hidden = status.accounts.length === 0;
  if (status.activeUid) {
    accountSelect.value = status.activeUid;
    await loadProfile(status.activeUid);
  } else showView("empty-view");
}

byId<HTMLFormElement>("uid-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void loadProfile(uidInput.value);
});
uidInput.addEventListener("input", () => { uidInput.value = uidInput.value.replace(/\D/g, "").slice(0, 9); });
accountSelect.addEventListener("change", () => void loadProfile(accountSelect.value));
byId<HTMLButtonElement>("refresh-btn").addEventListener("click", () => void loadProfile(currentUid));
byId<HTMLButtonElement>("retry-btn").addEventListener("click", () => currentUid ? void loadProfile(currentUid) : void initialize());
const characterDialog = byId<HTMLDialogElement>("character-dialog");
byId<HTMLButtonElement>("detail-close").addEventListener("click", () => characterDialog.close());
characterDialog.addEventListener("click", (event) => {
  if (event.target === characterDialog) characterDialog.close();
});
characterDialog.addEventListener("close", () => lastFocusedCard?.focus());

void initialize();
