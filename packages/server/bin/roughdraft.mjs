#!/usr/bin/env node

import { runCli } from "../dist/cli.js";

const args = process.argv.slice(2);

function isPathLikeInput(value) {
  return (
    typeof value === "string" &&
    (value.toLowerCase().endsWith(".md") ||
      value.startsWith(".") ||
      value.startsWith("/") ||
      value.startsWith("~") ||
      /^[a-zA-Z]:[\\/]/.test(value) ||
      value.includes("/") ||
      value.includes("\\"))
  );
}

function managedOpenRequested(argv) {
  if (process.env.IQ_QUICK_NOTES_MANAGED !== "1") return false;

  const command = argv.find(
    (value) => !["--json", "--no-color", "-h", "--help"].includes(value),
  );

  return command === "open" || isPathLikeInput(command);
}

async function resetManagedServerBeforeOpen() {
  await runCli(["--json", "stop", "--all"], {
    log: () => {},
    error: () => {},
  });
}

if (managedOpenRequested(args)) {
  await resetManagedServerBeforeOpen();
}

const exitCode = await runCli(args);
process.exit(exitCode);
