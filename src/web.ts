#!/usr/bin/env bun
import { marked } from "marked";

import type { Block, Section } from "./document";
import { loadDocument } from "./document";

interface PagePayload {
  title: string;
  sectionTitle: string;
  sectionIndex: number;
  sectionCount: number;
  pageIndex: number;
  pageCount: number;
  html: string;
  blockIds: string[];
}

const sourcePath = process.argv[2] ?? "panama.epub";
const port = Number(process.env.PORT ?? 4173);
const document = await loadDocument(sourcePath);

marked.use({
  gfm: true,
  breaks: false,
});

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") return htmlResponse(indexHtml());
    if (url.pathname === "/api/document") return jsonResponse(documentSummary());
    if (url.pathname === "/api/page") return jsonResponse(pageFromUrl(url));
    if (url.pathname === "/api/rlm") return jsonResponse(exploreQuery(url));

    return new Response("Not found", { status: 404 });
  },
});

console.log(`weft web preview → http://localhost:${port}`);
console.log(`reading ${sourcePath}`);

function documentSummary() {
  return {
    title: document.title,
    authors: document.authors,
    sourcePath: document.sourcePath,
    sections: document.sections.map((section, index) => ({
      id: section.id,
      title: section.title,
      index,
      blockCount: section.blocks.length,
    })),
  };
}

function pageFromUrl(url: URL): PagePayload {
  const sectionIndex = clamp(
    Number(url.searchParams.get("section") ?? 0),
    0,
    document.sections.length - 1,
  );
  const section = document.sections[sectionIndex] ?? document.sections[0];
  if (!section) throw new Error("Document has no sections.");

  const pages = pagesFor(section);
  const pageIndex = clamp(Number(url.searchParams.get("page") ?? 0), 0, pages.length - 1);
  const blocks = pages[pageIndex] ?? [];

  return {
    title: document.title,
    sectionTitle: section.title,
    sectionIndex,
    sectionCount: document.sections.length,
    pageIndex,
    pageCount: pages.length,
    html: renderBlocks(blocks),
    blockIds: blocks.map((block) => block.id),
  };
}


function exploreQuery(url: URL) {
  const query = (url.searchParams.get("q") ?? "").trim();
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
  const blocks = allBlocks();
  const hits = terms.length === 0
    ? []
    : blocks
      .map((entry) => ({ ...entry, score: scoreBlock(entry.block, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

  const slices = [
    {
      id: "toc",
      tool: "toc",
      title: "Read the structure first",
      content: document.sections.slice(0, 18).map((section, index) => `${index + 1}. ${section.title}`).join("\n"),
      sectionIndex: 0,
      chars: 0,
    },
    {
      id: "search",
      tool: "search_text",
      title: query ? `Search for “${query}”` : "Awaiting a query",
      content: hits.length
        ? hits.map((hit) => `${hit.block.id} · ${document.sections[hit.sectionIndex]?.title ?? "section"}\n${snippet(hit.block.plainText, terms)}`).join("\n\n")
        : "No matching blocks yet. Try a motif, character, phrase, or question.",
      sectionIndex: hits[0]?.sectionIndex ?? 0,
      chars: hits.reduce((sum, hit) => sum + snippet(hit.block.plainText, terms).length, 0),
    },
    ...hits.slice(0, 4).map((hit, index) => ({
      id: `context-${index}`,
      tool: "context_get",
      title: `Inspect ${hit.block.id}`,
      content: contextAround(hit.sectionIndex, hit.blockIndex),
      sectionIndex: hit.sectionIndex,
      blockId: hit.block.id,
      chars: contextAround(hit.sectionIndex, hit.blockIndex).length,
    })),
  ];

  const charsRead = slices.reduce((sum, slice) => sum + slice.chars, 0);
  const totalChars = blocks.reduce((sum, entry) => sum + entry.block.plainText.length, 0);

  return {
    query,
    totalChars,
    charsRead,
    coverage: totalChars > 0 ? charsRead / totalChars : 0,
    slices,
  };
}

function allBlocks() {
  return document.sections.flatMap((section, sectionIndex) =>
    section.blocks.map((block, blockIndex) => ({ section, sectionIndex, block, blockIndex })),
  );
}

function scoreBlock(block: Block, terms: string[]): number {
  const text = block.plainText.toLowerCase();
  return terms.reduce((score, term) => {
    const matches = text.matchAll(new RegExp(escapeRegExp(term), "g"));
    return score + Array.from(matches).length;
  }, 0);
}

function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const firstIndex = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstIndex - 160);
  const end = Math.min(text.length, firstIndex + 420);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function contextAround(sectionIndex: number, blockIndex: number): string {
  const section = document.sections[sectionIndex];
  if (!section) return "";
  return section.blocks
    .slice(Math.max(0, blockIndex - 2), blockIndex + 3)
    .map((block) => `[${block.id}] ${block.plainText.slice(0, 900)}${block.plainText.length > 900 ? "…" : ""}`)
    .join("\n\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pagesFor(section: Section): Block[][] {
  const pages: Block[][] = [];
  let current: Block[] = [];
  let chars = 0;

  for (const block of section.blocks) {
    const nextChars = chars + block.markdown.length;
    if (current.length > 0 && nextChars > 5200) {
      pages.push(current);
      current = [];
      chars = 0;
    }
    current.push(block);
    chars += block.markdown.length;
  }

  if (current.length > 0) pages.push(current);
  return pages.length ? pages : [[]];
}

function renderBlocks(blocks: Block[]): string {
  return blocks
    .map((block) => {
      const html = marked.parse(block.markdown, { async: false });
      return `<section class="weft-block" data-block-id="${escapeAttribute(block.id)}"><div class="block-meta">${block.id}</div>${html}</section>`;
    })
    .join("\n");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function jsonResponse(payload: unknown): Response {
  return Response.json(payload, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(value, max));
}

function indexHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Weft</title>
  <style>${styles()}</style>
</head>
<body>
  <div id="app">
    <aside id="toc" aria-label="Table of contents"></aside>
    <main>
      <header>
        <div>
          <p class="eyebrow">weft reboot preview</p>
          <h1 id="book-title">Loading…</h1>
        </div>
        <div class="progress-card">
          <span id="position">—</span>
          <div class="meter"><i id="meter"></i></div>
        </div>
      </header>
      <section class="reader-shell">
        <div class="section-bar">
          <button id="prev-section" title="h / previous section">←</button>
          <div>
            <p class="label">current section</p>
            <h2 id="section-title">—</h2>
          </div>
          <button id="next-section" title="l / next section">→</button>
        </div>
        <article id="page" class="markdown-body"></article>
      </section>
      <section class="rlm-shell">
        <div class="rlm-head">
          <div>
            <p class="label">recrsv graft</p>
            <h2>AI exploration rail</h2>
          </div>
          <form id="rlm-form">
            <input id="rlm-query" placeholder="hunt a motif, name, phrase…" autocomplete="off" />
            <button>explore</button>
          </form>
        </div>
        <div class="rlm-stats" id="rlm-stats">context tools waiting</div>
        <div class="rlm-timeline" id="rlm-timeline"></div>
      </section>
      <footer>
        <span><kbd>j</kbd>/<kbd>k</kbd> block</span>
        <span><kbd>ctrl+d</kbd>/<kbd>ctrl+u</kbd> page</span>
        <span><kbd>h</kbd>/<kbd>l</kbd> section</span>
        <span><kbd>g</kbd>/<kbd>G</kbd> ends</span>
        <span><kbd>t</kbd> TOC</span>
        <span>explore rail = recrsv-style context tools</span>
      </footer>
    </main>
  </div>
  <script>${clientScript()}</script>
</body>
</html>`;
}

function clientScript(): string {
  return String.raw`
const state = { section: 0, page: 0, block: 0, pageBlockIds: [], tocOpen: true, summary: null };
const els = {
  toc: document.getElementById("toc"),
  title: document.getElementById("book-title"),
  sectionTitle: document.getElementById("section-title"),
  position: document.getElementById("position"),
  meter: document.getElementById("meter"),
  page: document.getElementById("page"),
  prevSection: document.getElementById("prev-section"),
  nextSection: document.getElementById("next-section"),
  rlmForm: document.getElementById("rlm-form"),
  rlmQuery: document.getElementById("rlm-query"),
  rlmStats: document.getElementById("rlm-stats"),
  rlmTimeline: document.getElementById("rlm-timeline"),
};

async function boot() {
  state.summary = await fetchJson("/api/document");
  els.title.textContent = state.summary.title;
  renderToc();
  await renderPage();
}

async function renderPage() {
  const page = await fetchJson("/api/page?section=" + state.section + "&page=" + state.page);
  state.section = page.sectionIndex;
  state.page = page.pageIndex;
  state.pageBlockIds = page.blockIds;
  els.sectionTitle.textContent = page.sectionTitle;
  els.meter.style.width = Math.round(((page.sectionIndex + page.pageIndex / page.pageCount) / page.sectionCount) * 100) + "%";
  els.page.innerHTML = page.html;
  els.page.querySelectorAll(".weft-block").forEach((block, index) => {
    block.addEventListener("click", () => activateBlock(index));
  });
  document.querySelectorAll("#toc button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.index) === state.section);
  });
  state.block = clampIndex(state.block, state.pageBlockIds.length);
  activateBlock(state.block, false);
}

function renderToc() {
  const items = state.summary.sections.map((section) => {
    return '<button data-index="' + section.index + '" title="' + escapeHtml(section.title) + '">' +
      '<span>' + String(section.index + 1).padStart(2, "0") + '</span>' +
      escapeHtml(section.title) +
      '</button>';
  }).join("");

  els.toc.innerHTML = '<div class="toc-title">Contents</div><div class="toc-list">' + items + '</div>';
  els.toc.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      state.section = Number(button.dataset.index);
      state.page = 0;
      state.block = 0;
      await renderPage();
    });
  });
}

async function moveBlock(delta) {
  const next = state.block + delta;
  if (next >= 0 && next < state.pageBlockIds.length) {
    activateBlock(next);
    return;
  }
  await movePage(delta > 0 ? 1 : -1, delta < 0);
}

async function movePage(delta, end = false) {
  const before = state.page;
  state.page += delta;
  state.block = end ? 9999 : 0;
  await renderPage();
  if (before === state.page && delta > 0) {
    if (state.section < state.summary.sections.length - 1) await moveSection(1);
    else activateBlock(state.pageBlockIds.length - 1);
  }
  if (before === state.page && delta < 0) {
    if (state.section > 0) await moveSection(-1, true);
    else activateBlock(0);
  }
}

async function moveSection(delta, end = false) {
  state.section = Math.max(0, Math.min(state.summary.sections.length - 1, state.section + delta));
  state.page = end ? 9999 : 0;
  state.block = end ? 9999 : 0;
  await renderPage();
}

function activateBlock(index, scroll = true) {
  state.block = clampIndex(index, state.pageBlockIds.length);
  const blocks = Array.from(els.page.querySelectorAll(".weft-block"));
  blocks.forEach((block, blockIndex) => block.classList.toggle("active", blockIndex === state.block));
  const active = blocks[state.block];
  const blockId = state.pageBlockIds[state.block] || "—";
  els.position.textContent = "section " + (state.section + 1) + "/" + state.summary.sections.length + " · page " + (state.page + 1) + " · block " + blockId;
  if (scroll && active) active.scrollIntoView({ block: "center", behavior: "smooth" });
}

function clampIndex(index, length) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function toggleToc() {
  state.tocOpen = !state.tocOpen;
  document.body.classList.toggle("toc-closed", !state.tocOpen);
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function escapeHtml(value) {
  return value.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" }[char]));
}

els.prevSection.addEventListener("click", () => moveSection(-1));
els.nextSection.addEventListener("click", () => moveSection(1));
window.addEventListener("keydown", (event) => {
  if (["INPUT", "TEXTAREA"].includes(event.target?.tagName)) return;
  if (event.ctrlKey && event.key === "d") { event.preventDefault(); movePage(1); return; }
  if (event.ctrlKey && event.key === "u") { event.preventDefault(); movePage(-1, true); return; }
  if (event.key === "j") { event.preventDefault(); moveBlock(1); }
  if (event.key === "k") { event.preventDefault(); moveBlock(-1); }
  if (event.key === "h") { event.preventDefault(); moveSection(-1); }
  if (event.key === "l") { event.preventDefault(); moveSection(1); }
  if (event.key === "g") { event.preventDefault(); state.section = 0; state.page = 0; state.block = 0; renderPage(); }
  if (event.key === "G") { event.preventDefault(); state.section = state.summary.sections.length - 1; state.page = 9999; state.block = 9999; renderPage(); }
  if (event.key === "t") { event.preventDefault(); toggleToc(); }
});

boot().catch((error) => {
  els.page.innerHTML = "<pre>" + escapeHtml(error.stack || error.message) + "</pre>";
});
`;
}

function styles(): string {
  return String.raw`
:root {
  color-scheme: dark;
  --bg: #07090d;
  --panel: rgba(255,255,255,0.055);
  --panel-strong: rgba(255,255,255,0.09);
  --border: rgba(255,255,255,0.12);
  --text: #eef3ff;
  --muted: #8d99ae;
  --dim: #596579;
  --cyan: #77e7ff;
  --blue: #7aa7ff;
  --green: #a7f3d0;
  --gold: #f6d365;
  --max-reader: 880px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(119,231,255,0.16), transparent 34rem),
    radial-gradient(circle at bottom right, rgba(122,167,255,0.13), transparent 38rem),
    linear-gradient(135deg, #07090d 0%, #0c111b 48%, #071018 100%);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#app {
  display: grid;
  grid-template-columns: minmax(230px, 320px) minmax(0, 1fr);
  min-height: 100vh;
}
body.toc-closed #app { grid-template-columns: 0 minmax(0, 1fr); }
body.toc-closed #toc { transform: translateX(-100%); }
#toc {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: auto;
  border-right: 1px solid var(--border);
  background: rgba(3, 7, 12, 0.68);
  backdrop-filter: blur(24px);
  transition: transform 160ms ease;
}
.toc-title {
  position: sticky;
  top: 0;
  padding: 1rem;
  background: rgba(3, 7, 12, 0.9);
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.toc-list { padding: 0.5rem; }
#toc button {
  width: 100%;
  display: grid;
  grid-template-columns: 2.4rem minmax(0, 1fr);
  gap: 0.65rem;
  border: 0;
  border-radius: 0.8rem;
  padding: 0.72rem 0.75rem;
  background: transparent;
  color: var(--muted);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
#toc button:hover, #toc button.active {
  color: var(--text);
  background: var(--panel-strong);
}
#toc button span { color: var(--dim); font-variant-numeric: tabular-nums; }
main {
  width: min(100%, 1180px);
  margin: 0 auto;
  padding: 2rem clamp(1rem, 3vw, 3rem);
}
header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1.25rem;
  margin-bottom: 1.25rem;
}
.eyebrow, .label {
  margin: 0 0 0.35rem;
  color: var(--cyan);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
h1 { margin: 0; font-size: clamp(1.6rem, 3vw, 3.4rem); letter-spacing: -0.05em; }
.progress-card {
  min-width: 260px;
  padding: 0.85rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--panel);
  color: var(--muted);
  font-size: 0.85rem;
}
.meter { height: 0.42rem; margin-top: 0.65rem; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; }
.meter i { display: block; height: 100%; width: 0%; border-radius: inherit; background: linear-gradient(90deg, var(--cyan), var(--blue)); transition: width 180ms ease; }
.reader-shell {
  border: 1px solid var(--border);
  border-radius: 1.6rem;
  background: rgba(255,255,255,0.045);
  box-shadow: 0 30px 120px rgba(0,0,0,0.35);
  overflow: hidden;
}
.section-bar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: center;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid var(--border);
  background: rgba(0,0,0,0.2);
}
.section-bar h2 { margin: 0; font-size: 1.05rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.section-bar button {
  width: 2.4rem;
  height: 2.4rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}
.section-bar button:hover { border-color: rgba(119,231,255,0.5); color: var(--cyan); }
.markdown-body {
  max-width: var(--max-reader);
  margin: 0 auto;
  padding: clamp(1.5rem, 4vw, 4.5rem);
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
  font-size: clamp(1.08rem, 1.5vw, 1.28rem);
  line-height: 1.78;
}
.weft-block {
  position: relative;
  margin: 0.25rem -1.2rem;
  padding: 0.1rem 1.2rem;
  border-radius: 1rem;
  border: 1px solid transparent;
  transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}
.weft-block.active {
  background: rgba(119,231,255,0.065);
  border-color: rgba(119,231,255,0.18);
  box-shadow: 0 0 0 1px rgba(119,231,255,0.04), 0 18px 60px rgba(0,0,0,0.18);
}
.weft-block.active::before {
  content: "";
  position: absolute;
  left: 0.35rem;
  top: 0.85rem;
  bottom: 0.85rem;
  width: 2px;
  border-radius: 999px;
  background: linear-gradient(var(--cyan), var(--blue));
}
.block-meta {
  height: 0;
  overflow: visible;
  transform: translateY(-1.35rem);
  color: var(--dim);
  font: 0.68rem/1 ui-monospace, Menlo, monospace;
  opacity: 0;
  transition: opacity 140ms ease;
}
.weft-block.active .block-meta { opacity: 1; }
.markdown-body h1, .markdown-body h2, .markdown-body h3 {
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  line-height: 1.08;
  letter-spacing: -0.045em;
}
.markdown-body h1 { font-size: clamp(2.1rem, 4vw, 4.2rem); }
.markdown-body h2 { font-size: clamp(1.7rem, 3vw, 2.7rem); margin-top: 2em; }
.markdown-body h3 { font-size: 1.35rem; margin-top: 1.8em; }
.markdown-body p { margin: 1.05em 0; }
.markdown-body a { color: var(--cyan); }
.markdown-body blockquote {
  margin: 1.6em 0;
  padding: 0.2rem 1.2rem;
  border-left: 3px solid var(--cyan);
  color: #c8d3e5;
  background: rgba(119,231,255,0.055);
  border-radius: 0 1rem 1rem 0;
}
.markdown-body code {
  font-family: "SF Mono", ui-monospace, Menlo, monospace;
  font-size: 0.88em;
  color: var(--green);
  background: rgba(0,0,0,0.32);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 0.35rem;
  padding: 0.1rem 0.28rem;
}
.markdown-body pre {
  overflow: auto;
  padding: 1rem;
  border-radius: 1rem;
  background: rgba(0,0,0,0.45);
  border: 1px solid var(--border);
}
.markdown-body hr { border: 0; height: 1px; background: var(--border); margin: 2.5rem 0; }
.rlm-shell {
  margin-top: 1rem;
  border: 1px solid var(--border);
  border-radius: 1.4rem;
  background: rgba(0,0,0,0.24);
  overflow: hidden;
}
.rlm-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 440px);
  gap: 1rem;
  align-items: end;
  padding: 1rem;
  border-bottom: 1px solid var(--border);
}
.rlm-head h2 { margin: 0; font-size: 1.05rem; letter-spacing: -0.03em; }
#rlm-form { display: flex; gap: 0.5rem; }
#rlm-query {
  min-width: 0;
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.72rem 0.95rem;
  background: rgba(255,255,255,0.055);
  color: var(--text);
  outline: none;
}
#rlm-query:focus { border-color: rgba(119,231,255,0.62); box-shadow: 0 0 0 3px rgba(119,231,255,0.08); }
#rlm-form button {
  border: 1px solid rgba(119,231,255,0.38);
  border-radius: 999px;
  padding: 0.72rem 1rem;
  background: rgba(119,231,255,0.12);
  color: var(--cyan);
  cursor: pointer;
}
.rlm-stats {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.84rem;
  font-family: ui-monospace, Menlo, monospace;
}
.rlm-timeline {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
}
.rlm-slice {
  display: grid;
  grid-template-columns: 2.4rem minmax(0, 1fr);
  gap: 0.85rem;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: 0.9rem;
  background: rgba(255,255,255,0.04);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.rlm-slice:hover { border-color: rgba(119,231,255,0.45); background: rgba(119,231,255,0.055); }
.rlm-index { color: var(--cyan); font-family: ui-monospace, Menlo, monospace; }
.rlm-slice strong { color: var(--green); font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; }
.rlm-slice h3 { margin: 0.25rem 0 0.6rem; font-size: 1rem; }
.rlm-slice pre {
  max-height: 12rem;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  color: #c8d3e5;
  font: 0.82rem/1.55 ui-monospace, Menlo, monospace;
}
footer {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1rem;
  padding: 1rem 0;
  color: var(--muted);
  font-size: 0.86rem;
}
kbd {
  display: inline-flex;
  min-width: 1.45rem;
  justify-content: center;
  border: 1px solid var(--border);
  border-bottom-color: rgba(255,255,255,0.25);
  border-radius: 0.4rem;
  padding: 0.05rem 0.32rem;
  background: var(--panel);
  color: var(--text);
  font-family: ui-monospace, Menlo, monospace;
}
@media (max-width: 820px) {
  #app { grid-template-columns: 1fr; }
  #toc { position: fixed; z-index: 10; width: min(86vw, 320px); }
  body.toc-closed #toc { transform: translateX(-105%); }
  header { align-items: start; flex-direction: column; }
  .progress-card { min-width: 0; width: 100%; }
  .markdown-body { padding: 1.25rem; }
  .rlm-head { grid-template-columns: 1fr; }
}

`;
}
