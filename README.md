# weft 🪢

A vim-like, AI-native terminal reader for books and documents.

Weft starts with EPUBs today: it converts chapters into Markdown-like text, renders them in a fast Bun-powered terminal reader, and lets you navigate with keyboard-first controls.

The next direction is bigger: EPUB/PDF/Markdown in → snappy Markdown reading surface → durable highlights/comments → AI tools that understand the book, your current location, and where they looked.

<https://x.com/dpunjabi/status/1854361314040446995>

See [`docs/WEFT_REBOOT.md`](docs/WEFT_REBOOT.md) for the reboot plan.

## Current features

### Vim-like navigation

- Flip between chapters: `h`/`l` or `←`/`→`
- Scroll through pages: `j`/`k` or `↑`/`↓`
- Jump to start/end: `g`/`G`
- See table of contents: `t`

### AI-native direction

The original Python prototype can chat, summarize, and read aloud. The Bun reboot is rebuilding that on top of a stronger document model first, so AI can operate over chapters, blocks, source spans, annotations, and search results instead of only the current page.

## Reboot direction

Weft should stay small and sharp, but grow a real document spine:

- **Normalized document model** — chapters, sections, blocks, and source spans instead of raw strings
- **Stable annotations** — highlights/comments in a sidecar file that can later export to Markdown
- **Reader-native AI tools** — `toc`, `current_location`, `get_section`, `search_text`, and eventually `repl_exec` over book blocks
- **Visible AI navigation** — show the reader what the model inspected, inspired by `recrsv`'s long-document exploration
- **Recrsv-style exploration rail** — web preview includes `toc`, `search_text`, and `context_get` slices so you can watch document tools move through the book
- **Global reading tape** — `d/u` turns pages across the book, `h/l` jumps sections, and `j/k` moves through actual passages/blocks
- **Minimal reading tracker** — book / section / page progress plus quiet estimated time remaining

## Getting started

Install dependencies with Bun:

```bash
bun install
```

Open the modern Markdown reader preview:

```bash
bun run web path/to/book.epub
# then open http://localhost:4173
```

Or use the minimal terminal reader:

```bash
bun run read path/to/book.epub
```

For now, the original Python prototype remains in `reader.py` as a reference implementation for chat/TTS experiments. The reboot path is Bun + TypeScript under `src/`.
