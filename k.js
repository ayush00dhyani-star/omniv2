import fs from "fs";
const pids = fs.readdirSync("/proc").filter(f => !isNaN(f));
for (const pid of pids) {
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    if (cmd.includes("openclaw")) {
      console.log("Killing", pid);
      process.kill(parseInt(pid), 9);
    }
  } catch (e) {}
}
