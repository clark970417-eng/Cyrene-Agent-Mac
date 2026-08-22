import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..", "..");
const vendorDir = path.join(projectRoot, "vendor", "cloud-music-mcp");
const stagingRoot = path.join(projectRoot, "dist", "components");
const pyinstallerOutput = path.join(stagingRoot, "cyrene-music");
const componentDir = path.join(stagingRoot, "music");
const workDir = path.join(projectRoot, ".cache", "music-component", "work");
const specDir = path.join(projectRoot, ".cache", "music-component", "spec");
const entry = path.join(scriptDir, "music-component-entry.py");
const platform = process.platform;
const arch = process.arch;
if (platform !== "darwin" || arch !== "arm64") {
  throw new Error(`The desktop release is macOS Apple Silicon only; received ${platform}/${arch}`);
}

await rm(componentDir, { recursive: true, force: true });
await rm(pyinstallerOutput, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
await mkdir(workDir, { recursive: true });
await mkdir(specDir, { recursive: true });

const result = spawnSync("uv", [
  "run",
  "--frozen",
  "--project", vendorDir,
  "--with", "pyinstaller==6.19.0",
  "pyinstaller",
  "--noconfirm",
  "--clean",
  "--onedir",
  "--name", "cyrene-music",
  "--distpath", stagingRoot,
  "--workpath", workDir,
  "--specpath", specDir,
  "--paths", path.join(vendorDir, "src"),
  "--collect-data", "cloud_music_mcp",
  "--collect-data", "fakeredis",
  "--collect-all", "lupa",
  "--copy-metadata", "fastmcp",
  entry,
], {
  cwd: projectRoot,
  shell: false,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

await rename(pyinstallerOutput, componentDir);
// fakeredis resolves commands.json through dirname(__file__)/../commands.json.
// Its Python modules live in PyInstaller's archive, so the intermediate model
// directory must also exist on disk for POSIX path traversal to succeed.
await mkdir(path.join(componentDir, "_internal", "fakeredis", "model"), { recursive: true });
const executableName = "cyrene-music";
await writeFile(path.join(componentDir, "manifest.json"), JSON.stringify({
  id: "cyrene-music",
  version: "1.0.0",
  platform,
  arch,
  entry: executableName,
  protocolVersion: 1,
}, null, 2) + "\n", "utf8");

const licensesDir = path.join(componentDir, "LICENSES");
await mkdir(licensesDir, { recursive: true });
await copyFile(path.join(vendorDir, "LICENSE"), path.join(licensesDir, "cloud-music-mcp-LICENSE"));
const notices = await readFile(path.join(projectRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
await writeFile(path.join(licensesDir, "CYRENE-THIRD-PARTY-NOTICES.md"), notices, "utf8");

console.log(`[music-component] built ${componentDir}`);
