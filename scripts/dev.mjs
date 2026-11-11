// Starts the local development servers (AGENTS.md 「ローカルでの開発サーバー」).
//
// For now only the screen (vite) exists. The API (wrangler dev) and the
// kan-game.app ID platform (kan/game's wrangler dev) join here when the
// online features are built, following TAKO-SEN's scripts/dev.mjs.
//
// Under `roji run`, vite listens on the port roji chose. Without roji it keeps
// 5173 and fails if that is taken: the API will accept only the origins it
// knows, so a moved port would not work.
import { spawn } from "node:child_process";

const rojiUrl = process.env.ROJI_URL;
const screenPort = (rojiUrl && process.env.PORT) || "5173";

// npm puts .cmd shims on the PATH on Windows; those need a shell.
const shell = process.platform === "win32";

const children = [
  spawn("vite", ["--port", screenPort, "--strictPort"], {
    stdio: "inherit",
    shell,
  }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  // A server that ignores SIGTERM must not keep its port.
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 5000).unref();
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    stop(1);
  });
  // No server alone is a working app.
  child.once("exit", (code) => stop(code ?? 1));
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));
