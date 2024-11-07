# weft 🪢

A vim-like terminal reader to chat with your books

<https://x.com/dpunjabi/status/1854361314040446995>

## Features

### Vim-like navigation

- Flip between chapters: `h`/`l` or `←`/`→`
- Scroll through pages: `j`/`k` or `↑`/`↓`
- Jump to start/end: `g`/`G`
- See table of contents: `t`

### Chat with your books

- `a` - Chat with your current text
- `s` - Generate summary
- `r` - Listen text
- `>` - Listen to the compass

Uses [LLM](https://github.com/simonw/llm) to interface with OpenAI, Anthropic, and other providers.

## Getting started

Clone this repo and setup & activate venv using either [uv](https://github.com/astral-sh/uv) (recommended)

```bash
uv venv
source .venv/bin/activate
```

Or, standard Python tools:

```bash
python3 -m pip install virtualenv
python3 -m virtualenv .venv
source .venv/bin/activate
```

Install dependencies with:

```bash
uv pip install -r requirements.txt # if using `uv` - faster!
# or
pip install -r requirements.txt
```

Bring your keys from OpenAI (default):

```bash
llm keys set OPENAI_API_KEY
```

Or use Anthropic's Claude:

```bash
llm install llm-claude-3
llm keys set ANTHROPIC_API_KEY
llm models default claude-3-5-sonnet-latest
```

## Try it!

Get a book from [Project Gutenberg](https://www.gutenberg.org/) and try it out:

```bash
uv run reader.py path/to/book.epub
```
