// electron-builder afterPack hook.
// electronDist points at the local node_modules/electron/dist (so dev and
// packaged builds share the same Electron binary); that raw Electron.app
// ships its own placeholder default_app.asar, which electron-builder does
// not strip when copying a *custom* unpacked distribution the way it does
// for its own downloaded/cached Electron zips. Left in place it's dead
// weight and a second, unrelated "app" living inside our app bundle.
const fs = require("fs");
const path = require("path");
const plist = require("plist");
const { createHash } = require("crypto");
const { readAsarHeader } = require("app-builder-lib/out/asar/asar");

async function refreshAsarIntegrity(appDir) {
  const resourcesDir = path.join(appDir, "Contents", "Resources");
  const appAsarPath = path.join(resourcesDir, "app.asar");
  const infoPlistPath = path.join(appDir, "Contents", "Info.plist");
  const infoPlist = plist.parse(fs.readFileSync(infoPlistPath, "utf8"));
  const asarIntegrity = infoPlist.ElectronAsarIntegrity ?? {};

  delete asarIntegrity["Resources/default_app.asar"];

  if (fs.existsSync(appAsarPath)) {
    // Electron verifies the serialized ASAR header, not the entire archive.
    const { header } = await readAsarHeader(appAsarPath);
    const hash = createHash("sha256").update(header).digest("hex");
    asarIntegrity["Resources/app.asar"] = { algorithm: "SHA256", hash };
    console.log(`[afterPack] refreshed app.asar integrity: ${hash}`);
  }

  infoPlist.ElectronAsarIntegrity = asarIntegrity;
  fs.writeFileSync(infoPlistPath, plist.build(infoPlist));
}

module.exports = async function afterPack(context) {
  const appDir = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resourcesDir = path.join(appDir, "Contents", "Resources");
  const defaultAppAsar = path.join(resourcesDir, "default_app.asar");
  if (fs.existsSync(defaultAppAsar)) {
    fs.rmSync(defaultAppAsar, { force: true });
    console.log(`[afterPack] removed stray default_app.asar: ${defaultAppAsar}`);
  }

  // electron-builder records ASAR integrity before afterPack runs. When the
  // bundled Electron distribution contributes default_app.asar, deleting the
  // file without deleting its integrity record makes Electron exit before the
  // application entry point is evaluated.
  await refreshAsarIntegrity(appDir);
};

module.exports.refreshAsarIntegrity = refreshAsarIntegrity;

if (require.main === module) {
  const appDir = process.argv[2];
  if (!appDir) {
    console.error("usage: node scripts/after-pack.cjs /path/to/App.app");
    process.exit(2);
  }
  refreshAsarIntegrity(path.resolve(appDir)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
