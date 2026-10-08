// Shared file: edited by the PL only.
// MAIN-world content script for x.com. Runs before the page's own scripts so the
// interceptor can wrap XMLHttpRequest/fetch. It must not import anything that touches
// chrome.* APIs; it only forwards raw GraphQL responses via window.postMessage.

import { defineContentScript } from "wxt/utils/define-content-script";
import { installInterceptor } from "@/lib/interceptor";

export default defineContentScript({
  matches: ["https://x.com/*"],
  world: "MAIN",
  runAt: "document_start",
  registration: "manifest",

  main() {
    installInterceptor();
  },
});
