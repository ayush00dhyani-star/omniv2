import { execSync } from "child_process";
try {
  execSync("killall node");
} catch (e) {
  console.log("killall failed", e.message);
}
