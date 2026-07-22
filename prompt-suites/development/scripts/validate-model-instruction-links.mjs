#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const suiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codexHome = resolve(suiteRoot, "..", "..");
const rootPromptPath = resolve(suiteRoot, "AGENTS.md");
const rootProfilePath = resolve(codexHome, "development.config.toml");
const rootProfileHeader = `# Shared development profile. Use it with \`codex -p development\` in the CLI.\n# Architect is loaded from its canonical Markdown source as the model instruction set.\n# The desktop app uses the same setting from ~/.codex/config.toml.\nmodel_instructions_file = "~/.codex/prompt-suites/development/AGENTS.md"\n`;
const roles = ["Coder", "Lite", "Reviewer", "Rescue"];
const issues = [];

function report(path, message) {
  issues.push(`${path}: ${message}`);
}

async function readText(path, description) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    report(path, `cannot read ${description} (${error.code ?? error.message})`);
    return undefined;
  }
}

function validateRootProfile(profile) {
  if (!profile.startsWith(rootProfileHeader)) {
    report(rootProfilePath, "fixed development profile header or Architect model_instructions_file does not match");
  }

  const expected = "model_instructions_file = \"~/.codex/prompt-suites/development/AGENTS.md\"";
  const instructionLines = profile
    .split("\n")
    .filter((line) => /^\s*model_instructions_file\s*=/.test(line));
  if (instructionLines.length !== 1 || instructionLines[0] !== expected) {
    report(rootProfilePath, `must contain exactly: ${expected}`);
  }

  if (!/^\[agents\]$/m.test(profile)) {
    report(rootProfilePath, "missing [agents] section");
  }
}

function validateRoleConfig(role, configPath, config) {
  if (config.includes("developer_instructions")) {
    report(configPath, "must not contain developer_instructions");
  }

  const expected = `model_instructions_file = "~/.codex/prompt-suites/development/agents/${role}.md"`;
  const lines = config.split("\n");
  const instructionLines = lines.filter((line) => /^\s*model_instructions_file\s*=/.test(line));

  if (instructionLines.length !== 1 || instructionLines[0] !== expected) {
    report(configPath, `must contain exactly: ${expected}`);
  }
}

if (process.argv.length !== 2) {
  console.error("Usage: validate-model-instruction-links.mjs");
  process.exitCode = 2;
} else {
  const rootPrompt = await readText(rootPromptPath, "Architect model instructions");
  if (rootPrompt !== undefined && rootPrompt.trim().length === 0) {
    report(rootPromptPath, "Architect model instructions are empty");
  }

  const rootProfile = await readText(rootProfilePath, "development profile");
  if (rootProfile !== undefined) {
    validateRootProfile(rootProfile);
  }

  for (const role of roles) {
    const markdownPath = resolve(suiteRoot, "agents", `${role}.md`);
    const configPath = resolve(suiteRoot, "agents", `${role}.toml`);
    const [markdown, config] = await Promise.all([
      readText(markdownPath, `${role} model instructions`),
      readText(configPath, `${role} agent configuration`),
    ]);

    if (markdown !== undefined && markdown.trim().length === 0) {
      report(markdownPath, `${role} model instructions are empty`);
    }
    if (config !== undefined) {
      validateRoleConfig(role, configPath, config);
    }
  }

  if (issues.length > 0) {
    console.error(`Model instruction link validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    process.exitCode = 1;
  }
}
