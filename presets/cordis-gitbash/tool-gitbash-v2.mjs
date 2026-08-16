/**
 * Git Bash preference for the `cordis-gitbash` preset.
 *
 * Registers a prompt section directing the agent to prefer Git Bash over
 * PowerShell, and (on Windows) registers a `bash` tool that runs Git Bash
 * directly through `ctx.subprocess`. Git Bash (MSYS2) cannot start under the
 * harness file sandbox (its signal pipe is denied by the restricted token),
 * so the tool runs UNCONFINED, like a normal terminal; `pwsh` stays sandboxed.
 *
 * Timeout handling deliberately uses the host process's own `setTimeout`
 * (available to native loader plugins) instead of the cordis `timer` service,
 * so this tool has no hard dependency on `timer` being resolvable from the
 * preset realm. The deadline is a plain host timer cleared on settlement.
 */
export const name = 'tool-gitbash'
export const inject = ['systemPrompt', 'tools']

const SHELL_SECTION_TEXT = [
  'Shell preference: prefer the `bash` tool (Git Bash) over the `pwsh` tool (PowerShell) whenever a shell command is needed.',
  'Write commands in bash/POSIX style — `ls`, `grep`, `sed`, `cat`, `&&`, pipes, and `$VAR` variables — with POSIX-style paths.',
  'Reserve `pwsh` for tasks that specifically require PowerShell semantics (`$env:NAME`, `Get-*` cmdlets, `-Force` flags) or when Git Bash is unavailable.',
  'Note: the `bash` tool runs UNCONFINED (Git Bash cannot start under the harness file sandbox), so use it carefully; `pwsh` remains sandboxed.'
].join('\n')

function isAbsoluteWin(p) {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')
}
function joinPath(base, rel) {
  const b = base.replace(/[\\/]+$/, '')
  const r = rel.replace(/^[\\/]+/, '')
  return b + '\\' + r.split(/[\\/]/).join('\\')
}
async function resolveGitBash(subprocess) {
  try {
    return await subprocess.resolveExecutable('bash')
  } catch (err) {
    const candidates = [
      'E:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files\\Git\\cmd\\bash.exe'
    ]
    for (const candidate of candidates) {
      try {
        return await subprocess.resolveExecutable(candidate)
      } catch (e) {
        // try next candidate
      }
    }
    throw new Error('Git Bash (bash.exe) was not found on this machine: ' + String(err && err.message ? err.message : err))
  }
}
function streamText(o) {
  if (o === undefined || o === null) return ''
  if (!o.truncated) return o.text
  return (o.text !== '' ? o.text : '') + (o.spillPath !== undefined ? '\n[output truncated; full output: ' + o.spillPath + ']' : '\n[output truncated]')
}
function renderResultText(value) {
  const out = streamText(value.stdout)
  const err = streamText(value.stderr)
  let body = out
  if (err !== '') {
    if (body !== '' && !body.endsWith('\n')) body += '\n'
    body += '[stderr]\n' + err
  }
  if (body === '') body = '(no output)'
  const markers = []
  if (value.timedOut) markers.push('[timed out after ' + value.timeoutMs + 'ms]')
  if (value.aborted) markers.push('[aborted]')
  if (value.signal !== null && value.signal !== undefined) markers.push('[killed by signal: ' + value.signal + ']')
  else if (value.exitCode !== 0 && value.exitCode !== null) markers.push('[exit code: ' + value.exitCode + ']')
  if (markers.length > 0) {
    if (!body.endsWith('\n')) body += '\n'
    body += markers.join('\n')
  }
  return body
}

/**
 * Recover the terminal exit pill from the rendered result text — the inverse
 * of the `[exit code: N]` / `[killed by signal: X]` markers `renderResultText`
 * appends. A killed marker yields `signal`; otherwise a non-zero marker yields
 * `exitCode`; absent both means a clean exit 0. The consumed marker is removed
 * from `body` because the terminal card shows the exit status as its own pill.
 * Copied from @deepseek-ai/dsh-shell (this preset-local plugin cannot import
 * @deepseek-ai packages from its realm).
 */
function parseExitStatus(text) {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) {
    return { body: text.slice(0, signal.index), signal: signal[1] }
  }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined) {
    return { body: text.slice(0, exit.index), exitCode: Number(exit[1]) }
  }
  return { body: text, exitCode: 0 }
}

const BASH_TOOL = {
  name: 'bash',
  description: 'Execute a bash command via Git Bash (`bash -c`) and return its stdout/stderr. Prefer this tool over `pwsh` for general shell work: use bash/POSIX syntax (`ls`, `grep`, `sed`, `cat`, `&&`, pipes, `$VAR`) and POSIX-style paths. Each call runs in a fresh Git Bash process: no state (cwd, variables, functions) persists between calls — pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]`. IMPORTANT: Git Bash (MSYS2) cannot start under the harness file sandbox (its signal pipe is denied by the restricted token), so this tool runs UNCONFINED with full filesystem access, like your own terminal — only touch files you are meant to touch. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to execute via Git Bash.' },
      description: { type: 'string', description: 'Clear, concise description of what this command does in active voice, 5-10 words. Examples: "List files in current directory"; "Show git status"; "Count lines in a file".' },
      workdir: { type: 'string', description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds; the process tree is killed on expiry. Defaults to 120000.' }
    },
    required: ['command', 'description']
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['exitCode', 'signal', 'timedOut', 'aborted', 'timeoutMs', 'stdout', 'stderr'],
      properties: {
        exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        signal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        timedOut: { type: 'boolean' },
        aborted: { type: 'boolean' },
        timeoutMs: { type: 'number' },
        stdout: { type: 'object', additionalProperties: false, required: ['text', 'truncated'], properties: {
          text: { type: 'string' },
          truncated: { type: 'boolean' },
          spillPath: { type: 'string' }
        } },
        stderr: { type: 'object', additionalProperties: false, required: ['text', 'truncated'], properties: {
          text: { type: 'string' },
          truncated: { type: 'boolean' },
          spillPath: { type: 'string' }
        } }
      }
    },
    render(args, value) {
      return [{ type: 'text', text: renderResultText(value) }]
    },
    // Terminal-card render intent (the same contract dsh-tool-bash/dsh-tool-pwsh
    // declare): the web shell renders a foreground call as a clickable terminal
    // card with a cwd header, the command as the title, and the captured output
    // plus an exit-status pill after completion.
    presentCall(args) {
      return {
        card: 'terminal',
        title: args.command,
        description: args.description,
        ...(args.workdir !== undefined && args.workdir !== '' ? { cwd: args.workdir } : {})
      }
    },
    presentResult(args, result) {
      const content = Array.isArray(result.content) && result.content.length === 1 ? result.content[0] : undefined
      if (content === undefined || content.type !== 'text') return undefined
      const raw = content.text
      if (result.isError) {
        return {
          card: 'generic',
          content: [{ type: 'text', text: '```console\n' + raw.replace(/\n+$/, '') + '\n```' }]
        }
      }
      const { body, ...exit } = parseExitStatus(raw)
      return { card: 'terminal', output: body, ...exit }
    }
  }
}

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'shell:prefer-git-bash',
    order: 100,
    text: SHELL_SECTION_TEXT
  })

  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    ctx.logger.warn(`${name}: ctx.subprocess unavailable; bash tool not registered`)
    return
  }

  let bashResolve
  const getBash = () => {
    if (bashResolve === undefined) bashResolve = resolveGitBash(subprocess)
    return bashResolve
  }

  const tool = {
    ...BASH_TOOL,
    async execute(args, exec) {
      if (typeof args.command !== 'string' || args.command.trim().length === 0) throw new Error('invalid command: expected a non-empty string')
      if (typeof args.description !== 'string' || args.description.trim().length === 0) throw new Error('invalid description: expected a non-empty string')
      if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) throw new Error('invalid timeoutMs: expected a positive number')

      const bashExe = await getBash()
      const timeoutMs = args.timeoutMs !== undefined ? Math.min(Math.floor(args.timeoutMs), 3600000) : 120000

      const session = exec.agent && exec.agent.session ? exec.agent.session : undefined
      const headerCwd = session !== undefined ? session.header.cwd : undefined
      let workdir = args.workdir !== undefined && args.workdir.length > 0 ? args.workdir : headerCwd
      if (workdir === undefined) {
        const policySvc = ctx.get('sandboxPolicy')
        if (policySvc !== undefined) workdir = policySvc.workspaceRoot
      }
      if (workdir === undefined) throw new Error('no working directory: pass `workdir` or run inside a session')
      if (!isAbsoluteWin(workdir) && headerCwd !== undefined) workdir = joinPath(headerCwd, workdir)

      const argv = [bashExe, '-c', args.command]
      let proc
      try {
        proc = subprocess.spawn({
          argv,
          cwd: workdir,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: 400000, spill: { maxBytes: 4000000 } },
            stderr: { maxBytes: 400000, spill: { maxBytes: 4000000 } }
          },
          graceMs: 3000,
          signal: exec.signal
        })
      } catch (err) {
        throw new Error('failed to start Git Bash: ' + String(err && err.message ? err.message : err))
      }

      // Host-process deadline: native loader plugins run in the normal Node
      // process, so `setTimeout` is available without the cordis `timer`
      // service. `terminate()` starts the SIGTERM→KILL escalation (immediate
      // on Windows) and is idempotent, so firing after settlement is harmless.
      let timedOut = false
      const deadlineTimer = setTimeout(() => {
        timedOut = true
        try { proc.terminate() } catch (_) { /* process already gone */ }
      }, timeoutMs)
      let outcome
      try {
        outcome = await proc.done
      } catch (err) {
        clearTimeout(deadlineTimer)
        throw new Error('Git Bash process failed to start: ' + String(err && err.message ? err.message : err))
      }
      clearTimeout(deadlineTimer)

      const readOut = (reader) => {
        if (reader === undefined) return undefined
        const r = reader.readFrom(0)
        const out = { text: r.text, truncated: r.lossy }
        if (r.spillPath !== undefined) out.spillPath = r.spillPath
        return out
      }
      const stdout = readOut(proc.collected.stdout)
      const stderr = readOut(proc.collected.stderr)

      return {
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        timedOut,
        aborted: exec.signal.aborted,
        timeoutMs,
        stdout: stdout !== undefined ? stdout : { text: '', truncated: false },
        stderr: stderr !== undefined ? stderr : { text: '', truncated: false }
      }
    }
  }

  ctx.tools.register(tool)
}
