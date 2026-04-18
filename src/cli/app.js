#!/usr/bin/env node
import path from "node:path";

import { runSetup } from "./setup.js";
import { runVerify } from "./verify.js";
import { runAdmin } from "./admin.js";
import { promptInput, readJsonFile, withPrompts } from "../lib/common.js";

function printHeader() {
  console.log("telegram-tempmail-bot");
  console.log("Interactive npm app for setup and verification");
  console.log("");
}

function printSavedState(cwd) {
  const state = readJsonFile(path.resolve(cwd, ".tempmail/setup-state.json"), null);
  if (!state) {
    console.log("No local setup state found.");
    return;
  }
  console.log("Saved state");
  console.log(`Domain: ${state.domain}`);
  console.log(`Script: ${state.scriptName}`);
  console.log(`Worker URL: ${state.workerUrlBase}`);
  console.log(`Bot username: ${state.botUsername}`);
}

async function runMenu() {
  const cwd = process.cwd();
  while (true) {
    printHeader();
    console.log("1. Setup");
    console.log("2. Verify");
    console.log("3. Reset owner");
    console.log("4. Rotate secret");
    console.log("5. Show saved state");
    console.log("6. Exit");
    console.log("");
    const choice = await withPrompts((rl) => promptInput(rl, "Choose action", "1"));
    console.log("");
    if (choice === "1") {
      await runSetup({});
    } else if (choice === "2") {
      await runVerify({});
    } else if (choice === "3") {
      await runAdmin({ action: "reset-owner" });
    } else if (choice === "4") {
      await runAdmin({ action: "rotate-secret" });
    } else if (choice === "5") {
      printSavedState(cwd);
    } else if (choice === "6") {
      console.log("Bye.");
      return;
    } else {
      console.log("Unknown choice.");
    }
    console.log("");
    await withPrompts((rl) => promptInput(rl, "Press enter to continue", ""));
    console.log("");
  }
}

runMenu().catch((error) => {
  console.error(`[app] failed: ${error.message}`);
  process.exitCode = 1;
});
