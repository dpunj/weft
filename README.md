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

Uses [LLM](https://github.com/simonw/llm) to interface with OpenAI, Anthropic, and other providers. You can also install [plugins](https://llm.datasette.io/en/stable/other-models.html) to run local models on your machine.

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

Or, install a local model and run it on your machine:

```bash
llm install llm-gpt4all
llm models list # shows a list of available models
llm -m orca-mini-3b-gguf2-q4_0 '3 names for a pet cow' # tests the orca model locally (and downloads it first if needed)
```

## Try it!

Get a book from [Project Gutenberg](https://www.gutenberg.org/) and try it out:

```bash
uv run reader.py path/to/book.epub
```
