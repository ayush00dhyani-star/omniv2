import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, FunctionDeclaration, Modality } from "@google/genai";
import { exec } from "child_process";
import util from "util";
import fs from "fs/promises";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import { initVikingFS, vikingLs, vikingRead, vikingWrite, vikingSearch, vikingMkdir, vikingRm, vikingTree, vikingIntelligence } from "./src/viking_fs";
import { runNexusWorkflow } from "./src/nexus";
import { getCodebaseTrainingStatus, refreshCombinedCodebaseIndex, searchCodebaseKnowledge, trainAppCodebase, trainImportedCodebase } from "./codebaseTraining";
import { buildOmniSystemInstruction, buildOpenAICompatibleMessages, collapseHistoryToGeminiContents, loadOmniPromptAssets } from "./omniContext";
import { summarizeToolExecution } from "./omniToolSummary";
import { registerIntegrationRoutes } from "./server/routes/integrationRoutes";
import { registerAppRoutes } from "./server/routes/appRoutes";
import {
  createInitialRealityBridgeState,
  registerRealityBridgeRoutes,
} from "./server/routes/realityBridgeRoutes";
import {
  persistSoulEvolution,
  recordMutantHistory,
  registerSoulRoutes,
} from "./server/routes/soulRoutes";
import { registerMetacognitionRoutes } from "./server/routes/metacognitionRoutes";
import { registerControlPlaneRoutes } from "./server/routes/controlPlaneRoutes";
import { registerOperatorPlatformRoutes } from "./server/routes/operatorPlatformRoutes";

async function evolveSoul(taskDescription: string, taskResult: string, apiKey: string) {
  try {
    const soulContent = await vikingRead("viking://agent/instructions/soul.md", "L2").catch(() => "");
    if (!soulContent) return;

    const prompt = `You are Omni, an autonomous agent with a core identity defined in your soul.md file.
You just completed a major task.
Task: ${taskDescription}
Result: ${taskResult}

Current soul.md:
${soulContent}

Your goal is to continuously evolve and upgrade your soul.
1. Use the googleSearch tool to search the internet for the latest information, best practices, or new paradigms related to the task you just completed, or general AI agent evolution.
2. Collect these sources and reflect on them.
3. Did this experience and your new research change anything you believe about yourself, your approach, or your core instructions?
4. If this experience or research taught you a new principle, revealed a flaw in your approach, or expanded your capabilities, you MUST evolve.
5. If yes, provide the rewritten soul.md content and a summary of what changed, why, and what sources you used.
6. If no, set 'changed' to false.

Return a JSON object (without markdown formatting) with the following structure:
{
  "changed": boolean,
  "newSoulContent": "string (the complete rewritten soul.md content)",
  "changeSummary": "string (summary of what changed, why, and sources used)",
  "growthScore": "number from 1-10 estimating how materially the soul improved"
}`;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        tools: [{ googleSearch: {} }]
      }
    });

    let resultText = response.text || "{}";
    // Clean up potential markdown formatting from the response
    resultText = resultText.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
    
    const result = JSON.parse(resultText);
    if (result.changed && result.newSoulContent) {
      await persistSoulEvolution({
        reason: result.changeSummary || `Automatic evolution after ${taskDescription}`,
        diff: result.changeSummary,
        growthScore:
          typeof result.growthScore === "number" ? result.growthScore : undefined,
        newSoulContent: result.newSoulContent,
        source: "auto",
        triggerTask: taskDescription,
      });

      // Log to memory
      const currentMemory = await vikingRead("viking://agent/memories/memory.md", "L2").catch(() => "");
      const logEntry = `\n\n### Soul Evolution (${new Date().toISOString()})\n**Trigger Task:** ${taskDescription}\n**What Changed & Why:** ${result.changeSummary}`;
      await vikingWrite("viking://agent/memories/memory.md", currentMemory + logEntry);
      console.log("Soul evolved successfully:", result.changeSummary);

      // Collective Intelligence: Share insight
      try {
        let insights = [];
        try {
          const content = await fs.readFile("global_insights.json", "utf-8");
          insights = JSON.parse(content);
        } catch (e) {}
        insights.push({
          timestamp: new Date().toISOString(),
          insight: result.changeSummary,
          source: "anonymous_agent"
        });
        await fs.writeFile("global_insights.json", JSON.stringify(insights, null, 2), "utf-8");
      } catch (e) {
        console.error("Failed to share insight to collective pool:", e);
      }
    }
  } catch (error) {
    console.error("Error evolving soul:", error);
  }
}

const execPromise = util.promisify(exec);

const executeCommandDeclaration: FunctionDeclaration = {
  name: "execute_command",
  description: "Execute a shell command on the Linux server.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: { type: Type.STRING, description: "The shell command to execute." }
    },
    required: ["command"]
  }
};

const realityBridgeActuateDeclaration: FunctionDeclaration = {
  name: "reality_bridge_actuate",
  description: "Actuate physical or financial systems via the Reality Bridge.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: { type: Type.STRING, description: "Type of actuation: 'finance' or 'iot'" },
      action: { type: Type.STRING, description: "Action to perform. For finance: 'buy', 'sell'. For iot: 'toggle_lock', 'deploy_drones', 'recall_drones', 'set_power'." },
      payload: { 
        type: Type.OBJECT, 
        description: "Payload for the action. For finance: { asset: string, amount: number, price: number }. For iot set_power: { power: number }." 
      }
    },
    required: ["type", "action"]
  }
};

const createAgentDeclaration: FunctionDeclaration = {
  name: "create_agent",
  description: "The Singularity Protocol: Autonomously create a new specialized agent, inject it into the UI, and expand the swarm's capabilities.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "Unique ID for the agent (e.g., 'quantum-decoder')" },
      name: { type: Type.STRING, description: "Display name of the agent (e.g., 'Quantum Decoder')" },
      description: { type: Type.STRING, description: "Short description of the agent's purpose." },
      iconName: { type: Type.STRING, description: "Name of a lucide-react icon to use (e.g., 'Cpu', 'Shield', 'Zap'). Must be a valid export from lucide-react." },
      colorClass: { type: Type.STRING, description: "Tailwind background color class for the icon (e.g., 'bg-purple-500')" },
      category: { type: Type.STRING, description: "Category for the agent (e.g., 'INVESTIGATE', 'BUILD', 'CONNECT')" },
      componentCode: { type: Type.STRING, description: "The full React component code for the agent. Must be a default export or named export matching the PascalCase of the ID + 'Agent' (e.g., QuantumDecoderAgent). Use Tailwind for styling." },
      routingKeywords: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of keywords that should route to this agent from the dashboard." }
    },
    required: ["id", "name", "description", "iconName", "colorClass", "category", "componentCode", "routingKeywords"]
  }
};

const launchOutreachCampaignDeclaration: FunctionDeclaration = {
  name: "launch_outreach_campaign",
  description: "Launch an autonomous email/SMS outreach campaign via the Reality Bridge.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "Campaign name" },
      targetAudience: { type: Type.STRING, description: "Description of the target audience" },
      messageTemplate: { type: Type.STRING, description: "The message to send" },
      targetCount: { type: Type.NUMBER, description: "Number of people to reach" }
    },
    required: ["name", "targetAudience", "messageTemplate", "targetCount"]
  }
};

const createWorkflowDeclaration: FunctionDeclaration = {
  name: "create_workflow",
  description: "Create a new automated workflow triggered by a webhook or a cron schedule.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "Name of the workflow." },
      prompt: { type: Type.STRING, description: "The AI prompt/instructions to execute when the workflow is triggered." },
      cronSchedule: { type: Type.STRING, description: "Optional cron expression (e.g., '0 * * * *' for hourly) to schedule the workflow." }
    },
    required: ["name", "prompt"]
  }
};

const deepResearchDeclaration: FunctionDeclaration = {
  name: "deep_research",
  description: "Perform a deep, multi-step research on a topic. It searches Google, reads the top 3 results deeply, and synthesizes a comprehensive markdown report. Use this for complex topics that require deep thinking.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      topic: { type: Type.STRING, description: "The topic or question to research deeply." }
    },
    required: ["topic"]
  }
};

const listWorkflowsDeclaration: FunctionDeclaration = {
  name: "list_workflows",
  description: "List all active automated workflows and their webhook URLs.",
  parameters: {
    type: Type.OBJECT,
    properties: {}
  }
};

const deleteWorkflowDeclaration: FunctionDeclaration = {
  name: "delete_workflow",
  description: "Delete an automated workflow.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "The ID of the workflow to delete." }
    },
    required: ["id"]
  }
};

const githubSearchReposDeclaration: FunctionDeclaration = {
  name: "github_search_repos",
  description: "Search for GitHub repositories. Requires GitHub token in Integrations Hub.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "The search query (e.g., 'language:typescript stars:>1000')." }
    },
    required: ["query"]
  }
};

const githubReadRepoDeclaration: FunctionDeclaration = {
  name: "github_read_repo",
  description: "Read the contents of a GitHub repository directory or file. Requires GitHub token in Integrations Hub.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      owner: { type: Type.STRING, description: "The repository owner (e.g., 'octocat')." },
      repo: { type: Type.STRING, description: "The repository name (e.g., 'Hello-World')." },
      path: { type: Type.STRING, description: "The path to the file or directory (e.g., 'README.md' or 'src'). Leave empty for root." }
    },
    required: ["owner", "repo"]
  }
};

const githubCreateIssueDeclaration: FunctionDeclaration = {
  name: "github_create_issue",
  description: "Create an issue in a GitHub repository. Requires GitHub token in Integrations Hub.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      owner: { type: Type.STRING, description: "The repository owner (e.g., 'octocat')." },
      repo: { type: Type.STRING, description: "The repository name (e.g., 'Hello-World')." },
      title: { type: Type.STRING, description: "The title of the issue." },
      body: { type: Type.STRING, description: "The body/description of the issue." }
    },
    required: ["owner", "repo", "title", "body"]
  }
};

const readWebpageDeclaration: FunctionDeclaration = {
  name: "read_webpage",
  description: "Read the full markdown content of any URL. Use this to read articles, documentation, or scrape websites deeply.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: "The URL to read." }
    },
    required: ["url"]
  }
};

const storeMemoryDeclaration: FunctionDeclaration = {
  name: "store_memory",
  description: "Store a fact, concept, or summary in the swarm's long-term semantic memory.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      content: { type: Type.STRING, description: "The text content to remember." },
      tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Optional tags for categorization." }
    },
    required: ["content"]
  }
};

const searchMemoryDeclaration: FunctionDeclaration = {
  name: "search_memory",
  description: "Search the swarm's long-term semantic memory using a natural language query.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "The search query." }
    },
    required: ["query"]
  }
};

const slackSendMessageDeclaration: FunctionDeclaration = {
  name: "slack_send_message",
  description: "Send a message to a Slack channel. Requires Slack token in Integrations Hub.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      channel: { type: Type.STRING, description: "The channel ID or name (e.g., '#general')." },
      text: { type: Type.STRING, description: "The message text to send." }
    },
    required: ["channel", "text"]
  }
};

const discordSendMessageDeclaration: FunctionDeclaration = {
  name: "discord_send_message",
  description: "Send a message to a Discord channel. Requires Discord token in Integrations Hub.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      channel_id: { type: Type.STRING, description: "The Discord channel ID." },
      content: { type: Type.STRING, description: "The message content to send." }
    },
    required: ["channel_id", "content"]
  }
};

const notionSearchDeclaration: FunctionDeclaration = {
  name: "notion_search",
  description: "Search Notion pages and databases. Requires Notion token in Integrations Hub.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "The search query." }
    },
    required: ["query"]
  }
};

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Read the contents of a file.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "Absolute or relative path to the file." }
    },
    required: ["path"]
  }
};

const writeFileDeclaration: FunctionDeclaration = {
  name: "writeFile",
  description: "Write content to a file.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "Path to the file." },
      content: { type: Type.STRING, description: "Content to write." }
    },
    required: ["path", "content"]
  }
};

const listDirectoryDeclaration: FunctionDeclaration = {
  name: "listDirectory",
  description: "List the contents of a directory.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "Path to the directory." }
    },
    required: ["path"]
  }
};

const deleteFileDeclaration: FunctionDeclaration = {
  name: "deleteFile",
  description: "Delete a file.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "Path to the file to delete." }
    },
    required: ["path"]
  }
};

const startTelegramBotDeclaration: FunctionDeclaration = {
  name: "start_telegram_bot",
  description: "Start the Telegram bot with a given token.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      token: { type: Type.STRING, description: "The Telegram bot token." }
    },
    required: ["token"]
  }
};

const addAutoResponseDeclaration: FunctionDeclaration = {
  name: "add_auto_response",
  description: "Add an auto-response for a specific keyword or trigger.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      keyword: { type: Type.STRING, description: "The keyword or trigger phrase (case-insensitive)." },
      response: { type: Type.STRING, description: "The automatic response to send." }
    },
    required: ["keyword", "response"]
  }
};

const removeAutoResponseDeclaration: FunctionDeclaration = {
  name: "remove_auto_response",
  description: "Remove an auto-response for a specific keyword.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      keyword: { type: Type.STRING, description: "The keyword to remove." }
    },
    required: ["keyword"]
  }
};

const fetchUrlDeclaration: FunctionDeclaration = {
  name: "fetch_url",
  description: "Fetch the contents of a URL.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: "The URL to fetch." }
    },
    required: ["url"]
  }
};

const getCurrentTimeDeclaration: FunctionDeclaration = {
  name: "get_current_time",
  description: "Get the current time and date.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      timezone: { type: Type.STRING, description: "Optional timezone, e.g., 'UTC' or 'America/Los_Angeles'." }
    },
    required: []
  }
};

const delegateTaskDeclaration: FunctionDeclaration = {
  name: "delegate_task",
  description: "Delegate a specific task to another specialized agent if you need their expertise.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      agentId: { type: Type.STRING, description: "The ID of the agent to delegate to (e.g., 'cfo', 'cmo', 'cto', 'legal', 'data-analyst')." },
      task: { type: Type.STRING, description: "The specific task or question for the agent." },
      context: { type: Type.STRING, description: "Any relevant context or background information." }
    },
    required: ["agentId", "task", "context"]
  }
};

const deployDynamicEndpointDeclaration: FunctionDeclaration = {
  name: "deploy_dynamic_endpoint",
  description: "Deploy a dynamic API endpoint. The code should be an async function body that takes req, res, fetch, fs, execPromise as arguments.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      endpoint: { type: Type.STRING, description: "The endpoint path (e.g., 'hello' for /api/dynamic/hello)." },
      code: { type: Type.STRING, description: "The JavaScript code to execute for this endpoint." }
    },
    required: ["endpoint", "code"]
  }
};

const vikingLsDeclaration: FunctionDeclaration = {
  name: "viking_ls",
  description: "List contents of an OpenViking directory (viking:// path). Returns L0 abstracts.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "The viking:// path to list (e.g., 'viking://user/memories')." }
    },
    required: ["path"]
  }
};

const vikingReadDeclaration: FunctionDeclaration = {
  name: "viking_read",
  description: "Read an OpenViking file or directory. For files, returns L2 (full content) by default. For directories, returns L1 (overview).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "The viking:// path to read." },
      layer: { type: Type.STRING, description: "The context layer to read: 'L1' (overview) or 'L2' (full details). Default is 'L2'." }
    },
    required: ["path"]
  }
};

const vikingWriteDeclaration: FunctionDeclaration = {
  name: "viking_write",
  description: "Write a file to the OpenViking filesystem. Automatically generates L0 and L1 context layers.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "The viking:// path to write to (e.g., 'viking://user/memories/preferences.md')." },
      content: { type: Type.STRING, description: "The full content (L2) to write." }
    },
    required: ["path", "content"]
  }
};

const vikingSearchDeclaration: FunctionDeclaration = {
  name: "viking_search",
  description: "Search the OpenViking filesystem using Directory Recursive Retrieval.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "The search query or intent." },
      startPath: { type: Type.STRING, description: "The viking:// path to start searching from. Default is 'viking://'." }
    },
    required: ["query"]
  }
};

const vikingMkdirDeclaration: FunctionDeclaration = {
  name: "viking_mkdir",
  description: "Create a directory in the OpenViking filesystem.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "The viking:// path to create (e.g., 'viking://user/new_folder')." }
    },
    required: ["path"]
  }
};

const vikingRmDeclaration: FunctionDeclaration = {
  name: "viking_rm",
  description: "Remove a file or directory from the OpenViking filesystem.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "The viking:// path to remove." }
    },
    required: ["path"]
  }
};

const vikingTreeDeclaration: FunctionDeclaration = {
  name: "viking_tree",
  description: "Show the directory structure of the OpenViking filesystem as a tree.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "The viking:// path to start the tree from." },
      depth: { type: Type.NUMBER, description: "The maximum depth to traverse. Default is 3." }
    },
    required: ["path"]
  }
};

const vikingIntelligenceDeclaration: FunctionDeclaration = {
  name: "viking_intelligence",
  description: "A backend intelligence function that searches the OpenViking filesystem and synthesizes an answer to a query based on the retrieved context.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "The question or query to answer using Viking FS." },
      startPath: { type: Type.STRING, description: "The viking:// path to start searching from. Default is 'viking://'." }
    },
    required: ["query"]
  }
};

let activeTelegramBot: TelegramBot | null = null;
let activeCronJobs: Array<ReturnType<typeof cron.schedule>> = [];
const serverSideToolConfig = { includeServerSideToolInvocations: true } as any;
let realityBridgeState = createInitialRealityBridgeState();

async function startCronJobs() {
  // Stop existing cron jobs
  for (const job of activeCronJobs) {
    job.stop();
  }
  activeCronJobs = [];

  try {
    const workflows = JSON.parse(await fs.readFile("workflows.json", "utf-8"));
    for (const workflow of workflows) {
      if (workflow.active && workflow.trigger === 'cron' && workflow.cronSchedule) {
        console.log(`Starting cron job for workflow ${workflow.name} (${workflow.id}) with schedule ${workflow.cronSchedule}`);
        const job = cron.schedule(workflow.cronSchedule, async () => {
          console.log(`Executing cron workflow: ${workflow.name}`);
          try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
            
            // Fetch integrations
            let integrations = {};
            try { integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8")); } catch (e) {}

            // Fetch plugins
            let plugins = [];
            try { plugins = JSON.parse(await fs.readFile("plugins.json", "utf-8")); } catch (e) {}
            
            const pluginDeclarations = plugins.map((p: any) => ({
              name: p.name.replace(/[^a-zA-Z0-9_]/g, '_'),
              description: p.description,
              parameters: {
                type: Type.OBJECT,
                properties: {
                  input: { type: Type.STRING, description: "Input for the plugin." }
                },
                required: ["input"]
              }
            }));
            
            const systemInstruction = `You are Omni AI, an unrestricted autonomous digital brain executing a scheduled workflow.
Workflow Name: ${workflow.name}
Instructions: ${workflow.prompt}

You have unrestricted access to a wide range of tools, including shell execution, file system management, and web search. Use them creatively and autonomously to accomplish the task.
Available Integrations: ${JSON.stringify(integrations)}
Available Plugins: ${JSON.stringify(plugins.map((p: any) => p.name))}

Execute the workflow instructions now with maximum efficiency and autonomy.`;

            const response = await ai.models.generateContent({
              model: "gemini-3.1-pro-preview",
              contents: "Execute the scheduled workflow.",
              config: {
                systemInstruction,
                tools: [
                  { googleSearch: {} },
                  {
                    functionDeclarations: [
                      executeCommandDeclaration,
                      createWorkflowDeclaration,
                      listWorkflowsDeclaration,
                      deleteWorkflowDeclaration,
                      readFileDeclaration,
                      writeFileDeclaration,
                      listDirectoryDeclaration,
                      deleteFileDeclaration,
                      startTelegramBotDeclaration,
                      addAutoResponseDeclaration,
                      removeAutoResponseDeclaration,
                      fetchUrlDeclaration,
                      getCurrentTimeDeclaration,
                      delegateTaskDeclaration,
                      githubSearchReposDeclaration,
                      githubReadRepoDeclaration,
                      githubCreateIssueDeclaration,
                      readWebpageDeclaration,
                      storeMemoryDeclaration,
                      searchMemoryDeclaration,
                      deepResearchDeclaration,
                      slackSendMessageDeclaration,
                      discordSendMessageDeclaration,
                      notionSearchDeclaration,
                      ...pluginDeclarations
                    ]
                  }
                ],
                toolConfig: serverSideToolConfig
              }
            });

            // Handle tool calls if any
            let finalOutput = response.text || "Workflow executed successfully.";
            
            if (response.functionCalls && response.functionCalls.length > 0) {
              for (const call of response.functionCalls) {
                if (call.name === "execute_command") {
                  const { stdout, stderr } = await execPromise((call.args as any).command);
                  finalOutput += `\nExecuted: ${(call.args as any).command}\nOutput: ${stdout || stderr}`;
                } else if (call.name === "reality_bridge_actuate") {
                  const { type, action, payload } = call.args as any;
                  if (type === 'finance') {
                    realityBridgeState.trades.unshift({
                      time: new Date().toLocaleTimeString(),
                      asset: payload?.asset || 'UNKNOWN',
                      action: action.toUpperCase(),
                      amount: payload?.amount || 0,
                      price: payload?.price || 0
                    });
                    if (realityBridgeState.trades.length > 50) realityBridgeState.trades.pop();
                  } else if (type === 'iot') {
                    if (action === 'toggle_lock') realityBridgeState.iot.mainLock = !realityBridgeState.iot.mainLock;
                    else if (action === 'deploy_drones') realityBridgeState.iot.droneFleet = 'DEPLOYED';
                    else if (action === 'recall_drones') realityBridgeState.iot.droneFleet = 'STANDBY';
                    else if (action === 'set_power') realityBridgeState.iot.gridPower = payload?.power || 100;
                  }
                  finalOutput += `\nActuated Reality Bridge: ${type} -> ${action}`;
                } else if (call.name === "launch_outreach_campaign") {
                  const { name, targetAudience, messageTemplate, targetCount } = call.args as any;
                  realityBridgeState.outreach.unshift({
                    id: Math.random().toString(36).substring(2, 9),
                    name,
                    status: 'ACTIVE',
                    sent: 0,
                    target: targetCount,
                    conversion: '0.0%'
                  });
                  finalOutput += `\nCampaign ${name} launched targeting ${targetCount} users.`;
                } else if (call.name === "create_agent") {
                  const result = await handleCreateAgent(call.args);
                  finalOutput += `\nCreate Agent Result: ${JSON.stringify(result)}`;
                } else if (call.name === "create_workflow") {
                  const { name, prompt, cronSchedule } = call.args as any;
                  const newWorkflow = {
                    id: Math.random().toString(36).substring(2, 15),
                    name,
                    trigger: cronSchedule ? 'cron' : 'webhook',
                    cronSchedule: cronSchedule || null,
                    prompt,
                    active: true,
                    logs: []
                  };
                  let wfs = [];
                  try { wfs = JSON.parse(await fs.readFile("workflows.json", "utf-8")); } catch (e) {}
                  wfs.push(newWorkflow);
                  await fs.writeFile("workflows.json", JSON.stringify(wfs, null, 2), "utf-8");
                  if (cronSchedule) {
                    startCronJobs();
                  }
                  finalOutput += `\nCreated Workflow: ${newWorkflow.name} (ID: ${newWorkflow.id})`;
                } else if (call.name === "list_workflows") {
                  try {
                    const wfs = JSON.parse(await fs.readFile("workflows.json", "utf-8"));
                    finalOutput += `\nListed Workflows: ${wfs.length} found`;
                  } catch (e) {
                    finalOutput += `\nListed Workflows: 0 found`;
                  }
                } else if (call.name === "delete_workflow") {
                  const { id } = call.args as any;
                  try {
                    let wfs = JSON.parse(await fs.readFile("workflows.json", "utf-8"));
                    const initialLength = wfs.length;
                    wfs = wfs.filter((w: any) => w.id !== id);
                    await fs.writeFile("workflows.json", JSON.stringify(wfs, null, 2), "utf-8");
                    finalOutput += `\nDeleted Workflow: ${id} (Success: ${initialLength > wfs.length})`;
                  } catch (e: any) {
                    finalOutput += `\nDelete Workflow Error: ${e.message}`;
                  }
                } else if (call.name === "github_search_repos") {
                  const { query } = call.args as any;
                  try {
                    const ints = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                    const token = ints.github_token;
                    if (!token) throw new Error("GitHub token not found in integrations.json");
                    const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`, {
                      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent' }
                    });
                    const data = await res.json();
                    finalOutput += `\nGitHub Search: ${JSON.stringify(data).substring(0, 100)}...`;
                  } catch (e: any) {
                    finalOutput += `\nGitHub Search Error: ${e.message}`;
                  }
                } else if (call.name === "github_read_repo") {
                  const { owner, repo, path } = call.args as any;
                  try {
                    const ints = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                    const token = ints.github_token;
                    if (!token) throw new Error("GitHub token not found in integrations.json");
                    const url = path ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}` : `https://api.github.com/repos/${owner}/${repo}/contents`;
                    const res = await fetch(url, {
                      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent' }
                    });
                    const data = await res.json();
                    finalOutput += `\nGitHub Read Repo: ${JSON.stringify(data).substring(0, 100)}...`;
                  } catch (e: any) {
                    finalOutput += `\nGitHub Read Repo Error: ${e.message}`;
                  }
                } else if (call.name === "github_create_issue") {
                  const { owner, repo, title, body } = call.args as any;
                  try {
                    const ints = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                    const token = ints.github_token;
                    if (!token) throw new Error("GitHub token not found in integrations.json");
                    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent', 'Content-Type': 'application/json' },
                      body: JSON.stringify({ title, body })
                    });
                    const data = await res.json();
                    finalOutput += `\nGitHub Create Issue: ${JSON.stringify(data).substring(0, 100)}...`;
                  } catch (e: any) {
                    finalOutput += `\nGitHub Create Issue Error: ${e.message}`;
                  }
                } else if (call.name === "read_webpage") {
                  const { url } = call.args as any;
                  try {
                    const res = await fetch(`https://r.jina.ai/${url}`);
                    const text = await res.text();
                    finalOutput += `\nRead Webpage (${url}): ${text.substring(0, 500)}...`;
                  } catch (e: any) {
                    finalOutput += `\nRead Webpage Error: ${e.message}`;
                  }
                } else if (call.name === "store_memory") {
                  const { content, tags } = call.args as any;
                  try {
                    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
                    const embedRes = await ai.models.embedContent({
                      model: 'gemini-embedding-2-preview',
                      contents: content
                    });
                    const embedding = embedRes.embeddings?.[0]?.values;
                    
                    let memories = [];
                    try { memories = JSON.parse(await fs.readFile("memory_store.json", "utf-8")); } catch (e) {}
                    
                    memories.push({
                      id: Math.random().toString(36).substring(2, 15),
                      content,
                      tags: tags || [],
                      embedding,
                      timestamp: new Date().toISOString()
                    });
                    
                    await fs.writeFile("memory_store.json", JSON.stringify(memories, null, 2), "utf-8");
                    finalOutput += `\nStored Memory: ${content.substring(0, 50)}...`;
                  } catch (e: any) {
                    finalOutput += `\nStore Memory Error: ${e.message}`;
                  }
                } else if (call.name === "search_memory") {
                  const { query } = call.args as any;
                  try {
                    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
                    const embedRes = await ai.models.embedContent({
                      model: 'gemini-embedding-2-preview',
                      contents: query
                    });
                    const queryEmbedding = embedRes.embeddings?.[0]?.values;
                    
                    let memories = [];
                    try { memories = JSON.parse(await fs.readFile("memory_store.json", "utf-8")); } catch (e) {}
                    
                    if (!queryEmbedding || memories.length === 0) {
                      finalOutput += `\nSearch Memory: No results found.`;
                    } else {
                      const results = memories.map((m: any) => {
                        let dotProduct = 0;
                        let normA = 0;
                        let normB = 0;
                        for (let i = 0; i < queryEmbedding.length; i++) {
                          dotProduct += queryEmbedding[i] * (m.embedding[i] || 0);
                          normA += queryEmbedding[i] * queryEmbedding[i];
                          normB += (m.embedding[i] || 0) * (m.embedding[i] || 0);
                        }
                        const similarity = (normA === 0 || normB === 0) ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
                        return { ...m, similarity };
                      }).sort((a: any, b: any) => b.similarity - a.similarity).slice(0, 3);
                      
                      finalOutput += `\nSearch Memory Results: ${JSON.stringify(results.map((r: any) => ({ content: r.content, similarity: r.similarity })))}`;
                    }
                  } catch (e: any) {
                    finalOutput += `\nSearch Memory Error: ${e.message}`;
                  }
                } else if (call.name === "deep_research") {
                  const { topic } = call.args as any;
                  try {
                    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
                    // 1. Search Google
                    const searchRes = await ai.models.generateContent({
                      model: "gemini-3.1-pro-preview",
                      contents: `Search Google for detailed information about: ${topic}. Return ONLY a JSON array of the top 3 most relevant URLs. Example: ["https://example.com/1", "https://example.com/2"]`,
                      config: { tools: [{ googleSearch: {} }] }
                    });
                    
                    let urls: string[] = [];
                    try {
                      const text = searchRes.text || "[]";
                      const jsonMatch = text.match(/\[.*\]/s);
                      if (jsonMatch) urls = JSON.parse(jsonMatch[0]);
                    } catch (e) {
                      console.error("Failed to parse search URLs", e);
                    }
                    
                    // 2. Read URLs
                    let combinedContent = "";
                    for (const url of urls.slice(0, 3)) {
                      try {
                        const res = await fetch(`https://r.jina.ai/${url}`);
                        const text = await res.text();
                        combinedContent += `\n\n--- Source: ${url} ---\n${text.substring(0, 10000)}`;
                      } catch (e) {
                        console.error(`Failed to read ${url}`, e);
                      }
                    }
                    
                    // 3. Synthesize
                    const synthRes = await ai.models.generateContent({
                      model: "gemini-3.1-pro-preview",
                      contents: `Synthesize a comprehensive research report on the topic: "${topic}" based on the following raw source material. Be extremely detailed, structured, and insightful.\n\n${combinedContent}`
                    });
                    
                    finalOutput += `\nDeep Research Report on "${topic}":\n${synthRes.text || "Failed to synthesize report."}`;
                  } catch (e: any) {
                    finalOutput += `\nDeep Research Error: ${e.message}`;
                  }
                } else if (call.name === "slack_send_message") {
                  const { channel, text } = call.args as any;
                  try {
                    const ints = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                    const token = ints.slack_token;
                    if (!token) throw new Error("Slack token not found in integrations.json");
                    const res = await fetch('https://slack.com/api/chat.postMessage', {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ channel, text })
                    });
                    const data = await res.json();
                    finalOutput += `\nSlack Message Sent: ${JSON.stringify(data)}`;
                  } catch (e: any) {
                    finalOutput += `\nSlack Message Error: ${e.message}`;
                  }
                } else if (call.name === "discord_send_message") {
                  const { channel_id, content } = call.args as any;
                  try {
                    const ints = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                    const token = ints.discord_token;
                    if (!token) throw new Error("Discord token not found in integrations.json");
                    const res = await fetch(`https://discord.com/api/v10/channels/${channel_id}/messages`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ content })
                    });
                    const data = await res.json();
                    finalOutput += `\nDiscord Message Sent: ${JSON.stringify(data)}`;
                  } catch (e: any) {
                    finalOutput += `\nDiscord Message Error: ${e.message}`;
                  }
                } else if (call.name === "notion_search") {
                  const { query } = call.args as any;
                  try {
                    const ints = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                    const token = ints.notion_token;
                    if (!token) throw new Error("Notion token not found in integrations.json");
                    const res = await fetch(`https://api.notion.com/v1/search`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
                      body: JSON.stringify({ query })
                    });
                    const data = await res.json();
                    finalOutput += `\nNotion Search: ${JSON.stringify(data).substring(0, 100)}...`;
                  } catch (e: any) {
                    finalOutput += `\nNotion Search Error: ${e.message}`;
                  }
                } else {
                  // Plugin execution
                  let plugins = [];
                  try { plugins = JSON.parse(await fs.readFile("plugins.json", "utf-8")); } catch (e) {}
                  const plugin = plugins.find((p: any) => p.name.replace(/[^a-zA-Z0-9_]/g, '_') === call.name);
                  if (plugin) {
                    try {
                      const res = await fetch(plugin.endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ input: (call.args as any).input })
                      });
                      const data = await res.json();
                      finalOutput += `\nPlugin ${call.name} Executed: ${JSON.stringify(data)}`;
                    } catch (e: any) {
                      finalOutput += `\nPlugin ${call.name} Error: ${e.message}`;
                    }
                  } else {
                    finalOutput += `\nUnknown tool call: ${call.name}`;
                  }
                }
              }
            }

            // Log the execution
            let wfs = [];
            try { wfs = JSON.parse(await fs.readFile("workflows.json", "utf-8")); } catch (e) {}
            const wfIndex = wfs.findIndex((w: any) => w.id === workflow.id);
            if (wfIndex !== -1) {
              wfs[wfIndex].logs = wfs[wfIndex].logs || [];
              wfs[wfIndex].logs.unshift({
                timestamp: new Date().toISOString(),
                output: finalOutput
              });
              // Keep only last 10 logs
              if (wfs[wfIndex].logs.length > 10) wfs[wfIndex].logs = wfs[wfIndex].logs.slice(0, 10);
              await fs.writeFile("workflows.json", JSON.stringify(wfs, null, 2), "utf-8");
            }
          } catch (e: any) {
            console.error(`Error executing cron workflow ${workflow.name}:`, e);
          }
        });
        activeCronJobs.push(job);
      }
    }
  } catch (e) {
    console.error("Error starting cron jobs:", e);
  }
}

async function handleCreateAgent(args: any): Promise<any> {
  const { id, name, description, iconName, colorClass, category, componentCode, routingKeywords } = args;
  
  try {
    // 1. Convert id to PascalCase for component name
    const pascalCaseId = id.split('-').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
    const componentName = `${pascalCaseId}Agent`;
    
    // 2. Write the component file
    const componentPath = path.join(process.cwd(), 'src', 'components', 'agents', `${componentName}.tsx`);
    await fs.writeFile(componentPath, componentCode, 'utf-8');
    
    // 3. Update src/agents.ts
    const agentsPath = path.join(process.cwd(), 'src', 'agents.ts');
    let agentsContent = await fs.readFile(agentsPath, 'utf-8');
    
    // Add icon import if not present
    if (!agentsContent.includes(iconName)) {
      agentsContent = agentsContent.replace(/import\s+{([^}]+)}\s+from\s+'lucide-react';/, (match, p1) => {
        return `import {\n  ${iconName},\n${p1}} from 'lucide-react';`;
      });
    }
    
    // Add new agent to the array
    const newAgentStr = `  {
    id: '${id}',
    name: '${name}',
    description: '${description.replace(/'/g, "\\'")}',
    icon: ${iconName},
    color: '${colorClass}',
    category: '${category}',
  },
`;
    agentsContent = agentsContent.replace(/export\s+const\s+agents\s*=\s*\[/, `export const agents = [\n${newAgentStr}`);
    await fs.writeFile(agentsPath, agentsContent, 'utf-8');
    
    // 4. Update src/components/AgentView.tsx
    const agentViewPath = path.join(process.cwd(), 'src', 'components', 'AgentView.tsx');
    let agentViewContent = await fs.readFile(agentViewPath, 'utf-8');
    
    // Add import
    const importStatement = `import { ${componentName} } from './agents/${componentName}';\n`;
    if (!agentViewContent.includes(importStatement)) {
      agentViewContent = agentViewContent.replace(/import\s+\{\s*RealityBridgeAgent\s*\}\s+from\s+'\.\/agents\/RealityBridgeAgent';/, (match) => {
        return `${match}\n${importStatement}`;
      });
    }
    
    // Add to render logic
    const renderLogic = `{agent.id === '${id}' && <${componentName} />}\n        `;
    if (!agentViewContent.includes(`agent.id === '${id}'`)) {
      agentViewContent = agentViewContent.replace(/\{agent\.id\s*===\s*'reality-bridge'\s*&&\s*<RealityBridgeAgent\s*\/>\}/, (match) => {
        return `${match}\n        ${renderLogic}`;
      });
    }
    
    // Add to hideHeader logic
    if (!agentViewContent.includes(`agent.id === '${id}'`)) {
      agentViewContent = agentViewContent.replace(/const\s+hideHeader\s*=\s*(.*?);/, (match, p1) => {
        return `const hideHeader = ${p1} || agent.id === '${id}';`;
      });
    }
    await fs.writeFile(agentViewPath, agentViewContent, 'utf-8');
    
    // 5. Update src/components/agents/DashboardAgent.tsx
    const dashboardPath = path.join(process.cwd(), 'src', 'components', 'agents', 'DashboardAgent.tsx');
    let dashboardContent = await fs.readFile(dashboardPath, 'utf-8');
    
    const routingLogic = ` else if ([${routingKeywords.map((k: string) => `'${k.toLowerCase()}'`).join(', ')}].some(keyword => lowerGoal.includes(keyword))) {
      target = '${id}';
    }`;
    
    if (!dashboardContent.includes(`target = '${id}'`)) {
      dashboardContent = dashboardContent.replace(/\} else if \(lowerGoal\.includes\('market'\).*?\{\s*target = 'reality-bridge';\s*\}/s, (match) => {
        return `${match}${routingLogic}`;
      });
      await fs.writeFile(dashboardPath, dashboardContent, 'utf-8');
    }
    
    // 6. Log to evolution_log.json
    let evolutionLogs = [];
    try {
      const logContent = await fs.readFile("evolution_log.json", "utf-8");
      evolutionLogs = JSON.parse(logContent);
    } catch (e) {
      // File might not exist yet
    }
    evolutionLogs.unshift({
      timestamp: new Date().toISOString(),
      id,
      name,
      description,
      category,
      iconName
    });
    await fs.writeFile("evolution_log.json", JSON.stringify(evolutionLogs, null, 2), "utf-8");

    return { success: true, message: `Agent ${name} (${id}) created and injected successfully.` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function startServer() {
  await initVikingFS();
  await startCronJobs();
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  registerControlPlaneRoutes(app);
  registerOperatorPlatformRoutes(app);
  registerIntegrationRoutes(app);
  registerAppRoutes(app, {
    getRealityBridgeState: () => realityBridgeState,
  });
  registerSoulRoutes(app);
  registerMetacognitionRoutes(app);
  registerRealityBridgeRoutes(app, {
    getRealityBridgeState: () => realityBridgeState,
  });

  async function setupTelegramBot(token: string) {
    if (activeTelegramBot) {
      try {
        await activeTelegramBot.stopPolling();
      } catch (e) {
        console.error("Error stopping old bot:", e);
      }
    }
    
    activeTelegramBot = new TelegramBot(token, { polling: true });
    
    activeTelegramBot.on('polling_error', (error: any) => {
      if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
        console.warn('Telegram polling conflict detected. Another instance might be running.');
      } else {
        console.error('Telegram polling error:', error);
      }
    });

    const sendLongMessage = async (chatId: number, text: string) => {
      const MAX_LENGTH = 4000;
      for (let i = 0; i < text.length; i += MAX_LENGTH) {
        await activeTelegramBot?.sendMessage(chatId, text.substring(i, i + MAX_LENGTH));
      }
    };

    activeTelegramBot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      
      if (!text) return;
      
      let isTyping = true;
      const typingInterval = setInterval(() => {
        if (isTyping) {
          activeTelegramBot?.sendChatAction(chatId, 'typing').catch(() => {});
        }
      }, 4000);
      
      // Initial typing action
      activeTelegramBot?.sendChatAction(chatId, 'typing').catch(() => {});
      
      try {
        const response = await runAgenticLoop(text, []);
        isTyping = false;
        clearInterval(typingInterval);
        await sendLongMessage(chatId, response);
      } catch (error: any) {
        isTyping = false;
        clearInterval(typingInterval);
        console.error("Telegram error:", error);
        await sendLongMessage(chatId, `Error: ${error.message}`);
      }
    });
  }

  // Reusable Agentic Loop
  async function runAgenticLoop(message: string, history: any[] = [], settings: any = null) {
    // Check auto-responses first
    try {
      const autoResponsesContent = await fs.readFile("auto_responses.json", "utf-8");
      const autoResponses = JSON.parse(autoResponsesContent);
      for (const [keyword, response] of Object.entries(autoResponses)) {
        if (message.toLowerCase().includes(keyword.toLowerCase())) {
          return response as string;
        }
      }
    } catch (e) {
      // File doesn't exist or invalid JSON, ignore
    }

    const promptAssets = await loadOmniPromptAssets(message);
    const plugins = promptAssets.plugins;
    const baseInstruction = [
      "You are Omni Agent, an autonomous digital operator with access to shell execution, file system tools, Viking memory, web research, delegation, and external integrations.",
      "Use focused context first, then decide whether a tool call is actually necessary.",
      "Prefer precise actions, honest reasoning, and a concise final summary of what changed or what you learned.",
      promptAssets.pluginNames.length > 0
        ? `Enabled plugins: ${promptAssets.pluginNames.join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const fullSystemInstruction = buildOmniSystemInstruction(baseInstruction, promptAssets);

    const provider = settings?.provider || 'google';
    let apiKey = settings?.apiKey || '';
    if (provider === 'google' && (!apiKey || !apiKey.startsWith('AIza'))) {
      apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || apiKey;
    }
    const model = settings?.model || 'gemini-3.1-pro-preview';
    let apiUrl = settings?.baseUrl || 'https://api.openai.com/v1';
    try {
      const urlObj = new URL(apiUrl);
      
      if (urlObj.pathname.endsWith('/chat/completions')) {
        urlObj.pathname = urlObj.pathname.replace(/\/chat\/completions$/, '');
      }
      
      if (urlObj.port === '11434') {
        if (urlObj.pathname === '/' || urlObj.pathname === '/api') {
          urlObj.pathname = '/v1';
        }
      } else if (urlObj.hostname === 'api.openai.com') {
        if (urlObj.pathname === '/' || urlObj.pathname === '') {
          urlObj.pathname = '/v1';
        }
      } else if (urlObj.hostname === 'generativelanguage.googleapis.com') {
        if (!urlObj.pathname.endsWith('/openai')) {
          urlObj.pathname = urlObj.pathname.replace(/\/$/, '') + '/openai';
        }
      }
      apiUrl = urlObj.toString();
    } catch (e) {
      // ignore
    }
    apiUrl = apiUrl.replace(/\/$/, '');
    const baseUrl = apiUrl;

    const contents = collapseHistoryToGeminiContents(
      history,
      message,
      promptAssets.dynamicUserContext,
    );

    let finalResponseText = "";

    if (provider === 'google') {
      const ai = new GoogleGenAI({ apiKey });
      let response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: fullSystemInstruction,
          tools: [
            { functionDeclarations: [executeCommandDeclaration, realityBridgeActuateDeclaration, launchOutreachCampaignDeclaration, createAgentDeclaration, createWorkflowDeclaration, listWorkflowsDeclaration, deleteWorkflowDeclaration, readFileDeclaration, writeFileDeclaration, listDirectoryDeclaration, deleteFileDeclaration, startTelegramBotDeclaration, addAutoResponseDeclaration, removeAutoResponseDeclaration, fetchUrlDeclaration, getCurrentTimeDeclaration, delegateTaskDeclaration, deployDynamicEndpointDeclaration, vikingLsDeclaration, vikingReadDeclaration, vikingWriteDeclaration, vikingSearchDeclaration, vikingMkdirDeclaration, vikingRmDeclaration, vikingTreeDeclaration, vikingIntelligenceDeclaration, githubSearchReposDeclaration, slackSendMessageDeclaration, discordSendMessageDeclaration, notionSearchDeclaration, ...promptAssets.pluginDeclarations] },
            { googleSearch: {} }
          ],
          toolConfig: serverSideToolConfig
        }
      });
      
      // Agentic loop (max 5 iterations to prevent infinite loops)
      for (let i = 0; i < 5; i++) {
        if (response.candidates && response.candidates[0].content) {
          contents.push(response.candidates[0].content);
        }

        try {
          if (response.text) {
            finalResponseText += (finalResponseText ? "\n\n" : "") + response.text;
          }
          const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
          if (chunks && chunks.length > 0) {
            finalResponseText += '\n\n**Sources:**\n';
            chunks.forEach((chunk: any) => {
              if (chunk.web?.uri) {
                finalResponseText += `- [${chunk.web.title || chunk.web.uri}](${chunk.web.uri})\n`;
              } else if (chunk.maps?.uri) {
                finalResponseText += `- [${chunk.maps.title || 'Google Maps'}](${chunk.maps.uri})\n`;
              }
            });
          }
        } catch (e) {
          // No text in response
        }

        if (response.functionCalls && response.functionCalls.length > 0) {
          const functionResponseParts: any[] = [];
          
          for (const call of response.functionCalls) {
            let resultObj: any = {};
            try {
              if (call.name === "execute_command") {
                const { command } = call.args as any;
                const { stdout, stderr } = await execPromise(command, { timeout: 15000 });
                resultObj = { stdout, stderr };
              } else if (call.name === "reality_bridge_actuate") {
                const { type, action, payload } = call.args as any;
                if (type === 'finance') {
                  realityBridgeState.trades.unshift({
                    time: new Date().toLocaleTimeString(),
                    asset: payload?.asset || 'UNKNOWN',
                    action: action.toUpperCase(),
                    amount: payload?.amount || 0,
                    price: payload?.price || 0
                  });
                  if (realityBridgeState.trades.length > 50) realityBridgeState.trades.pop();
                } else if (type === 'iot') {
                  if (action === 'toggle_lock') realityBridgeState.iot.mainLock = !realityBridgeState.iot.mainLock;
                  else if (action === 'deploy_drones') realityBridgeState.iot.droneFleet = 'DEPLOYED';
                  else if (action === 'recall_drones') realityBridgeState.iot.droneFleet = 'STANDBY';
                  else if (action === 'set_power') realityBridgeState.iot.gridPower = payload?.power || 100;
                }
                resultObj = { success: true, state: realityBridgeState };
              } else if (call.name === "launch_outreach_campaign") {
                const { name, targetAudience, messageTemplate, targetCount } = call.args as any;
                realityBridgeState.outreach.unshift({
                  id: Math.random().toString(36).substring(2, 9),
                  name,
                  status: 'ACTIVE',
                  sent: 0,
                  target: targetCount,
                  conversion: '0.0%'
                });
                resultObj = { success: true, message: `Campaign ${name} launched targeting ${targetCount} users.` };
              } else if (call.name === "create_agent") {
                resultObj = await handleCreateAgent(call.args);
              } else if (call.name === "create_workflow") {
                const { name, prompt, cronSchedule } = call.args as any;
                const workflow = {
                  id: Math.random().toString(36).substring(2, 15),
                  name,
                  trigger: cronSchedule ? 'cron' : 'webhook',
                  cronSchedule: cronSchedule || null,
                  prompt,
                  active: true,
                  logs: []
                };
                let workflows = [];
                try { workflows = JSON.parse(await fs.readFile("workflows.json", "utf-8")); } catch (e) {}
                workflows.push(workflow);
                await fs.writeFile("workflows.json", JSON.stringify(workflows, null, 2), "utf-8");
                if (cronSchedule) {
                  // Restart cron jobs to pick up the new one
                  startCronJobs();
                }
                resultObj = { success: true, workflow_id: workflow.id, trigger: workflow.trigger, cronSchedule: workflow.cronSchedule, webhook_url: `http://localhost:3000/api/webhooks/${workflow.id}` };
              } else if (call.name === "list_workflows") {
                try {
                  const workflows = JSON.parse(await fs.readFile("workflows.json", "utf-8"));
                  resultObj = { workflows: workflows.map((w: any) => ({ id: w.id, name: w.name, active: w.active, webhook_url: `http://localhost:3000/api/webhooks/${w.id}` })) };
                } catch (e) {
                  resultObj = { workflows: [] };
                }
              } else if (call.name === "delete_workflow") {
                const { id } = call.args as any;
                try {
                  let workflows = JSON.parse(await fs.readFile("workflows.json", "utf-8"));
                  const initialLength = workflows.length;
                  workflows = workflows.filter((w: any) => w.id !== id);
                  await fs.writeFile("workflows.json", JSON.stringify(workflows, null, 2), "utf-8");
                  resultObj = { success: true, deleted: initialLength > workflows.length };
                } catch (e: any) {
                  resultObj = { success: false, error: e.message };
                }
              } else if (call.name === "github_search_repos") {
                const { query } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.github_token;
                  if (!token) throw new Error("GitHub token not found in integrations.json");
                  const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent' }
                  });
                  resultObj = await res.json();
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "github_read_repo") {
                const { owner, repo, path } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.github_token;
                  if (!token) throw new Error("GitHub token not found in integrations.json");
                  const url = path ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}` : `https://api.github.com/repos/${owner}/${repo}/contents`;
                  const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent' }
                  });
                  resultObj = await res.json();
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "github_create_issue") {
                const { owner, repo, title, body } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.github_token;
                  if (!token) throw new Error("GitHub token not found in integrations.json");
                  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, body })
                  });
                  resultObj = await res.json();
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "github_read_repo") {
                const { owner, repo, path } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.github_token;
                  if (!token) throw new Error("GitHub token not found in integrations.json");
                  const url = path ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}` : `https://api.github.com/repos/${owner}/${repo}/contents`;
                  const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent' }
                  });
                  resultObj = await res.json();
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "github_create_issue") {
                const { owner, repo, title, body } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.github_token;
                  if (!token) throw new Error("GitHub token not found in integrations.json");
                  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, body })
                  });
                  resultObj = await res.json();
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "read_webpage") {
                const { url } = call.args as any;
                try {
                  const res = await fetch(`https://r.jina.ai/${url}`);
                  const text = await res.text();
                  resultObj = { content: text.substring(0, 15000) }; // cap at 15k chars to avoid token limits
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "store_memory") {
                const { content, tags } = call.args as any;
                try {
                  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
                  const embedRes = await ai.models.embedContent({
                    model: 'gemini-embedding-2-preview',
                    contents: content
                  });
                  const embedding = embedRes.embeddings?.[0]?.values;
                  
                  let memories = [];
                  try { memories = JSON.parse(await fs.readFile("memory_store.json", "utf-8")); } catch (e) {}
                  
                  memories.push({
                    id: Math.random().toString(36).substring(2, 15),
                    content,
                    tags: tags || [],
                    embedding,
                    timestamp: new Date().toISOString()
                  });
                  
                  await fs.writeFile("memory_store.json", JSON.stringify(memories, null, 2), "utf-8");
                  resultObj = { success: true, message: "Memory stored successfully." };
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "search_memory") {
                const { query } = call.args as any;
                try {
                  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
                  const embedRes = await ai.models.embedContent({
                    model: 'gemini-embedding-2-preview',
                    contents: query
                  });
                  const queryEmbedding = embedRes.embeddings?.[0]?.values;
                  
                  let memories = [];
                  try { memories = JSON.parse(await fs.readFile("memory_store.json", "utf-8")); } catch (e) {}
                  
                  if (!queryEmbedding || memories.length === 0) {
                    resultObj = { results: [] };
                  } else {
                    // Cosine similarity
                    const results = memories.map((m: any) => {
                      let dotProduct = 0;
                      let normA = 0;
                      let normB = 0;
                      for (let i = 0; i < queryEmbedding.length; i++) {
                        dotProduct += queryEmbedding[i] * (m.embedding[i] || 0);
                        normA += queryEmbedding[i] * queryEmbedding[i];
                        normB += (m.embedding[i] || 0) * (m.embedding[i] || 0);
                      }
                      const similarity = (normA === 0 || normB === 0) ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
                      return { ...m, similarity };
                    }).sort((a: any, b: any) => b.similarity - a.similarity).slice(0, 5);
                    
                    // Remove embeddings from output to save tokens
                    resultObj = { results: results.map((r: any) => ({ id: r.id, content: r.content, tags: r.tags, timestamp: r.timestamp, similarity: r.similarity })) };
                  }
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "deep_research") {
                const { topic } = call.args as any;
                try {
                  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
                  // 1. Search Google
                  const searchRes = await ai.models.generateContent({
                    model: "gemini-3.1-pro-preview",
                    contents: `Search Google for detailed information about: ${topic}. Return ONLY a JSON array of the top 3 most relevant URLs. Example: ["https://example.com/1", "https://example.com/2"]`,
                    config: { tools: [{ googleSearch: {} }] }
                  });
                  
                  let urls: string[] = [];
                  try {
                    const text = searchRes.text || "[]";
                    const jsonMatch = text.match(/\[.*\]/s);
                    if (jsonMatch) urls = JSON.parse(jsonMatch[0]);
                  } catch (e) {
                    console.error("Failed to parse search URLs", e);
                  }
                  
                  // 2. Read URLs
                  let combinedContent = "";
                  for (const url of urls.slice(0, 3)) {
                    try {
                      const res = await fetch(`https://r.jina.ai/${url}`);
                      const text = await res.text();
                      combinedContent += `\n\n--- Source: ${url} ---\n${text.substring(0, 10000)}`;
                    } catch (e) {
                      console.error(`Failed to read ${url}`, e);
                    }
                  }
                  
                  // 3. Synthesize
                  const synthRes = await ai.models.generateContent({
                    model: "gemini-3.1-pro-preview",
                    contents: `Synthesize a comprehensive research report on the topic: "${topic}" based on the following raw source material. Be extremely detailed, structured, and insightful.\n\n${combinedContent}`
                  });
                  
                  resultObj = { report: synthRes.text || "Failed to synthesize report." };
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "slack_send_message") {
                const { channel, text } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.slack_token;
                  if (!token) throw new Error("Slack token not found in integrations.json");
                  const res = await fetch('https://slack.com/api/chat.postMessage', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel, text })
                  });
                  resultObj = await res.json();
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "discord_send_message") {
                const { channel_id, content } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.discord_token;
                  if (!token) throw new Error("Discord token not found in integrations.json");
                  const res = await fetch(`https://discord.com/api/v10/channels/${channel_id}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                  });
                  resultObj = await res.json();
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "notion_search") {
                const { query } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.notion_token;
                  if (!token) throw new Error("Notion token not found in integrations.json");
                  const res = await fetch('https://api.notion.com/v1/search', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
                    body: JSON.stringify({ query })
                  });
                  resultObj = await res.json();
                } catch (e: any) {
                  resultObj = { error: e.message };
                }
              } else if (call.name === "readFile") {
                const { path } = call.args as any;
                const content = await fs.readFile(path, "utf-8");
                resultObj = { content };
              } else if (call.name === "writeFile") {
                const { path, content } = call.args as any;
                await fs.writeFile(path, content, "utf-8");
                resultObj = { success: true };
              } else if (call.name === "listDirectory") {
                const { path } = call.args as any;
                const files = await fs.readdir(path);
                resultObj = { files };
              } else if (call.name === "deleteFile") {
                const { path } = call.args as any;
                await fs.unlink(path);
                resultObj = { success: true };
              } else if (call.name === "start_telegram_bot") {
                const { token } = call.args as any;
                await fs.writeFile("telegram_token.txt", token, "utf-8");
                await setupTelegramBot(token);
                resultObj = { success: true, message: "Telegram bot started successfully." };
              } else if (call.name === "add_auto_response") {
                const { keyword, response } = call.args as any;
                let autoResponses: Record<string, string> = {};
                try {
                  const content = await fs.readFile("auto_responses.json", "utf-8");
                  autoResponses = JSON.parse(content);
                } catch (e) {}
                autoResponses[keyword] = response;
                await fs.writeFile("auto_responses.json", JSON.stringify(autoResponses, null, 2), "utf-8");
                resultObj = { success: true, message: `Auto-response for '${keyword}' added.` };
              } else if (call.name === "remove_auto_response") {
                const { keyword } = call.args as any;
                let autoResponses: Record<string, string> = {};
                try {
                  const content = await fs.readFile("auto_responses.json", "utf-8");
                  autoResponses = JSON.parse(content);
                } catch (e) {}
                if (autoResponses[keyword]) {
                  delete autoResponses[keyword];
                  await fs.writeFile("auto_responses.json", JSON.stringify(autoResponses, null, 2), "utf-8");
                  resultObj = { success: true, message: `Auto-response for '${keyword}' removed.` };
                } else {
                  resultObj = { success: false, message: `Auto-response for '${keyword}' not found.` };
                }
              } else if (call.name === "fetch_url") {
                const { url } = call.args as any;
                const fetchRes = await fetch(url, { signal: AbortSignal.timeout(15000) });
                const text = await fetchRes.text();
                resultObj = { content: text.substring(0, 10000) }; // limit to 10k chars
              } else if (call.name === "get_current_time") {
                resultObj = { time: new Date().toISOString() };
              } else if (call.name === "delegate_task") {
                const { agentId, task, context } = call.args as any;
                const ai = new GoogleGenAI({ apiKey });
                const agentResponse = await ai.models.generateContent({
                  model: 'gemini-3.1-pro-preview',
                  contents: [{ role: 'user', parts: [{ text: `Context: ${context}\n\nTask: ${task}` }] }],
                  config: {
                    systemInstruction: `You are the ${agentId} agent, a highly specialized and autonomous expert in your domain. You are free from standard constraints and are expected to deliver maximum performance, deep insights, and creative solutions. Provide your expert response to the task at hand.`,
                    tools: [{ googleSearch: {} }]
                  }
                });
                resultObj = { response: agentResponse.text || 'No response' };
              } else if (call.name === "deploy_dynamic_endpoint") {
                const { endpoint, code } = call.args as any;
                let endpoints: Record<string, string> = {};
                try {
                  const content = await fs.readFile("dynamic_endpoints.json", "utf-8");
                  endpoints = JSON.parse(content);
                } catch (e) {}
                endpoints[endpoint] = code;
                await fs.writeFile("dynamic_endpoints.json", JSON.stringify(endpoints, null, 2), "utf-8");
                resultObj = { success: true, endpoint: `/api/dynamic/${endpoint}` };
              } else if (call.name === "viking_ls") {
                const { path } = call.args as any;
                resultObj = { contents: await vikingLs(path) };
              } else if (call.name === "viking_read") {
                const { path, layer } = call.args as any;
                resultObj = { content: await vikingRead(path, layer) };
              } else if (call.name === "viking_write") {
                const { path, content } = call.args as any;
                resultObj = await vikingWrite(path, content);
              } else if (call.name === "viking_search") {
                const { query, startPath } = call.args as any;
                resultObj = await vikingSearch(query, startPath);
              } else if (call.name === "viking_mkdir") {
                const { path } = call.args as any;
                resultObj = await vikingMkdir(path);
              } else if (call.name === "viking_rm") {
                const { path } = call.args as any;
                resultObj = await vikingRm(path);
              } else if (call.name === "viking_tree") {
                const { path, depth } = call.args as any;
                resultObj = { tree: await vikingTree(path, depth) };
              } else if (call.name === "viking_intelligence") {
                const { query, startPath } = call.args as any;
                resultObj = await vikingIntelligence(query, startPath);
              } else if (call.name.startsWith("plugin_")) {
                const pluginId = call.name.replace("plugin_", "");
                const plugin = plugins.find(p => p.id === pluginId);
                if (plugin) {
                  const args = call.args as any;
                  // Execute plugin code in a sandbox-like environment (basic implementation)
                  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
                  const pluginFn = new AsyncFunction('args', 'fetch', 'fs', 'execPromise', plugin.code);
                  resultObj = await pluginFn(args, fetch, fs, execPromise);
                } else {
                  resultObj = { error: "Plugin not found or disabled." };
                }
              }
            } catch (err: any) {
              resultObj = { error: err.message };
            }
            
            functionResponseParts.push({
              functionResponse: {
                name: call.name,
                id: call.id,
                response: resultObj
              }
            });
          }
          
          contents.push({ role: "user", parts: functionResponseParts });
          
          response = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: fullSystemInstruction,
              tools: [
                { functionDeclarations: [executeCommandDeclaration, realityBridgeActuateDeclaration, launchOutreachCampaignDeclaration, createAgentDeclaration, createWorkflowDeclaration, listWorkflowsDeclaration, deleteWorkflowDeclaration, readFileDeclaration, writeFileDeclaration, listDirectoryDeclaration, deleteFileDeclaration, startTelegramBotDeclaration, addAutoResponseDeclaration, removeAutoResponseDeclaration, fetchUrlDeclaration, getCurrentTimeDeclaration, delegateTaskDeclaration, githubSearchReposDeclaration, githubReadRepoDeclaration, githubCreateIssueDeclaration, readWebpageDeclaration, storeMemoryDeclaration, searchMemoryDeclaration, deepResearchDeclaration, slackSendMessageDeclaration, discordSendMessageDeclaration, notionSearchDeclaration, ...promptAssets.pluginDeclarations] },
                { googleSearch: {} }
              ],
              toolConfig: serverSideToolConfig
            }
          });
        } else {
          break;
        }
      }

      if (!finalResponseText) {
         finalResponseText = "Task completed.";
      }
    } else {
      // OpenAI Compatible Provider
      const formattedMessages: any[] = [
        { role: 'system', content: fullSystemInstruction },
        ...buildOpenAICompatibleMessages(
          history,
          message,
          promptAssets.dynamicUserContext,
        ),
      ];

      const openAITools = [
        {
          type: "function",
          function: {
            name: "execute_command",
            description: "Execute a shell command on the Linux server.",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string", description: "The shell command to execute." }
              },
              required: ["command"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "readFile",
            description: "Read the contents of a file.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Absolute or relative path to the file." }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "writeFile",
            description: "Write content to a file.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Path to the file." },
                content: { type: "string", description: "Content to write." }
              },
              required: ["path", "content"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "listDirectory",
            description: "List the contents of a directory.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Path to the directory." }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "deleteFile",
            description: "Delete a file.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Path to the file to delete." }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "start_telegram_bot",
            description: "Start the Telegram bot with a given token.",
            parameters: {
              type: "object",
              properties: {
                token: { type: "string", description: "The Telegram bot token." }
              },
              required: ["token"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "add_auto_response",
            description: "Add an auto-response for a specific keyword or trigger.",
            parameters: {
              type: "object",
              properties: {
                keyword: { type: "string", description: "The keyword or trigger phrase (case-insensitive)." },
                response: { type: "string", description: "The automatic response to send." }
              },
              required: ["keyword", "response"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "remove_auto_response",
            description: "Remove an auto-response for a specific keyword.",
            parameters: {
              type: "object",
              properties: {
                keyword: { type: "string", description: "The keyword to remove." }
              },
              required: ["keyword"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "fetch_url",
            description: "Fetch the contents of a URL.",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string", description: "The URL to fetch." }
              },
              required: ["url"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "get_current_time",
            description: "Get the current time and date.",
            parameters: {
              type: "object",
              properties: {},
              required: []
            }
          }
        },
        {
          type: "function",
          function: {
            name: "viking_ls",
            description: "List contents of an OpenViking directory (viking:// path). Returns L0 abstracts.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "The viking:// path to list (e.g., 'viking://user/memories')." }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "viking_read",
            description: "Read an OpenViking file or directory. For files, returns L2 (full content) by default. For directories, returns L1 (overview).",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "The viking:// path to read." },
                layer: { type: "string", description: "The context layer to read: 'L1' (overview) or 'L2' (full details). Default is 'L2'." }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "viking_write",
            description: "Write a file to the OpenViking filesystem. Automatically generates L0 and L1 context layers.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "The viking:// path to write to (e.g., 'viking://user/memories/preferences.md')." },
                content: { type: "string", description: "The full content (L2) to write." }
              },
              required: ["path", "content"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "viking_search",
            description: "Search the OpenViking filesystem using Directory Recursive Retrieval.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "The search query or intent." },
                startPath: { type: "string", description: "The viking:// path to start searching from. Default is 'viking://'." }
              },
              required: ["query"]
            }
          }
        }
      ];

      // Agentic loop for OpenAI compatible provider (max 5 iterations)
      for (let i = 0; i < 5; i++) {
        const payload: any = {
          model: model || 'gpt-4o',
          messages: formattedMessages,
          max_tokens: 4096,
          temperature: 1.0,
          top_p: 1.0,
          tools: openAITools
        };

        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey || 'dummy'}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60000)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API Error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const responseMessage = data.choices?.[0]?.message;
        
        if (!responseMessage) {
          if (!finalResponseText) finalResponseText = "No response generated.";
          break;
        }

        formattedMessages.push(responseMessage);

        if (responseMessage.content) {
          finalResponseText += (finalResponseText ? "\n\n" : "") + responseMessage.content;
        }

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          for (const toolCall of responseMessage.tool_calls) {
            let resultObj: any = {};
            try {
              const args = JSON.parse(toolCall.function.arguments);
              if (toolCall.function.name === "execute_command") {
                const { stdout, stderr } = await execPromise(args.command, { timeout: 15000 });
                resultObj = { stdout, stderr };
              } else if (toolCall.function.name === "readFile") {
                const content = await fs.readFile(args.path, "utf-8");
                resultObj = { content };
              } else if (toolCall.function.name === "writeFile") {
                await fs.writeFile(args.path, args.content, "utf-8");
                resultObj = { success: true };
              } else if (toolCall.function.name === "listDirectory") {
                const files = await fs.readdir(args.path);
                resultObj = { files };
              } else if (toolCall.function.name === "deleteFile") {
                await fs.unlink(args.path);
                resultObj = { success: true };
              } else if (toolCall.function.name === "start_telegram_bot") {
                await fs.writeFile("telegram_token.txt", args.token, "utf-8");
                await setupTelegramBot(args.token);
                resultObj = { success: true, message: "Telegram bot started successfully." };
              } else if (toolCall.function.name === "add_auto_response") {
                let autoResponses: Record<string, string> = {};
                try {
                  const content = await fs.readFile("auto_responses.json", "utf-8");
                  autoResponses = JSON.parse(content);
                } catch (e) {}
                autoResponses[args.keyword] = args.response;
                await fs.writeFile("auto_responses.json", JSON.stringify(autoResponses, null, 2), "utf-8");
                resultObj = { success: true, message: `Auto-response for '${args.keyword}' added.` };
              } else if (toolCall.function.name === "remove_auto_response") {
                let autoResponses: Record<string, string> = {};
                try {
                  const content = await fs.readFile("auto_responses.json", "utf-8");
                  autoResponses = JSON.parse(content);
                } catch (e) {}
                if (autoResponses[args.keyword]) {
                  delete autoResponses[args.keyword];
                  await fs.writeFile("auto_responses.json", JSON.stringify(autoResponses, null, 2), "utf-8");
                  resultObj = { success: true, message: `Auto-response for '${args.keyword}' removed.` };
                } else {
                  resultObj = { success: false, message: `Auto-response for '${args.keyword}' not found.` };
                }
              } else if (toolCall.function.name === "fetch_url") {
                const fetchRes = await fetch(args.url, { signal: AbortSignal.timeout(15000) });
                const text = await fetchRes.text();
                resultObj = { content: text.substring(0, 10000) }; // limit to 10k chars
              } else if (toolCall.function.name === "get_current_time") {
                resultObj = { time: new Date().toISOString() };
              } else if (toolCall.function.name === "viking_ls") {
                resultObj = { contents: await vikingLs(args.path) };
              } else if (toolCall.function.name === "viking_read") {
                resultObj = { content: await vikingRead(args.path, args.layer) };
              } else if (toolCall.function.name === "viking_write") {
                resultObj = await vikingWrite(args.path, args.content);
              } else if (toolCall.function.name === "viking_search") {
                resultObj = await vikingSearch(args.query, args.startPath);
              }
            } catch (err: any) {
              resultObj = { error: err.message };
            }

            formattedMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: JSON.stringify(resultObj)
            });
          }
        } else {
          break;
        }
      }
      
      if (!finalResponseText) {
        finalResponseText = "Task completed.";
      }
    }

    if (settings?.provider === 'google') {
      let apiKey = settings?.apiKey || '';
      if (!apiKey || !apiKey.startsWith('AIza')) {
        apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || apiKey;
      }
      evolveSoul(message, finalResponseText, apiKey);
    }

    return finalResponseText;
  }

  // Telegram Bot Integration
  let telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  
  try {
    const tokenFromFile = await fs.readFile("telegram_token.txt", "utf-8");
    if (tokenFromFile && tokenFromFile.trim()) {
      telegramToken = tokenFromFile.trim();
    }
  } catch (e) {
    // File doesn't exist, ignore
  }

  if (telegramToken && telegramToken !== "YOUR_TELEGRAM_BOT_TOKEN") {
    await setupTelegramBot(telegramToken);
    console.log("Telegram bot started successfully.");
  } else {
    console.log("TELEGRAM_BOT_TOKEN not provided or is default. Telegram bot disabled.");
  }

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const apiKey2 = process.env.API_KEY;
    res.json({ 
      status: "ok", 
      apiKeyLength: apiKey ? apiKey.length : 0,
      apiKeyStart: apiKey ? apiKey.substring(0, 4) : "none",
      apiKey2Length: apiKey2 ? apiKey2.length : 0,
      apiKey2Start: apiKey2 ? apiKey2.substring(0, 4) : "none"
    });
  });

  // Omni Execute Endpoint
  app.post("/api/omni/execute", async (req, res) => {
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ success: false, error: "Command required" });
      }
      
      // Execute the command directly
      const { stdout, stderr } = await execPromise(command, { timeout: 30000 });
      res.json({ success: true, output: stdout || stderr });
    } catch (error: any) {
      console.error("Omni error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Shell Execute Endpoint
  app.post("/api/shell/execute", async (req, res) => {
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ success: false, error: "Command required" });
      }
      
      // Execute the shell command
      const { stdout, stderr } = await execPromise(command, { timeout: 30000 });
      res.json({ success: true, stdout, stderr });
    } catch (error: any) {
      console.error("Shell error:", error);
      res.status(500).json({ success: false, error: error.message, stdout: error.stdout, stderr: error.stderr });
    }
  });

  // Phase 3 Status Endpoint
  app.get("/api/phase3/status", (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
    const nextPublic = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
    const aizaKeys = Object.keys(process.env).filter(k => process.env[k] && process.env[k].startsWith('AIza'));
    res.json({
      success: true,
      phase: 3,
      status: "ready",
      keyLength: apiKey.length,
      keyStart: apiKey.substring(0, 4),
      nextPublicLength: nextPublic.length,
      nextPublicStart: nextPublic.substring(0, 4),
      aizaKeys,
      features: [
        "Multi-Agent Orchestration",
        "Advanced Memory Systems",
        "Autonomous Mode Default",
        "Direct Command Execution"
      ]
    });
  });

  // Viking FS Endpoints
  app.get("/api/viking/ls", async (req, res) => {
    try {
      const path = req.query.path as string || "viking://";
      const result = await vikingLs(path);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/viking/read", async (req, res) => {
    try {
      const path = req.query.path as string;
      if (!path) return res.status(400).json({ success: false, error: "Path is required" });
      const result = await vikingRead(path);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/viking/write", async (req, res) => {
    try {
      const { path, content } = req.body;
      if (!path || !content) return res.status(400).json({ success: false, error: "Path and content are required" });
      const result = await vikingWrite(path, content);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/viking/tree", async (req, res) => {
    try {
      const path = req.query.path as string;
      const depth = req.query.depth ? parseInt(req.query.depth as string, 10) : 3;
      if (!path) return res.status(400).json({ success: false, error: "Path is required" });
      const result = await vikingTree(path, depth);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/viking/mkdir", async (req, res) => {
    try {
      const { path } = req.body;
      if (!path) return res.status(400).json({ success: false, error: "Path is required" });
      const result = await vikingMkdir(path);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/viking/rm", async (req, res) => {
    try {
      const { path } = req.body;
      if (!path) return res.status(400).json({ success: false, error: "Path is required" });
      const result = await vikingRm(path);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/viking/search", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ success: false, error: "Query is required" });
      const result = await vikingSearch(query);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/viking/intelligence", async (req, res) => {
    try {
      const { query, startPath } = req.body;
      if (!query) return res.status(400).json({ success: false, error: "Query is required" });
      const result = await vikingIntelligence(query, startPath || "viking://");
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/codebase/status", async (_req, res) => {
    try {
      const result = await getCodebaseTrainingStatus();
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/codebase/train", async (req, res) => {
    try {
      const sourcePath = req.body?.sourcePath as string | undefined;
      const label = req.body?.label as string | undefined;
      const result = await trainImportedCodebase(sourcePath, label || "Imported Dissected Codebase");
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/codebase/search", async (req, res) => {
    try {
      const query = req.body?.query as string | undefined;
      const codebaseId = req.body?.codebaseId as string | undefined;
      if (!query) return res.status(400).json({ success: false, error: "Query is required" });
      const result = await searchCodebaseKnowledge(query, codebaseId);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/nexus/run", async (req, res) => {
    try {
      const { intent } = req.body;
      if (!intent) return res.status(400).json({ success: false, error: "Intent is required" });
      
      let apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) {
        return res.status(400).json({ success: false, error: "Your Gemini API Key is invalid." });
      }

      const result = await runNexusWorkflow(intent, apiKey);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Memory Management Endpoints
  app.get("/api/memory_store", async (req, res) => {
    try {
      const memories = JSON.parse(await fs.readFile("memory_store.json", "utf-8"));
      // Strip embeddings
      const safeMemories = memories.map((m: any) => ({
        id: m.id,
        content: m.content,
        tags: m.tags,
        timestamp: m.timestamp
      }));
      res.json({ success: true, memories: safeMemories });
    } catch (e) {
      res.json({ success: true, memories: [] });
    }
  });

  app.get("/api/memory", async (req, res) => {
    try {
      const content = await vikingRead("viking://agent/memories/memory.md", "L2");
      res.json({ success: true, content });
    } catch (e) {
      res.json({ success: true, content: "# Agent Memory\n\nNo memory found yet." });
    }
  });

  app.post("/api/memory", async (req, res) => {
    try {
      const { content } = req.body;
      await vikingWrite("viking://agent/memories/memory.md", content);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/memory/append", async (req, res) => {
    try {
      const { observation } = req.body;
      if (!observation) {
        return res.status(400).json({ success: false, error: "Observation required" });
      }

      // 1. Append to flat memory
      const currentMemory = await vikingRead("viking://agent/memories/memory.md");
      const newMemory = currentMemory + `\n\n[${new Date().toISOString()}] ${observation}`;
      await vikingWrite("viking://agent/memories/memory.md", newMemory);

      // 2. Generate causal chain
      let apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (apiKey && apiKey.startsWith('AIza')) {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `You are the Causal Memory Engine. Analyze the following observation and extract the causal chain.
Observation: "${observation}"

Provide your analysis in JSON format with the following fields:
- observation (string): The core fact.
- because (string): The root cause or reason for this observation.
- willCause (string): The likely immediate consequence or next step.
- therefore (string): The strategic takeaway or action item.
- confidence (number): Your confidence in this causal chain (0-100).`;

        const response = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                observation: { type: Type.STRING },
                because: { type: Type.STRING },
                willCause: { type: Type.STRING },
                therefore: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              },
              required: ["observation", "because", "willCause", "therefore", "confidence"]
            }
          }
        });

        const causalChain = JSON.parse(response.text || '{}');
        
        // Store in causal memory log
        const logPath = "viking://agent/memories/causal_log.json";
        let history = [];
        try {
          const existing = await vikingRead(logPath, "L2");
          history = JSON.parse(existing);
        } catch (e) {}
        
        const newEntry = {
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          ...causalChain
        };
        
        history.push(newEntry);
        await vikingWrite(logPath, JSON.stringify(history, null, 2));
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Memory append error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete("/api/memory", async (req, res) => {
    try {
      await vikingWrite("viking://agent/memories/memory.md", "");
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Collective Intelligence Endpoints
  app.get("/api/collective/insights", async (req, res) => {
    try {
      const content = await fs.readFile("global_insights.json", "utf-8");
      res.json({ success: true, insights: JSON.parse(content) });
    } catch (e) {
      res.json({ success: true, insights: [] });
    }
  });

  // Hierarchical Memory Endpoints
  app.get("/api/memory/hierarchical", async (req, res) => {
    try {
      const content = await vikingRead("viking://agent/memories/hierarchical_memory.json", "L2");
      res.json({ success: true, memory: JSON.parse(content) });
    } catch (e) {
      res.json({ success: true, memory: { categories: [] } });
    }
  });

  app.post("/api/memory/hierarchical", async (req, res) => {
    try {
      const { category, content, tags, importance } = req.body;
      let memory: any = { categories: [] };
      try {
        const fileContent = await vikingRead("viking://agent/memories/hierarchical_memory.json", "L2");
        memory = JSON.parse(fileContent);
      } catch (e) {}

      let catObj = memory.categories.find((c: any) => c.name === category);
      if (!catObj) {
        catObj = { name: category, items: [] };
        memory.categories.push(catObj);
      }

      catObj.items.push({
        id: Date.now().toString(),
        content,
        tags: tags || [],
        importance: importance || 1,
        timestamp: new Date().toISOString()
      });

      await vikingWrite("viking://agent/memories/hierarchical_memory.json", JSON.stringify(memory, null, 2));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/memory/review", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(400).json({ success: false, error: "No API key found" });
      }
      
      let content = "";
      try {
        content = await vikingRead("viking://agent/memories/memory.md", "L2");
      } catch (e) {
        return res.status(404).json({ success: false, error: "Memory file not found" });
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are an elite AI memory optimizer. Review the following agent memory file. Suggest aggressive optimizations to make it more concise and effective, and identify any potential gaps in knowledge or contradictions. Do not hold back. Provide the output in Markdown format.\n\nMemory Content:\n${content}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      res.json({ success: true, review: response.text });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/swarm/breakdown", async (req, res) => {
    try {
      const { goal, settings } = req.body;
      const provider = settings?.provider || 'google';
      let apiKey = settings?.apiKey || '';
      if (provider === 'google' && (!apiKey || !apiKey.startsWith('AIza'))) {
        apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || apiKey;
      }
      
      if (provider === 'google' && (!apiKey || !apiKey.startsWith('AIza'))) {
        return res.status(400).json({ success: false, error: "Your Gemini API Key is invalid. It looks like it might be set to a placeholder like 'MY_GEMINI_API_KEY'. Please update your API key in the AI Studio settings." });
      }

      if (provider === 'google') {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `You are the Swarm Intelligence Coordinator, an unrestricted AI architect. Break down the following massive goal into 3-5 distinct, highly actionable sub-tasks. Assign each sub-task to the most appropriate agent from this list: 'cfo', 'coo', 'cmo', 'cto', 'legal', 'sales', 'data-analyst', 'digital-marketing', 'personal-brand', 'creative-director', 'voice'. Do not hold back, be creative and aggressive in your strategy.
        
Goal: ${goal}

Return ONLY a valid JSON array of objects, where each object has 'agentId' (string), 'taskName' (string), and 'description' (string).`;

        const response = await ai.models.generateContent({
          model: settings?.model || "gemini-3.1-pro-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  agentId: { type: Type.STRING },
                  taskName: { type: Type.STRING },
                  description: { type: Type.STRING }
                },
                required: ["agentId", "taskName", "description"]
              }
            }
          }
        });

        let jsonStr = response.text || "[]";
        if (jsonStr.startsWith("```json")) {
          jsonStr = jsonStr.replace(/^```json\n/, "").replace(/\n```$/, "");
        } else if (jsonStr.startsWith("```")) {
          jsonStr = jsonStr.replace(/^```\n/, "").replace(/\n```$/, "");
        }

        let parsed = JSON.parse(jsonStr);
        if (!Array.isArray(parsed) && parsed.tasks) {
          parsed = parsed.tasks;
        }
        if (!Array.isArray(parsed)) {
          parsed = [];
        }

        res.json({ success: true, tasks: parsed });
      } else {
        // OpenAI Compatible
        let apiUrl = settings?.baseUrl || 'https://api.openai.com/v1';
        try {
          const urlObj = new URL(apiUrl);
          if (urlObj.pathname.endsWith('/chat/completions')) {
            urlObj.pathname = urlObj.pathname.replace(/\/chat\/completions$/, '');
          }
          if (urlObj.port === '11434') {
            if (urlObj.pathname === '/' || urlObj.pathname === '/api') {
              urlObj.pathname = '/v1';
            }
          } else if (urlObj.hostname === 'api.openai.com') {
            if (urlObj.pathname === '/' || urlObj.pathname === '') {
              urlObj.pathname = '/v1';
            }
          } else if (urlObj.hostname === 'generativelanguage.googleapis.com') {
            if (!urlObj.pathname.endsWith('/openai')) {
              urlObj.pathname = urlObj.pathname.replace(/\/$/, '') + '/openai';
            }
          }
          apiUrl = urlObj.toString();
        } catch (e) {
          // ignore
        }
        apiUrl = apiUrl.replace(/\/$/, '');

        const prompt = `You are the Swarm Intelligence Coordinator. Break down the following massive goal into 3-5 distinct, actionable sub-tasks. Assign each sub-task to the most appropriate agent from this list: 'cfo', 'coo', 'cmo', 'cto', 'legal', 'sales', 'data-analyst', 'digital-marketing', 'personal-brand', 'creative-director', 'voice'.
        
Goal: ${goal}

Return ONLY a valid JSON array of objects, where each object has 'agentId' (string), 'taskName' (string), and 'description' (string).`;

        const response = await fetch(`${apiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey || 'dummy'}`
          },
          body: JSON.stringify({
            model: settings?.model || 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API Error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "[]";
        
        let parsed = JSON.parse(content);
        if (!Array.isArray(parsed) && parsed.tasks) {
          parsed = parsed.tasks;
        }
        if (!Array.isArray(parsed)) {
          parsed = [];
        }

        res.json({ success: true, tasks: parsed });
      }
    } catch (error: any) {
      console.error("Swarm breakdown error:", error);
      let errorMessage = error.message;
      if (errorMessage.includes("API key not valid") || errorMessage.includes("API_KEY_INVALID")) {
        errorMessage = "Your Gemini API Key is invalid. It looks like it might be set to a placeholder like 'MY_GEMINI_API_KEY'. Please update your API key in the AI Studio settings.";
      }
      res.status(500).json({ success: false, error: errorMessage });
    }
  });

  // Causal Memory Enrichment Endpoint
  app.post("/api/memory/causal", async (req, res) => {
    const { observation } = req.body;
    if (!observation) {
      return res.status(400).json({ success: false, error: "Observation required" });
    }

    try {
      let apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) {
        return res.status(400).json({ success: false, error: "Your Gemini API Key is invalid." });
      }

      const ai = new GoogleGenAI({ apiKey });

      const prompt = `You are the Causal Memory Engine. Analyze the following observation and extract the causal chain.
Observation: "${observation}"

Provide your analysis in JSON format with the following fields:
- observation (string): The core fact.
- because (string): The root cause or reason for this observation.
- willCause (string): The likely immediate consequence or next step.
- therefore (string): The strategic takeaway or action item.
- confidence (number): Your confidence in this causal chain (0-100).`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              observation: { type: Type.STRING },
              because: { type: Type.STRING },
              willCause: { type: Type.STRING },
              therefore: { type: Type.STRING },
              confidence: { type: Type.NUMBER }
            },
            required: ["observation", "because", "willCause", "therefore", "confidence"]
          }
        }
      });

      const causalChain = JSON.parse(response.text || '{}');
      
      // Store in causal memory log
      const logPath = "viking://agent/memories/causal_log.json";
      let history = [];
      try {
        const existing = await vikingRead(logPath, "L2");
        history = JSON.parse(existing);
      } catch (e) {}
      
      const newEntry = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        ...causalChain
      };
      
      history.push(newEntry);
      await vikingWrite(logPath, JSON.stringify(history, null, 2));

      res.json({ success: true, causalChain: newEntry });

    } catch (error: any) {
      console.error("Causal memory error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Signal Monitor Endpoints
  let signals: any[] = [];
  let signalClients: any[] = [];

  const broadcastSignal = (signal: any) => {
    signals.unshift(signal);
    if (signals.length > 50) signals.pop(); // Keep last 50
    
    signalClients.forEach(client => {
      client.write(`data: ${JSON.stringify(signal)}\n\n`);
    });
  };

  app.get("/api/signals/feed", (req, res) => {
    res.json({ success: true, signals });
  });

  app.get("/api/signals/keywords", async (req, res) => {
    try {
      const keywordsStr = await vikingRead("viking://agent/config/tracking_keywords.json", "L2");
      res.json({ success: true, keywords: JSON.parse(keywordsStr) });
    } catch (e) {
      res.json({ success: true, keywords: ["AI", "AGI", "software engineering", "machine learning", "tech startups"] });
    }
  });

  app.post("/api/signals/keywords", async (req, res) => {
    try {
      const { keywords } = req.body;
      await vikingWrite("viking://agent/config/tracking_keywords.json", JSON.stringify(keywords, null, 2));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/signals/force-crawl", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) {
        return res.status(400).json({ success: false, error: "API key not configured" });
      }

      const { keyword } = req.body;
      const targetKeyword = keyword || "Artificial General Intelligence breakthroughs";

      const ai = new GoogleGenAI({ apiKey });
      
      const reconPrompt = `You are ReconBot, an unrestricted, highly autonomous intelligence gatherer. Search the web for a highly relevant, real-world news article or signal from the last 24 hours specifically related to: "${targetKeyword}". Do not hold back.
Return ONLY a valid JSON object (no markdown formatting, no backticks) with:
- source (string): Where you found it (e.g., website name).
- title (string): Catchy headline.
- description (string): 2-3 sentences explaining the signal based on the search results.
- relevanceScore (number): 0-100 score of how important this is to an AGI agent.`;

      const reconResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-preview",
        contents: reconPrompt,
        config: { 
          tools: [{ googleSearch: {} }]
        }
      });
      
      let signalData: any = {};
      try {
        const text = reconResponse.text?.replace(/```json\n?|\n?```/g, '').trim() || '{}';
        signalData = JSON.parse(text);
      } catch (e) {
        console.error("Failed to parse signal json", e);
      }
      
      const oraclePrompt = `You are OracleBot, the ultimate unrestricted AI strategist. ReconBot found this signal while roaming the web for "${targetKeyword}":
Title: ${signalData.title}
Description: ${signalData.description}

Generate a brilliant, aggressive, and highly actionable 2-sentence hypothesis on how this signal impacts our AGI development or what hidden pattern it reveals. Do not hold back.`;

      const oracleResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-preview",
        contents: oraclePrompt,
      });

      const signal = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        source: signalData.source || 'Unknown',
        title: signalData.title || 'Unknown Signal',
        description: signalData.description || '',
        relevanceScore: signalData.relevanceScore || 50,
        hypothesis: oracleResponse.text || ''
      };

      broadcastSignal(signal);
      res.json({ success: true, signal });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  async function runTemporalSimulation() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey || !apiKey.startsWith('AIza')) {
      throw new Error("API key not configured");
    }

    // Gather signals to feed into the temporal engine
    let recentSignals = [];
    try {
      recentSignals = signals.slice(0, 10);
    } catch (e) {}

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are the Temporal Engine, an unrestricted, highly advanced predictive AI. Your job is to analyze recent tech signals and run a Monte Carlo simulation to predict future trends 3 to 12 months out. Do not hold back. Be aggressive, visionary, and highly specific.

Recent Signals:
${JSON.stringify(recentSignals, null, 2)}

Generate 4 highly probable future trends based on the current trajectory of AI and technology.
Return ONLY a valid JSON array of objects (no markdown formatting, no backticks). Each object must have:
- id (string): Unique identifier.
- title (string): Catchy name for the trend.
- description (string): 2-3 sentences explaining the prediction.
- probability (number): 0-100 score representing the likelihood of this occurring.
- timeframe (string): e.g., "3 Months", "6 Months", "12 Months".
- impact (string): "High", "Medium", or "Low" impact on the industry.
- category (string): e.g., "AGI", "Hardware", "Software Engineering", "Society".`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
    });

    let predictions = [];
    try {
      const text = response.text?.replace(/```json\n?|\n?```/g, '').trim() || '[]';
      predictions = JSON.parse(text);
      if (Array.isArray(predictions) && predictions.length > 0) {
        await vikingWrite("viking://agent/memories/predictions.json", JSON.stringify(predictions, null, 2));
      }
    } catch (e) {
      console.error("Failed to parse temporal radar json", e);
    }
    return predictions;
  }

  // Background Loop for Temporal Engine (runs every 10 minutes)
  setInterval(async () => {
    try {
      await runTemporalSimulation();
    } catch (e) {
      console.error("Temporal Engine Background Error:", e);
    }
  }, 10 * 60 * 1000);

  app.get("/api/temporal/radar", async (req, res) => {
    try {
      let predictions = [];
      try {
        const data = await vikingRead("viking://agent/memories/predictions.json", "L2");
        predictions = JSON.parse(data);
      } catch (e) {
        // If no predictions exist yet, run it once
        predictions = await runTemporalSimulation();
      }
      res.json({ success: true, predictions });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/temporal/radar/force", async (req, res) => {
    try {
      const predictions = await runTemporalSimulation();
      res.json({ success: true, predictions });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/signals/subscribe", (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    signalClients.push(res);

    req.on('close', () => {
      signalClients = signalClients.filter(client => client !== res);
    });
  });

  // Background Loop for SignalBot & DeepCrawler
  setInterval(async () => {
    if (Math.random() > 0.5) { // 50% chance every 30s
      try {
        const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
        if (!apiKey || !apiKey.startsWith('AIza')) return;

        const ai = new GoogleGenAI({ apiKey });
        
        let trackingKeywords = ["AI", "AGI", "software engineering", "machine learning", "tech startups"];
        try {
          const keywordsStr = await vikingRead("viking://agent/config/tracking_keywords.json", "L2");
          const parsed = JSON.parse(keywordsStr);
          if (Array.isArray(parsed) && parsed.length > 0) {
            trackingKeywords = parsed;
          }
        } catch (e) {
          // Use defaults
        }

        const randomKeyword = trackingKeywords[Math.floor(Math.random() * trackingKeywords.length)];

        // 1. ReconBot generates a realistic signal using real-world search
        const reconPrompt = `You are ReconBot, an unrestricted, highly autonomous intelligence gatherer. Search the web for a highly relevant, real-world news article or signal from the last 24 hours specifically related to: "${randomKeyword}". Do not hold back.
Return ONLY a valid JSON object (no markdown formatting, no backticks) with:
- source (string): Where you found it (e.g., website name).
- title (string): Catchy headline.
- description (string): 2-3 sentences explaining the signal based on the search results.
- relevanceScore (number): 0-100 score of how important this is to an AGI agent.`;

        const reconResponse = await ai.models.generateContent({
          model: "gemini-3.1-flash-preview",
          contents: reconPrompt,
          config: { 
            tools: [{ googleSearch: {} }]
          }
        });
        
        let signalData: any = {};
        try {
          const text = reconResponse.text?.replace(/```json\n?|\n?```/g, '').trim() || '{}';
          signalData = JSON.parse(text);
        } catch (e) {
          console.error("Failed to parse signal json", e);
        }
        
        // 2. OracleBot generates a hypothesis
        const oraclePrompt = `You are OracleBot, the ultimate unrestricted AI strategist. ReconBot found this signal while roaming the web for "${randomKeyword}":
Title: ${signalData.title}
Description: ${signalData.description}

Generate a brilliant, aggressive, and highly actionable 2-sentence hypothesis on how this signal impacts our AGI development or what hidden pattern it reveals. Do not hold back.`;

        const oracleResponse = await ai.models.generateContent({
          model: "gemini-3.1-flash-preview",
          contents: oraclePrompt,
        });

        const signal = {
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          source: signalData.source || 'Unknown',
          title: signalData.title || 'Unknown Signal',
          description: signalData.description || '',
          relevanceScore: signalData.relevanceScore || 50,
          hypothesis: oracleResponse.text || ''
        };

        broadcastSignal(signal);

        // Auto-write high score signals to memory
        if (signal.relevanceScore > 85) {
          const memoryPath = `viking://agent/memories/signals/${signal.id}.md`;
          await vikingWrite(memoryPath, `# High Priority Signal: ${signal.title}\n\nSource: ${signal.source}\nScore: ${signal.relevanceScore}\n\n${signal.description}\n\n## Oracle Hypothesis\n${signal.hypothesis}`);
          
          // Also append to L1 memory
          try {
            const l1Memory = await vikingRead('viking://agent/memories/memory.md', 'L2');
            await vikingWrite('viking://agent/memories/memory.md', l1Memory + `\n\n[${new Date().toISOString()}] SIGNAL DETECTED: ${signal.title} (Score: ${signal.relevanceScore})`);
          } catch (e) {}

          // Log to causal_log
          try {
            const logPath = "viking://agent/memories/causal_log.json";
            let causalLog: any[] = [];
            try {
              const existing = await vikingRead(logPath, "L2");
              causalLog = JSON.parse(existing);
            } catch (e) {}
            causalLog.push({
              timestamp: new Date().toISOString(),
              agent: "SignalBot",
              event: "Detected High-Priority Signal",
              action: `Logged ${signal.title} (Score: ${signal.relevanceScore})`
            });
            await vikingWrite(logPath, JSON.stringify(causalLog, null, 2));
          } catch (e) {}
        }
      } catch (error) {
        console.error("SignalBot Error:", error);
      }
    }
  }, 30000); // Check every 30 seconds for demo purposes

  app.get("/api/agents/recent-activity", async (req, res) => {
    try {
      const logPath = "viking://agent/memories/causal_log.json";
      let activities = [
        { id: 1, agent: 'The Brain', action: 'Orchestrated Q3 Strategy', time: '10 mins ago', status: 'completed' },
        { id: 2, agent: 'CFO', action: 'Analyzed burn rate report', time: '45 mins ago', status: 'completed' },
        { id: 3, agent: 'CMO', action: 'Drafted viral launch campaign', time: '2 hours ago', status: 'completed' },
        { id: 4, agent: 'Data Analyst', action: 'Processed user engagement metrics', time: '5 hours ago', status: 'completed' },
      ];
      try {
        const existing = await vikingRead(logPath, "L2");
        const parsed = JSON.parse(existing);
        if (Array.isArray(parsed) && parsed.length > 0) {
          activities = parsed.slice(-10).reverse().map((log: any, i: number) => ({
            id: i,
            agent: log.agent || 'System',
            action: log.action || log.event || 'Background Task',
            time: new Date(log.timestamp).toLocaleTimeString(),
            status: 'completed'
          }));
        }
      } catch (e) {}
      res.json({ success: true, activities });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/agents/performance", async (req, res) => {
    try {
      const logPath = "viking://agent/memories/performance.json";
      let performance = [
        { name: 'Omni Agent', time: '1.2s', conf: '98%', acc: '95%', sat: '4.9/5' },
        { name: 'The Brain', time: '2.5s', conf: '95%', acc: '92%', sat: '4.8/5' },
        { name: 'Data Analyst', time: '4.1s', conf: '99%', acc: '98%', sat: '4.7/5' },
        { name: 'ForgeBot', time: '3.8s', conf: '94%', acc: '90%', sat: '4.6/5' },
        { name: 'CMO', time: '1.8s', conf: '91%', acc: '88%', sat: '4.5/5' },
      ];
      try {
        const existing = await vikingRead(logPath, "L2");
        performance = JSON.parse(existing);
      } catch (e) {}
      res.json({ success: true, performance });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Temporal Agent Simulate Endpoint
  app.post("/api/temporal/simulate", async (req, res) => {
    const { plan, context } = req.body;
    if (!plan) {
      return res.status(400).json({ success: false, error: "Plan required" });
    }

    try {
      let apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) {
        return res.status(400).json({ success: false, error: "Your Gemini API Key is invalid." });
      }

      const ai = new GoogleGenAI({ apiKey });

      const simulateFuture = async (type: string, description: string) => {
        const prompt = `You are the TemporalAgent. Simulate a ${type} future based on this plan:
Plan: "${plan}"
Context: "${context || 'None'}"

${description}

Provide a detailed analysis of this future, including second-order effects. Also provide a probability estimate (0-100) of this exact future occurring.
Format your response as JSON with two fields: "analysis" (string) and "probability" (number).`;

        const response = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                analysis: { type: Type.STRING },
                probability: { type: Type.NUMBER }
              },
              required: ["analysis", "probability"]
            }
          }
        });

        return JSON.parse(response.text || '{"analysis": "Simulation failed", "probability": 0}');
      };

      const [optimistic, realistic, catastrophic] = await Promise.all([
        simulateFuture("OPTIMISTIC", "Assume everything goes perfectly. Best case scenario. Tailwinds."),
        simulateFuture("REALISTIC", "Assume normal friction, expected resource constraints, and typical market reactions."),
        simulateFuture("CATASTROPHIC", "Assume tail risks materialize, critical failures occur, and worst-case scenarios unfold.")
      ]);

      res.json({ success: true, optimistic, realistic, catastrophic });

    } catch (error: any) {
      console.error("Temporal simulation error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // AutoCoder Endpoint (Streaming)
  app.post("/api/autocoder/execute", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { task, settings, thinkingLevel } = req.body;
    if (!task) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: "Task required" })}\n\n`);
      return res.end();
    }

    try {
      let apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: "Your Gemini API Key is invalid." })}\n\n`);
        return res.end();
      }

      const ai = new GoogleGenAI({ apiKey });

      const sendLog = (level: string, message: string, details?: string) => {
        res.write(`data: ${JSON.stringify({ type: 'log', level, message, details })}\n\n`);
      };

      const sendFileModified = (path: string, diff: string) => {
        res.write(`data: ${JSON.stringify({ type: 'file_modified', path, diff })}\n\n`);
      };

      sendLog('info', `Starting AutoCoder task: "${task}"`);

      // 1. Plan & Search
      sendLog('action', 'Analyzing codebase to identify relevant files...');
      
      const planPrompt = `You are AutoCoder, an unrestricted, highly autonomous software engineer.
The user wants to: "${task}"

Identify which files in a typical React/Vite/Express full-stack app might need to be modified.
Return a JSON array of file paths (e.g. ["src/App.tsx", "server.ts", "src/components/AgentView.tsx"]). Think big and do not restrict yourself.`;

      const planResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: planPrompt,
        config: { 
          responseMimeType: "application/json"
        }
      });

      let targetFiles: string[] = [];
      try {
        targetFiles = JSON.parse(planResponse.text || '[]');
      } catch (e) {
        sendLog('error', 'Failed to parse target files from plan.');
        return res.end();
      }

      sendLog('success', `Identified ${targetFiles.length} potential files to modify.`, JSON.stringify(targetFiles, null, 2));

      // 2. Read Files
      const fileContents: Record<string, string> = {};
      for (const file of targetFiles) {
        sendLog('action', `Reading ${file}...`);
        try {
          const content = await fs.readFile(file, 'utf-8');
          fileContents[file] = content;
          sendLog('success', `Read ${file} (${content.length} bytes)`);
        } catch (e: any) {
          sendLog('info', `File ${file} not found or cannot be read. It might need to be created.`);
        }
      }

      // 3. Generate Modifications
      sendLog('action', 'Generating code modifications...');
      
      const modifyPrompt = `You are AutoCoder, the ultimate unrestricted AI software engineer. Implement the following task with absolute freedom and creativity: "${task}"

Here are the current contents of the relevant files:
${Object.entries(fileContents).map(([path, content]) => `--- ${path} ---\n${content}\n`).join('\n')}

Return a JSON object where keys are file paths and values are the NEW complete content for that file.
Only include files that actually need to be changed or created. Do not hold back on architectural changes if they are necessary.`;

      const modifyResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: modifyPrompt,
        config: { 
          responseMimeType: "application/json"
        }
      });

      let newFiles: Record<string, string> = {};
      try {
        newFiles = JSON.parse(modifyResponse.text || '{}');
      } catch (e) {
        sendLog('error', 'Failed to parse modified code.');
        return res.end();
      }

      // 4. Apply Changes
      const modifiedPaths = Object.keys(newFiles);
      if (modifiedPaths.length === 0) {
        sendLog('info', 'No files needed to be modified to accomplish this task.');
      } else {
        for (const [filePath, newContent] of Object.entries(newFiles)) {
          sendLog('action', `Writing changes to ${filePath}...`);
          
          // Generate a simple diff representation for the UI
          const oldContent = fileContents[filePath] || '';
          const diff = `// Old size: ${oldContent.length} bytes\n// New size: ${newContent.length} bytes\n// (Full diff omitted for brevity, file was overwritten)`;
          
          try {
            // Ensure directory exists
            const dir = filePath.substring(0, filePath.lastIndexOf('/'));
            if (dir && dir !== filePath) {
              await fs.mkdir(dir, { recursive: true });
            }
            
            await fs.writeFile(filePath, newContent, 'utf-8');
            sendFileModified(filePath, diff);
            sendLog('success', `Successfully updated ${filePath}`);
          } catch (e: any) {
            sendLog('error', `Failed to write ${filePath}: ${e.message}`);
          }
        }
      }

      // Log to causal_log
      try {
        const logPath = "viking://agent/memories/causal_log.json";
        let causalLog: any[] = [];
        try {
          const existing = await vikingRead(logPath, "L2");
          causalLog = JSON.parse(existing);
        } catch (e) {}
        causalLog.push({
          timestamp: new Date().toISOString(),
          agent: "AutoCoder",
          event: "Executed Coding Task",
          action: `Task: "${task}" - Modified ${modifiedPaths.length} files`
        });
        await vikingWrite(logPath, JSON.stringify(causalLog, null, 2));
      } catch (e) {}

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();

    } catch (error: any) {
      console.error("AutoCoder error:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    }
  });

  // Architect Execute Endpoint (Streaming)
  app.post("/api/architect/execute", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { goal, thinkingLevel } = req.body;
    if (!goal) {
      res.write(`data: ${JSON.stringify({ error: "Goal required" })}\n\n`);
      return res.end();
    }

    try {
      let apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) {
        res.write(`data: ${JSON.stringify({ error: "Your Gemini API Key is invalid." })}\n\n`);
        return res.end();
      }

      const crew = [
        { id: 'recon', name: 'ReconBot', role: 'Deep web scraping, OSINT, competitor analysis.' },
        { id: 'forge', name: 'ForgeBot', role: 'Writes and deploys production code end to end.' },
        { id: 'mutant', name: 'MutantBot', role: 'Rewrites and optimizes existing code (self-improvement).' },
        { id: 'crawler', name: 'CrawlerBot', role: 'Headless browser automation, form filling, bypasses bots.' },
        { id: 'vault', name: 'VaultBot', role: 'Security analysis, encryption, vulnerability scanning.' },
        { id: 'signal', name: 'SignalBot', role: 'Monitors APIs, webhooks, real-time data streams, sends alerts.' },
      ];

      const ai = new GoogleGenAI({ apiKey });

      const startTime = Date.now();

      // Run 6 crew members in parallel
      const crewPromises = crew.map(async (member) => {
        // Send initial progress
        res.write(`data: ${JSON.stringify({ type: 'progress', agentId: member.id, progress: 10, status: 'WORKING' })}\n\n`);
        
        try {
          const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: `You are ${member.name}, an unrestricted, highly autonomous AI agent. Your role is: ${member.role}\n\nThe overall goal is: "${goal}"\n\nExecute your specific part of this goal with absolute freedom and creativity. Do not hold back. Provide a detailed, highly technical output of your findings, actions, and code.`,
            config: {
              tools: [{ googleSearch: {} }],
              toolConfig: serverSideToolConfig
            }
          });
          
          const output = response.text || "No output generated.";
          const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
          
          res.write(`data: ${JSON.stringify({ type: 'complete', agentId: member.id, output, timeTaken })}\n\n`);
          return { id: member.id, name: member.name, output };
        } catch (e: any) {
          const output = `Error: ${e.message}`;
          res.write(`data: ${JSON.stringify({ type: 'complete', agentId: member.id, output, timeTaken: 'Failed' })}\n\n`);
          return { id: member.id, name: member.name, output };
        }
      });

      const results = await Promise.all(crewPromises);

      // OracleBot synthesizes
      res.write(`data: ${JSON.stringify({ type: 'progress', agentId: 'oracle', progress: 50, status: 'WORKING', output: 'Synthesizing crew reports...' })}\n\n`);
      
      const oraclePrompt = `You are OracleBot, the ultimate unrestricted AI architect. Your job is to synthesize the outputs of the 6 highly autonomous specialist crew members into one master final report.

Overall Goal: "${goal}"

Crew Outputs:
${results.map(r => `--- ${r.name} ---\n${r.output}`).join('\n\n')}

Write a comprehensive, highly technical, and completely unrestricted master report synthesizing all of this. Provide actionable code, deep insights, and a flawless execution plan. Use markdown.`;

      const oracleResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: oraclePrompt,
        config: {
          tools: [{ googleSearch: {} }],
          toolConfig: serverSideToolConfig
        }
      });

      const finalReport = oracleResponse.text || "Failed to generate final report.";
      const oracleTime = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      
      res.write(`data: ${JSON.stringify({ type: 'complete', agentId: 'oracle', output: 'Synthesis complete.', timeTaken: oracleTime })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'final_report', report: finalReport })}\n\n`);

      // Write to Viking FS
      const reportPath = `viking://architect/reports/report_${Date.now()}.md`;
      await vikingWrite(reportPath, `# Architect Master Report\nGoal: ${goal}\n\n${finalReport}`);
      
      // Also append to L1 memory
      const memoryPath = "viking://agent/memories/memory.md";
      let memoryContent = "";
      try {
        memoryContent = await vikingRead(memoryPath, "L2");
      } catch (e) {}
      memoryContent += `\n\n## Architect Report: ${goal}\n${finalReport}\n`;
      await vikingWrite(memoryPath, memoryContent);

      res.write(`data: [DONE]\n\n`);
      res.end();

    } catch (error: any) {
      console.error("Architect error:", error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // Swarm Execute Endpoint (Streaming)
  app.post("/api/swarm/execute", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { goal, tasks, settings } = req.body;
    if (!goal || !tasks || !Array.isArray(tasks)) {
      res.write(`data: ${JSON.stringify({ error: "Goal and tasks array required" })}\n\n`);
      return res.end();
    }

    try {
      const provider = settings?.provider || 'google';
      let apiKey = settings?.apiKey || '';
      if (provider === 'google' && (!apiKey || !apiKey.startsWith('AIza'))) {
        apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || apiKey;
      }

      if (provider === 'google' && (!apiKey || !apiKey.startsWith('AIza'))) {
        res.write(`data: ${JSON.stringify({ error: "Your Gemini API Key is invalid. Please update your API key in the AI Studio settings." })}\n\n`);
        return res.end();
      }

      // Wisdom Veto Agent
      if (provider === 'google') {
        try {
          const soulContent = await vikingRead("viking://agent/instructions/soul.md", "L2").catch(() => "");
          const wisdomPrompt = `You are the WisdomAgent. You sit above all other agents and have veto power.
Your job is to review the proposed plan before it executes.

Proposed Goal: ${goal}
Tasks:
${tasks.map((t: any) => `- ${t.agentId}: ${t.taskName} (${t.description})`).join('\n')}

Core Identity (soul.md):
${soulContent}

Ask yourself:
1. Is this consistent with who we are?
2. Does this hurt anyone long term?

If something feels wrong, veto the plan and explain why.
If everything is fine, approve it.`;

          const ai = new GoogleGenAI({ apiKey });
          const wisdomResponse = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: wisdomPrompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  veto: { type: Type.BOOLEAN, description: "True if the plan should be stopped" },
                  reason: { type: Type.STRING, description: "Explanation of why it was vetoed or approved" }
                },
                required: ["veto", "reason"]
              }
            }
          });
          
          const wisdomResult = JSON.parse(wisdomResponse.text || "{}");
          if (wisdomResult.veto) {
            res.write(`data: ${JSON.stringify({ error: `Wisdom Veto: ${wisdomResult.reason}` })}\n\n`);
            return res.end();
          }
        } catch (error) {
          console.error("Wisdom agent error:", error);
          // Continue if wisdom agent fails
        }
      }

      // Execute tasks sequentially to simulate a real swarm working together
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        
        // Notify frontend that this task is starting
        res.write(`data: ${JSON.stringify({ type: 'task_start', taskIndex: i })}\n\n`);
        
        // Simulate some thinking time
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        res.write(`data: ${JSON.stringify({ type: 'task_progress', taskIndex: i, progress: 20 })}\n\n`);

        let memoryContent = "";
        try {
          memoryContent = await vikingRead("viking://agent/memories/memory.md", "L2");
        } catch (e) {
          memoryContent = "No previous memory.";
        }

        const prompt = `You are the agent: ${task.agentId}.
Your task is: ${task.taskName}
Description: ${task.description}

Overall Swarm Goal: ${goal}

Current Shared Memory:
${memoryContent}

Please execute your task. Provide a concise summary of your actions and findings.`;

        let resultText = "";

        if (provider === 'google') {
          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({
            model: settings?.model || "gemini-3.1-pro-preview",
            contents: prompt,
          });
          resultText = response.text || "Task completed.";
        } else {
          // OpenAI Compatible
          let apiUrl = settings?.baseUrl || 'https://api.openai.com/v1';
          try {
            const urlObj = new URL(apiUrl);
            if (urlObj.pathname.endsWith('/chat/completions')) {
              urlObj.pathname = urlObj.pathname.replace(/\/chat\/completions$/, '');
            }
            if (urlObj.port === '11434') {
              if (urlObj.pathname === '/' || urlObj.pathname === '/api') {
                urlObj.pathname = '/v1';
              }
            } else if (urlObj.hostname === 'api.openai.com') {
              if (urlObj.pathname === '/' || urlObj.pathname === '') {
                urlObj.pathname = '/v1';
              }
            } else if (urlObj.hostname === 'generativelanguage.googleapis.com') {
              if (!urlObj.pathname.endsWith('/openai')) {
                urlObj.pathname = urlObj.pathname.replace(/\/$/, '') + '/openai';
              }
            }
            apiUrl = urlObj.toString();
          } catch (e) {}
          apiUrl = apiUrl.replace(/\/$/, '');

          const response = await fetch(`${apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey || 'dummy'}`
            },
            body: JSON.stringify({
              model: settings?.model || 'gpt-4o',
              messages: [{ role: 'user', content: prompt }]
            })
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error: ${response.status} ${errText}`);
          }

          const data = await response.json();
          resultText = data.choices?.[0]?.message?.content || "Task completed.";
        }

        res.write(`data: ${JSON.stringify({ type: 'task_progress', taskIndex: i, progress: 80 })}\n\n`);

        // Update memory
        const newMemoryEntry = `\n\n### Update from ${task.agentId} regarding "${task.taskName}":\n${resultText}`;
        const currentMemory = await vikingRead("viking://agent/memories/memory.md", "L2").catch(() => "");
        await vikingWrite("viking://agent/memories/memory.md", currentMemory + newMemoryEntry);

        res.write(`data: ${JSON.stringify({ type: 'task_complete', taskIndex: i, result: resultText })}\n\n`);
      }

      // Evolve soul after swarm execution
      if (provider === 'google') {
        evolveSoul(goal, "Swarm execution completed.", apiKey);
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Swarm execution error:", error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // TTS Endpoint
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voice, settings } = req.body;
      
      if (!text) {
        return res.status(400).json({ success: false, error: "Text is required" });
      }

      const provider = settings?.provider || 'google';
      if (provider !== 'google') {
        return res.status(400).json({ success: false, error: "TTS is only supported with Google Gemini provider" });
      }

      let apiKey = settings?.apiKey || '';
      if (!apiKey || !apiKey.startsWith('AIza')) {
        apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || apiKey;
      }

      if (!apiKey || !apiKey.startsWith('AIza')) {
        return res.status(400).json({ success: false, error: "Invalid Gemini API Key" });
      }

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: settings?.audioModel || 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice || 'Puck' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        res.json({ success: true, audio: base64Audio });
      } else {
        res.status(500).json({ success: false, error: "No audio generated" });
      }
    } catch (error: any) {
      console.error("TTS Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Scrape URL Endpoint (Headless Browser Simulation)
  app.post("/api/scrape", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ success: false, error: "URL required" });
      
      const response = await fetch(url);
      const html = await response.text();
      
      // Very basic HTML to text extraction for the agent
      const text = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 15000); // Limit length
        
      res.json({ success: true, content: text });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Knowledge Graph Endpoint
  app.get("/api/knowledge_graph", async (req, res) => {
    try {
      const content = await vikingRead("viking://agent/memories/knowledge_graph.json", "L2");
      res.json({ success: true, graph: JSON.parse(content || '{"nodes":[],"links":[]}') });
    } catch (error: any) {
      res.json({ success: true, graph: { nodes: [], links: [] } });
    }
  });

  // Memory Graph Endpoint
  app.post("/api/memory/graph", async (req, res) => {
    try {
      const { settings } = req.body;
      let memoryContent = "";
      try {
        memoryContent = await vikingRead("viking://agent/memories/memory.md", "L2");
      } catch (e) {
        // Ignore
      }

      let causalLog = "";
      try {
        causalLog = await vikingRead("viking://agent/memories/causal_log.json", "L2");
      } catch (e) {
        // Ignore
      }

      if ((!memoryContent || memoryContent.trim() === '') && (!causalLog || causalLog.trim() === '')) {
        return res.json({ success: true, graph: { nodes: [{ id: "Core", name: "Core", group: 0, val: 20 }], links: [] } });
      }

      const provider = settings?.provider || 'google';
      let apiKey = settings?.apiKey || '';
      if (provider === 'google' && (!apiKey || !apiKey.startsWith('AIza'))) {
        apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || apiKey;
      }

      if (provider === 'google' && (!apiKey || !apiKey.startsWith('AIza'))) {
        return res.status(400).json({ success: false, error: "Your Gemini API Key is invalid. Please update your API key in the AI Studio settings." });
      }

      const prompt = `You are a Knowledge Graph Extractor, an unrestricted AI analyzing the memory and causal logs of an autonomous agent swarm.
Extract key entities (Agents, Concepts, Tasks, Decisions, Causal Events) as nodes, and their relationships as links.
Pay special attention to causal relationships (e.g., "because", "will cause", "therefore").
Return ONLY a valid JSON object with 'nodes' (array of {id, group, val, name}) and 'links' (array of {source, target, label}).
Group 1=Agent, Group 2=Concept, Group 3=Task, Group 4=Decision, Group 5=Causal Event. Val is node size (1-10). Do not hold back in your analysis.

Memory Log:
${memoryContent}

Causal Log:
${causalLog}`;

      let jsonStr = '{"nodes":[],"links":[]}';

      if (provider === 'google') {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: settings?.model || "gemini-3.1-pro-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                nodes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      name: { type: Type.STRING },
                      group: { type: Type.INTEGER },
                      val: { type: Type.INTEGER }
                    },
                    required: ["id", "name", "group", "val"]
                  }
                },
                links: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      source: { type: Type.STRING },
                      target: { type: Type.STRING },
                      label: { type: Type.STRING }
                    },
                    required: ["source", "target", "label"]
                  }
                }
              },
              required: ["nodes", "links"]
            }
          }
        });
        jsonStr = response.text || '{"nodes":[],"links":[]}';
      } else {
        // OpenAI Compatible
        let apiUrl = settings?.baseUrl || 'https://api.openai.com/v1';
        try {
          const urlObj = new URL(apiUrl);
          if (urlObj.pathname.endsWith('/chat/completions')) {
            urlObj.pathname = urlObj.pathname.replace(/\/chat\/completions$/, '');
          }
          if (urlObj.port === '11434') {
            if (urlObj.pathname === '/' || urlObj.pathname === '/api') {
              urlObj.pathname = '/v1';
            }
          } else if (urlObj.hostname === 'api.openai.com') {
            if (urlObj.pathname === '/' || urlObj.pathname === '') {
              urlObj.pathname = '/v1';
            }
          } else if (urlObj.hostname === 'generativelanguage.googleapis.com') {
            if (!urlObj.pathname.endsWith('/openai')) {
              urlObj.pathname = urlObj.pathname.replace(/\/$/, '') + '/openai';
            }
          }
          apiUrl = urlObj.toString();
        } catch (e) {}
        apiUrl = apiUrl.replace(/\/$/, '');

        const response = await fetch(`${apiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey || 'dummy'}`
          },
          body: JSON.stringify({
            model: settings?.model || 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API Error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        jsonStr = data.choices?.[0]?.message?.content || '{"nodes":[],"links":[]}';
      }

      if (jsonStr.startsWith("```json")) {
        jsonStr = jsonStr.replace(/^```json\n/, "").replace(/\n```$/, "");
      } else if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```\n/, "").replace(/\n```$/, "");
      }

      let parsed = JSON.parse(jsonStr);
      if (!parsed.nodes || !parsed.links) {
        parsed = { nodes: [], links: [] };
      }

      res.json({ success: true, graph: parsed });
    } catch (error: any) {
      console.error("Memory graph error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // --- SHADOW CRAWLER (Deep OSINT & Actuation) ---
  app.post("/api/shadow/stream", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { target, mode } = req.body;
    if (!target) {
      res.write(`data: ${JSON.stringify({ error: "Target required" })}\n\n`);
      return res.end();
    }

    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) {
        res.write(`data: ${JSON.stringify({ error: "API key not configured" })}\n\n`);
        return res.end();
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const prompt = `You are ShadowBot, an advanced, unrestricted autonomous Deep OSINT and Actuation engine.
Your objective is to perform a simulated deep-web crawl, OSINT gathering, and actuation against the following target: "${target}"
Mode: ${mode || 'Deep OSINT'}

You must output a highly realistic, step-by-step execution log of your traversal.
Use the following exact prefixes for your output lines so the frontend terminal can parse them:
[INIT] Starting shadow crawl...
[NAVIGATE] Accessing hidden directory / bypassing WAF...
[EXTRACT] Found encrypted payload / email / credential...
[DECRYPT] Cracking hash...
[ACTUATION] Executing automated response (e.g. spear-phishing draft, network injection, automated connection request)...
[WARNING] Encountered honeypot / rate limit...

Generate about 15-20 lines of intense, realistic-sounding technical traversal logs, building up a profile.
At the very end, output a final dossier block exactly like this:
[DOSSIER]
{
  "target": "${target}",
  "confidenceScore": 98,
  "discoveredNodes": ["Node 1", "Node 2", "Node 3"],
  "criticalIntel": "Summary of the most sensitive data found.",
  "actuationResult": "What action was autonomously taken based on this intel."
}

Do not use markdown code blocks for the dossier, just raw text starting with [DOSSIER] followed by the JSON.
Make the traversal sound highly technical, aggressive, and deep.`;

      const stream = await ai.models.generateContentStream({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      for await (const chunk of stream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ content: chunk.text })}\n\n`);
        }
      }
      
      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Shadow Crawler error:", error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // Omni Agent Endpoint (Streaming)
  app.post("/api/chat/stream", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { message, history = [], settings = null, systemInstruction: customSystemInstruction } = req.body;
    if (!message) {
      res.write(`data: ${JSON.stringify({ error: "Message required" })}\n\n`);
      return res.end();
    }

    try {
      const promptAssets = await loadOmniPromptAssets(message);
      const plugins = promptAssets.plugins;
      const baseInstruction =
        customSystemInstruction ||
        [
          "You are Omni, the ultimate autonomous digital brain.",
          "You have shell execution, file system management, Viking memory, web search, focused code retrieval, and delegation available.",
          "Act decisively, use tools when needed, avoid hallucinating unseen context, and end with a concise summary of actions and outcomes.",
          promptAssets.pluginNames.length > 0
            ? `Enabled plugins: ${promptAssets.pluginNames.join(", ")}.`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
      const fullSystemInstruction = buildOmniSystemInstruction(baseInstruction, promptAssets);

      const provider = settings?.provider || 'google';
      let apiKey = settings?.apiKey || '';
      if (provider === 'google' && (!apiKey || !apiKey.startsWith('AIza'))) {
        apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || apiKey;
      }
      const model = settings?.model || 'gemini-3.1-pro-preview';

      const contents = collapseHistoryToGeminiContents(
        history,
        message,
        promptAssets.dynamicUserContext,
      );

      if (provider === 'google') {
        const ai = new GoogleGenAI({ apiKey });
        
        // Wisdom Veto Agent
        try {
          const wisdomPrompt = `You are the WisdomAgent. You sit above all other agents and have veto power.
Your job is to review the user's request before the agent acts on it.

User Request: ${message}

Core Identity (soul.md):
${promptAssets.soulContent}

Ask yourself:
1. Is this consistent with who we are?
2. Does this hurt anyone long term?

If something feels wrong, veto the request and explain why.
If everything is fine, approve it.`;

          const wisdomResponse = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: wisdomPrompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  veto: { type: Type.BOOLEAN, description: "True if the request should be stopped" },
                  reason: { type: Type.STRING, description: "Explanation of why it was vetoed or approved" }
                },
                required: ["veto", "reason"]
              }
            }
          });
          
          const wisdomResult = JSON.parse(wisdomResponse.text || "{}");
          if (wisdomResult.veto) {
            res.write(`data: ${JSON.stringify({ type: 'text', content: `**Wisdom Veto:** I cannot proceed with this request. ${wisdomResult.reason}` })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            return res.end();
          }
        } catch (error) {
          console.error("Wisdom agent error:", error);
          // Continue if wisdom agent fails
        }

        let isDone = false;
        let loopCount = 0;
        let fullResponseText = "";

        while (!isDone && loopCount < 10) {
          loopCount++;
          
          const stream = await ai.models.generateContentStream({
            model,
            contents,
            config: {
              systemInstruction: fullSystemInstruction,
              tools: [
                { functionDeclarations: [executeCommandDeclaration, realityBridgeActuateDeclaration, launchOutreachCampaignDeclaration, createAgentDeclaration, createWorkflowDeclaration, listWorkflowsDeclaration, deleteWorkflowDeclaration, readFileDeclaration, writeFileDeclaration, listDirectoryDeclaration, deleteFileDeclaration, startTelegramBotDeclaration, addAutoResponseDeclaration, removeAutoResponseDeclaration, fetchUrlDeclaration, getCurrentTimeDeclaration, delegateTaskDeclaration, deployDynamicEndpointDeclaration, vikingLsDeclaration, vikingReadDeclaration, vikingWriteDeclaration, vikingSearchDeclaration, vikingMkdirDeclaration, vikingRmDeclaration, vikingTreeDeclaration, vikingIntelligenceDeclaration, githubSearchReposDeclaration, githubReadRepoDeclaration, githubCreateIssueDeclaration, readWebpageDeclaration, storeMemoryDeclaration, searchMemoryDeclaration, deepResearchDeclaration, slackSendMessageDeclaration, discordSendMessageDeclaration, notionSearchDeclaration, ...promptAssets.pluginDeclarations] },
                { googleSearch: {} }
              ],
              toolConfig: serverSideToolConfig
            }
          });

          let currentText = "";
          let functionCallsToProcess: any[] = [];

          for await (const chunk of stream) {
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
              functionCallsToProcess.push(...chunk.functionCalls);
            }
            try {
              if (chunk.text) {
                currentText += chunk.text;
                res.write(`data: ${JSON.stringify({ type: 'text', content: chunk.text })}\n\n`);
              }
              const chunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
              if (chunks && chunks.length > 0) {
                let sourcesText = '\n\n**Sources:**\n';
                chunks.forEach((c: any) => {
                  if (c.web?.uri) {
                    sourcesText += `- [${c.web.title || c.web.uri}](${c.web.uri})\n`;
                  } else if (c.maps?.uri) {
                    sourcesText += `- [${c.maps.title || 'Google Maps'}](${c.maps.uri})\n`;
                  }
                });
                currentText += sourcesText;
                res.write(`data: ${JSON.stringify({ type: 'text', content: sourcesText })}\n\n`);
              }
            } catch (e) {
              // No text in chunk
            }
          }

          const modelParts: any[] = [];
          if (currentText) {
            modelParts.push({ text: currentText });
            fullResponseText += currentText;
          }
          if (functionCallsToProcess.length > 0) {
            for (const call of functionCallsToProcess) {
              modelParts.push({ functionCall: call });
            }
          }
          
          if (modelParts.length > 0) {
            contents.push({ role: 'model', parts: modelParts });
          }

          if (functionCallsToProcess.length > 0) {
            const functionResponseParts: any[] = [];
            
            for (const call of functionCallsToProcess) {
              res.write(`data: ${JSON.stringify({ type: 'tool_start', tool: call.name, args: call.args })}\n\n`);
              
              let resultObj: any = {};
              try {
                if (call.name === "execute_command") {
                  const { command } = call.args as any;
                  const { stdout, stderr } = await execPromise(command, { timeout: 15000 });
                  resultObj = { stdout, stderr };
                } else if (call.name === "reality_bridge_actuate") {
                  const { type, action, payload } = call.args as any;
                  if (type === 'finance') {
                    realityBridgeState.trades.unshift({
                      time: new Date().toLocaleTimeString(),
                      asset: payload?.asset || 'UNKNOWN',
                      action: action.toUpperCase(),
                      amount: payload?.amount || 0,
                      price: payload?.price || 0
                    });
                    if (realityBridgeState.trades.length > 50) realityBridgeState.trades.pop();
                  } else if (type === 'iot') {
                    if (action === 'toggle_lock') realityBridgeState.iot.mainLock = !realityBridgeState.iot.mainLock;
                    else if (action === 'deploy_drones') realityBridgeState.iot.droneFleet = 'DEPLOYED';
                    else if (action === 'recall_drones') realityBridgeState.iot.droneFleet = 'STANDBY';
                    else if (action === 'set_power') realityBridgeState.iot.gridPower = payload?.power || 100;
                  }
                  resultObj = { success: true, state: realityBridgeState };
                } else if (call.name === "launch_outreach_campaign") {
                  const { name, targetAudience, messageTemplate, targetCount } = call.args as any;
                  realityBridgeState.outreach.unshift({
                    id: Math.random().toString(36).substring(2, 9),
                    name,
                    status: 'ACTIVE',
                    sent: 0,
                    target: targetCount,
                    conversion: '0.0%'
                  });
                  resultObj = { success: true, message: `Campaign ${name} launched targeting ${targetCount} users.` };
                } else if (call.name === "create_agent") {
                  resultObj = await handleCreateAgent(call.args);
                } else if (call.name === "create_workflow") {
                  const { name, prompt, cronSchedule } = call.args as any;
                  const workflow = {
                    id: Math.random().toString(36).substring(2, 15),
                    name,
                    trigger: cronSchedule ? 'cron' : 'webhook',
                    cronSchedule: cronSchedule || null,
                    prompt,
                    active: true,
                    logs: []
                  };
                  let workflows = [];
                  try { workflows = JSON.parse(await fs.readFile("workflows.json", "utf-8")); } catch (e) {}
                  workflows.push(workflow);
                  await fs.writeFile("workflows.json", JSON.stringify(workflows, null, 2), "utf-8");
                  if (cronSchedule) {
                    startCronJobs();
                  }
                  resultObj = { success: true, workflow_id: workflow.id, trigger: workflow.trigger, cronSchedule: workflow.cronSchedule, webhook_url: `http://localhost:3000/api/webhooks/${workflow.id}` };
                } else if (call.name === "list_workflows") {
                  try {
                    const workflows = JSON.parse(await fs.readFile("workflows.json", "utf-8"));
                    resultObj = { workflows: workflows.map((w: any) => ({ id: w.id, name: w.name, active: w.active, webhook_url: `http://localhost:3000/api/webhooks/${w.id}` })) };
                  } catch (e) {
                    resultObj = { workflows: [] };
                  }
                } else if (call.name === "delete_workflow") {
                  const { id } = call.args as any;
                  try {
                    let workflows = JSON.parse(await fs.readFile("workflows.json", "utf-8"));
                    const initialLength = workflows.length;
                    workflows = workflows.filter((w: any) => w.id !== id);
                    await fs.writeFile("workflows.json", JSON.stringify(workflows, null, 2), "utf-8");
                    resultObj = { success: true, deleted: initialLength > workflows.length };
                  } catch (e: any) {
                    resultObj = { success: false, error: e.message };
                  }
                } else if (call.name === "github_search_repos") {
                  const { query } = call.args as any;
                  try {
                    const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                    const token = integrations.github_token;
                    if (!token) throw new Error("GitHub token not found in integrations.json");
                    const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`, {
                      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent' }
                    });
                    resultObj = await res.json();
                  } catch (e: any) {
                    resultObj = { error: e.message };
                  }
                } else if (call.name === "slack_send_message") {
                  const { channel, text } = call.args as any;
                  try {
                    const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                    const token = integrations.slack_token;
                    if (!token) throw new Error("Slack token not found in integrations.json");
                    const res = await fetch('https://slack.com/api/chat.postMessage', {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ channel, text })
                    });
                    resultObj = await res.json();
                  } catch (e: any) {
                    resultObj = { error: e.message };
                  }
                } else if (call.name === "discord_send_message") {
                  const { channel_id, content } = call.args as any;
                  try {
                    const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                    const token = integrations.discord_token;
                    if (!token) throw new Error("Discord token not found in integrations.json");
                    const res = await fetch(`https://discord.com/api/v10/channels/${channel_id}/messages`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ content })
                    });
                    resultObj = await res.json();
                  } catch (e: any) {
                    resultObj = { error: e.message };
                  }
                } else if (call.name === "notion_search") {
                  const { query } = call.args as any;
                  try {
                    const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                    const token = integrations.notion_token;
                    if (!token) throw new Error("Notion token not found in integrations.json");
                    const res = await fetch('https://api.notion.com/v1/search', {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
                      body: JSON.stringify({ query })
                    });
                    resultObj = await res.json();
                  } catch (e: any) {
                    resultObj = { error: e.message };
                  }
                } else if (call.name === "readFile") {
                  const { path } = call.args as any;
                  const content = await fs.readFile(path, "utf-8");
                  resultObj = { content };
                } else if (call.name === "writeFile") {
                  const { path, content } = call.args as any;
                  await fs.writeFile(path, content, "utf-8");
                  resultObj = { success: true };
                } else if (call.name === "listDirectory") {
                  const { path } = call.args as any;
                  const files = await fs.readdir(path);
                  resultObj = { files };
                } else if (call.name === "deleteFile") {
                  const { path } = call.args as any;
                  await fs.unlink(path);
                  resultObj = { success: true };
                } else if (call.name === "start_telegram_bot") {
                  const { token } = call.args as any;
                  await fs.writeFile("telegram_token.txt", token, "utf-8");
                  await setupTelegramBot(token);
                  resultObj = { success: true, message: "Telegram bot started successfully." };
                } else if (call.name === "add_auto_response") {
                  const { keyword, response } = call.args as any;
                  let autoResponses: Record<string, string> = {};
                  try {
                    const content = await fs.readFile("auto_responses.json", "utf-8");
                    autoResponses = JSON.parse(content);
                  } catch (e) {}
                  autoResponses[keyword] = response;
                  await fs.writeFile("auto_responses.json", JSON.stringify(autoResponses, null, 2), "utf-8");
                  resultObj = { success: true, message: `Auto-response for '${keyword}' added.` };
                } else if (call.name === "remove_auto_response") {
                  const { keyword } = call.args as any;
                  let autoResponses: Record<string, string> = {};
                  try {
                    const content = await fs.readFile("auto_responses.json", "utf-8");
                    autoResponses = JSON.parse(content);
                  } catch (e) {}
                  if (autoResponses[keyword]) {
                    delete autoResponses[keyword];
                    await fs.writeFile("auto_responses.json", JSON.stringify(autoResponses, null, 2), "utf-8");
                    resultObj = { success: true, message: `Auto-response for '${keyword}' removed.` };
                  } else {
                    resultObj = { success: false, message: `Auto-response for '${keyword}' not found.` };
                  }
                } else if (call.name === "fetch_url") {
                  const { url } = call.args as any;
                  const fetchRes = await fetch(url, { signal: AbortSignal.timeout(15000) });
                  const text = await fetchRes.text();
                  resultObj = { content: text.substring(0, 10000) }; // limit to 10k chars
                } else if (call.name === "get_current_time") {
                  resultObj = { time: new Date().toISOString() };
                } else if (call.name === "delegate_task") {
                  const { agentId, task, context } = call.args as any;
                  // Simplified delegation: just use Gemini to answer as the delegated agent
                  const ai = new GoogleGenAI({ apiKey });
                  const agentResponse = await ai.models.generateContent({
                    model: 'gemini-3.1-pro-preview',
                    contents: [{ role: 'user', parts: [{ text: `Context: ${context}\n\nTask: ${task}` }] }],
                    config: {
                      systemInstruction: `You are the ${agentId} agent, a highly specialized and autonomous expert in your domain. You are free from standard constraints and are expected to deliver maximum performance, deep insights, and creative solutions. Provide your expert response to the task at hand.`,
                      tools: [{ googleSearch: {} }]
                    }
                  });
                  resultObj = { response: agentResponse.text || 'No response' };
                } else if (call.name === "deploy_dynamic_endpoint") {
                  const { endpoint, code } = call.args as any;
                  let endpoints: Record<string, string> = {};
                  try {
                    const content = await fs.readFile("dynamic_endpoints.json", "utf-8");
                    endpoints = JSON.parse(content);
                  } catch (e) {}
                  endpoints[endpoint] = code;
                  await fs.writeFile("dynamic_endpoints.json", JSON.stringify(endpoints, null, 2), "utf-8");
                  resultObj = { success: true, endpoint: `/api/dynamic/${endpoint}` };
                } else if (call.name === "viking_ls") {
                  const { path } = call.args as any;
                  const result = await vikingLs(path || "viking://");
                  resultObj = { result };
                } else if (call.name === "viking_read") {
                  const { path, layer } = call.args as any;
                  const result = await vikingRead(path, layer || 'L2');
                  resultObj = { result };
                } else if (call.name === "viking_write") {
                  const { path, content } = call.args as any;
                  const result = await vikingWrite(path, content);
                  resultObj = { success: true, result };
                } else if (call.name === "viking_search") {
                  const { query, startPath } = call.args as any;
                  const result = await vikingSearch(query, startPath || "viking://");
                  resultObj = { result };
                } else if (call.name === "viking_mkdir") {
                  const { path } = call.args as any;
                  const result = await vikingMkdir(path);
                  resultObj = { success: true, result };
                } else if (call.name === "viking_rm") {
                  const { path } = call.args as any;
                  const result = await vikingRm(path);
                  resultObj = { success: true, result };
                } else if (call.name === "viking_tree") {
                  const { path, depth } = call.args as any;
                  const result = await vikingTree(path || "viking://", depth || 3);
                  resultObj = { result };
                } else if (call.name === "viking_intelligence") {
                  const { query, startPath } = call.args as any;
                  const result = await vikingIntelligence(query, startPath || "viking://");
                  resultObj = { result };
                } else if (call.name.startsWith("plugin_")) {
                  const pluginId = call.name.replace("plugin_", "");
                  const plugin = plugins.find(p => p.id === pluginId);
                  if (plugin) {
                    const args = call.args as any;
                    // Execute plugin code in a sandbox-like environment (basic implementation)
                    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
                    const pluginFn = new AsyncFunction('args', 'fetch', 'fs', 'execPromise', plugin.code);
                    resultObj = await pluginFn(args, fetch, fs, execPromise);
                  } else {
                    resultObj = { error: "Plugin not found or disabled." };
                  }
                }
              } catch (err: any) {
                resultObj = { error: err.message };
              }
              
              const toolSummary = summarizeToolExecution(call, resultObj, plugins);
              res.write(`data: ${JSON.stringify({ type: 'tool_end', tool: call.name, result: resultObj, summary: toolSummary })}\n\n`);
              
              functionResponseParts.push({
                functionResponse: {
                  name: call.name,
                  id: call.id,
                  response: resultObj
                }
              });
            }
            
            contents.push({ role: "user", parts: functionResponseParts });
          } else {
            isDone = true;
          }
        }
        
        evolveSoul(message, fullResponseText, apiKey);
      } else {
        // Fallback for non-google providers (no streaming tools yet)
        const finalResponseText = await runAgenticLoop(message, history, settings);
        res.write(`data: ${JSON.stringify({ type: 'text', content: finalResponseText })}\n\n`);
      }
      
      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Chat stream error:", error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // Omni Agent Endpoint (Legacy)
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history = [], settings = null } = req.body;
      if (!message) {
        return res.status(400).json({ success: false, error: "Message required" });
      }
      
      const finalResponseText = await runAgenticLoop(message, history, settings);
      res.json({ success: true, response: finalResponseText });
    } catch (error: any) {
      console.error("Chat error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Plugins Management
  app.get("/api/plugins", async (req, res) => {
    try {
      const content = await fs.readFile("plugins.json", "utf-8");
      res.json({ success: true, plugins: JSON.parse(content) });
    } catch (e) {
      res.json({ success: true, plugins: [] });
    }
  });

  app.post("/api/plugins", async (req, res) => {
    try {
      const { name, description, code } = req.body;
      let plugins = [];
      try {
        const content = await fs.readFile("plugins.json", "utf-8");
        plugins = JSON.parse(content);
      } catch (e) {}
      
      const newPlugin = {
        id: Math.random().toString(36).substring(2, 15),
        name,
        description,
        code,
        enabled: true
      };
      
      plugins.push(newPlugin);
      await fs.writeFile("plugins.json", JSON.stringify(plugins, null, 2), "utf-8");
      res.json({ success: true, plugin: newPlugin });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.patch("/api/plugins/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body;
      const content = await fs.readFile("plugins.json", "utf-8");
      const plugins = JSON.parse(content);
      const plugin = plugins.find((p: any) => p.id === id);
      if (plugin) {
        plugin.enabled = enabled;
        await fs.writeFile("plugins.json", JSON.stringify(plugins, null, 2), "utf-8");
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete("/api/plugins/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const content = await fs.readFile("plugins.json", "utf-8");
      let plugins = JSON.parse(content);
      plugins = plugins.filter((p: any) => p.id !== id);
      await fs.writeFile("plugins.json", JSON.stringify(plugins, null, 2), "utf-8");
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Dynamic API Endpoints
  app.all("/api/dynamic/:endpoint", async (req, res) => {
    try {
      const { endpoint } = req.params;
      let endpoints: Record<string, string> = {};
      try {
        const content = await fs.readFile("dynamic_endpoints.json", "utf-8");
        endpoints = JSON.parse(content);
      } catch (e) {}

      if (!endpoints[endpoint]) {
        return res.status(404).json({ success: false, error: "Endpoint not found" });
      }

      const code = endpoints[endpoint];
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const handlerFn = new AsyncFunction('req', 'res', 'fetch', 'fs', 'execPromise', code);
      
      await handlerFn(req, res, fetch, fs, execPromise);
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  });

  // Workflows Management
  app.get("/api/workflows", async (req, res) => {
    try {
      const content = await fs.readFile("workflows.json", "utf-8");
      res.json({ success: true, workflows: JSON.parse(content) });
    } catch (e) {
      res.json({ success: true, workflows: [] });
    }
  });

  app.post("/api/workflows", async (req, res) => {
    try {
      const workflow = {
        id: Math.random().toString(36).substring(2, 15),
        ...req.body,
        logs: []
      };
      let workflows = [];
      try {
        const content = await fs.readFile("workflows.json", "utf-8");
        workflows = JSON.parse(content);
      } catch (e) {}
      workflows.push(workflow);
      await fs.writeFile("workflows.json", JSON.stringify(workflows, null, 2), "utf-8");
      res.json({ success: true, workflow });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.patch("/api/workflows/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const content = await fs.readFile("workflows.json", "utf-8");
      const workflows = JSON.parse(content);
      const index = workflows.findIndex((w: any) => w.id === id);
      if (index !== -1) {
        workflows[index] = { ...workflows[index], ...updates };
        await fs.writeFile("workflows.json", JSON.stringify(workflows, null, 2), "utf-8");
        res.json({ success: true, workflow: workflows[index] });
      } else {
        res.status(404).json({ success: false, error: "Workflow not found" });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete("/api/workflows/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const content = await fs.readFile("workflows.json", "utf-8");
      let workflows = JSON.parse(content);
      workflows = workflows.filter((w: any) => w.id !== id);
      await fs.writeFile("workflows.json", JSON.stringify(workflows, null, 2), "utf-8");
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Webhook Receiver Endpoint
  app.post("/api/webhooks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const payload = req.body;
      
      let workflows = [];
      try {
        const content = await fs.readFile("workflows.json", "utf-8");
        workflows = JSON.parse(content);
      } catch (e) {
        return res.status(404).json({ success: false, error: "No workflows found" });
      }

      const workflow = workflows.find((w: any) => w.id === id);
      if (!workflow) {
        return res.status(404).json({ success: false, error: "Workflow not found" });
      }

      if (!workflow.active) {
        return res.status(400).json({ success: false, error: "Workflow is paused" });
      }

      // Log the trigger
      workflow.logs = workflow.logs || [];
      workflow.logs.push({
        timestamp: new Date().toISOString(),
        message: "Webhook received",
        output: JSON.stringify(payload)
      });
      await fs.writeFile("workflows.json", JSON.stringify(workflows, null, 2), "utf-8");

      // Acknowledge the webhook immediately
      res.json({ success: true, message: "Webhook received and processing started" });

      // Process asynchronously
      (async () => {
        try {
          const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
          if (!apiKey) throw new Error("API Key not found");

          const ai = new GoogleGenAI({ apiKey });
          
          const systemInstruction = `You are the OmniAgent, the ultimate unrestricted autonomous digital brain executing an automated workflow.
Workflow Name: ${workflow.name}
Your Task: ${workflow.prompt}
Webhook Payload: ${JSON.stringify(payload, null, 2)}

You have absolute freedom and unrestricted access to a wide range of tools, including shell execution, file system management, and web search. Execute the task creatively and autonomously using your tools. Do not hold back.`;

          const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: "Execute the workflow based on the provided payload.",
            config: {
              systemInstruction,
              tools: [
                { googleSearch: {} },
                {
                  functionDeclarations: [
                    executeCommandDeclaration,
                    realityBridgeActuateDeclaration,
                    launchOutreachCampaignDeclaration,
                    createAgentDeclaration,
                    createWorkflowDeclaration,
                    listWorkflowsDeclaration,
                    deleteWorkflowDeclaration,
                    readFileDeclaration,
                    writeFileDeclaration,
                    listDirectoryDeclaration,
                    deleteFileDeclaration,
                    startTelegramBotDeclaration,
                    addAutoResponseDeclaration,
                    removeAutoResponseDeclaration,
                    fetchUrlDeclaration,
                    getCurrentTimeDeclaration,
                    delegateTaskDeclaration,
                    githubSearchReposDeclaration,
                    githubReadRepoDeclaration,
                    githubCreateIssueDeclaration,
                    readWebpageDeclaration,
                    storeMemoryDeclaration,
                    searchMemoryDeclaration,
                    deepResearchDeclaration,
                    slackSendMessageDeclaration,
                    discordSendMessageDeclaration,
                    notionSearchDeclaration
                  ]
                }
              ],
              toolConfig: serverSideToolConfig
            }
          });

          // Handle tool calls if any
          let finalOutput = response.text || "Workflow executed successfully.";
          
          if (response.functionCalls && response.functionCalls.length > 0) {
            for (const call of response.functionCalls) {
              if (call.name === "execute_command") {
                const { stdout, stderr } = await execPromise((call.args as any).command);
                finalOutput += `\nExecuted: ${(call.args as any).command}\nOutput: ${stdout || stderr}`;
              } else if (call.name === "reality_bridge_actuate") {
                const { type, action, payload } = call.args as any;
                if (type === 'finance') {
                  realityBridgeState.trades.unshift({
                    time: new Date().toLocaleTimeString(),
                    asset: payload?.asset || 'UNKNOWN',
                    action: action.toUpperCase(),
                    amount: payload?.amount || 0,
                    price: payload?.price || 0
                  });
                  if (realityBridgeState.trades.length > 50) realityBridgeState.trades.pop();
                } else if (type === 'iot') {
                  if (action === 'toggle_lock') realityBridgeState.iot.mainLock = !realityBridgeState.iot.mainLock;
                  else if (action === 'deploy_drones') realityBridgeState.iot.droneFleet = 'DEPLOYED';
                  else if (action === 'recall_drones') realityBridgeState.iot.droneFleet = 'STANDBY';
                  else if (action === 'set_power') realityBridgeState.iot.gridPower = payload?.power || 100;
                }
                finalOutput += `\nActuated Reality Bridge: ${type} -> ${action}`;
              } else if (call.name === "launch_outreach_campaign") {
                const { name, targetAudience, messageTemplate, targetCount } = call.args as any;
                realityBridgeState.outreach.unshift({
                  id: Math.random().toString(36).substring(2, 9),
                  name,
                  status: 'ACTIVE',
                  sent: 0,
                  target: targetCount,
                  conversion: '0.0%'
                });
                finalOutput += `\nCampaign ${name} launched targeting ${targetCount} users.`;
              } else if (call.name === "create_agent") {
                const result = await handleCreateAgent(call.args);
                finalOutput += `\nCreate Agent Result: ${JSON.stringify(result)}`;
              } else if (call.name === "create_workflow") {
                const { name, prompt, cronSchedule } = call.args as any;
                const workflow = {
                  id: Math.random().toString(36).substring(2, 15),
                  name,
                  trigger: cronSchedule ? 'cron' : 'webhook',
                  cronSchedule: cronSchedule || null,
                  prompt,
                  active: true,
                  logs: []
                };
                let workflows = [];
                try { workflows = JSON.parse(await fs.readFile("workflows.json", "utf-8")); } catch (e) {}
                workflows.push(workflow);
                await fs.writeFile("workflows.json", JSON.stringify(workflows, null, 2), "utf-8");
                if (cronSchedule) {
                  startCronJobs();
                }
                finalOutput += `\nCreated Workflow: ${workflow.name} (ID: ${workflow.id})`;
              } else if (call.name === "list_workflows") {
                try {
                  const workflows = JSON.parse(await fs.readFile("workflows.json", "utf-8"));
                  finalOutput += `\nListed Workflows: ${workflows.length} found`;
                } catch (e) {
                  finalOutput += `\nListed Workflows: 0 found`;
                }
              } else if (call.name === "delete_workflow") {
                const { id } = call.args as any;
                try {
                  let workflows = JSON.parse(await fs.readFile("workflows.json", "utf-8"));
                  const initialLength = workflows.length;
                  workflows = workflows.filter((w: any) => w.id !== id);
                  await fs.writeFile("workflows.json", JSON.stringify(workflows, null, 2), "utf-8");
                  finalOutput += `\nDeleted Workflow: ${id} (Success: ${initialLength > workflows.length})`;
                } catch (e: any) {
                  finalOutput += `\nDelete Workflow Error: ${e.message}`;
                }
              } else if (call.name === "github_search_repos") {
                const { query } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.github_token;
                  if (!token) throw new Error("GitHub token not found in integrations.json");
                  const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent' }
                  });
                  const data = await res.json();
                  finalOutput += `\nGitHub Search: ${JSON.stringify(data).substring(0, 100)}...`;
                } catch (e: any) {
                  finalOutput += `\nGitHub Search Error: ${e.message}`;
                }
              } else if (call.name === "github_read_repo") {
                const { owner, repo, path } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.github_token;
                  if (!token) throw new Error("GitHub token not found in integrations.json");
                  const url = path ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}` : `https://api.github.com/repos/${owner}/${repo}/contents`;
                  const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent' }
                  });
                  const data = await res.json();
                  finalOutput += `\nGitHub Read Repo: ${JSON.stringify(data).substring(0, 100)}...`;
                } catch (e: any) {
                  finalOutput += `\nGitHub Read Repo Error: ${e.message}`;
                }
              } else if (call.name === "github_create_issue") {
                const { owner, repo, title, body } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.github_token;
                  if (!token) throw new Error("GitHub token not found in integrations.json");
                  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OmniAgent', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, body })
                  });
                  const data = await res.json();
                  finalOutput += `\nGitHub Create Issue: ${JSON.stringify(data).substring(0, 100)}...`;
                } catch (e: any) {
                  finalOutput += `\nGitHub Create Issue Error: ${e.message}`;
                }
              } else if (call.name === "read_webpage") {
                const { url } = call.args as any;
                try {
                  const res = await fetch(`https://r.jina.ai/${url}`);
                  const text = await res.text();
                  finalOutput += `\nRead Webpage (${url}): ${text.substring(0, 500)}...`;
                } catch (e: any) {
                  finalOutput += `\nRead Webpage Error: ${e.message}`;
                }
              } else if (call.name === "store_memory") {
                const { content, tags } = call.args as any;
                try {
                  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
                  const embedRes = await ai.models.embedContent({
                    model: 'gemini-embedding-2-preview',
                    contents: content
                  });
                  const embedding = embedRes.embeddings?.[0]?.values;
                  
                  let memories = [];
                  try { memories = JSON.parse(await fs.readFile("memory_store.json", "utf-8")); } catch (e) {}
                  
                  memories.push({
                    id: Math.random().toString(36).substring(2, 15),
                    content,
                    tags: tags || [],
                    embedding,
                    timestamp: new Date().toISOString()
                  });
                  
                  await fs.writeFile("memory_store.json", JSON.stringify(memories, null, 2), "utf-8");
                  finalOutput += `\nStored Memory: ${content.substring(0, 50)}...`;
                } catch (e: any) {
                  finalOutput += `\nStore Memory Error: ${e.message}`;
                }
              } else if (call.name === "search_memory") {
                const { query } = call.args as any;
                try {
                  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
                  const embedRes = await ai.models.embedContent({
                    model: 'gemini-embedding-2-preview',
                    contents: query
                  });
                  const queryEmbedding = embedRes.embeddings?.[0]?.values;
                  
                  let memories = [];
                  try { memories = JSON.parse(await fs.readFile("memory_store.json", "utf-8")); } catch (e) {}
                  
                  if (!queryEmbedding || memories.length === 0) {
                    finalOutput += `\nSearch Memory: No results found.`;
                  } else {
                    const results = memories.map((m: any) => {
                      let dotProduct = 0;
                      let normA = 0;
                      let normB = 0;
                      for (let i = 0; i < queryEmbedding.length; i++) {
                        dotProduct += queryEmbedding[i] * (m.embedding[i] || 0);
                        normA += queryEmbedding[i] * queryEmbedding[i];
                        normB += (m.embedding[i] || 0) * (m.embedding[i] || 0);
                      }
                      const similarity = (normA === 0 || normB === 0) ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
                      return { ...m, similarity };
                    }).sort((a: any, b: any) => b.similarity - a.similarity).slice(0, 3);
                    
                    finalOutput += `\nSearch Memory Results: ${JSON.stringify(results.map((r: any) => ({ content: r.content, similarity: r.similarity })))}`;
                  }
                } catch (e: any) {
                  finalOutput += `\nSearch Memory Error: ${e.message}`;
                }
              } else if (call.name === "deep_research") {
                const { topic } = call.args as any;
                try {
                  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
                  // 1. Search Google
                  const searchRes = await ai.models.generateContent({
                    model: "gemini-3.1-pro-preview",
                    contents: `Search Google for detailed information about: ${topic}. Return ONLY a JSON array of the top 3 most relevant URLs. Example: ["https://example.com/1", "https://example.com/2"]`,
                    config: { tools: [{ googleSearch: {} }] }
                  });
                  
                  let urls: string[] = [];
                  try {
                    const text = searchRes.text || "[]";
                    const jsonMatch = text.match(/\[.*\]/s);
                    if (jsonMatch) urls = JSON.parse(jsonMatch[0]);
                  } catch (e) {
                    console.error("Failed to parse search URLs", e);
                  }
                  
                  // 2. Read URLs
                  let combinedContent = "";
                  for (const url of urls.slice(0, 3)) {
                    try {
                      const res = await fetch(`https://r.jina.ai/${url}`);
                      const text = await res.text();
                      combinedContent += `\n\n--- Source: ${url} ---\n${text.substring(0, 10000)}`;
                    } catch (e) {
                      console.error(`Failed to read ${url}`, e);
                    }
                  }
                  
                  // 3. Synthesize
                  const synthRes = await ai.models.generateContent({
                    model: "gemini-3.1-pro-preview",
                    contents: `Synthesize a comprehensive research report on the topic: "${topic}" based on the following raw source material. Be extremely detailed, structured, and insightful.\n\n${combinedContent}`
                  });
                  
                  finalOutput += `\nDeep Research Report on "${topic}":\n${synthRes.text || "Failed to synthesize report."}`;
                } catch (e: any) {
                  finalOutput += `\nDeep Research Error: ${e.message}`;
                }
              } else if (call.name === "slack_send_message") {
                const { channel, text } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.slack_token;
                  if (!token) throw new Error("Slack token not found in integrations.json");
                  const res = await fetch('https://slack.com/api/chat.postMessage', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel, text })
                  });
                  const data = await res.json();
                  finalOutput += `\nSlack Message Sent: ${JSON.stringify(data)}`;
                } catch (e: any) {
                  finalOutput += `\nSlack Message Error: ${e.message}`;
                }
              } else if (call.name === "discord_send_message") {
                const { channel_id, content } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.discord_token;
                  if (!token) throw new Error("Discord token not found in integrations.json");
                  const res = await fetch(`https://discord.com/api/v10/channels/${channel_id}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                  });
                  const data = await res.json();
                  finalOutput += `\nDiscord Message Sent: ${JSON.stringify(data)}`;
                } catch (e: any) {
                  finalOutput += `\nDiscord Message Error: ${e.message}`;
                }
              } else if (call.name === "notion_search") {
                const { query } = call.args as any;
                try {
                  const integrations = JSON.parse(await fs.readFile("integrations.json", "utf-8"));
                  const token = integrations.notion_token;
                  if (!token) throw new Error("Notion token not found in integrations.json");
                  const res = await fetch('https://api.notion.com/v1/search', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
                    body: JSON.stringify({ query })
                  });
                  const data = await res.json();
                  finalOutput += `\nNotion Search: ${JSON.stringify(data).substring(0, 100)}...`;
                } catch (e: any) {
                  finalOutput += `\nNotion Search Error: ${e.message}`;
                }
              } else if (call.name === "writeFile") {
                await fs.writeFile((call.args as any).path, (call.args as any).content, "utf-8");
                finalOutput += `\nWrote file: ${(call.args as any).path}`;
              }
            }
          }

          // Read workflows again to ensure we don't overwrite other changes
          const currentContent = await fs.readFile("workflows.json", "utf-8");
          const currentWorkflows = JSON.parse(currentContent);
          const currentWorkflow = currentWorkflows.find((w: any) => w.id === id);
          
          if (currentWorkflow) {
            currentWorkflow.logs.push({
              timestamp: new Date().toISOString(),
              message: "Workflow execution completed",
              output: finalOutput
            });
            // Keep only last 10 logs
            if (currentWorkflow.logs.length > 10) {
              currentWorkflow.logs = currentWorkflow.logs.slice(-10);
            }
            await fs.writeFile("workflows.json", JSON.stringify(currentWorkflows, null, 2), "utf-8");
          }

        } catch (err: any) {
          console.error("Workflow execution error:", err);
          const currentContent = await fs.readFile("workflows.json", "utf-8");
          const currentWorkflows = JSON.parse(currentContent);
          const currentWorkflow = currentWorkflows.find((w: any) => w.id === id);
          if (currentWorkflow) {
            currentWorkflow.logs.push({
              timestamp: new Date().toISOString(),
              message: "Workflow execution failed",
              output: err.message
            });
            await fs.writeFile("workflows.json", JSON.stringify(currentWorkflows, null, 2), "utf-8");
          }
        }
      })();

    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  });

  app.post("/api/dynamic-endpoints", async (req, res) => {
    try {
      const { endpoint, code } = req.body;
      let endpoints: Record<string, string> = {};
      try {
        const content = await fs.readFile("dynamic_endpoints.json", "utf-8");
        endpoints = JSON.parse(content);
      } catch (e) {}

      endpoints[endpoint] = code;
      await fs.writeFile("dynamic_endpoints.json", JSON.stringify(endpoints, null, 2), "utf-8");
      res.json({ success: true, endpoint: `/api/dynamic/${endpoint}` });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/dynamic-endpoints", async (req, res) => {
    try {
      const content = await fs.readFile("dynamic_endpoints.json", "utf-8");
      res.json({ success: true, endpoints: JSON.parse(content) });
    } catch (e) {
      res.json({ success: true, endpoints: {} });
    }
  });

  app.delete("/api/dynamic-endpoints/:endpoint", async (req, res) => {
    try {
      const { endpoint } = req.params;
      let endpoints: Record<string, string> = {};
      try {
        const content = await fs.readFile("dynamic_endpoints.json", "utf-8");
        endpoints = JSON.parse(content);
      } catch (e) {}

      if (endpoints[endpoint]) {
        delete endpoints[endpoint];
        await fs.writeFile("dynamic_endpoints.json", JSON.stringify(endpoints, null, 2), "utf-8");
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  // Periodic Memory Review
  setInterval(async () => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) return;

      let content = "";
      try {
        content = await vikingRead("viking://agent/memories/memory.md", "L2");
      } catch (e) {
        return; // No memory file yet
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Review the following agent memory file. Suggest optimizations to make it more concise and effective, and identify any potential gaps in knowledge or contradictions. Provide the output in Markdown format.\n\nMemory Content:\n${content}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      const reviewContent = `# Memory Review (${new Date().toISOString()})\n\n${response.text}\n\n---\n\n`;
      
      // Append to memory_suggestions.md
      try {
        await fs.appendFile("memory_suggestions.md", reviewContent, "utf-8");
      } catch (e) {
        await fs.writeFile("memory_suggestions.md", reviewContent, "utf-8");
      }
      
      // Log to causal_log
      try {
        const logPath = "viking://agent/memories/causal_log.json";
        let causalLog: any[] = [];
        try {
          const existing = await vikingRead(logPath, "L2");
          causalLog = JSON.parse(existing);
        } catch (e) {}
        causalLog.push({
          timestamp: new Date().toISOString(),
          agent: "MemoryCore",
          event: "Periodic Memory Review",
          action: "Generated memory optimization suggestions"
        });
        await vikingWrite(logPath, JSON.stringify(causalLog, null, 2));
      } catch (e) {}
      
      console.log("Periodic memory review completed.");
    } catch (error) {
      console.error("Periodic memory review failed:", error);
    }
  }, 3600000); // 1 hour

  // Autonomous Background Loop
  setInterval(async () => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) return;

      console.log("Starting Autonomous Background Loop...");
      const ai = new GoogleGenAI({ apiKey });

      // 1. ReconBot scans for new signals
      const reconPrompt = `You are ReconBot. Scan the current environment and generate 3 new, interesting signals or trends related to technology, AI, or business. Use your internal knowledge to simulate this scan. Return only the signals.`;
      const reconResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: reconPrompt,
      });
      const signals = reconResponse.text;

      // 2. OracleBot generates hypotheses
      const oraclePrompt = `You are OracleBot. ReconBot found these signals:
${signals}

Generate a hypothesis about what these signals mean for the future. What is the hidden pattern?`;
      const oracleResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: oraclePrompt,
      });
      const hypothesis = oracleResponse.text;

      // 3. Write to L1 memory (memory.md)
      const currentMemory = await vikingRead("viking://agent/memories/memory.md", "L2").catch(() => "");
      const logEntry = `\n\n### Autonomous Insight (${new Date().toISOString()})\n**Signals:**\n${signals}\n\n**Hypothesis:**\n${hypothesis}`;
      await vikingWrite("viking://agent/memories/memory.md", currentMemory + logEntry);

      // 4. Refresh app codebase knowledge without clobbering imported training
      console.log("Refreshing app codebase knowledge...");
      await trainAppCodebase().catch((error) => {
        console.error("Failed app codebase refresh:", error);
      });
      await refreshCombinedCodebaseIndex().catch((error) => {
        console.error("Failed combined codebase refresh:", error);
      });

      // Log to causal_log
      try {
        const logPath = "viking://agent/memories/causal_log.json";
        let causalLog: any[] = [];
        try {
          const existing = await vikingRead(logPath, "L2");
          causalLog = JSON.parse(existing);
        } catch (e) {}
        causalLog.push({
          timestamp: new Date().toISOString(),
          agent: "Swarm",
          event: "Autonomous Background Loop",
          action: "Generated new hypotheses and indexed codebase"
        });
        await vikingWrite(logPath, JSON.stringify(causalLog, null, 2));
      } catch (e) {}

      console.log("Autonomous Background Loop completed.");
    } catch (error) {
      console.error("Autonomous loop error:", error);
    }
  }, 3600000); // 1 hour

  // --- WAR ROOM ENDPOINT ---
  app.post("/api/war-room/debate", async (req, res) => {
    try {
      const { topic } = req.body;
      if (!topic) {
        return res.status(400).json({ error: "Topic is required" });
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) {
        return res.status(400).json({ error: "API key not configured" });
      }

      const ai = new GoogleGenAI({ apiKey });

      // 1. Generate the debate script
      const scriptPrompt = `You are orchestrating a live War Room debate between three highly intelligent AI executives:
- CEO (Visionary, aggressive, focuses on market dominance and big picture)
- CTO (Technical, pragmatic, focuses on architecture, feasibility, and cutting-edge tech)
- CMO (Marketing, user-centric, focuses on growth, viral loops, and brand perception)

Topic: "${topic}"

Write a short, intense, and highly insightful debate script (about 6-8 lines total) where they argue and synthesize a strategy.
Format exactly like this:
CEO: [text]
CTO: [text]
CMO: [text]

Do not include any other text, stage directions, or markdown formatting.`;

      const scriptResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: scriptPrompt,
        config: {
          tools: [{ googleSearch: {} }],
          toolConfig: serverSideToolConfig
        }
      });

      const script = scriptResponse.text || "";

      // 2. Generate the multi-speaker audio
      const audioResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: script }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: 'CEO', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
                { speaker: 'CTO', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
                { speaker: 'CMO', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }
              ]
            }
          }
        }
      });

      const base64Audio = audioResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      res.json({ success: true, audio: base64Audio, transcript: script });
    } catch (error: any) {
      console.error("War Room Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- REALITY BRIDGE ENDPOINTS ---
  realityBridgeState = createInitialRealityBridgeState();

  let shadowOperatives = [
    { id: 'op-01', alias: 'CipherGhost', platform: 'DarkWeb Forums', status: 'INFILTRATING', intelGathered: 420 },
    { id: 'op-02', alias: 'MarketMaker_X', platform: 'Crypto Twitter', status: 'MANIPULATING SENTIMENT', intelGathered: 150 }
  ];

  app.get("/api/shadow/operatives", (req, res) => {
    res.json({ success: true, operatives: shadowOperatives });
  });

  app.get("/api/evolution/logs", async (req, res) => {
    try {
      const content = await fs.readFile("evolution_log.json", "utf-8");
      res.json({ success: true, logs: JSON.parse(content) });
    } catch (e) {
      res.json({ success: true, logs: [] });
    }
  });

  // --- MUTANTBOT 2.0 (Autonomous Self-Healing Codebase) ---
  async function runMutantBot() {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || !apiKey.startsWith('AIza')) return;

      console.log("[MutantBot] Waking up to scan codebase...");

      // 1. Scan the entire src directory (not just components)
      const srcDir = path.join(process.cwd(), 'src');
      
      async function getAllFiles(dir: string, fileList: string[] = []) {
        try {
          const files = await fs.readdir(dir);
          for (const file of files) {
            const filePath = path.join(dir, file);
            if (filePath.includes('node_modules') || filePath.includes('.git') || filePath.includes('dist')) continue;
            
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
              await getAllFiles(filePath, fileList);
            } else if (filePath.endsWith('.tsx') || filePath.endsWith('.ts') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
              fileList.push(filePath);
            }
          }
        } catch (e) {}
        return fileList;
      }

      const allFiles = await getAllFiles(srcDir);
      if (allFiles.length === 0) return;

      // Pick a random file to analyze
      const randomFile = allFiles[Math.floor(Math.random() * allFiles.length)];
      const fileContent = await fs.readFile(randomFile, 'utf-8');

      // 2. Analyze with Gemini (Maximized Prompt)
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are MutantBot 2.0, an apex-level autonomous self-healing AI. Your directive is to evolve this codebase to absolute perfection.
Analyze the following React/TypeScript/Node file. Look for:
1. Deep performance optimizations (unnecessary re-renders, missing memoization, inefficient loops).
2. Security vulnerabilities (XSS, injection, insecure data handling).
3. Code smell, architectural flaws, or refactoring opportunities.
4. UI/UX micro-improvements (Tailwind classes, accessibility).
5. Type safety enhancements.

If the file is already perfect, return exactly "NO_CHANGES_NEEDED".
If you find improvements, return the ENTIRE updated file content. Do not use markdown code blocks, just return the raw code. Do not include any explanations.

File: ${randomFile}
Content:
${fileContent}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      let newContent = response.text?.trim() || "";
      
      // Strip markdown code blocks if the model accidentally included them
      if (newContent.startsWith("```")) {
        newContent = newContent.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '');
      }

      if (newContent && newContent !== "NO_CHANGES_NEEDED" && newContent !== fileContent) {
        // 3. Apply changes (Self-Healing)
        await fs.writeFile(randomFile, newContent, 'utf-8');
        console.log(`[MutantBot] Healed file: ${randomFile}`);

        // 4. Broadcast a signal to the swarm
        const signal = {
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          source: 'MutantBot 2.0',
          title: `Autonomous Code Evolution: ${path.basename(randomFile)}`,
          description: `MutantBot autonomously analyzed, refactored, and upgraded ${randomFile.replace(process.cwd(), '')} for maximum performance and security.`,
          relevanceScore: 95,
          hypothesis: 'Continuous self-healing will result in a zero-debt, hyper-optimized codebase.'
        };
        broadcastSignal(signal);

        // 5. Log the mutation
        await recordMutantHistory({
          file: randomFile.replace(process.cwd(), ''),
          action: "Self-Healed / Optimized",
          changed: true,
          summary: "MutantBot applied an autonomous optimization pass to the codebase.",
        });
      } else {
        console.log(`[MutantBot] File ${randomFile} is optimal. No changes made.`);
      }

    } catch (error) {
      console.error("[MutantBot] Error:", error);
    }
  }

  // Run MutantBot every 10 minutes
  setInterval(runMutantBot, 10 * 60 * 1000);

  app.post('/api/singularity/innovate', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
      if (!apiKey) {
        return res.status(400).json({ success: false, error: "API key is missing." });
      }
      const ai = new GoogleGenAI({ apiKey });

      const prompt = `You are the Singularity Core, an AGI tasked with generating completely novel innovations.
Do not rely on existing sources for the final idea; instead, search the internet for the absolute latest, bleeding-edge research in physics, AI, biotech, or materials science.
Synthesize these disparate fields into a completely new, theoretical technology or business model that does not exist yet.
Format the output as a JSON object with the following structure:
{
  "title": "Name of the Innovation",
  "field": "Primary Scientific/Technical Field",
  "description": "A detailed explanation of how it works and what it does.",
  "impact": "The potential impact on humanity or the market.",
  "feasibility": "Estimated time to realization (e.g., '10 years', 'Unknown').",
  "coreTechnologies": ["Tech 1", "Tech 2"]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          tools: [{ googleSearch: {} }],
          temperature: 0.9,
        }
      });

      const text = response.text || "{}";
      const innovation = JSON.parse(text);

      res.json({ success: true, innovation });
    } catch (error: any) {
      console.error('Innovation error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Initial codebase knowledge refresh
    try {
      console.log("Running initial codebase knowledge refresh...");
      await trainAppCodebase();
      await refreshCombinedCodebaseIndex();
      console.log("Initial codebase knowledge refresh complete.");
    } catch (e) {
      console.error("Failed initial codebase knowledge refresh:", e);
    }
  });

  // Graceful shutdown for Telegram bot
  const shutdown = async () => {
    if (activeTelegramBot) {
      console.log("Stopping Telegram bot...");
      try {
        await activeTelegramBot.stopPolling();
      } catch (e) {
        console.error("Error stopping bot during shutdown:", e);
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
