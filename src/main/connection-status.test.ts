import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hasKaggleCredentials, mapChannelStatus } from "./connection-status";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("connection status", () => {
  it("maps each channel runtime phase without hiding failures", () => {
    expect(mapChannelStatus("discord", { enabled: true, phase: "running", message: "已連接" })).toMatchObject({
      state: "connected",
      label: "已連線",
    });
    expect(mapChannelStatus("feishu", { enabled: true, phase: "error", message: "token 過期" })).toMatchObject({
      state: "error",
      detail: "token 過期",
    });
  });

  it("detects both Kaggle environment credentials and kaggle.json", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-kaggle-"));
    tempDirs.push(home);
    expect(hasKaggleCredentials(home, {})).toBe(false);
    expect(hasKaggleCredentials(home, { KAGGLE_API_TOKEN: "token" })).toBe(true);

    fs.mkdirSync(path.join(home, ".kaggle"));
    fs.writeFileSync(
      path.join(home, ".kaggle", "kaggle.json"),
      JSON.stringify({ username: "cyrene", key: "secret" }),
    );
    expect(hasKaggleCredentials(home, {})).toBe(true);
  });
});
