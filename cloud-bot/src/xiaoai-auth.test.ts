import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { isAuthorizedDevice } from "./xiaoai-auth.js";

function requestWith(authorization?: string): IncomingMessage {
  return { headers: { authorization } } as unknown as IncomingMessage;
}

test("沒設定 token 時一律拒絕", () => {
  assert.equal(isAuthorizedDevice(requestWith("Bearer abc"), undefined), false);
});

test("缺少 Authorization header 時拒絕", () => {
  assert.equal(isAuthorizedDevice(requestWith(undefined), "abc"), false);
});

test("token 不符時拒絕", () => {
  assert.equal(isAuthorizedDevice(requestWith("Bearer wrong"), "abc"), false);
});

test("token 相符時通過", () => {
  assert.equal(isAuthorizedDevice(requestWith("Bearer abc"), "abc"), true);
});

test("非 Bearer 格式時拒絕", () => {
  assert.equal(isAuthorizedDevice(requestWith("Basic abc"), "abc"), false);
});
