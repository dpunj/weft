#!/usr/bin/env bun
import { loadDocument } from "./document";
import { TerminalReader } from "./reader";

function printHelp(): void {
  console.log(`weft 🪢

Usage:
  weft read <path-to-book.epub>
  weft <path-to-book.epub>

Keys:
  h/l       previous/next section
  j/k       next/previous page
  g/G       start/end
  t         table of contents
  q         quit
`);
}

const args = process.argv.slice(2);
const command = args[0];
const sourcePath = command === "read" ? args[1] : command;

if (!sourcePath || sourcePath === "--help" || sourcePath === "-h") {
  printHelp();
  process.exit(sourcePath ? 0 : 1);
}

try {
  const document = await loadDocument(sourcePath);
  new TerminalReader(document).start();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
