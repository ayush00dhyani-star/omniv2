const fs = require('fs');
const path = require('path');

const agentDir = '/root/.openclaw/agents/main/agent';
fs.mkdirSync(agentDir, { recursive: true });

const authProfiles = {
  "google": {
    "apiKey": process.env.GEMINI_API_KEY || "dummy"
  }
};

fs.writeFileSync(path.join(agentDir, 'auth-profiles.json'), JSON.stringify(authProfiles, null, 2));

const agentConfig = {
  "model": "gemini-3.1-pro-preview",
  "provider": "google"
};

fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify(agentConfig, null, 2));

console.log("Created OpenClaw agent config manually.");
