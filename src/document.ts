import path from "node:path";

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import TurndownService from "turndown";

export type SourceType = "epub" | "html" | "pdf" | "markdown" | "text";
export type BlockKind = "heading" | "paragraph" | "quote" | "list" | "code" | "table" | "image" | "page_break";

export interface SourceSpan {
  sourcePath: string;
  href?: string;
  page?: number;
  charStart?: number;
  charEnd?: number;
  selector?: string;
}

export interface Block {
  id: string;
  sectionId: string;
  kind: BlockKind;
  markdown: string;
  plainText: string;
  sourceSpan: SourceSpan;
}

export interface Section {
  id: string;
  title: string;
  level: number;
  parentId?: string;
  blocks: Block[];
  sourceSpan: SourceSpan;
}

export interface WeftDocument {
  id: string;
  title: string;
  authors: string[];
  language?: string;
  description?: string;
  sourcePath: string;
  sourceType: SourceType;
  sections: Section[];
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType?: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
});

const markdownConverter = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

markdownConverter.remove(["script", "style", "img"]);

export async function loadDocument(sourcePath: string): Promise<WeftDocument> {
  const sourceUrl = sourcePath.toLowerCase().split("#")[0] ?? sourcePath.toLowerCase();

  if (sourceUrl.endsWith(".epub")) {
    return loadEpubDocument(sourcePath);
  }

  if (sourceUrl.endsWith(".html") || sourceUrl.endsWith(".htm")) {
    return loadHtmlDocument(sourcePath);
  }

  throw new Error(`Unsupported document type: ${path.extname(sourceUrl) || "unknown"}`);
}

export async function loadEpubDocument(sourcePath: string): Promise<WeftDocument> {
  const data = await Bun.file(sourcePath).arrayBuffer();
  const zip = await JSZip.loadAsync(data);
  const opfPath = await readOpfPath(zip);
  const opfText = await readZipText(zip, opfPath);
  const opf = xmlParser.parse(opfText) as Record<string, unknown>;
  const packageNode = objectAt(opf, "package");
  const metadata = objectAt(packageNode, "metadata");
  const manifestItems = readManifest(packageNode);
  const spineIds = readSpineIds(packageNode);
  const manifestById = new Map(manifestItems.map((item) => [item.id, item]));
  const opfDir = path.posix.dirname(opfPath);
  const sections: Section[] = [];

  for (const idref of spineIds) {
    const item = manifestById.get(idref);
    if (!item || !isReadableDocumentItem(item)) continue;

    const href = normalizeZipPath(path.posix.join(opfDir, item.href));
    const html = await readZipText(zip, href);
    const markdown = normalizeMarkdown(markdownConverter.turndown(html));
    if (!markdown) continue;

    const sectionId = `s${sections.length + 1}`;
    const sourceSpan: SourceSpan = { sourcePath, href };
    sections.push({
      id: sectionId,
      title: extractSectionTitle(markdown, item.href),
      level: 1,
      parentId: sections.at(-1)?.id,
      blocks: blocksFromMarkdown(markdown, sectionId, sourceSpan),
      sourceSpan,
    });
  }

  return {
    id: path.basename(sourcePath, path.extname(sourcePath)),
    title: firstMetadataValue(metadata, "title") ?? path.basename(sourcePath),
    authors: metadataValues(metadata, "creator"),
    language: firstMetadataValue(metadata, "language"),
    description: firstMetadataValue(metadata, "description"),
    sourcePath,
    sourceType: "epub",
    sections,
  };
}

export async function loadHtmlDocument(sourcePath: string): Promise<WeftDocument> {
  const html = await readSourceText(sourcePath);
  const title = extractHtmlTitle(html) ?? path.basename(sourcePath.split("#")[0] ?? sourcePath);
  const sourceSpan: SourceSpan = { sourcePath: sourcePath.split("#")[0] ?? sourcePath };
  const markdown = normalizeMarkdown(markdownConverter.turndown(preprocessHtml(html)));
  const sections = sectionsFromMarkdown(markdown, sourceSpan, title);

  return {
    id: sourceId(sourcePath),
    title,
    authors: [],
    sourcePath,
    sourceType: "html",
    sections,
  };
}

async function readSourceText(sourcePath: string): Promise<string> {
  if (/^https?:\/\//i.test(sourcePath)) {
    const url = new URL(sourcePath);
    url.hash = "";
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    return response.text();
  }

  return Bun.file(sourcePath).text();
}

function preprocessHtml(html: string): string {
  return html
    .replace(/<span[^>]*class=["'][^"']*pagenum[^"']*["'][^>]*>\s*<a[^>]*(?:name|id)=["']Page_(\d+)["'][\s\S]*?<\/a>\s*<\/span>/gi, "<p>WEFT_SOURCE_PAGE_$1</p>")
    .replace(/<a[^>]*(?:name|id)=["']Page_(\d+)["'][\s\S]*?<\/a>/gi, "<p>WEFT_SOURCE_PAGE_$1</p>");
}

function extractHtmlTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) return cleanHtmlText(title);

  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?? html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  return heading ? cleanHtmlText(heading) : undefined;
}

function cleanHtmlText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sourceId(sourcePath: string): string {
  const withoutHash = sourcePath.split("#")[0] ?? sourcePath;
  try {
    const url = new URL(withoutHash);
    return path.basename(url.pathname, path.extname(url.pathname)) || "document";
  } catch {
    return path.basename(withoutHash, path.extname(withoutHash)) || "document";
  }
}

function sectionsFromMarkdown(markdown: string, sourceSpan: SourceSpan, fallbackTitle: string): Section[] {
  const lines = markdown.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^#{1,2}\s+/.test(line) && current.some((currentLine) => currentLine.trim())) {
      chunks.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.some((line) => line.trim())) chunks.push(current.join("\n").trim());
  const sourceChunks = chunks.length ? chunks : [markdown];

  return sourceChunks.map((chunk, index) => {
    const sectionId = `s${index + 1}`;
    return {
      id: sectionId,
      title: extractSectionTitle(chunk, fallbackTitle),
      level: 1,
      parentId: index > 0 ? `s${index}` : undefined,
      blocks: blocksFromMarkdown(chunk, sectionId, sourceSpan),
      sourceSpan,
    };
  });
}

function readManifest(packageNode: Record<string, unknown>): ManifestItem[] {
  const manifest = objectAt(packageNode, "manifest");
  return arrayAt(manifest, "item")
    .map((item) => objectOrNull(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      id: String(item.id ?? ""),
      href: String(item.href ?? ""),
      mediaType: typeof item["media-type"] === "string" ? item["media-type"] : undefined,
    }))
    .filter((item) => item.id && item.href);
}

function readSpineIds(packageNode: Record<string, unknown>): string[] {
  const spine = objectAt(packageNode, "spine");
  return arrayAt(spine, "itemref")
    .map((item) => objectOrNull(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => String(item.idref ?? ""))
    .filter(Boolean);
}

async function readOpfPath(zip: JSZip): Promise<string> {
  const container = await readZipText(zip, "META-INF/container.xml");
  const parsed = xmlParser.parse(container) as Record<string, unknown>;
  const rootfiles = objectAt(objectAt(parsed, "container"), "rootfiles");
  const rootfile = objectOrNull(arrayAt(rootfiles, "rootfile")[0]) ?? objectAt(rootfiles, "rootfile");
  const fullPath = rootfile["full-path"];

  if (typeof fullPath !== "string" || !fullPath) {
    throw new Error("Invalid EPUB: missing OPF rootfile path.");
  }

  return normalizeZipPath(fullPath);
}

async function readZipText(zip: JSZip, filePath: string): Promise<string> {
  const file = zip.file(normalizeZipPath(filePath));
  if (!file) throw new Error(`Invalid EPUB: missing ${filePath}.`);
  return file.async("text");
}

function blocksFromMarkdown(markdown: string, sectionId: string, sectionSpan: SourceSpan): Block[] {
  const blocks: Block[] = [];
  let cursor = 0;
  let sourcePage = sectionSpan.page;

  for (const rawBlock of markdown.split(/\n{2,}/)) {
    const blockMarkdown = rawBlock.trim();
    if (!blockMarkdown) continue;

    const pageMarker = blockMarkdown.match(/^WEFT\\?_SOURCE\\?_PAGE\\?_(\d+)$/);
    if (pageMarker?.[1]) {
      sourcePage = Number(pageMarker[1]);
      cursor += rawBlock.length + 2;
      continue;
    }

    const start = markdown.indexOf(rawBlock, cursor);
    const end = start >= 0 ? start + rawBlock.length : undefined;
    blocks.push({
      id: `${sectionId}.b${blocks.length + 1}`,
      sectionId,
      kind: blockKind(blockMarkdown),
      markdown: blockMarkdown,
      plainText: plainText(blockMarkdown),
      sourceSpan: {
        sourcePath: sectionSpan.sourcePath,
        href: sectionSpan.href,
        page: sourcePage,
        selector: sourcePage ? `Page_${sourcePage}` : sectionSpan.selector,
        charStart: start >= 0 ? start : undefined,
        charEnd: end,
      },
    });
    cursor = end === undefined ? cursor : end;
  }

  return blocks;
}

function blockKind(markdown: string): BlockKind {
  if (markdown.startsWith("#")) return "heading";
  if (markdown.startsWith(">")) return "quote";
  if (markdown.startsWith("```")) return "code";
  if (/^[-*+]\s/.test(markdown) || /^\d+[.)]\s/.test(markdown)) return "list";
  if (markdown.includes("| ---")) return "table";
  return "paragraph";
}

function extractSectionTitle(markdown: string, fallbackHref: string): string {
  for (const line of markdown.split("\n").slice(0, 8)) {
    if (!line.startsWith("#")) continue;
    const title = line.replace(/^#+\s*/, "").trim();
    if (title && !/^wrap\d+$/i.test(title)) return title;
  }

  const firstText = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("![") && !/^wrap\d+$/i.test(line));

  return firstText ?? path.posix.basename(fallbackHref, path.posix.extname(fallbackHref)).replaceAll("_", " ");
}

function isReadableDocumentItem(item: ManifestItem): boolean {
  return !item.mediaType || ["application/xhtml+xml", "text/html"].includes(item.mediaType);
}

function metadataValues(metadata: Record<string, unknown>, key: string): string[] {
  return arrayAt(metadata, key)
    .map((value) => {
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      if (typeof value === "object" && value && "#text" in value) return String(value["#text"]);
      return "";
    })
    .map((value) => value.trim())
    .filter(Boolean);
}

function firstMetadataValue(metadata: Record<string, unknown>, key: string): string | undefined {
  return metadataValues(metadata, key)[0];
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#>*_`~\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeZipPath(filePath: string): string {
  return filePath.replace(/^\.\//, "");
}

function objectAt(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function arrayAt(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key];
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}
