import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const results = JSON.parse(await readFile(resolve(ROOT, "results.json"), "utf8"));
const judgments = JSON.parse(await readFile(resolve(ROOT, "judgments.json"), "utf8"));

const selections = [
  {
    modelId: "mistralai/mistral-small-2603",
    selectedBy: "Automated judges",
    selectionRank: 1
  },
  {
    modelId: "x-ai/grok-4.3",
    selectedBy: "Automated judges #2 · Manual review #3",
    selectionRank: null
  },
  {
    modelId: "moonshotai/kimi-k2.5",
    selectedBy: "Automated judges",
    selectionRank: 3
  },
  {
    modelId: "aion-labs/aion-3.0-mini",
    selectedBy: "Manual review",
    selectionRank: 1
  },
  {
    modelId: "google/gemma-4-31b-it",
    selectedBy: "Manual review",
    selectionRank: 2
  }
];

const finalistIds = new Set(selections.map((selection) => selection.modelId));
const finalistRoster = selections.map((selection) =>
  results.roster.find((model) => model.id === selection.modelId)
);
const finalistRanking = judgments.ranking
  .map((entry, index) => ({ ...entry, automatedRank: index + 1 }))
  .filter((entry) => finalistIds.has(entry.modelId));

const payload = {
  generatedAt: new Date().toISOString(),
  generationMeta: results.meta,
  judgingMeta: judgments.meta,
  roster: finalistRoster,
  scenarios: results.scenarios,
  responses: results.responses.filter((response) => finalistIds.has(response.modelId)).map((response) => ({
    modelId: response.modelId,
    scenarioId: response.scenarioId,
    content: response.content,
    status: response.status,
    usage: response.usage,
    provider: response.provider,
    responseModel: response.responseModel
  })),
  judgments: judgments.judgments.filter((judgment) => finalistIds.has(judgment.modelId)).map((judgment) => ({
    modelId: judgment.modelId,
    judgeLabel: judgment.judgeLabel,
    weightedScore: judgment.weightedScore,
    scores: judgment.scores,
    status: judgment.status
  })),
  ranking: finalistRanking,
  selections,
  blindOrder: selections.map((selection) => selection.modelId)
};

const safePayload = JSON.stringify(payload).replace(/</g, "\\u003c");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cantarella Voice Room</title>
  <style>
    :root {
      --bg: #0b0908;
      --surface: #15110f;
      --surface-2: #1c1713;
      --surface-3: #241d17;
      --ink: #f1ebe3;
      --muted: #a29385;
      --dim: #6f6257;
      --amber: #cf9558;
      --amber-soft: #e2b37f;
      --amber-dim: rgba(207, 149, 88, .12);
      --line: rgba(226, 179, 127, .13);
      --line-strong: rgba(226, 179, 127, .24);
      --green: #79a886;
      --red: #c8756b;
      --blue: #789db6;
      --shadow: 0 22px 70px rgba(0, 0, 0, .34);
      --display: Georgia, "Times New Roman", serif;
      --body: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at 50% -20%, rgba(207, 149, 88, .12), transparent 38%),
        linear-gradient(180deg, #0e0b09 0%, var(--bg) 55%);
      font-family: var(--body);
      letter-spacing: .01em;
    }

    button, textarea, select { font: inherit; }
    button { color: inherit; }
    .noise {
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .025;
      z-index: 20;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.8'/%3E%3C/svg%3E");
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 15;
      min-height: 76px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 14px 24px;
      border-bottom: 1px solid var(--line);
      background: rgba(11, 9, 8, .82);
      backdrop-filter: blur(18px);
    }

    .brand { display: flex; align-items: center; gap: 13px; min-width: 250px; }
    .sigil {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: var(--amber);
      border: 1px solid var(--line-strong);
      background: linear-gradient(145deg, #2b2016, #17110d);
      font: italic 20px var(--display);
      box-shadow: inset 0 0 22px rgba(207, 149, 88, .08);
    }
    .brand h1 {
      margin: 0;
      font: 400 22px/1 var(--display);
      letter-spacing: .04em;
    }
    .brand p {
      margin: 5px 0 0;
      color: var(--dim);
      font-size: 10px;
      letter-spacing: .15em;
      text-transform: uppercase;
    }

    .run-stats { display: flex; align-items: center; gap: 24px; }
    .stat { text-align: right; }
    .stat strong { display: block; color: var(--amber-soft); font: 400 17px var(--display); }
    .stat span { display: block; margin-top: 3px; color: var(--dim); font-size: 9px; letter-spacing: .12em; text-transform: uppercase; }

    .top-actions { display: flex; gap: 8px; align-items: center; }
    .button {
      border: 1px solid var(--line);
      border-radius: 9px;
      padding: 9px 12px;
      background: var(--surface);
      color: var(--muted);
      cursor: pointer;
      transition: .18s ease;
      font-size: 11px;
    }
    .button:hover { border-color: var(--line-strong); color: var(--ink); transform: translateY(-1px); }
    .button.active { color: var(--amber-soft); border-color: rgba(207, 149, 88, .38); background: var(--amber-dim); }
    .button.icon { width: 36px; height: 36px; padding: 0; display: grid; place-items: center; font-size: 16px; }

    .layout {
      display: grid;
      grid-template-columns: 245px minmax(480px, 1fr) 390px;
      min-height: calc(100vh - 76px);
    }

    .sidebar, .review {
      position: sticky;
      top: 76px;
      height: calc(100vh - 76px);
      overflow: auto;
      background: rgba(18, 14, 12, .6);
    }
    .sidebar { border-right: 1px solid var(--line); }
    .review { border-left: 1px solid var(--line); }
    .panel-head { padding: 22px 20px 12px; }
    .eyebrow { color: var(--amber); font-size: 9px; letter-spacing: .17em; text-transform: uppercase; }
    .panel-head h2 { margin: 7px 0 0; font: 400 19px var(--display); }
    .panel-head p { margin: 7px 0 0; color: var(--dim); font-size: 11px; line-height: 1.5; }

    .scene-list { padding: 4px 10px 18px; }
    .scene {
      width: 100%;
      display: grid;
      grid-template-columns: 28px 1fr auto;
      gap: 10px;
      align-items: center;
      text-align: left;
      padding: 12px 10px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      cursor: pointer;
      transition: .18s ease;
    }
    .scene:hover { background: rgba(255, 255, 255, .018); }
    .scene.active { border-color: var(--line); background: var(--amber-dim); }
    .scene-number {
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: var(--dim);
      border: 1px solid var(--line);
      font: 400 12px var(--display);
    }
    .scene.active .scene-number { color: var(--amber); border-color: rgba(207, 149, 88, .38); }
    .scene-copy strong { display: block; font-size: 11px; font-weight: 500; }
    .scene-copy span { display: block; margin-top: 3px; color: var(--dim); font-size: 9px; }
    .scene-progress { color: var(--dim); font-size: 9px; }

    .main {
      min-width: 0;
      padding: 34px clamp(24px, 5vw, 76px) 110px;
    }
    .scene-intro {
      max-width: 760px;
      margin: 0 auto 22px;
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: end;
    }
    .scene-intro h2 { margin: 5px 0 0; font: 400 clamp(25px, 3vw, 38px)/1.1 var(--display); }
    .scene-intro p { max-width: 460px; margin: 9px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
    .thought-toggle { flex: 0 0 auto; }
    .thought {
      display: none;
      max-width: 760px;
      margin: 0 auto 18px;
      padding: 14px 16px;
      border: 1px dashed var(--line-strong);
      border-radius: 12px;
      color: var(--muted);
      background: rgba(207, 149, 88, .04);
      font-size: 11px;
      line-height: 1.6;
    }
    .thought.visible { display: block; }
    .thought strong { color: var(--amber-soft); font-weight: 500; }

    .phone {
      position: relative;
      max-width: 760px;
      min-height: 440px;
      margin: 0 auto;
      border: 1px solid var(--line);
      border-radius: 22px;
      background:
        radial-gradient(circle at 12% 0%, rgba(207, 149, 88, .055), transparent 30%),
        rgba(18, 14, 12, .88);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .thread-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15px 18px;
      border-bottom: 1px solid var(--line);
      background: rgba(10, 8, 7, .35);
    }
    .thread-person { display: flex; align-items: center; gap: 10px; }
    .avatar {
      width: 31px;
      height: 31px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      border: 1px solid var(--line-strong);
      color: var(--amber);
      background: linear-gradient(145deg, #2b2016, #17110d);
      font: italic 14px var(--display);
    }
    .thread-person strong { display: block; font: italic 15px var(--display); color: var(--amber-soft); }
    .thread-person span { display: block; margin-top: 2px; color: var(--dim); font-size: 9px; }
    .candidate-badge {
      color: var(--dim);
      font-size: 9px;
      letter-spacing: .11em;
      text-transform: uppercase;
    }

    .messages { padding: 26px 22px 34px; }
    .message-row { display: flex; gap: 10px; margin: 0 0 18px; align-items: flex-end; }
    .message-row.user { justify-content: flex-end; }
    .bubble {
      max-width: 76%;
      white-space: pre-wrap;
      padding: 12px 15px;
      border: 1px solid var(--line);
      border-radius: 16px;
      color: var(--ink);
      font-size: 13px;
      font-weight: 350;
      line-height: 1.65;
      background: var(--surface);
    }
    .message-row.assistant .bubble { border-bottom-left-radius: 4px; }
    .message-row.user .bubble {
      border-bottom-right-radius: 4px;
      background: var(--surface-2);
    }
    .message-row.candidate { margin-top: 28px; }
    .message-row.candidate .bubble {
      position: relative;
      border-color: rgba(207, 149, 88, .24);
      background: linear-gradient(145deg, rgba(35, 26, 19, .92), rgba(21, 17, 15, .98));
      box-shadow: 0 10px 30px rgba(0, 0, 0, .2);
    }
    .message-label { margin: 0 0 5px 3px; color: var(--amber); font: italic 11px var(--display); }
    .message-stack { max-width: 76%; }
    .message-stack .bubble { max-width: 100%; }
    .candidate-bubbles { display: grid; justify-items: start; gap: 5px; }
    .candidate-bubbles .bubble { width: fit-content; }
    .candidate-bubbles .bubble:not(:last-child) { border-bottom-left-radius: 16px; }

    .nav-row {
      max-width: 760px;
      margin: 18px auto 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
    }
    .nav-center { color: var(--dim); font-size: 10px; letter-spacing: .09em; }

    .review-content { padding: 0 18px 26px; }
    .candidate-name {
      padding: 15px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(255, 255, 255, .014);
    }
    .candidate-name span { color: var(--dim); font-size: 9px; letter-spacing: .13em; text-transform: uppercase; }
    .candidate-name strong { display: block; margin-top: 7px; font: 400 18px var(--display); }
    .candidate-name code { display: block; margin-top: 5px; color: var(--dim); font-size: 9px; word-break: break-all; }
    .selection-source {
      display: inline-flex;
      margin-top: 10px;
      padding: 5px 7px;
      border: 1px solid rgba(207, 149, 88, .3);
      border-radius: 6px;
      color: var(--amber-soft);
      background: var(--amber-dim);
      font-size: 9px;
      line-height: 1.35;
    }
    .detail-stack { display: grid; gap: 10px; }
    .detail-card {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: rgba(255, 255, 255, .012);
    }
    .detail-card summary {
      padding: 10px 11px;
      color: var(--muted);
      cursor: pointer;
      font-size: 9px;
      letter-spacing: .1em;
      text-transform: uppercase;
    }
    .detail-card pre {
      max-height: 240px;
      overflow: auto;
      margin: 0;
      padding: 11px;
      border-top: 1px solid var(--line);
      color: #c6b7aa;
      background: rgba(7, 6, 5, .36);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 10px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .detail-card.output pre { color: var(--ink); }

    .review-block { padding: 19px 0; border-bottom: 1px solid var(--line); }
    .review-block:last-child { border: 0; }
    .review-label { display: flex; justify-content: space-between; margin-bottom: 10px; color: var(--muted); font-size: 10px; }
    .review-label span:last-child { color: var(--dim); }
    .rating { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
    .rating button, .verdicts button {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--dim);
      cursor: pointer;
      transition: .15s ease;
    }
    .rating button { height: 34px; }
    .rating button:hover, .rating button.active { color: var(--amber); border-color: rgba(207, 149, 88, .4); background: var(--amber-dim); }
    .verdicts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
    .verdicts button { padding: 9px 4px; font-size: 10px; }
    .verdicts button.keep.active { color: var(--green); border-color: rgba(121, 168, 134, .45); background: rgba(121, 168, 134, .09); }
    .verdicts button.maybe.active { color: var(--amber-soft); border-color: rgba(207, 149, 88, .45); background: var(--amber-dim); }
    .verdicts button.pass.active { color: var(--red); border-color: rgba(200, 117, 107, .45); background: rgba(200, 117, 107, .08); }
    textarea {
      width: 100%;
      min-height: 86px;
      resize: vertical;
      padding: 11px;
      border: 1px solid var(--line);
      border-radius: 9px;
      outline: 0;
      color: var(--ink);
      background: var(--surface);
      font-size: 11px;
      line-height: 1.5;
    }
    textarea:focus { border-color: rgba(207, 149, 88, .4); }

    .auto-score {
      display: grid;
      grid-template-columns: 66px 1fr;
      gap: 13px;
      align-items: center;
    }
    .score-ring {
      width: 62px;
      height: 62px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      border: 1px solid var(--line-strong);
      color: var(--amber-soft);
      background: radial-gradient(circle, var(--amber-dim), transparent 70%);
      font: 400 19px var(--display);
    }
    .score-copy strong { display: block; font-size: 11px; font-weight: 500; }
    .score-copy span { display: block; margin-top: 5px; color: var(--dim); font-size: 9px; line-height: 1.45; }
    .bars { margin-top: 14px; display: grid; gap: 7px; }
    .bar { display: grid; grid-template-columns: 74px 1fr 24px; gap: 7px; align-items: center; color: var(--dim); font-size: 8px; }
    .bar-track { height: 3px; overflow: hidden; border-radius: 3px; background: var(--surface-3); }
    .bar-fill { height: 100%; background: var(--amber); }
    .flags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
    .flag { padding: 4px 6px; border: 1px solid rgba(200, 117, 107, .2); border-radius: 5px; color: #b98a83; font-size: 8px; }

    .candidate-rail {
      position: fixed;
      z-index: 14;
      left: 245px;
      right: 390px;
      bottom: 0;
      display: flex;
      gap: 5px;
      overflow-x: auto;
      padding: 10px 14px;
      border-top: 1px solid var(--line);
      background: rgba(11, 9, 8, .92);
      backdrop-filter: blur(16px);
    }
    .rail-item {
      flex: 0 0 auto;
      min-width: 40px;
      height: 34px;
      padding: 0 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--dim);
      cursor: pointer;
      font-size: 9px;
    }
    .rail-item:hover { color: var(--ink); }
    .rail-item.active { color: var(--amber); border-color: rgba(207, 149, 88, .42); background: var(--amber-dim); }
    .rail-item.keep { box-shadow: inset 0 -2px var(--green); }
    .rail-item.maybe { box-shadow: inset 0 -2px var(--amber); }
    .rail-item.pass { box-shadow: inset 0 -2px var(--red); opacity: .6; }

    .modal {
      position: fixed;
      inset: 0;
      z-index: 30;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 28px;
      background: rgba(5, 4, 3, .78);
      backdrop-filter: blur(8px);
    }
    .modal.visible { display: flex; }
    .modal-card {
      width: min(780px, 100%);
      max-height: 86vh;
      overflow: auto;
      border: 1px solid var(--line-strong);
      border-radius: 18px;
      background: #120f0d;
      box-shadow: var(--shadow);
    }
    .modal-head {
      position: sticky;
      top: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 20px;
      border-bottom: 1px solid var(--line);
      background: rgba(18, 15, 13, .96);
    }
    .modal-head h2 { margin: 0; font: 400 22px var(--display); }
    .leaderboard { padding: 8px 18px 22px; }
    .leader-row {
      display: grid;
      grid-template-columns: 34px minmax(170px, 1fr) 70px 90px;
      gap: 10px;
      align-items: center;
      padding: 11px 4px;
      border-bottom: 1px solid var(--line);
      font-size: 11px;
    }
    .leader-row .rank { color: var(--dim); font: 400 15px var(--display); }
    .leader-row .name strong { display: block; }
    .leader-row .name span { display: block; margin-top: 3px; color: var(--dim); font-size: 8px; }
    .leader-row .machine-score { color: var(--amber-soft); text-align: right; }
    .leader-row .human-score { color: var(--muted); text-align: right; }

    .hidden { display: none !important; }

    @media (max-width: 1100px) {
      .layout { grid-template-columns: 210px minmax(430px, 1fr); }
      .review { position: fixed; z-index: 25; right: 0; width: 390px; box-shadow: -20px 0 50px rgba(0,0,0,.35); transform: translateX(100%); transition: .2s ease; }
      .review.open { transform: translateX(0); }
      .candidate-rail { left: 210px; right: 0; }
      .review-mobile { display: inline-grid !important; }
    }

    @media (max-width: 720px) {
      .topbar { align-items: flex-start; padding: 12px 14px; }
      .run-stats { display: none; }
      .brand { min-width: 0; }
      .top-actions .labelled { display: none; }
      #rankingButton, #exportButton { display: none; }
      .top-actions { margin-left: auto; }
      .layout { display: block; }
      .sidebar { position: static; width: 100%; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
      .scene-list { display: flex; overflow-x: auto; }
      .scene { min-width: 210px; }
      .main { padding: 26px 15px 100px; }
      .scene-intro { align-items: flex-start; }
      .phone { border-radius: 16px; }
      .messages { padding: 21px 13px 28px; }
      .bubble, .message-stack { max-width: 88%; }
      .candidate-rail { left: 0; }
      .review { top: 0; height: 100vh; width: min(370px, 94vw); }
    }
  </style>
</head>
<body>
  <div class="noise"></div>
  <header class="topbar">
    <div class="brand">
      <div class="sigil">C</div>
      <div>
        <h1>Voice room</h1>
        <p>Cantarella · finalist review</p>
      </div>
    </div>
    <div class="run-stats">
      <div class="stat"><strong>${finalistRoster.length}</strong><span>finalists</span></div>
      <div class="stat"><strong>${finalistRoster.length * results.scenarios.length}</strong><span>replies</span></div>
      <div class="stat"><strong>$${Number(judgments.meta.combinedCostUsd ?? 0).toFixed(4)}</strong><span>total run</span></div>
    </div>
    <div class="top-actions">
      <button id="rankingButton" class="button icon" aria-label="Open ranking" title="Ranking">≋</button>
      <button id="exportButton" class="button icon" aria-label="Export reviews" title="Export reviews">⇩</button>
      <button id="reviewMobileButton" class="button icon review-mobile hidden" aria-label="Open review panel" title="Review">✦</button>
    </div>
  </header>

  <div class="layout">
    <aside class="sidebar">
      <div class="panel-head">
        <div class="eyebrow">Five moments</div>
        <h2>Read the room.</h2>
        <p>Five finalists. The same context and private judgment in every scene.</p>
      </div>
      <div id="sceneList" class="scene-list"></div>
    </aside>

    <main class="main">
      <section class="scene-intro">
        <div>
          <div id="sceneEyebrow" class="eyebrow"></div>
          <h2 id="sceneTitle"></h2>
          <p id="scenePurpose"></p>
        </div>
      </section>
      <section class="phone" data-testid="conversation">
        <div class="thread-head">
          <div class="thread-person">
            <div class="avatar">C</div>
            <div><strong>Cantarella</strong><span>voice candidate</span></div>
          </div>
          <div id="candidateBadge" class="candidate-badge"></div>
        </div>
        <div id="messages" class="messages"></div>
      </section>
      <div class="nav-row">
        <button id="previousButton" class="button" data-testid="previous-voice">← Previous voice</button>
        <div id="navCount" class="nav-center"></div>
        <button id="nextButton" class="button" data-testid="next-voice">Next voice →</button>
      </div>
    </main>

    <aside id="reviewPanel" class="review">
      <div class="panel-head">
        <div class="eyebrow">Model evidence</div>
        <h2>What went in and out.</h2>
        <p id="reviewProgress"></p>
      </div>
      <div class="review-content">
        <div id="candidateName" class="candidate-name"></div>

        <div class="review-block">
          <div class="review-label"><span>Exact model exchange</span><span>Per scene</span></div>
          <div class="detail-stack">
            <details class="detail-card" open>
              <summary>Custom voice style</summary>
              <pre id="voiceStyleDetail"></pre>
            </details>
            <details class="detail-card">
              <summary>Structured thought JSON</summary>
              <pre id="thoughtDetail"></pre>
            </details>
            <details class="detail-card">
              <summary>Conversation input JSON</summary>
              <pre id="inputDetail"></pre>
            </details>
            <details class="detail-card output" open>
              <summary>Raw model output</summary>
              <pre id="outputDetail"></pre>
            </details>
            <details class="detail-card">
              <summary>Provider and token usage</summary>
              <pre id="usageDetail"></pre>
            </details>
          </div>
        </div>

        <div id="automatedBlock" class="review-block"></div>

        <div class="review-block">
          <div class="review-label"><span>How good is this reply?</span><span id="ratingLabel">Unrated</span></div>
          <div id="rating" class="rating"></div>
        </div>

        <div class="review-block">
          <div class="review-label"><span>Your verdict</span><span>Saved locally</span></div>
          <div id="verdicts" class="verdicts">
            <button class="keep" data-verdict="keep">Keep</button>
            <button class="maybe" data-verdict="maybe">Maybe</button>
            <button class="pass" data-verdict="pass">Pass</button>
          </div>
        </div>

        <div class="review-block">
          <div class="review-label"><span>What felt right or wrong?</span><span>Optional</span></div>
          <textarea id="notes" placeholder="Too polished, nailed the warmth, invented a fact…"></textarea>
        </div>

      </div>
    </aside>
  </div>

  <nav id="candidateRail" class="candidate-rail" aria-label="Voice candidates"></nav>

  <div id="rankingModal" class="modal" role="dialog" aria-modal="true" aria-label="Candidate ranking">
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <div class="eyebrow">Machine ranking, human decision</div>
          <h2>The five finalists</h2>
        </div>
        <button id="closeRankingButton" class="button icon" aria-label="Close ranking">×</button>
      </div>
      <div id="leaderboard" class="leaderboard"></div>
    </div>
  </div>

  <script>
    const DATA = ${safePayload};
    const STORAGE_KEY = location.search.includes("verification=1")
      ? "cantarella-voice-reviews-v2-verification"
      : "cantarella-voice-reviews-v2";
    const stored = (() => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
      catch { return {}; }
    })();

    const state = {
      scenarioId: DATA.scenarios[0].id,
      candidateIndex: 0,
      reviews: stored
    };

    const byId = (id) => document.getElementById(id);
    const modelById = (id) => DATA.roster.find((model) => model.id === id);
    const scenarioById = (id) => DATA.scenarios.find((scenario) => scenario.id === id);
    const rankingById = (id) => DATA.ranking.find((entry) => entry.modelId === id);
    const selectionById = (id) =>
      DATA.selections.find((selection) => selection.modelId === id);
    const responseFor = (modelId, scenarioId) =>
      DATA.responses.find((response) => response.modelId === modelId && response.scenarioId === scenarioId);

    const reviewKey = (modelId, scenarioId) => modelId + "::" + scenarioId;
    const reviewFor = (modelId, scenarioId) =>
      state.reviews[reviewKey(modelId, scenarioId)] || { rating: 0, verdict: "", notes: "" };

    const saveReviews = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state.reviews));
    const currentModelId = () => DATA.blindOrder[state.candidateIndex];
    const currentModel = () => modelById(currentModelId());
    const currentScenario = () => scenarioById(state.scenarioId);
    const currentReview = () => reviewFor(currentModelId(), state.scenarioId);

    const escapeHtml = (value) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const displayName = (modelId) => modelById(modelId).label;

    const reviewedCountForScene = (scenarioId) =>
      DATA.roster.filter((model) => {
        const review = reviewFor(model.id, scenarioId);
        return review.rating > 0 || review.verdict || review.notes.trim();
      }).length;

    const overallReviewed = () =>
      DATA.scenarios.reduce((sum, scenario) => sum + reviewedCountForScene(scenario.id), 0);

    const renderScenes = () => {
      byId("sceneList").innerHTML = DATA.scenarios.map((scenario, index) => {
        const active = scenario.id === state.scenarioId ? " active" : "";
        return '<button class="scene' + active + '" data-scene="' + escapeHtml(scenario.id) + '">' +
          '<span class="scene-number">' + (index + 1) + '</span>' +
          '<span class="scene-copy"><strong>' + escapeHtml(scenario.title) + '</strong>' +
          '<span>' + escapeHtml(scenario.purpose.split("?")[0]) + '</span></span>' +
          '<span class="scene-progress">' + reviewedCountForScene(scenario.id) + '/' +
          DATA.roster.length + '</span>' +
          '</button>';
      }).join("");

      document.querySelectorAll("[data-scene]").forEach((button) => {
        button.addEventListener("click", () => {
          state.scenarioId = button.dataset.scene;
          state.candidateIndex = 0;
          render();
        });
      });
    };

    const renderConversation = () => {
      const scenario = currentScenario();
      const modelId = currentModelId();
      const response = responseFor(modelId, scenario.id);

      byId("sceneEyebrow").textContent = "Scene " + (DATA.scenarios.indexOf(scenario) + 1);
      byId("sceneTitle").textContent = scenario.title;
      byId("scenePurpose").textContent = scenario.purpose;
      byId("candidateBadge").textContent = displayName(modelId);

      const history = scenario.messages.map((message) => {
        const assistant = message.role === "assistant";
        const label = assistant ? '<div class="message-label">Cantarella</div>' : "";
        return '<div class="message-row ' + escapeHtml(message.role) + '">' +
          (assistant ? '<div class="avatar">C</div>' : "") +
          '<div class="message-stack">' + label +
          '<div class="bubble">' + escapeHtml(message.content) + '</div></div>' +
          '</div>';
      }).join("");

      const candidateBubbles = String(response?.content || "[No response]")
        .split(/\\r?\\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => '<div class="bubble">' + escapeHtml(line) + '</div>')
        .join("");

      const candidate =
        '<div class="message-row assistant candidate">' +
        '<div class="avatar">C</div><div class="message-stack">' +
        '<div class="message-label">Cantarella</div>' +
        '<div class="candidate-bubbles">' + candidateBubbles + '</div>' +
        '</div></div>';

      byId("messages").innerHTML = history + candidate;
      byId("navCount").textContent =
        (state.candidateIndex + 1) + " of " + DATA.blindOrder.length + " · " + displayName(modelId);
    };

    const renderReview = () => {
      const model = currentModel();
      const modelId = model.id;
      const review = currentReview();
      const ranking = rankingById(modelId);
      const selection = selectionById(modelId);
      const scenario = currentScenario();
      const response = responseFor(modelId, scenario.id);

      byId("reviewProgress").textContent =
        overallReviewed() + " of " + (DATA.roster.length * DATA.scenarios.length) + " replies reviewed";
      byId("candidateName").innerHTML =
        '<span>Current finalist</span><strong>' + escapeHtml(displayName(modelId)) + '</strong>' +
        '<code>' + escapeHtml(modelId) + '</code>' +
        '<div id="selectionSource" class="selection-source">' +
        escapeHtml(
          selection.selectionRank
            ? selection.selectedBy + " #" + selection.selectionRank
            : selection.selectedBy
        ) +
        '</div>';

      byId("voiceStyleDetail").textContent = scenario.voiceStyle;
      byId("thoughtDetail").textContent = JSON.stringify(scenario.thought, null, 2);
      byId("inputDetail").textContent = JSON.stringify(scenario.messages, null, 2);
      byId("outputDetail").textContent = response?.content || "[No response]";
      byId("usageDetail").textContent = JSON.stringify(
        {
          requestedModel: modelId,
          responseModel: response?.responseModel ?? null,
          provider: response?.provider ?? null,
          usage: response?.usage ?? null
        },
        null,
        2
      );

      byId("rating").innerHTML = [1, 2, 3, 4, 5].map((rating) =>
        '<button data-rating="' + rating + '" class="' + (review.rating === rating ? "active" : "") +
        '" aria-label="Rate ' + rating + ' out of 5">' + rating + '</button>'
      ).join("");
      byId("ratingLabel").textContent =
        review.rating ? ["", "Wrong", "Weak", "Maybe", "Good", "That’s her"][review.rating] : "Unrated";

      document.querySelectorAll("[data-rating]").forEach((button) => {
        button.addEventListener("click", () => {
          updateReview({ rating: Number(button.dataset.rating) });
        });
      });

      document.querySelectorAll("[data-verdict]").forEach((button) => {
        button.classList.toggle("active", button.dataset.verdict === review.verdict);
        button.onclick = () => updateReview({
          verdict: review.verdict === button.dataset.verdict ? "" : button.dataset.verdict
        });
      });

      byId("notes").value = review.notes || "";

      const categoryLabels = {
        naturalness: "Natural",
        voiceFit: "Voice fit",
        styleControl: "Style",
        fidelity: "Faithful",
        restraint: "Restraint",
        emotionalJudgment: "Judgment"
      };
      const flags = ranking?.flags || [];
      byId("automatedBlock").innerHTML = ranking
        ? '<div class="auto-score"><div class="score-ring">' + ranking.score.toFixed(1) + '</div>' +
          '<div class="score-copy"><strong>Automated rank #' +
          ranking.automatedRank +
          '</strong><span>Average of three blind rubric judges. Useful evidence, not the decision.</span></div></div>' +
          '<div class="bars">' + Object.entries(ranking.categories).map(([key, value]) =>
            '<div class="bar"><span>' + categoryLabels[key] + '</span><div class="bar-track">' +
            '<div class="bar-fill" style="width:' + (value * 10) + '%"></div></div><span>' +
            value.toFixed(1) + '</span></div>'
          ).join("") + '</div>' +
          (flags.length ? '<div class="flags">' + flags.map((flag) =>
            '<span class="flag">' + escapeHtml(flag.replaceAll("_", " ")) + '</span>'
          ).join("") + '</div>' : "")
        : "";
    };

    const updateReview = (patch) => {
      const key = reviewKey(currentModelId(), state.scenarioId);
      state.reviews[key] = { ...currentReview(), ...patch };
      saveReviews();
      renderScenes();
      renderReview();
      renderRail();
    };

    let notesTimer;
    byId("notes").addEventListener("input", (event) => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => updateReview({ notes: event.target.value }), 180);
    });

    const renderRail = () => {
      byId("candidateRail").innerHTML = DATA.blindOrder.map((modelId, index) => {
        const review = reviewFor(modelId, state.scenarioId);
        return '<button class="rail-item ' + (index === state.candidateIndex ? "active " : "") +
          escapeHtml(review.verdict || "") + '" data-candidate-index="' + index + '" title="' +
          escapeHtml(displayName(modelId)) + '">' + (index + 1) + '</button>';
      }).join("");

      document.querySelectorAll("[data-candidate-index]").forEach((button) => {
        button.addEventListener("click", () => {
          state.candidateIndex = Number(button.dataset.candidateIndex);
          renderConversation();
          renderReview();
          renderRail();
        });
      });
    };

    const renderLeaderboard = () => {
      const humanAverage = (modelId) => {
        const ratings = DATA.scenarios
          .map((scenario) => reviewFor(modelId, scenario.id).rating)
          .filter(Boolean);
        return ratings.length
          ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1) + "/5"
          : "—";
      };

      byId("leaderboard").innerHTML = DATA.ranking.map((entry) =>
        '<div class="leader-row"><div class="rank">' + entry.automatedRank + '</div>' +
        '<div class="name"><strong>' + escapeHtml(displayName(entry.modelId)) + '</strong>' +
        '<span>' + escapeHtml(entry.modelId) + '</span></div>' +
        '<div class="machine-score">' + entry.score.toFixed(1) + '</div>' +
        '<div class="human-score">' + humanAverage(entry.modelId) + '</div></div>'
      ).join("");
    };

    const moveCandidate = (direction) => {
      state.candidateIndex =
        (state.candidateIndex + direction + DATA.blindOrder.length) % DATA.blindOrder.length;
      renderConversation();
      renderReview();
      renderRail();
    };

    byId("previousButton").addEventListener("click", () => moveCandidate(-1));
    byId("nextButton").addEventListener("click", () => moveCandidate(1));

    byId("rankingButton").addEventListener("click", () => {
      renderLeaderboard();
      byId("rankingModal").classList.add("visible");
    });
    byId("closeRankingButton").addEventListener("click", () => {
      byId("rankingModal").classList.remove("visible");
    });
    byId("rankingModal").addEventListener("click", (event) => {
      if (event.target === byId("rankingModal")) byId("rankingModal").classList.remove("visible");
    });

    byId("reviewMobileButton").addEventListener("click", () => {
      byId("reviewPanel").classList.toggle("open");
    });

    byId("exportButton").addEventListener("click", () => {
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        reviews: state.reviews,
        finalists: DATA.selections
      };
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "cantarella-human-voice-reviews.json";
      anchor.click();
      URL.revokeObjectURL(url);
    });

    document.addEventListener("keydown", (event) => {
      if (event.target.matches("textarea, input, select")) return;
      if (event.key === "ArrowLeft") moveCandidate(-1);
      if (event.key === "ArrowRight") moveCandidate(1);
      if (event.key === "Escape") {
        byId("rankingModal").classList.remove("visible");
        byId("reviewPanel").classList.remove("open");
      }
    });

    const render = () => {
      renderScenes();
      renderConversation();
      renderReview();
      renderRail();
      renderLeaderboard();
    };

    render();
  </script>
</body>
</html>`;

await writeFile(resolve(ROOT, "index.html"), html, "utf8");
console.log("Generated voice-model-eval/index.html");
