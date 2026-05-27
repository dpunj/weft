# Shape: Weft as an AI-Native Reader

## Status

Shaped draft. Weft has a working Bun/Web preview and the first deterministic `recrsv`-style exploration rail. This document clarifies what we want, why it matters, what exists today, and what is missing before it becomes the product we mean.

## One-line pitch

Turn Weft into a vim-like, AI-native reader for EPUB/PDF/Markdown where books render as snappy Markdown, annotations become durable knowledge, and AI explores the document through visible reader-native tools instead of opaque chat.

## Why this, why now

The original Weft already had the right spark:

- a terminal reader for books
- vim-like motion
- Markdown-ish EPUB rendering
- AI chat/summaries over current text
- audio read-aloud / compass experiments

The newer `recrsv` work proved a deeper interaction pattern:

> Don’t paste the entire document into the model. Give the model tools to inspect it strategically, then show the user where it looked.

That is more compelling for reading than a normal chat sidebar. A reader should be able to watch the AI move through the book: first the table of contents, then searches, then nearby context, then synthesis.

Roughdraft adds another useful signal: people want local-first Markdown review surfaces that let humans and agents exchange comments and suggestions. Weft should not become Roughdraft, but it should learn from its portability: annotations should not be trapped in an app database.

## Product thesis

Weft is not “an ebook app with AI.”

Weft is a woven reading surface:

```text
source file
  ↓
structured Markdown blocks
  ↓
vim navigation + reading state
  ↓
highlights/comments/marks
  ↓
AI tools over the same anchors
  ↓
visible exploration timeline
```

The unique feeling should be:

> I’m reading a book, and the AI is reading *with spatial awareness* — it knows where I am, can move around the document, can cite exact blocks, and I can see its path.

## Target user experience

A user opens an EPUB/PDF:

```bash
bun run web book.epub
```

The browser shows a clean, fast Markdown reading surface:

- left TOC
- centered readable text
- vim navigation
- progress meter
- current section/page

The user types a question or motif into the exploration rail:

```text
where does the author discuss the Panama Canal's economic impact?
```

Weft streams tool slices:

```text
01 toc
   Read the structure first

02 search_text
   Search for “Panama Canal economic impact”

03 context_get
   Inspect s11.b96

04 context_get
   Inspect s13.b41

05 answer
   Synthesis with citations back to block ids
```

The reader can click any slice to jump to that part of the book.

Later, the user can mark or comment:

```text
m   mark current block
c   comment on current block
n   next annotation
N   previous annotation
```

Annotations save beside the source:

```text
book.epub
book.weft.json
```

## What exists now

### Bun + TypeScript reboot

Files:

- `package.json`
- `tsconfig.json`
- `src/document.ts`
- `src/reader.ts`
- `src/cli.ts`
- `src/web.ts`

Current commands:

```bash
bun run read panama.epub
bun run web panama.epub
```

### Document spine

`src/document.ts` parses EPUBs into:

```text
WeftDocument
  sections[]
    blocks[]
      sourceSpan
```

Current EPUB path:

- unzip with `jszip`
- read OPF/package/spine with `fast-xml-parser`
- read XHTML items
- convert HTML to Markdown with `turndown`
- split into blocks
- assign ids like `s11.b96`

### Modern Markdown web reader

`src/web.ts` serves:

- `GET /`
- `GET /api/document`
- `GET /api/page`

The web UI includes:

- dark modern reader shell
- TOC sidebar
- Markdown rendering via `marked`
- vim keys: `j/k`, `d/u`, `ctrl+d/ctrl+u`, `h/l`, `g/G`, `t`
- global reading tape for page turns across the book
- block-level cursor over actual passages
- book / section / page progress with estimated time remaining

### First recrsv-style exploration rail

`src/web.ts` also serves:

- `GET /api/rlm?q=...`

Current deterministic tools:

```text
toc
search_text
context_get
```

The UI shows:

- tool slices
- chars read
- % explored
- context snippets
- click-to-jump to section

This is not yet model-driven, but it establishes the substrate and the visual grammar.

## What is missing

### 1. Real model-driven tool loop

Current `/api/rlm` is deterministic search. The next step is a real agent loop inspired by `recrsv`:

- model receives tool definitions
- model chooses tools
- server executes tools
- UI streams each tool call/result
- final answer cites sections/blocks

Initial tools:

```text
toc()
current_location()
search_text(query)
get_block(block_id)
get_section(section_id)
context_get(anchor, before, after)
```

Later:

```text
repl_exec(code)
semantic_search(query)
```

### 2. Streaming exploration

Current exploration returns one JSON response. It should stream events:

```text
meta
tool_call
tool_result
reading
answer_token
done
error
```

This is where the `recrsv` feeling really lands: the reader watches the model move.

### 3. Robust EPUB cleanup and TOC

Current EPUB rendering follows the spine and includes some Gutenberg cruft.

Needed:

- better title extraction
- use EPUB nav/NCX when available
- skip cover/preamble junk when reasonable
- preserve chapter hierarchy
- avoid duplicated title/header blocks

### 4. Annotations

Need sidecar storage:

```json
{
  "version": 1,
  "source": "book.epub",
  "annotations": [
    {
      "id": "a1",
      "kind": "comment",
      "anchor": { "blockId": "s11.b96" },
      "body": "Important canal economics point.",
      "createdAt": "..."
    }
  ]
}
```

Reader commands:

```text
m   mark current block
c   comment current block
n/N next/previous annotation
```

Future export:

- Markdown notes
- Roughdraft-flavored Markdown / CriticMarkup

### 5. PDF support

PDF should enter the same document model:

```text
PDF page → text blocks → source spans with page numbers
```

First version can be text extraction only. Layout/OCR can come later.

### 6. AI answer grounding

Answers should cite block ids and section names:

```text
The strongest discussion is in s11.b96, where the author says...
```

Citations should be clickable in the UI.

## Boundaries / non-goals for this cycle

- No hosted service
- No account system
- No sync
- No mobile app
- No full Roughdraft clone
- No embeddings as the first solution
- No complex PDF layout reconstruction yet
- No replacing the reader with a generic chat app

## Appetite

One focused cycle: **1–2 weeks**.

The goal is not to finish every document format. The goal is to prove the distinctive loop:

```text
read → ask → visible tool exploration → grounded answer → jump/cite → annotate
```

## Core bet

If Weft has stable block anchors and an evented tool loop, then AI features become straightforward and differentiated.

Without stable anchors, AI answers are just prose.

With stable anchors, Weft can do:

- citations
- jump-to-source
- durable comments
- reading history
- AI exploration timelines
- exportable notes
- later semantic indexing

## Proposed build slices

### Slice 1 — Clean reader spine

Goal: make EPUB navigation feel less prototype-y.

Already started:

- render block ids as data attributes
- add current block tracking in the web reader
- make `j/k` move through actual passages/blocks rather than browser scroll
- add `d/u` for page movement, with `ctrl+d/ctrl+u` kept as extra muscle memory
- refactor page turns around a global reading tape instead of section-local pages
- add minimal book / section / page progress and ETA based on cursor position

Still needed:

- Use EPUB nav/NCX for TOC when available
- improve section titles
- skip obvious cover-only sections

Demo:

> Open `panama.epub`, TOC looks like real chapters, vim nav works, current block is known.

### Slice 2 — Sidecar annotations

Goal: first durable user knowledge layer.

- create `book.weft.json`
- add mark/comment actions in web UI
- display annotations in rail or margin
- next/previous annotation nav

Demo:

> Comment on a paragraph, reload, comment persists, click annotation jumps back.

### Slice 3 — Recrsv event loop

Goal: make the exploration rail model-driven.

- define tool schemas
- add server-side loop using one provider first
- stream events to UI
- show timeline slices as they happen
- final answer cites block ids

Demo:

> Ask “what does the author think the canal changes economically?” and watch `toc → search_text → context_get → answer` stream live.

### Slice 4 — REPL over blocks

Goal: port the most insane `recrsv` power.

- add sandboxed `repl_exec(code)`
- expose normalized blocks as `context`
- stream code/result slices
- cap runtime/output

Demo:

> Ask for recurring place names or motif counts and watch the model write code over the book.

### Slice 5 — PDF import

Goal: broaden source formats without disturbing reader model.

- parse PDF text
- create page-backed sections/blocks
- source spans include page numbers

Demo:

> Open a PDF and use the same reader/exploration/annotation surface.

## Risks

### EPUB messiness

EPUBs vary wildly. The parser may produce junk sections or bad headings.

Mitigation: keep the document model simple and improve cleanup incrementally.

### Overbuilding AI before anchors

It is tempting to wire LLMs immediately. But without stable anchors, answers cannot cite, annotations cannot persist, and the UI cannot jump reliably.

Mitigation: finish enough block/source mapping first.

### Becoming Roughdraft

Roughdraft is good, but Weft’s job is reading books/docs, not reviewing Markdown drafts.

Mitigation: keep annotations reader-centered and source-anchored. Export to Markdown later; do not make Markdown the only source of truth.

### Losing terminal identity

The web preview is useful for modern Markdown rendering, but Weft should preserve a keyboard-first, local-first spirit.

Mitigation: Bun server + local files + vim nav. Terminal CLI can remain as a secondary surface.

## Open questions

1. Should the primary product surface be web-local, terminal, or both?
2. Should AI provider config use env vars first, browser localStorage keys, or Simon Willison `llm`-style config?
3. Do annotations belong in `.weft.json`, SQLite, or both?
4. How much Roughdraft compatibility matters for v1 export?
5. Should `repl_exec` ship before or after real LLM `context_get` streaming?
6. Should PDF support come before annotations, or after the reader loop feels magical on EPUB?

## Current recommendation

Keep going in this order:

1. Clean EPUB TOC/section quality
2. Add current block tracking and sidecar annotations
3. Add real streaming LLM tool loop
4. Add `repl_exec`
5. Add PDF

This keeps the product coherent: first the reader knows where it is, then the user can mark it, then the AI can move through it visibly.
