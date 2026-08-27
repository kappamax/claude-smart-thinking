import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode-ai/plugin"

const require = createRequire(import.meta.url)
const { createOpenCodePlugin } = require("../lib/opencode.js")
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export const SmartThinkingPlugin = createOpenCodePlugin({ root }) satisfies Plugin
