import { Dirent } from "fs";
import fs from "fs/promises";
import path from "path";

const VIKING_ROOT = path.join(process.cwd(), "viking_data");
const CODEBASES_ROOT = path.join(VIKING_ROOT, "resources", "codebases");
const APP_SUMMARY_PATH = "viking://agent/memories/app_codebase_index.md";
const IMPORTED_SUMMARY_PATH = "viking://agent/memories/imported_codebase_index.md";
const COMBINED_SUMMARY_PATH = "viking://agent/memories/codebase_index.md";

const DEFAULT_EXTERNAL_SOURCE_PATH =
  process.env.OMNI_TRAINING_CODEBASE_PATH || path.resolve(process.cwd(), "..", "src");

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "out",
]);

const IGNORED_FILE_SUFFIXES = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".mp4",
  ".mp3",
  ".wav",
  ".zip",
  ".tar",
  ".gz",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".lock",
];

const TEXT_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".sh",
  ".ps1",
]);

type CodebaseKind = "app" | "external";

type IndexedFile = {
  path: string;
  extension: string;
  bytes: number;
  lineCount: number;
  imports: string[];
  exports: string[];
  symbols: string[];
  preview: string;
};

export type CodebaseManifest = {
  id: string;
  kind: CodebaseKind;
  label: string;
  sourcePath: string;
  trainedAt: string;
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  topLevelDirectories: Array<{ name: string; files: number }>;
  extensions: Array<{ extension: string; files: number }>;
  largestFiles: Array<{ path: string; bytes: number }>;
  keyFiles: Array<{ path: string; reason: string }>;
  readingOrder: string[];
  notes: string[];
  summaryPath: string;
};

type TrainCodebaseOptions = {
  sourcePath: string;
  label: string;
  kind: CodebaseKind;
  summaryVikingPath: string;
  id?: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function resolveVikingPath(vikingPath: string): string {
  const cleanPath = vikingPath.replace(/^viking:\/\//, "").replace(/^\//, "");
  const normalized = path.normalize(cleanPath).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(VIKING_ROOT, normalized);
}

async function writeVikingRaw(vikingPath: string, content: string): Promise<void> {
  const localPath = resolveVikingPath(vikingPath);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, content, "utf-8");
}

async function readVikingRaw(vikingPath: string): Promise<string | null> {
  try {
    return await fs.readFile(resolveVikingPath(vikingPath), "utf-8");
  } catch {
    return null;
  }
}

function looksTextFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  if (IGNORED_FILE_SUFFIXES.some((suffix) => lowerPath.endsWith(suffix))) {
    return false;
  }
  const extension = path.extname(lowerPath);
  return TEXT_FILE_EXTENSIONS.has(extension) || extension === "";
}

function shouldIgnorePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized
    .split("/")
    .some((segment) => IGNORED_DIRS.has(segment));
}

function extractImports(content: string): string[] {
  const matches = content.matchAll(
    /(?:import\s+.+?\s+from\s+|require\()\s*['"]([^'"]+)['"]/g
  );
  return Array.from(new Set(Array.from(matches, (match) => match[1] || "").filter(Boolean))).slice(
    0,
    25
  );
}

function extractNamedMatches(content: string, pattern: RegExp): string[] {
  return Array.from(
    new Set(Array.from(content.matchAll(pattern), (match) => match[1] || "").filter(Boolean))
  ).slice(0, 40);
}

function buildPreview(content: string): string {
  const lines = content.split(/\r?\n/).slice(0, 80).join("\n");
  return lines.length > 3200 ? `${lines.slice(0, 3200)}\n...[TRUNCATED]` : lines;
}

async function collectCodebaseFiles(rootPath: string): Promise<IndexedFile[]> {
  const stack = [rootPath];
  const indexed: IndexedFile[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (shouldIgnorePath(fullPath)) continue;

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!looksTextFile(fullPath)) continue;

      let content = "";
      let stats: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stats = await fs.stat(fullPath);
        content = await fs.readFile(fullPath, "utf-8");
      } catch {
        continue;
      }

      const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, "/");
      const extension = path.extname(relativePath).toLowerCase();

      indexed.push({
        path: relativePath,
        extension: extension || "(none)",
        bytes: stats.size,
        lineCount: content.split(/\r?\n/).length,
        imports: extractImports(content),
        exports: extractNamedMatches(
          content,
          /export\s+(?:const|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g
        ),
        symbols: extractNamedMatches(
          content,
          /(?:function|class|interface|type|enum|const)\s+([A-Za-z0-9_]+)/g
        ),
        preview: buildPreview(content),
      });
    }
  }

  indexed.sort((a, b) => a.path.localeCompare(b.path));
  return indexed;
}

function buildTopLevelDirectoryStats(files: IndexedFile[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    const topLevel = file.path.includes("/") ? file.path.split("/")[0] : "(root)";
    counts.set(topLevel, (counts.get(topLevel) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 20);
}

function buildExtensionStats(files: IndexedFile[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    counts.set(file.extension, (counts.get(file.extension) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([extension, files]) => ({ extension, files }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 20);
}

function buildLargestFiles(files: IndexedFile[]) {
  return [...files]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 15)
    .map((file) => ({ path: file.path, bytes: file.bytes }));
}

function buildDirectoryCount(files: IndexedFile[]): number {
  const directories = new Set<string>();
  for (const file of files) {
    const dir = path.posix.dirname(file.path);
    if (dir && dir !== ".") {
      directories.add(dir);
    }
  }
  return directories.size;
}

function inferKeyFiles(files: IndexedFile[]): Array<{ path: string; reason: string }> {
  const interestingPatterns: Array<{ matcher: RegExp; reason: string }> = [
    { matcher: /(^|\/)entrypoints\/cli\.tsx?$/i, reason: "CLI entrypoint" },
    { matcher: /(^|\/)main\.tsx?$/i, reason: "Main startup orchestration" },
    { matcher: /(^|\/)server\.tsx?$/i, reason: "Server orchestration" },
    { matcher: /(^|\/)QueryEngine\.tsx?$/i, reason: "Conversation/session engine" },
    { matcher: /(^|\/)query\.tsx?$/i, reason: "Streaming query loop" },
    { matcher: /(^|\/)Tool\.tsx?$/i, reason: "Tool contract" },
    { matcher: /(^|\/)tools\.tsx?$/i, reason: "Tool registry" },
    { matcher: /(^|\/)commands\.tsx?$/i, reason: "Command registry" },
    { matcher: /(^|\/)screens\/REPL\.tsx?$/i, reason: "Main interactive UI" },
    { matcher: /(^|\/)src\/App\.tsx?$/i, reason: "Main browser app entry" },
    { matcher: /(^|\/)src\/agents\.tsx?$/i, reason: "Agent catalog" },
    { matcher: /(^|\/)src\/viking_fs\.tsx?$/i, reason: "Persistent memory filesystem" },
  ];

  const matches: Array<{ path: string; reason: string }> = [];
  for (const pattern of interestingPatterns) {
    const found = files.find((file) => pattern.matcher.test(file.path));
    if (found) {
      matches.push({ path: found.path, reason: pattern.reason });
    }
  }

  return matches.slice(0, 12);
}

function inferReadingOrder(files: IndexedFile[]): string[] {
  const candidates = [
    "entrypoints/cli.tsx",
    "main.tsx",
    "server.ts",
    "interactiveHelpers.tsx",
    "screens/REPL.tsx",
    "src/App.tsx",
    "QueryEngine.ts",
    "query.ts",
    "Tool.ts",
    "tools.ts",
    "commands.ts",
    "src/viking_fs.ts",
  ];

  return candidates.filter((candidate) => files.some((file) => file.path === candidate)).slice(0, 8);
}

function inferNotes(files: IndexedFile[], topLevelDirectories: Array<{ name: string; files: number }>): string[] {
  const notes: string[] = [];
  const topLevelNames = new Set(topLevelDirectories.map((dir) => dir.name));
  const fileSet = new Set(files.map((file) => file.path));

  if (
    ["commands", "tools", "services", "hooks", "components", "ink"].every((name) =>
      topLevelNames.has(name)
    )
  ) {
    notes.push(
      "This looks like a terminal-first AI agent platform with a command registry, a tool runtime, a custom Ink-style UI layer, and many integration services."
    );
  }

  if (fileSet.has("QueryEngine.ts") && fileSet.has("query.ts")) {
    notes.push(
      "Conversation handling appears split between a persistent session engine (QueryEngine.ts) and a lower-level streaming/query loop (query.ts)."
    );
  }

  if (fileSet.has("main.tsx") && fileSet.has("screens/REPL.tsx")) {
    notes.push(
      "Startup and interactive runtime are concentrated in main.tsx and screens/REPL.tsx, which are likely the highest-risk orchestration hotspots."
    );
  }

  if (fileSet.has("src/viking_fs.ts")) {
    notes.push(
      "The app uses a virtual Viking filesystem for long-term memory and layered summaries rather than relying only on chat history."
    );
  }

  if (fileSet.has("services/mcp/client.ts")) {
    notes.push("MCP integration is a first-class subsystem rather than a thin add-on.");
  }

  return notes;
}

function formatCountList(items: Array<{ name: string; files: number }>): string {
  return items.map((item) => `- ${item.name}: ${item.files} files`).join("\n");
}

function formatExtensions(items: Array<{ extension: string; files: number }>): string {
  return items.map((item) => `- ${item.extension}: ${item.files} files`).join("\n");
}

function formatLargestFiles(items: Array<{ path: string; bytes: number }>): string {
  return items
    .map((item) => `- ${item.path} (${item.bytes.toLocaleString()} bytes)`)
    .join("\n");
}

function formatKeyFiles(items: Array<{ path: string; reason: string }>): string {
  return items.map((item) => `- ${item.path}: ${item.reason}`).join("\n");
}

function buildSummaryMarkdown(manifest: CodebaseManifest): string {
  const noteBlock =
    manifest.notes.length > 0 ? manifest.notes.map((note) => `- ${note}`).join("\n") : "- No special heuristics detected.";

  const readingOrder =
    manifest.readingOrder.length > 0
      ? manifest.readingOrder.map((file) => `- ${file}`).join("\n")
      : "- No canonical reading order detected.";

  return `# ${manifest.label}

- Kind: ${manifest.kind}
- Source: ${manifest.sourcePath}
- Trained: ${manifest.trainedAt}
- Files indexed: ${manifest.fileCount}
- Directories indexed: ${manifest.directoryCount}
- Total bytes scanned: ${manifest.totalBytes.toLocaleString()}

## Top-Level Directories
${formatCountList(manifest.topLevelDirectories)}

## Top Extensions
${formatExtensions(manifest.extensions)}

## Key Files
${formatKeyFiles(manifest.keyFiles)}

## Largest Files
${formatLargestFiles(manifest.largestFiles)}

## Notes
${noteBlock}

## Suggested Reading Order
${readingOrder}

## Retrieval Hint
Use the trained file index for path-based and symbol-based search, then read the matching file previews before drilling into details.`;
}

async function buildManifest(options: TrainCodebaseOptions, files: IndexedFile[]): Promise<CodebaseManifest> {
  const fileCount = files.length;
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const topLevelDirectories = buildTopLevelDirectoryStats(files);
  const extensions = buildExtensionStats(files);
  const largestFiles = buildLargestFiles(files);
  const keyFiles = inferKeyFiles(files);
  const readingOrder = inferReadingOrder(files);
  const notes = inferNotes(files, topLevelDirectories);

  return {
    id: options.id || slugify(`${options.kind}-${options.label}`),
    kind: options.kind,
    label: options.label,
    sourcePath: options.sourcePath,
    trainedAt: new Date().toISOString(),
    fileCount,
    directoryCount: buildDirectoryCount(files),
    totalBytes,
    topLevelDirectories,
    extensions,
    largestFiles,
    keyFiles,
    readingOrder,
    notes,
    summaryPath: options.summaryVikingPath,
  };
}

async function trainCodebase(options: TrainCodebaseOptions): Promise<CodebaseManifest> {
  const sourcePath = path.resolve(options.sourcePath);
  const stat = await fs.stat(sourcePath);
  if (!stat.isDirectory()) {
    throw new Error(`Source path is not a directory: ${sourcePath}`);
  }

  const files = await collectCodebaseFiles(sourcePath);
  const manifest = await buildManifest({ ...options, sourcePath }, files);
  const summary = buildSummaryMarkdown(manifest);

  const outputDir = path.join(CODEBASES_ROOT, manifest.id);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  await fs.writeFile(path.join(outputDir, "file_index.json"), JSON.stringify(files, null, 2), "utf-8");
  await fs.writeFile(path.join(outputDir, "summary.md"), summary, "utf-8");

  await writeVikingRaw(options.summaryVikingPath, summary);
  await refreshCombinedCodebaseIndex();

  return manifest;
}

export async function trainAppCodebase(sourcePath: string = path.join(process.cwd(), "src")) {
  return trainCodebase({
    sourcePath,
    label: "Omni AI App Source",
    kind: "app",
    summaryVikingPath: APP_SUMMARY_PATH,
    id: "omni-ai-app",
  });
}

export async function trainImportedCodebase(
  sourcePath: string = DEFAULT_EXTERNAL_SOURCE_PATH,
  label = "Imported Dissected Codebase"
) {
  return trainCodebase({
    sourcePath,
    label,
    kind: "external",
    summaryVikingPath: IMPORTED_SUMMARY_PATH,
    id: "imported-dissected-codebase",
  });
}

export async function refreshCombinedCodebaseIndex(): Promise<string> {
  const appSummary = await readVikingRaw(APP_SUMMARY_PATH);
  const importedSummary = await readVikingRaw(IMPORTED_SUMMARY_PATH);

  const sections = [
    "# Combined Codebase Index",
    "",
    "This file is the high-level entrypoint for codebase knowledge available to Omni.",
    "",
  ];

  if (appSummary) {
    sections.push("## Omni App Source");
    sections.push(appSummary);
    sections.push("");
  }

  if (importedSummary) {
    sections.push("## Imported External Codebase");
    sections.push(importedSummary);
    sections.push("");
  }

  if (!appSummary && !importedSummary) {
    sections.push("No codebases have been trained yet.");
  }

  const combined = sections.join("\n");
  await writeVikingRaw(COMBINED_SUMMARY_PATH, combined);
  return combined;
}

async function readManifest(id: string): Promise<CodebaseManifest | null> {
  try {
    const content = await fs.readFile(path.join(CODEBASES_ROOT, id, "manifest.json"), "utf-8");
    return JSON.parse(content) as CodebaseManifest;
  } catch {
    return null;
  }
}

async function readFileIndex(id: string): Promise<IndexedFile[]> {
  const content = await fs.readFile(path.join(CODEBASES_ROOT, id, "file_index.json"), "utf-8");
  return JSON.parse(content) as IndexedFile[];
}

export async function getCodebaseTrainingStatus() {
  const app = await readManifest("omni-ai-app");
  const imported = await readManifest("imported-dissected-codebase");
  return {
    defaultExternalSourcePath: DEFAULT_EXTERNAL_SOURCE_PATH,
    app,
    imported,
  };
}

function scoreFile(queryTerms: string[], file: IndexedFile): number {
  const haystack = `${file.path}\n${file.imports.join(" ")}\n${file.exports.join(" ")}\n${file.symbols.join(" ")}\n${file.preview}`.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    if (file.path.toLowerCase().includes(term)) score += 8;
    if (file.imports.some((value) => value.toLowerCase().includes(term))) score += 4;
    if (file.exports.some((value) => value.toLowerCase().includes(term))) score += 5;
    if (file.symbols.some((value) => value.toLowerCase().includes(term))) score += 4;
    if (haystack.includes(term)) score += 1;
  }

  if (queryTerms.length > 0 && file.path.toLowerCase().includes(queryTerms.join(" "))) {
    score += 10;
  }

  return score;
}

export async function searchCodebaseKnowledge(query: string, codebaseId = "imported-dissected-codebase") {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return { codebaseId, results: [] };
  }

  const manifest = await readManifest(codebaseId);
  if (!manifest) {
    throw new Error(`No trained codebase found for ${codebaseId}.`);
  }

  const files = await readFileIndex(codebaseId);
  const queryTerms = normalizedQuery.split(/\s+/).filter((term) => term.length > 1);
  const ranked = files
    .map((file) => ({ file, score: scoreFile(queryTerms, file) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, 8)
    .map(({ file, score }) => ({
      path: file.path,
      score,
      exports: file.exports,
      symbols: file.symbols.slice(0, 10),
      imports: file.imports.slice(0, 10),
      preview: file.preview,
    }));

  return {
    codebaseId,
    label: manifest.label,
    trainedAt: manifest.trainedAt,
    results: ranked,
  };
}
