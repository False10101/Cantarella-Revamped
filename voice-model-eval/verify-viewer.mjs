import { writeFile } from "node:fs/promises";

const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const TARGET_URL =
  process.env.VOICE_EVAL_URL || "http://127.0.0.1:4173/?verification=1";

const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((response) =>
  response.json()
);
const target = targets.find((item) => item.type === "page");
if (!target?.webSocketDebuggerUrl) {
  throw new Error("No Chrome page target is available.");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let commandId = 0;

const ready = new Promise((resolveReady, rejectReady) => {
  socket.addEventListener("open", resolveReady, { once: true });
  socket.addEventListener("error", rejectReady, { once: true });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve: resolveCommand, reject: rejectCommand } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) rejectCommand(new Error(message.error.message));
  else resolveCommand(message.result);
});

await ready;

const send = (method, params = {}) =>
  new Promise((resolveCommand, rejectCommand) => {
    commandId += 1;
    pending.set(commandId, { resolve: resolveCommand, reject: rejectCommand });
    socket.send(JSON.stringify({ id: commandId, method, params }));
  });

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "Page evaluation failed."
    );
  }
  return result.result.value;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(`Verification failed: ${message}`);
  console.log(`PASS: ${message}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true
});
await send("Page.navigate", { url: TARGET_URL });
await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));

const initial = await evaluate(`(() => ({
  title: document.title,
  candidate: document.querySelector("#candidateName strong")?.textContent,
  nav: document.querySelector("#navCount")?.textContent,
  automatedHidden: document.querySelector("#automatedBlock")?.classList.contains("hidden"),
  selectionSource: document.querySelector("#selectionSource")?.textContent,
  modelId: document.querySelector("#candidateName code")?.textContent,
  voiceStyle: document.querySelector("#voiceStyleDetail")?.textContent,
  thoughtJson: document.querySelector("#thoughtDetail")?.textContent,
  inputJson: document.querySelector("#inputDetail")?.textContent,
  rawOutput: document.querySelector("#outputDetail")?.textContent,
  expectedRawOutput: responseFor(currentModelId(), currentScenario().id).content,
  sceneCount: document.querySelectorAll("[data-scene]").length,
  railCount: document.querySelectorAll("[data-candidate-index]").length,
  candidateBubbleCount: document.querySelectorAll(".candidate-bubbles .bubble").length,
  expectedCandidateBubbleCount: responseFor(currentModelId(), currentScenario().id).content
    .split(/\\r?\\n/)
    .filter((line) => line.trim()).length,
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth
}))()`);

assert(initial.title === "Cantarella Voice Room", "viewer title renders");
assert(initial.candidate === "Mistral Small 4", "actual finalist name renders");
assert(initial.modelId === "mistralai/mistral-small-2603", "OpenRouter model ID renders");
assert(initial.selectionSource === "Automated judges #1", "selection source and rank render");
assert(initial.voiceStyle.length > 0, "custom voice-style input renders");
assert(JSON.parse(initial.thoughtJson).situation === "greeting only", "structured thought JSON renders");
assert(Array.isArray(JSON.parse(initial.inputJson)), "conversation input JSON renders");
assert(initial.rawOutput === initial.expectedRawOutput, "exact raw model output renders");
assert(initial.automatedHidden === false, "automated score breakdown is visible");
assert(initial.sceneCount === 5, "all five scenarios render");
assert(initial.railCount === 5, "only the five unique finalists render");
assert(
  initial.candidateBubbleCount === initial.expectedCandidateBubbleCount,
  "each non-empty model output line renders as its own message bubble"
);
assert(initial.scrollWidth <= initial.innerWidth, "mobile layout has no horizontal page clipping");

const screenshot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false
});
await writeFile(
  "/private/tmp/cantarella-voice-room-v2-mobile-verified.png",
  Buffer.from(screenshot.data, "base64")
);

await evaluate(`document.querySelector("#reviewMobileButton").click()`);
const mobilePanelOpen = await evaluate(
  `document.querySelector("#reviewPanel").classList.contains("open")`
);
assert(mobilePanelOpen === true, "mobile evidence-panel control works");
await evaluate(`document.querySelector("#reviewMobileButton").click()`);

await evaluate(`document.querySelector("#nextButton").click()`);
const nextState = await evaluate(`(() => ({
  nav: document.querySelector("#navCount").textContent,
  candidate: document.querySelector("#candidateName strong").textContent,
  source: document.querySelector("#selectionSource").textContent
}))()`);
assert(nextState.nav.includes("2 of 5"), "five-finalist navigation works");
assert(nextState.candidate === "Grok 4.3", "next finalist details update");
assert(
  nextState.source.includes("Automated judges #2") &&
    nextState.source.includes("Manual review #3"),
  "Grok appears once with both selection sources"
);

await evaluate(`document.querySelector('[data-rating="5"]').click()`);
const savedRating = await evaluate(`(() => ({
  active: document.querySelector('[data-rating="5"]').classList.contains("active"),
  saved: JSON.parse(
    localStorage.getItem("cantarella-voice-reviews-v2-verification") || "{}"
  )
}))()`);
assert(savedRating.active === true, "human rating control works");
assert(
  Object.values(savedRating.saved).some((review) => review.rating === 5),
  "human rating persists locally"
);

await evaluate(`document.querySelector("#rankingButton").click()`);
const ranking = await evaluate(`(() => ({
  visible: document.querySelector("#rankingModal").classList.contains("visible"),
  rows: document.querySelectorAll(".leader-row").length
}))()`);
assert(ranking.visible === true, "ranking modal opens");
assert(ranking.rows === 5, "ranking contains only the five finalists");

await evaluate(`document.querySelector('[data-scene="earned_rest"]').click()`);
const switchedScene = await evaluate(`document.querySelector("#sceneTitle").textContent`);
assert(switchedScene === "Knowing when to stop pushing", "scenario navigation works");

await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false
});
await send("Page.navigate", { url: TARGET_URL });
await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));

const desktop = await evaluate(`(() => {
  const panel = document.querySelector("#reviewPanel").getBoundingClientRect();
  return {
    panelVisible: panel.width > 300 && panel.left >= 0 && panel.right <= window.innerWidth,
    finalistCount: document.querySelectorAll("[data-candidate-index]").length,
    rawOutputVisible: document.querySelector("#outputDetail").textContent.length > 0,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  };
})()`);
assert(desktop.panelVisible, "desktop evidence sidebar is fully visible");
assert(desktop.finalistCount === 5, "desktop view keeps five finalists");
assert(desktop.rawOutputVisible, "desktop raw-output evidence renders");
assert(desktop.scrollWidth <= desktop.innerWidth, "desktop layout has no horizontal clipping");

const desktopScreenshot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false
});
await writeFile(
  "/private/tmp/cantarella-finalists-desktop.png",
  Buffer.from(desktopScreenshot.data, "base64")
);

socket.close();
console.log("Viewer verification complete.");
