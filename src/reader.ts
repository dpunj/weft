import readline from "node:readline";

import type { Section, WeftDocument } from "./document";

interface ReaderState {
  sectionIndex: number;
  pageIndex: number;
  showToc: boolean;
}

export class TerminalReader {
  private state: ReaderState = { sectionIndex: 0, pageIndex: 0, showToc: false };

  constructor(private readonly document: WeftDocument) {}

  start(): void {
    if (this.document.sections.length === 0) {
      console.error("No readable sections found.");
      return;
    }

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", (_, key) => this.handleKey(key));
    process.stdout.on("resize", () => this.render());
    this.render();
  }

  private handleKey(key: readline.Key): void {
    if (key.ctrl && key.name === "c") this.quit();

    switch (key.name) {
      case "q":
        this.quit();
        break;
      case "h":
      case "left":
        this.moveSection(-1);
        break;
      case "l":
      case "right":
        this.moveSection(1);
        break;
      case "j":
      case "down":
        this.movePage(1);
        break;
      case "k":
      case "up":
        this.movePage(-1);
        break;
      case "g":
        this.jumpStart();
        break;
      case "G":
        this.jumpEnd();
        break;
      case "t":
        this.state.showToc = !this.state.showToc;
        break;
      case "escape":
        this.state.showToc = false;
        break;
    }

    this.render();
  }

  private render(): void {
    clearScreen();
    if (this.state.showToc) {
      this.renderToc();
      return;
    }

    const section = this.currentSection();
    const pages = this.pagesFor(section);
    this.state.pageIndex = clamp(this.state.pageIndex, 0, pages.length - 1);
    const page = pages[this.state.pageIndex] ?? "";
    const sectionProgress = percent(this.state.pageIndex + 1, pages.length);
    const documentProgress = percent(this.state.sectionIndex + 1, this.document.sections.length);

    writeDim(`weft 🪢  ${this.document.title}`);
    process.stdout.write("\n");
    writeStrong(section.title);
    process.stdout.write(
      `\n${dim(`section ${this.state.sectionIndex + 1}/${this.document.sections.length}`)} ` +
        `${dim(`page ${this.state.pageIndex + 1}/${pages.length}`)} ` +
        `${dim(`section ${sectionProgress}% · book ${documentProgress}%`)}\n\n`,
    );
    process.stdout.write(page);
    process.stdout.write("\n\n");
    writeDim("h/l sections · j/k pages · g/G ends · t toc · q quit");
  }

  private renderToc(): void {
    writeDim(`weft 🪢  ${this.document.title}`);
    process.stdout.write("\n\n");
    writeStrong("Table of contents");
    process.stdout.write("\n\n");

    for (const [index, section] of this.document.sections.entries()) {
      const marker = index === this.state.sectionIndex ? "→" : " ";
      const label = `${marker} ${String(index + 1).padStart(2, " ")}. ${section.title}`;
      process.stdout.write(index === this.state.sectionIndex ? cyan(label) : label);
      process.stdout.write("\n");
    }

    process.stdout.write("\n");
    writeDim("t/Esc close toc · q quit");
  }

  private moveSection(delta: number): void {
    this.state.sectionIndex = clamp(
      this.state.sectionIndex + delta,
      0,
      this.document.sections.length - 1,
    );
    this.state.pageIndex = 0;
    this.state.showToc = false;
  }

  private movePage(delta: number): void {
    const pages = this.pagesFor(this.currentSection());
    const nextPage = this.state.pageIndex + delta;

    if (nextPage >= 0 && nextPage < pages.length) {
      this.state.pageIndex = nextPage;
      return;
    }

    if (delta > 0 && this.state.sectionIndex < this.document.sections.length - 1) {
      this.state.sectionIndex += 1;
      this.state.pageIndex = 0;
    }

    if (delta < 0 && this.state.sectionIndex > 0) {
      this.state.sectionIndex -= 1;
      this.state.pageIndex = this.pagesFor(this.currentSection()).length - 1;
    }
  }

  private jumpStart(): void {
    this.state.sectionIndex = 0;
    this.state.pageIndex = 0;
    this.state.showToc = false;
  }

  private jumpEnd(): void {
    this.state.sectionIndex = this.document.sections.length - 1;
    this.state.pageIndex = this.pagesFor(this.currentSection()).length - 1;
    this.state.showToc = false;
  }

  private currentSection(): Section {
    return this.document.sections[this.state.sectionIndex] ?? this.document.sections[0]!;
  }

  private pagesFor(section: Section): string[] {
    const rows = Math.max(10, process.stdout.rows || 30);
    const columns = Math.max(40, process.stdout.columns || 100);
    const contentRows = rows - 7;
    const contentWidth = columns - 2;
    const lines = section.blocks.flatMap((block) => [
      ...wrapMarkdown(block.markdown, contentWidth),
      "",
    ]);
    const pages: string[] = [];

    for (let index = 0; index < lines.length; index += contentRows) {
      pages.push(lines.slice(index, index + contentRows).join("\n"));
    }

    return pages.length ? pages : ["[empty section]"];
  }

  private quit(): never {
    clearScreen();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.exit(0);
  }
}

function wrapMarkdown(markdown: string, width: number): string[] {
  return markdown.split("\n").flatMap((line) => wrapLine(line, width));
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const words = line.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (`${current} ${word}`.trim().length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }

  if (current) lines.push(current);
  return lines;
}

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function percent(current: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((current / total) * 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function writeStrong(value: string): void {
  process.stdout.write(`\x1b[1m${value}\x1b[0m`);
}

function writeDim(value: string): void {
  process.stdout.write(dim(value));
}

function dim(value: string): string {
  return `\x1b[2m${value}\x1b[0m`;
}

function cyan(value: string): string {
  return `\x1b[36m${value}\x1b[0m`;
}
