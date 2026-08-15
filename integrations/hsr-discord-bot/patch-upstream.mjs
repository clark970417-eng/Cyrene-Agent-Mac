#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.argv[2] ?? process.cwd());
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));

function edit(relativePath, edits) {
  const filePath = path.join(root, relativePath);
  let source = fs.readFileSync(filePath, "utf8");
  for (const [before, after] of edits) {
    if (source.includes(after)) continue;
    if (
      relativePath === "src/index.ts"
      && before === "const client = new Client({"
      && source.includes("const embeddedClientProxy = injectedClient")
    ) continue;
    if (
      relativePath === "src/index.ts"
      && before.startsWith("client.login(process.env.NODE_ENV")
      && source.includes("export async function loadEmbedded(hostClient: Client)")
    ) continue;
    if (!source.includes(before)) {
      throw new Error(`無法修補 ${relativePath}：找不到預期片段 ${JSON.stringify(before.slice(0, 80))}`);
    }
    source = source.replace(before, after);
  }
  fs.writeFileSync(filePath, source);
}

{
  const indexPath = path.join(root, "src/index.ts");
  const source = fs.readFileSync(indexPath, "utf8");
  if (source.includes("const embeddedEvents = new Set(")) {
    fs.writeFileSync(indexPath, source.replace(
      /const embeddedEvents = new Set\(\[[^\n]+\]\);/,
      'const embeddedEvents = new Set(["interactionCreate.js", "autoComplete.js", "selectMenu.js", "modal.js", "warp.js", "ready.js"]);',
    ));
  }
}

edit("src/index.ts", [
  [
    "const client = new Client({",
    "const injectedClient = (globalThis as typeof globalThis & { __CYRENE_HSR_CLIENT__?: Client }).__CYRENE_HSR_CLIENT__;\nconst client = injectedClient ?? new Client({",
  ],
  [
    "const cluster = new ClusterClient(client);",
    "const cluster = (injectedClient\n\t? ({ id: 0, broadcastEval: async () => [] } as unknown as ClusterClient)\n\t: new ClusterClient(client));",
  ],
  [
    "database = new QuickDB();",
    "database = new QuickDB(process.env.CYRENE_HSR_DB_PATH\n\t\t? { filePath: process.env.CYRENE_HSR_DB_PATH }\n\t\t: undefined);",
  ],
  [
    "\t\tconst eventPaths = await getAllFiles(`${__dirname}/events`, [\".js\"]);\n\t\tawait bindEvents(eventPaths);",
    "\t\tconst allEventPaths = await getAllFiles(`${__dirname}/events`, [\".js\"]);\n\t\tconst embeddedEvents = new Set([\"interactionCreate.js\", \"autoComplete.js\", \"selectMenu.js\", \"modal.js\", \"warp.js\", \"ready.js\"]);\n\t\tconst eventPaths = injectedClient\n\t\t\t? allEventPaths.filter(eventPath => embeddedEvents.has(eventPath.split(\"/\").at(-1) || \"\"))\n\t\t\t: allEventPaths;\n\t\tawait bindEvents(eventPaths);",
  ],
  [
    "\t\tclient.once(\"ready\", async () => {",
    "\t\tif (!injectedClient) client.once(\"ready\", async () => {",
  ],
  [
    "\t\t});\n\t} catch (error) {",
    "\t\t});\n\n\t\treturn slashCommands;\n\t} catch (error) {",
  ],
  [
    "\t\tnew Logger(\"系統\").error(`載入指令失敗: ${error}`);\n\t\tprocess.exit(1);",
    "\t\tnew Logger(\"系統\").error(`載入指令失敗: ${error}`);\n\t\tif (injectedClient) throw error;\n\t\tprocess.exit(1);",
  ],
  [
    "client.login(process.env.NODE_ENV === \"dev\" ? config.TEST_TOKEN : config.TOKEN);\n\nload();\n\nexport { client, database, cluster, commands };",
    `if (!injectedClient) {\n\tclient.login(process.env.NODE_ENV === "dev" ? config.TEST_TOKEN : config.TOKEN);\n\tvoid load();\n}\n\nlet embeddedLoad: Promise<any> | null = null;\nexport async function loadEmbedded(hostClient: Client) {\n\tif (hostClient !== client) throw new Error("昔漣 Discord Client 已更換，請重新啟動 App 後再載入星鐵工具");\n\tembeddedLoad ||= load();\n\tconst definitions = await embeddedLoad;\n\treturn {\n\t\tcommandDefinitions: definitions.map((definition: any) =>\n\t\t\ttypeof definition?.toJSON === "function" ? definition.toJSON() : definition\n\t\t),\n\t\tcommandNames: [...commands.slash.keys()]\n\t};\n}\n\nexport async function dispatchEmbeddedInteraction() {\n\t// The patched upstream listeners receive the original Client event immediately\n\t// after Cyrene yields ownership of this interaction.\n\treturn true;\n}\n\nexport { client, database, cluster, commands };`,
  ],
]);

edit("src/index.ts", [["\"autocomplete.js\"", "\"autoComplete.js\""]]);
edit("src/index.ts", [[
  "const injectedClient = (globalThis as typeof globalThis & { __CYRENE_HSR_CLIENT__?: Client }).__CYRENE_HSR_CLIENT__;\nconst client = injectedClient ?? new Client({",
  `const injectedClient = (globalThis as typeof globalThis & { __CYRENE_HSR_CLIENT__?: Client }).__CYRENE_HSR_CLIENT__;
type EmbeddedListener = { event: string | symbol; listener: (...args: any[]) => void; once: boolean };
let embeddedClientTarget = injectedClient;
const embeddedListeners: EmbeddedListener[] = [];
const embeddedClientProxy = injectedClient
	? new Proxy(injectedClient, {
		get(_target, property) {
			if (property === "on" || property === "once") {
				return (event: string | symbol, listener: (...args: any[]) => void) => {
					embeddedListeners.push({ event, listener, once: property === "once" });
					if (property === "once") embeddedClientTarget?.once(event, listener);
					else embeddedClientTarget?.on(event, listener);
					return client;
				};
			}
			const value = (embeddedClientTarget as any)?.[property];
			return typeof value === "function" ? value.bind(embeddedClientTarget) : value;
		},
		set(_target, property, value) {
			(embeddedClientTarget as any)[property] = value;
			return true;
		}
	})
	: null;
const client = (embeddedClientProxy ?? new Client({` ,
], [
  "\tshardCount: getInfo().TOTAL_SHARDS\n});\n\n/**\n * @description 集群客戶端",
  "\tshardCount: getInfo().TOTAL_SHARDS\n})) as Client;\n\n/**\n * @description 集群客戶端",
], [
  "export async function loadEmbedded(hostClient: Client) {\n\tif (hostClient !== client) throw new Error(\"昔漣 Discord Client 已更換，請重新啟動 App 後再載入星鐵工具\");\n\tembeddedLoad ||= load();",
  `export async function loadEmbedded(hostClient: Client) {
	if (embeddedClientTarget && embeddedClientTarget !== hostClient) {
		embeddedClientTarget = hostClient;
		for (const binding of embeddedListeners) {
			if (binding.once) hostClient.once(binding.event, binding.listener);
			else hostClient.on(binding.event, binding.listener);
		}
	}
	embeddedLoad ||= load();`,
]]);

edit("src/index.ts", [[
  `export async function dispatchEmbeddedInteraction() {
	// The patched upstream listeners receive the original Client event immediately
	// after Cyrene yields ownership of this interaction.
	return true;
}

export { client, database, cluster, commands };`,
  `export async function dispatchEmbeddedInteraction() {
	// The patched upstream listeners receive the original Client event immediately
	// after Cyrene yields ownership of this interaction.
	return true;
}

export async function dispatchEmbeddedMessage(message: any, content: string) {
	const { dispatchCyreneHsrMessage } = await import("./cyreneMessage.js");
	return dispatchCyreneHsrMessage(client, commands, message, content);
}

export { client, database, cluster, commands };`,
]]);

const guardImport = 'import { isCyreneHsrInteractionAllowed } from "@/utilities/core/cyrene.js";';
edit("src/events/interactionCreate.ts", [
  [
    'import { drainPendingLogins } from "@/utilities/webhookLogin.js";',
    `import { drainPendingLogins } from "@/utilities/webhookLogin.js";\n${guardImport}`,
  ],
  [
    "const webhook = new WebhookClient({ url: config.CMDWEBHOOK || \"\" });",
    "const webhook = config.CMDWEBHOOK ? new WebhookClient({ url: config.CMDWEBHOOK }) : null;",
  ],
  [
    "client.on(Events.InteractionCreate, async (interaction: Interaction) => {\n\tif (interaction.channel?.type == ChannelType.DM) return;",
    "client.on(Events.InteractionCreate, async (interaction: Interaction) => {\n\tif (!isCyreneHsrInteractionAllowed(interaction, commands.slash)) return;\n\tif (interaction.channel?.type == ChannelType.DM) return;",
  ],
  ["\t\t\twebhook.send({", "\t\t\twebhook?.send({"],
]);

edit("src/events/autoComplete.ts", [
  [
    'import { drainPendingLogins } from "@/utilities/webhookLogin.js";',
    `import { drainPendingLogins } from "@/utilities/webhookLogin.js";\n${guardImport}`,
  ],
  [
    "client.on(Events.InteractionCreate, async (interaction: any) => {\n\tif (!interaction.isAutocomplete()) return;",
    "client.on(Events.InteractionCreate, async (interaction: any) => {\n\tif (!isCyreneHsrInteractionAllowed(interaction)) return;\n\tif (!interaction.isAutocomplete()) return;",
  ],
]);

for (const [file, callback] of [
  ["src/events/selectMenu.ts", "client.on(Events.InteractionCreate, async (interaction: Interaction) => {"],
  ["src/events/modal.ts", "client.on(Events.InteractionCreate, async interaction => {"],
  ["src/events/warp.ts", "client.on(Events.InteractionCreate, async interaction => {"],
]) {
  edit(file, [
    [
      callback,
      `${guardImport}\n\n${callback}\n\tif (!isCyreneHsrInteractionAllowed(interaction)) return;`,
    ],
  ]);
}

edit("src/events/ready.ts", [[
  "\tif (presenceInterval) clearInterval(presenceInterval);\n\tpresenceInterval = setInterval(updatePresence, 300_000);",
  "\tif (process.env.CYRENE_HSR_EMBEDDED !== \"1\") {\n\t\tif (presenceInterval) clearInterval(presenceInterval);\n\t\tpresenceInterval = setInterval(updatePresence, 300_000);\n\t}",
]]);

edit("src/utilities/hsr/autoDaily.ts", [
  ["private webhook: WebhookClient;", "private webhook: WebhookClient | null;"],
  [
    "this.webhook = new WebhookClient({ url: webhookUrl });",
    "this.webhook = webhookUrl ? new WebhookClient({ url: webhookUrl }) : null;",
  ],
  [
    "\t\tif (!this.webhook?.url) {\n\t\t\tthrow new Error(\"無效的 webhook 配置\");\n\t\t}",
    "\t\t// 統計 webhook 為選配；昔漣嵌入模式沒有設定也可正常簽到。",
  ],
  ["await this.webhook.send({ embeds: [statsEmbed] });", "await this.webhook?.send({ embeds: [statsEmbed] });"],
  [
    "\tgetLanguage(locale: string): LanguageEnum {",
    `\tprivate async sendChannelMessage(
\t\tchannelId: string,
\t\tpayload: { content?: string; embeds?: object[] },
\t\tfile?: { buffer: Buffer; name: string }
\t): Promise<void> {
\t\tif (process.env.CYRENE_HSR_EMBEDDED !== "1") {
\t\t\tawait sendRestMessage(channelId, payload, file);
\t\t\treturn;
\t\t}
\t\tif (!channelId) throw new Error("未設定通知頻道，改用私訊通知");
\t\tconst channel = await this.client.channels.fetch(channelId);
\t\tif (!channel || !("send" in channel)) throw new Error("通知頻道不存在或無法傳送訊息");
\t\tawait (channel as any).send({
\t\t\t...payload,
\t\t\t...(file ? { files: [new AttachmentBuilder(file.buffer, { name: file.name })] } : {})
\t\t});
\t}

\tprivate async sendDirectMessage(
\t\tuserId: string,
\t\tpayload: { content?: string; embeds?: object[] },
\t\tfile?: { buffer: Buffer; name: string }
\t): Promise<void> {
\t\tif (process.env.CYRENE_HSR_EMBEDDED !== "1") {
\t\t\tawait sendRestDm(userId, payload, file);
\t\t\treturn;
\t\t}
\t\tconst user = await this.client.users.fetch(userId);
\t\tawait user.send({
\t\t\t...payload,
\t\t\t...(file ? { files: [new AttachmentBuilder(file.buffer, { name: file.name })] } : {})
\t\t});
\t}

\tgetLanguage(locale: string): LanguageEnum {`,
  ],
  ["await sendRestMessage(channelId, restPayloadSuccess, fileArg);", "await this.sendChannelMessage(channelId, restPayloadSuccess, fileArg);"],
  ["await sendRestDm(userId, restPayloadSuccess, fileArg);", "await this.sendDirectMessage(userId, restPayloadSuccess, fileArg);"],
  ["await sendRestMessage(cid, msgPayload);", "await this.sendChannelMessage(cid, msgPayload);"],
  ["await sendRestDm(uid, msgPayload);", "await this.sendDirectMessage(uid, msgPayload);"],
]);

edit("src/assets/languages/tw.ts", [[
  "### 🔥 如何取得 Cookie\\n1. 開啟 [Hoyolab](https://www.hoyolab.com/) 網頁並登入帳號\\n2. 按下 `F12` 或 `Ctrl + Shift + I` 打開開發者工具\\n3. 切換至 `Application` 選擇左邊的 `Cookies` → `https://www.hoyolab.com`\\n4. 找到以下欄位並複製其值：`ltoken_v2`、`ltuid_v2`、`cookie_token_v2`、`account_mid_v2`\\n5. 將它們填入各個欄位即可！",
  "### 🍎 macOS 綁定方式\\n1. 用 Chrome 開啟 [HoYoLAB](https://www.hoyolab.com/) 並登入\\n2. 按 `Option + Command + I` 開啟開發者工具\\n3. 選 `Application` → 左側 `Cookies` → `https://www.hoyolab.com`\\n4. 複製 `ltoken_v2`、`ltuid_v2`、`cookie_token_v2`、`account_mid_v2` 的值\\n5. 在遊戲內確認你的 9–10 位 UID\\n6. **只在私訊昔漣**輸入：`!bind UID ltoken_v2=值; ltuid_v2=值; cookie_token_v2=值; account_mid_v2=值`\\n\\n⚠️ Cookie 等同登入憑證，請勿貼在伺服器公開頻道或傳給其他人。",
]]);

// Cyrene's HSR commands always render in Traditional Chinese. HoYoLAB's record
// API returns character names in English, so translate by character ID before
// building profile menus or canvases (including component redraws).
{
  const profilePath = path.join(root, "src/utilities/hsr/profile.ts");
  const source = fs.readFileSync(profilePath, "utf8");
  fs.writeFileSync(profilePath, source.replace(
    "T extends { id: string; name?: string }",
    "T extends { id: string | number; name?: string }",
  ));
}
edit("src/utilities/hsr/profile.ts", [
  [
    "\tloadLightConeData,\n\tbuildPathMap,\n\tloadPathsData,\n\tloadElementsData\n} from \"./jsonManager.js\";",
    "\tloadLightConeData,\n\tbuildPathMap,\n\tloadPathsData,\n\tloadElementsData,\n\tloadCharacterNamesData\n} from \"./jsonManager.js\";",
  ],
  [
    "// 類型定義\ninterface PlayerData {",
    `let traditionalChineseCharacterNames: Record<string, { name?: string }> | null = null;

export async function localizeCharactersTraditionalChinese<T extends { id: string | number; name?: string }>(
	characters: T[],
	trailblazerName = "開拓者"
): Promise<T[]> {
	traditionalChineseCharacterNames ||= (await loadCharacterNamesData("tw")) || {};
	return characters.map(character => {
		const localized = traditionalChineseCharacterNames?.[String(character.id)]?.name;
		const name = localized === "{NICKNAME}" ? trailblazerName : localized;
		return name ? { ...character, name } : character;
	});
}

// 類型定義
interface PlayerData {`,
  ],
  [
    "\t\t\tconst requestEndTime = Date.now();\n\t\t\tconst drawStartTime = Date.now();",
    "\t\t\tif (characters) {\n\t\t\t\tcharacters = await localizeCharactersTraditionalChinese(characters);\n\t\t\t\tif (playerData) playerData.characters = characters;\n\t\t\t}\n\n\t\t\tconst requestEndTime = Date.now();\n\t\t\tconst drawStartTime = Date.now();",
  ],
  ["ctx.fillText(\"ASTRAL ROSTER  /  ALL CHARACTERS\", 177, 144);", "ctx.fillText(\"星穹名冊  /  全部角色\", 177, 144);"],
  ["ctx.fillText(\"COLLECTION ARCHIVE\", canvasWidth - baseX, 66);", "ctx.fillText(\"角色收藏\", canvasWidth - baseX, 66);"],
]);

edit("src/events/selectMenu.ts", [
  [
    "\tdrawCharacterImage,\n\tdrawAllCharactersImage\n} from \"../utilities/hsr/profile.js\";",
    "\tdrawCharacterImage,\n\tdrawAllCharactersImage,\n\tlocalizeCharactersTraditionalChinese\n} from \"../utilities/hsr/profile.js\";",
  ],
  [
    "\t\tconst allCharacters = data.avatar_list;\n\t\tconst playerData: PlayerData = {",
    "\t\tconst allCharacters = await localizeCharactersTraditionalChinese(data.avatar_list);\n\t\tconst playerData: PlayerData = {",
  ],
  [
    "\t\tconst charOptions = allCharacters.map((character: any) => {",
    "\t\tallCharacters = await localizeCharactersTraditionalChinese(allCharacters);\n\n\t\tconst charOptions = allCharacters.map((character: any) => {",
  ],
  [
    "\t\t\tconst requestEndTime = Date.now();\n\n\t\t\t// 檢查 playerData 是否為 null",
    "\t\t\tif (characters) {\n\t\t\t\tcharacters = await localizeCharactersTraditionalChinese(characters);\n\t\t\t\tif (playerData) playerData.characters = characters;\n\t\t\t\tcharacter = characters.find(item => item.id == characterId) || null;\n\t\t\t}\n\n\t\t\tconst requestEndTime = Date.now();\n\n\t\t\t// 檢查 playerData 是否為 null",
  ],
]);

const helperPath = path.join(root, "src/utilities/core/cyrene.ts");
fs.writeFileSync(helperPath, `import type { Collection, Interaction } from "discord.js";\n\nconst COMPONENT_PREFIXES = [\n\t"account", "leaderboard", "profile_", "profilebg_", "news", "guide",\n\t"forgottenHall_", "cookie_set", "simulator-set", "warp_query", "WarpMenu"\n];\n\nexport function isCyreneHsrInteractionAllowed(\n\tinteraction: Interaction,\n\tcommands?: Collection<string, unknown>\n): boolean {\n\tif (process.env.CYRENE_HSR_EMBEDDED !== "1") return true;\n\tconst allowed = new Set((process.env.CYRENE_HSR_ALLOWED_USER_IDS || "").split(",").filter(Boolean));\n\tif (!allowed.has(interaction.user.id)) return false;\n\tif (interaction.isCommand() || interaction.isAutocomplete()) {\n\t\treturn commands ? commands.has(interaction.commandName) : true;\n\t}\n\tif (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {\n\t\treturn COMPONENT_PREFIXES.some(prefix => interaction.customId.startsWith(prefix));\n\t}\n\treturn false;\n}\n`);

fs.copyFileSync(path.join(scriptRoot, "cyrene-message.ts"), path.join(root, "src/cyreneMessage.ts"));

// The standalone project resolves assets from its own cwd. Cyrene embeds it while
// keeping a different cwd, so make every bundled asset path installation-absolute.
function patchAssetPaths(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) patchAssetPaths(filePath);
    else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const source = fs.readFileSync(filePath, "utf8");
      let patched = source.replaceAll("./src/assets", path.join(root, "src/assets"));
      patched = patched.replaceAll(
        'join(".", "src", ".", "assets", ',
        `join(${JSON.stringify(path.join(root, "src/assets"))}, `,
      );
      for (const command of [
        "account", "daily", "note", "profile", "codes", "warp", "cardpool",
        "forgottenhall", "leaderboard", "profilebg", "automimo"
      ]) {
        patched = patched.replaceAll(`\`/${command}`, `\`!${command}`);
      }
      if (patched !== source) fs.writeFileSync(filePath, patched);
    }
  }
}
patchAssetPaths(path.join(root, "src"));

console.log(`已套用昔漣 macOS 嵌入修補：${root}`);
