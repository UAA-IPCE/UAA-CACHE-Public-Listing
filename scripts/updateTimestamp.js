import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function updateTimestamp() {
  const readmePath = resolve(ROOT, "README.md");
  if (!existsSync(readmePath)) {
    console.error("README.md not found");
    return;
  }

  let text = readFileSync(readmePath, "utf-8");
  
  const timestampStr = new Date().toLocaleString("en-US", { 
    timeZone: "America/Anchorage",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });

  const updateHeader = `\n> **Last Updated:** ${timestampStr} (Hourly Sync)\n`;
  
  const lines = text.split("\n");
  
  // Check if we already have a "Last Updated" line at index 1 or 2
  let found = false;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].includes("**Last Updated:**")) {
      lines[i] = `> **Last Updated:** ${timestampStr} (Hourly Sync)`;
      found = true;
      break;
    }
  }

  if (!found) {
    if (lines[0].startsWith("#")) {
      lines.splice(1, 0, updateHeader);
    } else {
      lines.unshift(updateHeader);
    }
  }

  writeFileSync(readmePath, lines.join("\n"), "utf-8");
  console.log(`✅ README.md updated with timestamp: ${timestampStr}`);
}

updateTimestamp();
