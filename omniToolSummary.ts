function clipText(text: string, maxChars = 64): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function getPathArg(args: any): string {
  return (
    args?.path ||
    args?.file_path ||
    args?.url ||
    args?.name ||
    args?.id ||
    "target"
  );
}

function humanizeToolName(name: string): string {
  return name
    .replace(/^plugin_/, "plugin ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

export function summarizeToolExecution(
  call: { name: string; args?: any },
  result: any,
  plugins: any[] = [],
): string {
  if (call.name.startsWith("plugin_")) {
    const pluginId = call.name.replace("plugin_", "");
    const plugin = plugins.find((entry: any) => entry.id === pluginId);
    return plugin ? `Ran plugin: ${plugin.name}` : "Ran plugin";
  }

  switch (call.name) {
    case "execute_command":
      return `Ran command: ${clipText(call.args?.command || "shell command")}`;
    case "read_file":
    case "readFile":
      return `Read ${clipText(getPathArg(call.args))}`;
    case "write_file":
    case "writeFile":
      return `Wrote ${clipText(getPathArg(call.args))}`;
    case "list_directory":
    case "listDirectory":
      return `Listed ${clipText(getPathArg(call.args))}`;
    case "delete_file":
    case "deleteFile":
      return `Deleted ${clipText(getPathArg(call.args))}`;
    case "fetch_url":
      return `Fetched ${clipText(getPathArg(call.args))}`;
    case "read_webpage":
      return `Read webpage: ${clipText(getPathArg(call.args))}`;
    case "search_memory":
      return `Searched memory for ${clipText(call.args?.query || "context")}`;
    case "store_memory":
      return `Stored memory entry`;
    case "deep_research":
      return `Ran deep research on ${clipText(call.args?.query || "topic")}`;
    case "github_search_repos":
      return `Searched GitHub for ${clipText(call.args?.query || "repositories")}`;
    case "github_read_repo":
      return `Read GitHub repo ${clipText(call.args?.repo || call.args?.full_name || "repository")}`;
    case "github_create_issue":
      return `Created GitHub issue in ${clipText(call.args?.repo || "repository")}`;
    case "delegate_task":
      return `Delegated to ${clipText(call.args?.agentType || call.args?.agentId || "agent")}`;
    case "create_workflow":
      return `Created workflow: ${clipText(call.args?.name || "workflow")}`;
    case "list_workflows":
      return `Listed workflows`;
    case "delete_workflow":
      return `Deleted workflow ${clipText(call.args?.id || "workflow")}`;
    case "create_agent":
      return `Created agent: ${clipText(call.args?.name || call.args?.id || "agent")}`;
    case "launch_outreach_campaign":
      return `Launched campaign: ${clipText(call.args?.name || "campaign")}`;
    case "slack_send_message":
      return `Sent Slack message to ${clipText(call.args?.channel || "channel")}`;
    case "discord_send_message":
      return `Sent Discord message to ${clipText(call.args?.channel_id || "channel")}`;
    case "notion_search":
      return `Searched Notion for ${clipText(call.args?.query || "query")}`;
    case "viking_ls":
      return `Listed Viking path ${clipText(call.args?.path || "viking://")}`;
    case "viking_read":
      return `Read Viking path ${clipText(call.args?.path || "viking://")}`;
    case "viking_write":
      return `Wrote Viking path ${clipText(call.args?.path || "viking://")}`;
    case "viking_search":
      return `Searched Viking for ${clipText(call.args?.query || "query")}`;
    case "viking_mkdir":
      return `Created Viking directory ${clipText(call.args?.path || "viking://")}`;
    case "viking_rm":
      return `Removed Viking path ${clipText(call.args?.path || "viking://")}`;
    case "viking_tree":
      return `Mapped Viking tree ${clipText(call.args?.path || "viking://")}`;
    case "viking_intelligence":
      return `Synthesized Viking intelligence`;
    case "reality_bridge_actuate":
      return `Actuated Reality Bridge: ${clipText(call.args?.type || "system")} / ${clipText(call.args?.action || "action")}`;
    case "start_telegram_bot":
      return result?.success === false ? "Telegram bot failed" : "Started Telegram bot";
    case "add_auto_response":
      return `Added auto response for ${clipText(call.args?.keyword || "keyword")}`;
    case "remove_auto_response":
      return `Removed auto response for ${clipText(call.args?.keyword || "keyword")}`;
    case "get_current_time":
      return `Looked up current time`;
    default:
      return `Finished ${humanizeToolName(call.name)}`;
  }
}
