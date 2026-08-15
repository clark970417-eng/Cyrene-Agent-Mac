import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  Interaction,
  Message,
} from "discord.js";

export type HsrCommandDefinition = {
  type?: number;
  name: string;
  description?: string;
  options?: unknown[];
};

type EmbeddedHsrModule = {
  loadEmbedded(client: Client): Promise<{
    commandDefinitions: HsrCommandDefinition[];
    commandNames: string[];
  }>;
  dispatchEmbeddedInteraction(interaction: Interaction): Promise<boolean>;
  dispatchEmbeddedMessage(message: Message, content: string): Promise<boolean>;
};

export type HsrBridge = {
  commandDefinitions: HsrCommandDefinition[];
  commandNames: ReadonlySet<string>;
  ownsInteraction(interaction: Interaction): boolean;
  dispatch(interaction: Interaction): Promise<boolean>;
  ownsMessage(content: string): boolean;
  dispatchMessage(message: Message, content: string): Promise<boolean>;
};

const HSR_BANG_COMMANDS = new Set([
  "account", "帳號", "bind", "daily", "每日簽到", "note", "即時便箋",
  "profile", "個人簡介", "cardpool", "卡池", "codes", "兌換碼", "warp", "躍遷",
  "forgottenhall", "忘卻之庭紀錄", "leaderboard", "排行榜", "profilebg", "簡介背景",
  "automimo", "自動mimo", "clear-cache", "清除緩存", "autodaily",
]);

export function isHsrBangCommand(content: string): boolean {
  const match = content.trim().match(/^!([^\s]+)/u);
  return Boolean(match?.[1] && HSR_BANG_COMMANDS.has(match[1].toLowerCase()));
}

export const CYRENE_HSR_COMPONENT_PREFIXES = [
  "account",
  "leaderboard",
  "profile_",
  "profilebg_",
  "news",
  "guide",
  "forgottenHall_",
  "cookie_set",
  "simulator-set",
  "warp_query",
  "WarpMenu",
] as const;

export function defaultHsrInstallRoot(): string {
  return process.env.CYRENE_HSR_ROOT?.trim()
    || path.join(os.homedir(), ".local", "share", "cyrene-hsr", "hsr-discord-bot");
}

export function isHsrComponentId(customId: string): boolean {
  return CYRENE_HSR_COMPONENT_PREFIXES.some((prefix) => customId.startsWith(prefix));
}

export type HsrNativeRuntimeProbe = {
  compatible: boolean;
  reason?: string;
};

/**
 * Probe better-sqlite3 in a disposable Electron-as-Node child process.
 *
 * The external HSR package may call process.exit when its database bootstrap
 * fails. Importing an ABI-incompatible native module directly into the desktop
 * process can therefore terminate the entire app before our try/catch runs.
 */
export function probeHsrNativeRuntime(
  installRoot: string,
  executablePath = process.execPath,
): HsrNativeRuntimeProbe {
  const moduleRoot = path.join(installRoot, "node_modules", "better-sqlite3");
  if (!fs.existsSync(moduleRoot)) {
    return { compatible: false, reason: `better-sqlite3 未安裝：${moduleRoot}` };
  }

  const probeScript = [
    "const Database = require(process.argv[1]);",
    "const db = new Database(':memory:');",
    "db.close();",
  ].join("");
  const result = spawnSync(executablePath, ["-e", probeScript, moduleRoot], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 10_000,
  });

  if (result.status === 0) return { compatible: true };
  const detail = result.error?.message
    || result.stderr?.trim().split("\n").slice(-4).join(" ")
    || `probe exit status ${String(result.status)}`;
  return { compatible: false, reason: detail };
}

export function mergeHsrCommandDefinitions(
  cyrene: HsrCommandDefinition[],
  hsr: HsrCommandDefinition[],
): HsrCommandDefinition[] {
  const merged = new Map(cyrene.map((command) => [command.name, command]));
  for (const command of hsr) {
    if (!merged.has(command.name)) merged.set(command.name, command);
  }
  return [...merged.values()];
}

export async function loadHsrBridge(
  client: Client,
  allowedUserIds: string[],
  installRoot = defaultHsrInstallRoot(),
): Promise<HsrBridge | null> {
  const entryPath = path.join(installRoot, "dist", "index.js");
  if (!fs.existsSync(entryPath)) return null;

  const nativeRuntime = probeHsrNativeRuntime(installRoot);
  if (!nativeRuntime.compatible) {
    console.warn(
      "[DiscordAdapter] 星穹鐵道工具的 native runtime 不相容；已安全略過，桌面 App 繼續運行：",
      nativeRuntime.reason,
    );
    return null;
  }

  process.env.CYRENE_HSR_EMBEDDED = "1";
  process.env.CYRENE_HSR_ALLOWED_USER_IDS = [...new Set(allowedUserIds)].join(",");
  process.env.CYRENE_HSR_DB_PATH = process.env.CYRENE_HSR_DB_PATH?.trim()
    || path.join(path.dirname(installRoot), "data", "hsr.sqlite");
  // Upstream validates TOKEN while loading its config. Embedded mode never calls login.
  process.env.TOKEN ||= "cyrene-embedded-client";
  (globalThis as typeof globalThis & { __CYRENE_HSR_CLIENT__?: Client }).__CYRENE_HSR_CLIENT__ = client;

  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<EmbeddedHsrModule>;
  const embedded = await dynamicImport(pathToFileURL(entryPath).href);
  if (
    typeof embedded.loadEmbedded !== "function"
    || typeof embedded.dispatchEmbeddedInteraction !== "function"
    || typeof embedded.dispatchEmbeddedMessage !== "function"
  ) {
    throw new Error("崩鐵工具模組尚未套用昔漣相容修補，請重新執行 install-mac.sh");
  }

  const loaded = await embedded.loadEmbedded(client);
  const commandNames = new Set(loaded.commandNames);
  return {
    commandDefinitions: loaded.commandDefinitions,
    commandNames,
    ownsInteraction(interaction) {
      if (interaction.isCommand() || interaction.isAutocomplete()) {
        return commandNames.has(interaction.commandName);
      }
      if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
        return isHsrComponentId(interaction.customId);
      }
      return false;
    },
    dispatch: (interaction) => embedded.dispatchEmbeddedInteraction(interaction),
    ownsMessage: isHsrBangCommand,
    dispatchMessage: (message, content) => embedded.dispatchEmbeddedMessage(message, content),
  };
}

export type HsrDispatchableInteraction =
  | ChatInputCommandInteraction
  | AutocompleteInteraction;
