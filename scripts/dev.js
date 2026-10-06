import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendPath = path.join(rootPath, "backend");

function resolveBin(packageName, binName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const binPath = typeof packageJson.bin === "string"
    ? packageJson.bin
    : packageJson.bin?.[binName];

  if (!binPath) {
    throw new Error(`Could not find the ${binName} executable for ${packageName}.`);
  }

  return path.resolve(path.dirname(packageJsonPath), binPath);
}

const children = [
  {
    name: "frontend",
    cwd: rootPath,
    args: [resolveBin("vite", "vite")],
  },
  {
    name: "backend",
    cwd: backendPath,
    args: [resolveBin("tsx", "tsx"), "watch", "src/server.ts"],
  },
].map(({ name, cwd, args }) => {
  const child = spawn(process.execPath, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`${name} process failed to start:`, error);
    stop(1);
  });

  child.on("exit", (code, signal) => {
    if (!stopping) {
      const exitCode = code ?? 1;
      if (signal) {
        console.error(`${name} process exited after ${signal}.`);
      } else if (exitCode !== 0) {
        console.error(`${name} process exited with code ${exitCode}.`);
      }
      stop(exitCode);
    }
  });

  return child;
});

let stopping = false;

function stop(exitCode) {
  if (stopping) {
    return;
  }

  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
