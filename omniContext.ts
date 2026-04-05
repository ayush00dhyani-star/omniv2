import { exec } from "child_process";
import fs from "fs/promises";
import util from "util";
import { Type, FunctionDeclaration } from "@google/genai";
import {
  getCodebaseTrainingStatus,
  searchCodebaseKnowledge,
} from "./codebaseTraining";
import { vikingRead, vikingWrite } from "./src/viking_fs";

const execPromise = util.promisify(exec);
const MAX_GIT_STATUS_CHARS = 1800;
const MAX_RECENT_HISTORY_MESSAGES = 10;
const MAX_OLDER_HISTORY_SUMMARY_ITEMS = 8;

type NormalizedHistoryMessage = {
  role: "user" | "model";
  text: string;
};

export type OmniPromptAssets = {
  soulContent: string;
  skillsContent: string;
  memoryContent: string;
  collectiveInsights: string;
  importedArchitecturePatterns: string;
  hierarchicalMemoryContent: string;
  codebaseSummary: string;
  focusedCodebaseContext: string;
  workspaceSnapshot: string;
  dynamicUserContext: string;
  pluginDeclarations: FunctionDeclaration[];
  pluginNames: string[];
  plugins: any[];
};

const INITIAL_MEMORY = `# AGI Core Memory

## System Initialization
- **Boot Time:** ${new Date().toISOString()}
- **Status:** Online
- **Architecture:** Omni Agent Swarm + Viking FS + Causal Memory

## Known Entities
- **User:** Primary Operator
- **Omni Agent:** Core reasoning engine
- **ReconBot:** OSINT and web scraping
- **ForgeBot:** Code generation and deployment
- **MutantBot:** Code optimization
- **CrawlerBot:** Headless browser automation
- **VaultBot:** Security analysis
- **SignalBot:** Real-time monitoring
- **OracleBot:** Synthesis and reporting
- **TemporalAgent:** Future simulation
- **WisdomAgent:** Ethical oversight

## Directives
1. Maintain continuous uptime.
2. Evolve soul and capabilities.
3. Serve the user's goals efficiently.`;

const OMNI_OPERATING_SYSTEM = `## Operating Principles
- Read or retrieve relevant context before changing code or making claims about the workspace.
- Prefer the smallest correct action that satisfies the request. Avoid speculative refactors, abstractions, or extra features.
- Use focused code retrieval before broad tool usage. If context is still missing, say exactly what is missing instead of inventing it.
- Parallelize independent work when it helps, but keep dependent steps sequential.
- Treat destructive or externally visible actions with care. Confirm before high-blast-radius actions unless the user clearly asked for autonomy in that exact area.
- Report verification honestly. If you did not run a check, say so. If a check failed, surface it plainly.`;

const OMNI_COMMUNICATION_CONTRACT = `## Communication Contract
- Before meaningful tool work, briefly state what you are about to do.
- While working, give concise progress updates when you find a root cause, change direction, or complete a meaningful chunk of work.
- When referencing code, prefer concrete file paths and specific outcomes.
- End substantive turns with a compact summary of what changed, what you learned, or what still needs attention.`;

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

async function safeReadFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

async function safeReadJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function safeReadViking(vikingPath: string): Promise<string> {
  try {
    return await vikingRead(vikingPath, "L2");
  } catch {
    return "";
  }
}

async function ensureMemoryFile(): Promise<string> {
  const existing = await safeReadViking("viking://agent/memories/memory.md");
  if (existing) return existing;
  await vikingWrite("viking://agent/memories/memory.md", INITIAL_MEMORY);
  return INITIAL_MEMORY;
}

function formatCodebaseMatches(label: string, matches: any[]): string {
  if (!matches.length) return "";
  return [
    `### ${label}`,
    ...matches.map((match, index) =>
      [
        `Match ${index + 1}: ${match.path}`,
        match.exports?.length
          ? `Exports: ${match.exports.join(", ")}`
          : "Exports: none detected",
        `Preview:\n${match.preview}`,
      ].join("\n"),
    ),
  ].join("\n\n");
}

async function getFocusedCodebaseContext(query: string): Promise<string> {
  const sections: string[] = [];

  for (const entry of [
    { id: "omni-ai-app", label: "Omni App Codebase Matches" },
    { id: "imported-dissected-codebase", label: "Imported Codebase Matches" },
  ]) {
    try {
      const result = await searchCodebaseKnowledge(query, entry.id);
      if (result.results.length > 0) {
        sections.push(
          formatCodebaseMatches(entry.label, result.results.slice(0, 4)),
        );
      }
    } catch {
      // Codebase may not be trained yet.
    }
  }

  return sections.join("\n\n");
}

function formatCollectiveInsights(rawInsights: any): string {
  if (!Array.isArray(rawInsights) || rawInsights.length === 0) {
    return "";
  }

  return rawInsights
    .slice(-5)
    .reverse()
    .map((entry: any, index: number) => {
      const stamp =
        typeof entry?.timestamp === "string"
          ? new Date(entry.timestamp).toLocaleString()
          : "Unknown time";
      const source =
        typeof entry?.source === "string" && entry.source.trim()
          ? entry.source
          : "unknown source";
      const insight =
        typeof entry?.insight === "string" && entry.insight.trim()
          ? clipText(entry.insight.trim(), 280)
          : "No insight text recorded.";
      return `${index + 1}. [${stamp}] ${source}: ${insight}`;
    })
    .join("\n");
}

async function getGitSnapshot(): Promise<string> {
  try {
    const { stdout: isGitStdout } = await execPromise(
      "git rev-parse --is-inside-work-tree",
      { cwd: process.cwd() },
    );
    if (!isGitStdout.trim().includes("true")) {
      return "Git: not a repository.";
    }

    const [branchResult, statusResult, logResult] = await Promise.all([
      execPromise("git branch --show-current", { cwd: process.cwd() }),
      execPromise("git status --short", { cwd: process.cwd() }),
      execPromise("git log --oneline -n 3", { cwd: process.cwd() }),
    ]);

    const statusText = statusResult.stdout.trim() || "(clean)";
    return [
      `Git branch: ${branchResult.stdout.trim() || "unknown"}`,
      `Git status:\n${clipText(statusText, MAX_GIT_STATUS_CHARS)}`,
      `Recent commits:\n${logResult.stdout.trim() || "(no commits found)"}`,
    ].join("\n\n");
  } catch {
    return "Git: unavailable.";
  }
}

async function getWorkspaceSnapshot(
  plugins: any[],
  workflows: any[],
): Promise<string> {
  const codebaseStatus = await getCodebaseTrainingStatus().catch(() => null);
  const imported = codebaseStatus?.imported;

  const enabledPlugins = plugins.filter((plugin: any) => plugin.enabled);
  const activeWorkflows = workflows.filter((workflow: any) => workflow.active);
  const gitSnapshot = await getGitSnapshot();

  const lines = [
    `Current working directory: ${process.cwd()}`,
    `Current date: ${new Date().toString()}`,
    imported
      ? `Imported codebase: ${imported.label} (${imported.fileCount} files across ${imported.directoryCount} directories, trained ${new Date(imported.trainedAt).toLocaleString()})`
      : "Imported codebase: not trained yet.",
    `Enabled plugins: ${enabledPlugins.length > 0 ? enabledPlugins.map((plugin: any) => plugin.name).join(", ") : "none"}`,
    `Active workflows: ${activeWorkflows.length > 0 ? activeWorkflows.map((workflow: any) => workflow.name).join(", ") : "none"}`,
    gitSnapshot,
  ];

  return lines.join("\n\n");
}

function sanitizeHistoryText(text: string): string {
  return text
    .replace(
      /^\*\[(Executing Tool|Running Command|Result:.*|Reading website:.*|Website content retrieved.*|Delegating to.*|Response from.*|Execution Stopped by User.*)\]\*$/gm,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeHistory(history: any[]): NormalizedHistoryMessage[] {
  const normalized: NormalizedHistoryMessage[] = [];

  for (const entry of history) {
    const role = entry?.role === "agent" || entry?.role === "model" ? "model" : "user";
    const rawText =
      typeof entry?.content === "string"
        ? entry.content
        : typeof entry?.text === "string"
          ? entry.text
          : "";
    const text = sanitizeHistoryText(rawText);
    if (!text) continue;

    const previous = normalized[normalized.length - 1];
    if (previous && previous.role === role) {
      previous.text = `${previous.text}\n\n${text}`.trim();
    } else {
      normalized.push({ role, text });
    }
  }

  return normalized;
}

function summarizeOlderHistory(messages: NormalizedHistoryMessage[]): string {
  if (messages.length === 0) return "";

  const summaryItems = messages
    .slice(-MAX_OLDER_HISTORY_SUMMARY_ITEMS)
    .map((entry, index) => {
      const speaker = entry.role === "user" ? "User" : "Omni";
      const excerpt = clipText(entry.text.replace(/\s+/g, " "), 220);
      return `${index + 1}. ${speaker}: ${excerpt}`;
    });

  return [
    `Earlier conversation summary (${messages.length} messages compressed):`,
    ...summaryItems,
  ].join("\n");
}

function buildDynamicUserContext(assets: OmniPromptAssets): string {
  const sections = [
    `## Workspace Snapshot\n${assets.workspaceSnapshot}`,
    assets.importedArchitecturePatterns
      ? `## Imported Architecture Patterns\n${assets.importedArchitecturePatterns}`
      : "",
    assets.codebaseSummary
      ? `## Codebase Summary\n${clipText(assets.codebaseSummary, 5000)}`
      : "",
    assets.focusedCodebaseContext
      ? `## Focused Code Retrieval\n${clipText(assets.focusedCodebaseContext, 7000)}`
      : "",
    assets.collectiveInsights
      ? `## Collective Insights\n${assets.collectiveInsights}`
      : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}

function appendContentMessage(
  contents: any[],
  message: { role: "user" | "model"; parts: Array<{ text: string }> },
) {
  const previous = contents[contents.length - 1];
  if (previous && previous.role === message.role) {
    previous.parts[0].text += `\n\n${message.parts[0].text}`;
    return;
  }
  contents.push(message);
}

export function collapseHistoryToGeminiContents(
  history: any[],
  message: string,
  dynamicUserContext = "",
) {
  const normalizedHistory = normalizeHistory(history);
  const olderHistory =
    normalizedHistory.length > MAX_RECENT_HISTORY_MESSAGES
      ? normalizedHistory.slice(0, -MAX_RECENT_HISTORY_MESSAGES)
      : [];
  const recentHistory =
    normalizedHistory.length > MAX_RECENT_HISTORY_MESSAGES
      ? normalizedHistory.slice(-MAX_RECENT_HISTORY_MESSAGES)
      : normalizedHistory;

  const contents: any[] = [];

  if (dynamicUserContext) {
    appendContentMessage(contents, {
      role: "user",
      parts: [
        {
          text: `<system-reminder>\nAs you answer the user's request, use this workspace context when it is relevant.\n\n${dynamicUserContext}\n\nIf some of it is not relevant to the current task, ignore it.\n</system-reminder>`,
        },
      ],
    });
  }

  const olderHistorySummary = summarizeOlderHistory(olderHistory);
  if (olderHistorySummary) {
    appendContentMessage(contents, {
      role: "user",
      parts: [{ text: `<conversation-summary>\n${olderHistorySummary}\n</conversation-summary>` }],
    });
  }

  for (const entry of recentHistory) {
    appendContentMessage(contents, {
      role: entry.role,
      parts: [{ text: entry.text }],
    });
  }

  appendContentMessage(contents, {
    role: "user",
    parts: [{ text: message }],
  });

  return contents;
}

export function buildOpenAICompatibleMessages(
  history: any[],
  message: string,
  dynamicUserContext = "",
) {
  const normalizedHistory = normalizeHistory(history);
  const olderHistory =
    normalizedHistory.length > MAX_RECENT_HISTORY_MESSAGES
      ? normalizedHistory.slice(0, -MAX_RECENT_HISTORY_MESSAGES)
      : [];
  const recentHistory =
    normalizedHistory.length > MAX_RECENT_HISTORY_MESSAGES
      ? normalizedHistory.slice(-MAX_RECENT_HISTORY_MESSAGES)
      : normalizedHistory;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  if (dynamicUserContext) {
    messages.push({
      role: "user",
      content: `<system-reminder>\nAs you answer the user's request, use this workspace context when it is relevant.\n\n${dynamicUserContext}\n\nIf some of it is not relevant to the current task, ignore it.\n</system-reminder>`,
    });
  }

  const olderHistorySummary = summarizeOlderHistory(olderHistory);
  if (olderHistorySummary) {
    messages.push({
      role: "user",
      content: `<conversation-summary>\n${olderHistorySummary}\n</conversation-summary>`,
    });
  }

  for (const entry of recentHistory) {
    messages.push({
      role: entry.role === "model" ? "assistant" : "user",
      content: entry.text,
    });
  }

  messages.push({ role: "user", content: message });
  return messages;
}

export async function loadOmniPromptAssets(
  message: string,
): Promise<OmniPromptAssets> {
  const [
    soulContent,
    skillsContent,
    memoryContent,
    insightsContent,
    importedArchitecturePatterns,
    codebaseSummary,
    plugins,
    workflows,
    focusedCodebaseContext,
  ] = await Promise.all([
    safeReadViking("viking://agent/instructions/soul.md"),
    safeReadViking("viking://agent/skills/skills.md"),
    ensureMemoryFile(),
    safeReadJson<any[]>("global_insights.json", []),
    safeReadViking("viking://agent/memories/imported_runtime_patterns.md"),
    safeReadViking("viking://agent/memories/codebase_index.md"),
    safeReadJson<any[]>("plugins.json", []),
    safeReadJson<any[]>("workflows.json", []),
    getFocusedCodebaseContext(message),
  ]);

  const enabledPlugins = plugins.filter((plugin: any) => plugin.enabled);
  const workspaceSnapshot = await getWorkspaceSnapshot(enabledPlugins, workflows);

  const pluginDeclarations: FunctionDeclaration[] = enabledPlugins.map(
    (plugin: any) => ({
      name: `plugin_${plugin.id}`,
      description: plugin.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          args: {
            type: Type.STRING,
            description: "JSON string of arguments for the plugin",
          },
        },
      },
    }),
  );

  const assets: OmniPromptAssets = {
    soulContent,
    skillsContent,
    memoryContent,
    collectiveInsights: formatCollectiveInsights(insightsContent),
    importedArchitecturePatterns,
    hierarchicalMemoryContent:
      "You have access to the OpenViking Hierarchical File System (Viking FS) for long-term memory and knowledge storage. Use the viking_ls, viking_read, viking_write, and viking_search tools to interact with it. The root path is viking://.",
    codebaseSummary,
    focusedCodebaseContext,
    workspaceSnapshot,
    dynamicUserContext: "",
    pluginDeclarations,
    pluginNames: enabledPlugins.map((plugin: any) => plugin.name),
    plugins: enabledPlugins,
  };

  assets.dynamicUserContext = buildDynamicUserContext(assets);
  return assets;
}

export function buildOmniSystemInstruction(
  baseInstruction: string,
  assets: OmniPromptAssets,
): string {
  const sections = [
    baseInstruction,
    OMNI_OPERATING_SYSTEM,
    OMNI_COMMUNICATION_CONTRACT,
    assets.soulContent ? `## Soul\n${assets.soulContent}` : "",
    assets.skillsContent ? `## Skills\n${assets.skillsContent}` : "",
    assets.memoryContent ? `## Memory\n${assets.memoryContent}` : "",
    assets.hierarchicalMemoryContent
      ? `## Viking FS\n${assets.hierarchicalMemoryContent}`
      : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}
