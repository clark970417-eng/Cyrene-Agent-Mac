import { Client } from "discord.js";

process.env.CYRENE_HSR_EMBEDDED = "1";
process.env.CYRENE_HSR_DB_PATH = "/private/tmp/cyrene-hsr-pending-verify.sqlite";
process.env.CYRENE_HSR_ALLOWED_USER_IDS = "pending-test-user";
process.env.TOKEN = "verification-only";
globalThis.__CYRENE_HSR_CLIENT__ = new Client({ intents: [] });

const hsr = await import(
	"/Users/clark/.local/share/cyrene-hsr/hsr-discord-bot/dist/index.js"
);
await hsr.loadEmbedded(globalThis.__CYRENE_HSR_CLIENT__);

const replies = [];
const edits = [];
const pending = {
	edit: async payload => {
		edits.push(payload);
		return pending;
	}
};
const message = {
	author: { id: "pending-test-user", displayName: "測試者" },
	member: null,
	guild: null,
	guildId: null,
	channel: { id: "pending-test-channel" },
	channelId: "pending-test-channel",
	createdTimestamp: Date.now(),
	reply: async payload => {
		replies.push(payload);
		return pending;
	}
};

await hsr.dispatchEmbeddedMessage(message, "!daily");
if (replies[0] !== "⏳ 崩鐵指令處理中…") {
	throw new Error(`沒有先送出處理中訊息：${JSON.stringify(replies[0])}`);
}
if (!edits[0] || typeof edits[0] !== "object" || edits[0].content !== "") {
	throw new Error(`完成訊息未清除處理中文字：${JSON.stringify(edits[0])}`);
}
console.log(JSON.stringify({ pending: replies[0], finalContent: edits[0].content, embeds: edits[0].embeds?.length ?? 0 }));
process.exit(0);
