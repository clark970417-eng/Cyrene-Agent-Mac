#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const plist = require("plist");
const { createHash } = require("crypto");
const asar = require("@electron/asar");
const { readAsarHeader } = require("app-builder-lib/out/asar/asar");

async function verifyPackagedApp(appDir) {
  const appAsarPath = path.join(appDir, "Contents", "Resources", "app.asar");
  const infoPlistPath = path.join(appDir, "Contents", "Info.plist");

  if (!fs.existsSync(appAsarPath) || !fs.existsSync(infoPlistPath)) {
    throw new Error(`invalid app bundle: ${appDir}`);
  }

  let packageJson;
  try {
    packageJson = JSON.parse(asar.extractFile(appAsarPath, "package.json").toString("utf8"));
  } catch (error) {
    throw new Error(`app.asar contains an invalid package.json: ${error.message}`);
  }

  if (typeof packageJson.main !== "string" || packageJson.main.length === 0) {
    throw new Error("app.asar package.json does not declare a main entry");
  }

  const mainEntry = asar.extractFile(appAsarPath, packageJson.main);
  if (mainEntry.length === 0) {
    throw new Error(`app.asar main entry is empty: ${packageJson.main}`);
  }

  const infoPlist = plist.parse(fs.readFileSync(infoPlistPath, "utf8"));
  const expectedHash = infoPlist.ElectronAsarIntegrity?.["Resources/app.asar"]?.hash;
  const { header } = await readAsarHeader(appAsarPath);
  const actualHash = createHash("sha256").update(header).digest("hex");
  if (expectedHash !== actualHash) {
    throw new Error(`app.asar header integrity mismatch: expected ${expectedHash}, actual ${actualHash}`);
  }

  console.log(`verified packaged app: ${appDir}`);
}

const appDir = process.argv[2];
if (!appDir) {
  console.error("usage: node scripts/verify-packaged-app.cjs /path/to/App.app");
  process.exit(2);
}

verifyPackagedApp(path.resolve(appDir)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
