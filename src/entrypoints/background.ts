// Shared file: edited by the PL only. Wiring for the service worker.
import { defineBackground } from "wxt/utils/define-background";
import { setupBackground } from "@/lib/background";

export default defineBackground(() => {
  setupBackground();
});
