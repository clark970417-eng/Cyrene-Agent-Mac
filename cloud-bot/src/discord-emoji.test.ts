import assert from "node:assert/strict";
import test from "node:test";
import { selectCloudDiscordEmojiName } from "./discord-emoji.js";

test("雲端回覆會選擇伺服器既有的昔漣表情名稱", () => {
  assert.equal(selectCloudDiscordEmojiName("在嗎", "嗨♪ 人家一直都在呀！"), "cyrene_hello");
  assert.equal(selectCloudDiscordEmojiName("今天好累", "辛苦了，來抱抱你。"), "cyrene_hugtight");
  assert.equal(selectCloudDiscordEmojiName("解釋程式", "這裡分成三個步驟。"), null);
});
