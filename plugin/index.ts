/**
 * Forge for OpenCode.
 *
 * Three Claude Code hooks become native OpenCode behaviour:
 *
 *   Stop        -> a `session.idle` subscriber that runs the gate and, when the loop is not done,
 *                  sends the gate's reason back into the same session as a new prompt.
 *   PreToolUse  -> a `tool.execute.before` hook that refuses hand-edits to the loop's own state.
 *   SessionStart-> a `shell.create.before` hook that puts project-local verification tools on PATH.
 *
 * The gate itself is still plain Node code (`scripts/gate.mjs --json`), so the loop state has one
 * writer and the same fail-open behaviour as the original plugin. Nothing here trusts an LLM.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// The installer rewrites this literal to the absolute install directory. When the plugin is
// loaded straight from a source checkout it falls back to the repository root.
const BAKED_ROOT = "__FORGE_ROOT__"
const ROOT = BAKED_ROOT.startsWith("__") ? path.resolve(import.meta.dir, "..") : BAKED_ROOT

const STATE = (project: string) => path.join(project, ".forge", "state.json")
const LOG = (project: string) => path.join(project, ".forge", "plugin-errors.log")

const PROTECTED =
  /^(state\.json|checks-\d+\.json|verdict-\d+-(supervisor|critic)\.json|signoff-\d+\.json|scope-\d+\.json|approvals\.json|tools\.json)$/

const WRITEISH =
  /(>|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b|\btruncate\b|\bperl\s+-i|\bdd\b|Out-File|Set-Content|Add-Content|writeFile|open\([^)]*['"]w)/
const PROTECTED_NAMES = /\.forge[\\/]+(state\.json|checks-|verdict-|signoff-|scope-|approvals\.json|tools\.json)/

const GUARD_MESSAGE =
  "forge: .forge/state.json, checks-*, verdict-*, signoff-*, scope-*, approvals.json and tools.json " +
  "are written only by the forge CLI. Use the forge CLI instead of editing them directly."

function isProtectedPath(project: string, file: string): boolean {
  if (!file) return false
  const abs = path.resolve(project, file)
  const dir = path.join(project, ".forge")
  const rel = path.relative(dir, abs)
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false
  return PROTECTED.test(rel.replace(/\\/g, "/"))
}

function bashTouchesProtected(command: string): boolean {
  if (!PROTECTED_NAMES.test(command)) return false
  if (/forge\.mjs["']?\s+(verdict|signoff|checks|tool|start|plan-set|init|abort|tweak)\b/.test(command)) return false
  return WRITEISH.test(command)
}

function readState(project: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(STATE(project), "utf8"))
  } catch {
    return null
  }
}

function logError(project: string, error: unknown) {
  try {
    fs.mkdirSync(path.dirname(LOG(project)), { recursive: true })
    fs.appendFileSync(LOG(project), `${new Date().toISOString()} ${(error as any)?.stack || error}\n`)
  } catch {
    /* fail open */
  }
}

function runGate(project: string, sessionID: string): Promise<{ allow: boolean; reason?: string } | null> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.env.FORGE_NODE || "node", [path.join(ROOT, "scripts", "gate.mjs"), "--json"], {
        cwd: project,
        env: { ...process.env, FORGE_PROJECT_DIR: project },
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch (error) {
      logError(project, error)
      return resolve(null)
    }

    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill()
      logError(project, "gate timed out after 20s")
      resolve(null)
    }, 20_000)

    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", (error) => {
      clearTimeout(timer)
      logError(project, error)
      resolve(null)
    })
    child.on("close", () => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(stdout))
      } catch {
        if (stderr.trim()) logError(project, stderr.trim())
        resolve(null)
      }
    })
    child.stdin.end(JSON.stringify({ cwd: project, session_id: sessionID }))
  })
}

/** Put the loop's project-local tools on PATH for every shell command, like the old SessionStart hook. */
function extendPath(project: string, env: Record<string, string | undefined>) {
  const base = process.env.FORGE_TOOLS_DIR || path.join(os.homedir(), ".forge", "tools")
  const dirs = [path.join(base, "bin"), path.join(base, "venv", "bin"), path.join(base, "venv", "Scripts")].filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path") || "PATH"
  env[key] = [...dirs, env[key] || ""].filter(Boolean).join(path.delimiter)
  env.FORGE_PROJECT_DIR = project

  const libs = path.join(base, "npm", "_libs", "node_modules")
  env.NODE_PATH = [libs, env.NODE_PATH || process.env.NODE_PATH || ""].filter(Boolean).join(path.delimiter)
  env.SEMGREP_ENABLE_VERSION_CHECK = "0"
  env.SEMGREP_SEND_METRICS = "off"
  env.PIP_DISABLE_PIP_VERSION_CHECK = "1"
}

// `Plugin.define` is only an identity helper; exporting the shape directly keeps this file
// dependency-free so it loads from any OpenCode config directory.
export default {
  id: "forge",
  async setup(ctx: any) {
    const project = ctx.location.directory
    const active = new Set<string>()
    let loopSession: string | undefined
    const children = new Map<string, boolean>()

    await ctx.shell.hook("create.before", (event) => {
      extendPath(project, event.env)
    })

    await ctx.tool.hook("execute.before", (event) => {
      const input = (event.input ?? {}) as Record<string, any>

      // Remember which session owns the loop. Subagent sessions run forge commands too, so we only
      // bind on init/start/tweak, which the main session runs.
      const command = String(input.command ?? input.cmd ?? "")
      if (["bash", "shell"].includes(event.tool) && /forge\.mjs["']?\s+(init|start|tweak)\b/.test(command)) {
        loopSession = event.sessionID
      }

      if (!fs.existsSync(STATE(project))) return
      if (["write", "edit", "patch"].includes(event.tool)) {
        const file = String(input.filePath || input.path || input.file || "")
        if (isProtectedPath(project, file)) throw new Error(GUARD_MESSAGE)
        if (event.tool === "patch" && PROTECTED_NAMES.test(String(input.patchText || input.patch || ""))) {
          throw new Error(GUARD_MESSAGE)
        }
      }
      if (["bash", "shell"].includes(event.tool) && bashTouchesProtected(command)) {
        throw new Error(GUARD_MESSAGE)
      }
    })

    // Second guard layer for file edits: even if a tool bypasses execute.before, the permission
    // layer refuses writes to loop-owned files.
    await ctx.permission.hook("evaluate", (event: any) => {
      if (event.action !== "edit") return
      if (!fs.existsSync(STATE(project))) return
      if (event.resources.some((resource: string) => isProtectedPath(project, resource))) {
        event.effect = "deny"
        event.message = GUARD_MESSAGE
      }
    })

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type !== "session.idle") continue
          const sessionID = event.data.sessionID

          if (event.location?.directory && path.resolve(event.location.directory) !== path.resolve(project)) continue
          if (active.has(sessionID)) continue
          if (loopSession && sessionID !== loopSession) continue

          const state = readState(project)
          if (!state || !["running", "delivering"].includes(state.status)) continue
          if (state.session_id && state.session_id !== sessionID) continue

          // Before anything is bound, ignore child sessions: a planner or toolsmith going idle is
          // not the builder finishing its turn.
          if (!state.session_id && !loopSession) {
            let isChild = children.get(sessionID)
            if (isChild === undefined) {
              try {
                const info: any = await ctx.session.get({ sessionID })
                isChild = Boolean(info?.parentID ?? info?.data?.parentID)
              } catch {
                isChild = false
              }
              children.set(sessionID, isChild)
            }
            if (isChild) continue
          }

          active.add(sessionID)
          try {
            const result = await runGate(project, sessionID)
            if (!result || result.allow !== false || !result.reason) continue
            await ctx.session.prompt({ sessionID, text: result.reason })
          } catch (error) {
            logError(project, error)
          } finally {
            active.delete(sessionID)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) logError(project, error)
      }
    })()

    return () => controller.abort()
  },
}
