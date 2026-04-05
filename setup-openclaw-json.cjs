const fs = require('fs');
const path = require('path');
const os = require('os');

const openclawDir = path.join(os.homedir(), '.openclaw');
const openclawJsonPath = path.join(openclawDir, 'openclaw.json');

const config = {
  "agents": {
    "defaults": {
      "model": "google/gemini-3.1-pro-preview"
    }
  },
  "models": {
    "providers": {
      "google": {
        "apiKey": process.env.GEMINI_API_KEY || "",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "models": [
          { "id": "gemini-3.1-pro-preview", "name": "Gemini 3.1 Pro Preview" },
          { "id": "gemini-3.1-flash-preview", "name": "Gemini 3.1 Flash Preview" }
        ]
      }
    }
  }
};

fs.writeFileSync(openclawJsonPath, JSON.stringify(config, null, 2));
console.log("Wrote openclaw.json");
