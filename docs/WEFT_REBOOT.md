# Weft Reboot

For the fuller shaped plan, see [`docs/shaped/ai-native-reader-reboot.md`](shaped/ai-native-reader-reboot.md).

Weft should stay Weft: a vim-like reader for books and documents, with AI woven into the act of reading instead of bolted on as a chat box.

## North star

Weft is an AI-native reader for EPUBs, PDFs, and long Markdown documents.

It turns source files into a fast, navigable Markdown-like reading surface where readers can move with vim keys, leave durable annotations, and ask AI questions that understand the book, their current location, and their reading history.

## What Weft already has

The current public repo has the right seed:

- EPUB ingestion via `ebooklib`
- HTML-to-Markdown conversion via `html2text`
- terminal rendering via Rich Markdown
- vim-like navigation across sections/pages
- current-page AI chat and summarization through `llm`
- text-to-speech and an audio “compass” guide

The reboot keeps that spirit, but moves the forward path to **Bun + TypeScript** so the document pipeline, AI tools, and terminal UI can share one typed model.

## Reference points

### recrsv / RLM

`recrsv` proves the important AI pattern: do not paste a whole long document into the model. Give the model tools to explore it strategically.

Useful ideas to bring into Weft:

- `context_get(offset, limit)` as a primitive read tool
- `repl_exec(code)` as a computational exploration tool
- reading timeline / dive mode for reviewing where the AI looked
- minimap-style coverage of document exploration

For Weft, raw character offsets should evolve into reader-native anchors: chapters, sections, blocks, pages, and source spans.

### Roughdraft

Roughdraft is adjacent, not competitive. It is a local-first Markdown review app for collaborating with agents through comments, replies, and suggestions stored in Markdown with CriticMarkup.

Useful ideas to bring into Weft:

- annotations as portable text, not trapped app state
- comments/replies/suggestions as first-class collaboration objects
- CLI/agent-friendly workflows
- optional export to Roughdraft-flavored Markdown

Weft should not become a Markdown review app. It should be a reader for books/docs whose annotations can round-trip to Markdown when useful.

## Product pillars

1. **Snappy Markdown reading**
   - EPUB/PDF/Markdown in
   - normalized Markdown-like blocks out
   - fast terminal-first rendering
   - vim navigation by page, section, heading, search result, and mark

2. **Stable source mapping**
   - every rendered block has a durable id
   - every annotation points at a source span or block id
   - PDF/EPUB quirks are hidden behind a common document model

3. **Annotations as knowledge**
   - highlights, comments, replies, and AI-suggested notes
   - stored in a sidecar file first
   - exportable to Markdown / Roughdraft-flavored Markdown later

4. **AI as a reading companion**
   - ask about current page, section, chapter, or whole book
   - summarize since last mark
   - explain selected passage
   - find motifs, definitions, contradictions, references
   - show where the AI looked, not just what it answered

## Proposed document model

```text
Document
  id
  title
  authors[]
  source_path
  source_type: epub | pdf | markdown | text
  sections[]

Section
  id
  title
  level
  parent_id?
  block_ids[]
  source_span

Block
  id
  section_id
  kind: heading | paragraph | quote | list | code | table | image | page_break
  markdown
  plain_text
  source_span
```

A source span is intentionally abstract:

```text
SourceSpan
  source_path
  href?          # EPUB item path
  page?          # PDF page when available
  char_start?
  char_end?
  selector?      # future: text quote selector / CFI / PDF coordinates
```

## AI tool surface

Start with safe reader tools before embeddings:

```text
current_location()
toc()
get_block(block_id)
get_section(section_id)
get_near(anchor, before, after)
search_text(query)
list_annotations(filter?)
```

Then add heavier tools:

```text
summarize_range(start_anchor, end_anchor)
repl_exec(code)          # over normalized blocks, inspired by recrsv
semantic_search(query)   # later, optional
```

The model should cite block ids / sections in answers so the reader can jump there.

## First build slice

Keep it terminal-first and incremental, using Bun + TypeScript.

1. Extract EPUB ingestion into a document model module.
2. Render from blocks instead of raw section strings.
3. Add block ids and section ids to the reader state.
4. Add a sidecar annotations file:

```text
book.epub
book.weft.json
```

5. Add minimal commands:

```text
m   mark current block
c   comment on current block
n/N next/previous annotation
```

6. Upgrade AI context from current page text to current location + surrounding blocks + section metadata.

## Non-goals for the reboot slice

- no web app yet
- no cloud sync
- no account system
- no embeddings until structure/source maps work
- no replacement of the terminal reader core
- no full Roughdraft clone

## Naming

This remains Weft.

The concept is not “another AI document app.” It is a woven reading surface: source file, rendered text, reader marks, and AI exploration all tied together by durable anchors.
