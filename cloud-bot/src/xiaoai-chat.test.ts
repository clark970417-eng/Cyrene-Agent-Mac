import assert from "node:assert/strict";
import test from "node:test";
import { buildChatCompletionResponse, extractLatestUserText } from "./xiaoai-chat.js";

test("取最後一則 user 訊息（純文字）", () => {
  const text = extractLatestUserText({
    messages: [
      { role: "system", content: "你是昔漣" },
      { role: "user", content: "早安" },
      { role: "assistant", content: "早安夥伴" },
      { role: "user", content: "  今天天氣如何  " },
    ],
  });
  assert.equal(text, "今天天氣如何");
});

test("取最後一則 user 訊息（陣列 content block）", () => {
  const text = extractLatestUserText({
    messages: [{ role: "user", content: [{ type: "text", text: "陣列格式" }] }],
  });
  assert.equal(text, "陣列格式");
});

test("沒有 user 訊息時回傳空字串", () => {
  assert.equal(extractLatestUserText({ messages: [{ role: "system", content: "x" }] }), "");
  assert.equal(extractLatestUserText({}), "");
});

test("組出符合 OpenAI chat.completion 形狀的回應", () => {
  const response = buildChatCompletionResponse("gpt-test", "昔漣的回覆");
  assert.equal(response.object, "chat.completion");
  assert.equal(response.model, "gpt-test");
  const choices = response.choices as Array<{ message: { role: string; content: string }; finish_reason: string }>;
  assert.equal(choices[0].message.role, "assistant");
  assert.equal(choices[0].message.content, "昔漣的回覆");
  assert.equal(choices[0].finish_reason, "stop");
});
