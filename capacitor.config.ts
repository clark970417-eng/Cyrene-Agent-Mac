import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cyrene.pet",
  appName: "昔漣",
  webDir: "mobile",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https",
    cleartext: true, // 允許在局域網/Tailscale (HTTP) 下進行本地通信
  },
  ios: {
    contentInset: "always",
    preferredContentMode: "mobile",
    scheme: "Cyrene",
    backgroundColor: "#0d0f18",
  },
};

export default config;
