import fs from "node:fs/promises";
import { Client } from "discord.js";

process.env.CYRENE_HSR_EMBEDDED = "1";
process.env.CYRENE_HSR_DB_PATH = "/private/tmp/cyrene-hsr-zh-verify.sqlite";
process.env.TOKEN = "verification-only";
globalThis.__CYRENE_HSR_CLIENT__ = new Client({ intents: [] });

const profile = await import(
	"/Users/clark/.local/share/cyrene-hsr/hsr-discord-bot/dist/utilities/hsr/profile.js"
);

const ids = ["1408", "1407", "1406", "1405"];
const elements = ["physical", "quantum", "quantum", "wind"];
const characters = ids.map((id, index) => ({
	id,
	name: ["Phainon", "Castorice", "Cipher", "Anaxa"][index],
	level: 80,
	rank: index,
	rarity: 5,
	icon: `/Users/clark/.local/share/cyrene-hsr/hsr-discord-bot/src/assets/image/character_portrait/${id}.png`,
	figure_path: `/Users/clark/.local/share/cyrene-hsr/hsr-discord-bot/src/assets/image/character_portrait/${id}.png`,
	element: elements[index],
	path: index === 0 ? "destruction" : "remembrance"
}));

const localized = await profile.localizeCharactersTraditionalChinese(characters);
const expected = ["白厄", "遐蝶", "賽飛兒", "那刻夏"];
if (localized.map(character => character.name).join("|") !== expected.join("|")) {
	throw new Error(`角色繁中映射錯誤：${localized.map(character => character.name).join("|")}`);
}

const tr = key => ({
	profile_TrailblazeLevel: "開拓等級",
	profile_CharactersCount: "角色數量"
})[key] || key;
const image = await profile.drawAllCharactersImage(
	tr,
	{
		player: {
			nickname: "繁中驗證",
			uid: "801000001",
			level: 70,
			avatar: { icon: characters[0].icon }
		},
		characters: localized
	},
	localized
);
if (!image?.length) throw new Error("繁中角色名冊圖片生成失敗");
await fs.writeFile("/private/tmp/cyrene-hsr-zh-profile.webp", image);
console.log(JSON.stringify({ names: localized.map(character => character.name), bytes: image.length }));
process.exit(0);
