import type { Client, Collection, Message, MessageCreateOptions, MessagePayload } from "discord.js";
import { createTranslator } from "@/utilities/core/i18n.js";
import { setupDefaultLang } from "@/utilities/index.js";

type Command = { data?: { toJSON(): any }; execute(message: any, translator?: any): Promise<unknown> };
type Commands = { slash: Collection<string, Command>; message: Collection<string, Command> };

const COMMAND_ALIASES: Record<string, string> = {
	"帳號": "account", "每日簽到": "daily", "即時便箋": "note", "個人簡介": "profile",
	"卡池": "cardpool", "兌換碼": "codes", "躍遷": "warp", "忘卻之庭紀錄": "forgottenhall",
	"排行榜": "leaderboard", "簡介背景": "profilebg", "自動mimo": "automimo", "清除緩存": "clear-cache"
};

const ACCOUNT_ACTIONS: Record<string, string> = {
	"說明": "HowToSetUpAccount", "教學": "HowToSetUpAccount", "help": "HowToSetUpAccount",
	"網頁": "BindAccountByWebLogin", "web": "BindAccountByWebLogin",
	"cookie": "BindAccountByCookie", "綁定": "BindAccountByCookie",
	"查看": "ViewAccount", "view": "ViewAccount", "編輯": "EditAccount", "edit": "EditAccount",
	"刪除": "DeleteAccount", "delete": "DeleteAccount"
};

const OPTION_ALIASES: Record<string, string> = {
	"帳號": "account", "使用者": "user", "自動簽到": "autosign", "簽到時間": "time",
	"標註": "tag", "模式": "mode", "選項": "options", "禮包碼": "code", "開啟": "enable",
	"版本": "version", "類型": "type", "uid": "uid", "全部角色": "allcharacters"
};

const SUBCOMMAND_ALIASES: Record<string, Record<string, string>> = {
	"note": { "查看": "check" },
	"codes": { "列表": "list", "兌換": "redeem", "兌換全部": "redeemall", "自動兌換": "autoredeem" },
	"warp": { "模擬器": "simulator", "模擬器設定": "simulator-setting", "紀錄": "log", "記錄": "log" }
};

function tokenize(input: string): string[] {
	return [...input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/gu)].map(match => match[1] ?? match[2] ?? match[3] ?? "");
}

function cleanPayload(payload: string | MessagePayload | MessageCreateOptions): any {
	if (typeof payload === "string") return payload;
	const clone = { ...(payload as any) };
	delete clone.flags;
	delete clone.ephemeral;
	delete clone.fetchReply;
	return clone;
}

function cleanEditPayload(payload: string | MessagePayload | MessageCreateOptions): any {
	const cleaned = cleanPayload(payload);
	if (typeof cleaned !== "string" && !("content" in cleaned)) {
		cleaned.content = "";
	}
	return cleaned;
}

function normalizeValue(command: string, key: string, value: string): string | boolean | number {
	if (command === "account" && key === "options") return ACCOUNT_ACTIONS[value.toLowerCase()] ?? value;
	if (["on", "開啟", "是", "true"].includes(value.toLowerCase())) {
		if (key === "allcharacters") return true;
		if (key === "tag") return "true";
		return "on";
	}
	if (["off", "關閉", "否", "false"].includes(value.toLowerCase())) {
		if (key === "allcharacters") return false;
		if (key === "tag") return "false";
		return "off";
	}
	if (key === "uid" && /^\d+$/u.test(value)) return Number(value);
	return value;
}

export async function dispatchCyreneHsrMessage(
	client: Client,
	commands: Commands,
	message: Message,
	content: string
): Promise<boolean> {
	const tokens = tokenize(content.trim().slice(1));
	const rawName = tokens.shift();
	if (!rawName) return false;
	const commandName = COMMAND_ALIASES[rawName] ?? rawName.toLowerCase();
	// Cyrene's HSR cards and generated images are always Traditional Chinese,
	// regardless of whether the user typed the English or Chinese command alias.
	await setupDefaultLang(message.author.id, "zh-TW");

	const messageCommand = commands.message.get(commandName);
	if (messageCommand) {
		if (commandName === "bind" && message.guildId) {
			await message.reply("為避免 Cookie 外洩，請私訊昔漣使用 `!bind UID Cookie內容`。");
			return true;
		}
		await messageCommand.execute(message, tokens);
		return true;
	}

	const command = commands.slash.get(commandName);
	if (!command) return false;
	const definition = command.data?.toJSON() ?? {};
	const topOptions: any[] = definition.options ?? [];
	const subcommands = topOptions.filter(option => option.type === 1);
	const values = new Map<string, unknown>();
	const positionals: string[] = [];

	for (const token of tokens) {
		const separator = token.search(/[:=]/u);
		if (separator > 0) {
			const rawKey = token.slice(0, separator);
			const key = OPTION_ALIASES[rawKey] ?? rawKey.toLowerCase();
			values.set(key, normalizeValue(commandName, key, token.slice(separator + 1)));
		} else {
			positionals.push(token);
		}
	}

	let subcommand: string | null = null;
	if (subcommands.length) {
		const requestedInput = positionals.shift()?.toLowerCase();
		const requested = requestedInput
			? (SUBCOMMAND_ALIASES[commandName]?.[requestedInput] ?? requestedInput)
			: undefined;
		subcommand = subcommands.find(option =>
			option.name === requested || Object.values(option.name_localizations ?? {}).includes(requested)
		)?.name ?? requested ?? subcommands[0]?.name ?? null;
	}
	const activeOptions = subcommand
		? (subcommands.find(option => option.name === subcommand)?.options ?? [])
		: topOptions;
	for (const option of activeOptions) {
		if (option.type === 1 || values.has(option.name) || !positionals.length) continue;
		values.set(option.name, normalizeValue(commandName, option.name, positionals.shift()!));
	}
	for (const option of activeOptions) {
		const current = values.get(option.name);
		if (typeof current !== "string" || !Array.isArray(option.choices)) continue;
		const selected = option.choices.find((choice: any) =>
			choice.value === current
			|| choice.name?.toLowerCase() === current.toLowerCase()
			|| Object.values(choice.name_localizations ?? {}).some(
				localized => String(localized).toLowerCase() === current.toLowerCase()
			)
		);
		if (selected) values.set(option.name, selected.value);
	}
	if (commandName === "account" && !values.has("options")) {
		values.set("options", normalizeValue(commandName, "options", positionals.shift() ?? "查看"));
	}

	let selectedUser: any = null;
	const selectedUserId = String(values.get("user") ?? "").replace(/\D/gu, "");
	if (selectedUserId) selectedUser = await client.users.fetch(selectedUserId).catch(() => null);
	let pending: any = null;
	let pendingCompleted = false;
	let replied = false;
	let deferred = false;
	const send = async (payload: any) => message.reply(cleanPayload(payload));
	const completePendingOrSend = async (payload: any) => {
		if (pending?.edit && !pendingCompleted) {
			pendingCompleted = true;
			return pending.edit(cleanEditPayload(payload));
		}
		return send(payload);
	};
	const fake: any = {
		client,
		commandName,
		user: message.author,
		member: message.member,
		memberPermissions: message.member?.permissions ?? null,
		guild: message.guild,
		guildId: message.guildId,
		channel: message.channel,
		channelId: message.channelId,
		locale: "zh-TW",
		createdTimestamp: message.createdTimestamp,
		get replied() { return replied; },
		get deferred() { return deferred; },
		isCommand: () => true,
		isChatInputCommand: () => true,
		options: {
			data: [],
			getSubcommand: () => subcommand,
			getString: (name: string) => values.get(name) == null ? null : String(values.get(name)),
			getInteger: (name: string) => values.get(name) == null ? null : Number(values.get(name)),
			getBoolean: (name: string) => typeof values.get(name) === "boolean" ? values.get(name) : null,
			getUser: (name: string) => name === "user" ? selectedUser : null
		},
		reply: async (payload: any) => {
			replied = true;
			if (deferred) return completePendingOrSend(payload);
			pending = await send(payload);
			pendingCompleted = true;
			return pending;
		},
		deferReply: async () => {
			deferred = true;
			pendingCompleted = false;
			pending = await send("⏳ 崩鐵指令處理中…");
			return pending;
		},
		editReply: async (payload: any) => {
			replied = true;
			if (pending?.edit) {
				pendingCompleted = true;
				return pending.edit(cleanEditPayload(payload));
			}
			pending = await send(payload);
			pendingCompleted = true;
			return pending;
		},
		followUp: completePendingOrSend,
		showModal: async () => {
			replied = true;
			return send("訊息指令無法開啟 Discord 表單。Cookie 綁定請私訊昔漣：`!bind UID Cookie內容`。");
		}
	};

	try {
		await command.execute(fake, createTranslator("tw"));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (pending?.edit) await pending.edit(`崩鐵指令執行失敗：${detail}`).catch(() => undefined);
		else await message.reply(`崩鐵指令執行失敗：${detail}`).catch(() => undefined);
	}
	return true;
}
