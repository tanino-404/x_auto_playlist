import preact from "@preact/preset-vite";
import { defineConfig } from "wxt";

// Shared file: edited by the PL only (see docs/agent_rule.md §1, docs/architecture.md §9).
export default defineConfig({
  srcDir: "src",
  outDir: ".output",
  // Explicit imports only (keeps Biome and readers honest about where symbols come from).
  imports: false,
  manifest: {
    name: "X Auto Playlist",
    description: "Play videos and images on x.com as a playlist.",
    permissions: ["storage", "contextMenus", "activeTab"],
    host_permissions: ["https://x.com/*"],
    action: {
      default_title: "X Auto Playlist",
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
      },
    },
  },
  vite: () => ({
    plugins: [preact()],
  }),
});
