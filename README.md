# KodaX-Extensions

KodaX-Extensions is the ecosystem workspace for KodaX extension packages.

The first extension is [`read_pdf`](extensions/read_pdf/README.md), a thin KodaX bridge for
reading text-layer and scanned PDFs through an external sidecar. See its README for
installation and usage (connected and air-gapped).

## Repository Layout

```text
KodaX-Extensions/
  package.json            # workspace tooling (vitest, esbuild, typescript)
  tsconfig.json
  vitest.config.ts
  scripts/                # build-extension.mjs, build-sidecar.mjs, pack-offline.mjs
  extensions/
    read_pdf/
      README.md           # design + install/usage
      HANDOFF.md
      PLAN.md             # authoritative build plan
      extension.ts        # KodaX entrypoint (dev source)
      src/                # TS bridge implementation
      tests/              # vitest suites + fixtures
      sidecar/            # Python sidecar (PyMuPDF + RapidOCR) + BUILD_OFFLINE.md
```

Each folder under `extensions/` should be independently understandable. Keep extension-specific design notes, setup instructions, tests, and handoff material inside that extension folder.

## Build, Test & Offline Packaging

```bash
npm install            # install workspace dev deps
npm test               # run all extension test suites (vitest)
npm run typecheck      # tsc --noEmit across the workspace

# Build the distributable extension.mjs (required for KodaX's compiled binary)
node scripts/build-extension.mjs

# Air-gapped delivery (run on a connected machine matching the target OS):
node scripts/build-sidecar.mjs   # PyInstaller onedir: interpreter + deps + OCR models
node scripts/pack-offline.mjs    # stage extension.mjs + sidecar binary + checksums
```

See [extensions/read_pdf/sidecar/BUILD_OFFLINE.md](extensions/read_pdf/sidecar/BUILD_OFFLINE.md)
for the full air-gapped build-and-ship procedure.

## Real LLM Auto-Use Eval

`read_pdf` should be a model-selected tool, not something users normally have to name. To smoke-test that behavior with a real KodaX run:

```bash
npm run eval:read-pdf-auto-use
```

The eval generates a tiny PDF with a hidden sentinel phrase, runs KodaX with the `read_pdf`
extension loaded, and gives the model a prompt that mentions only the PDF path, not the tool
name. It passes only when KodaX returns the sentinel through a PDF tool result without first
falling back to the built-in `read` PDF warning. Raw output is written under the OS temp
directory at `kodax-eval-dumps/read-pdf-auto-use/`.

## KodaX Extension Mechanism

KodaX currently has an `extension` mechanism rather than a separate marketplace plugin runtime. An extension is a local JavaScript or TypeScript module that KodaX loads at startup. The module exports either a default activation function or a named `activate(api)` function.

The activation function receives `KodaXExtensionAPI`, registers contributions, and may return a cleanup function.

```ts
import type { KodaXExtensionAPI } from '@kodax-ai/kodax/coding';

export default function activate(api: KodaXExtensionAPI) {
  api.registerTool({
    name: 'hello_extension',
    description: 'Return a greeting from a KodaX extension.',
    sideEffect: 'readonly',
    planModeAllowed: true,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name to greet.' }
      },
      required: []
    },
    toClassifierInput: () => '',
    handler: async (input) => {
      const name = typeof input.name === 'string' && input.name.trim()
        ? input.name.trim()
        : 'KodaX';
      return `Hello, ${name}.`;
    }
  });
}
```

Plain JavaScript extensions can omit the type import.

### Loading Extensions

KodaX can load either a single module file or a directory package.

Supported module extensions are:

```text
.js .mjs .cjs .ts .mts .cts
```

Directory packages are resolved by looking for one of these files at the package root, in this order:

```text
extension.mjs
extension.js
extension.cjs
extension.mts
extension.ts
extension.cts
index.mjs
index.js
index.cjs
index.mts
index.ts
index.cts
```

Prefer `extension.ts` during source development and `extension.mjs` for a built distribution. Keep that root entrypoint small; import real implementation from `src/`.

KodaX currently loads extensions from three places:

- Default discovery: KodaX scans `${KODAX_HOME}/extensions`, normally `~/.kodax/extensions`, for direct child modules, directory packages, and symlinks to either.
- User config: `~/.kodax/config.json` can include an `extensions` array. Relative paths resolve from the config file directory.
- CLI: `kodax --extension <path>` loads a file or directory. Relative paths resolve from the current working directory.

Example config:

```json
{
  "extensions": [
    "./extensions/read_pdf"
  ]
}
```

Example CLI usage:

```bash
kodax --extension C:/Works/GitWorks/KodaX-author/KodaX-Extensions/extensions/read_pdf "Read C:/tmp/sample.pdf"
```

Load order is default discovery, then config, then CLI. If two extensions register the same tool or command name, the later registration is the active one and diagnostics keep the shadowed sources. Use that for local development overrides, not as a long-term product design.

CLI and ACP/server hosts both load default discovery and config extensions, so desktop or IDE hosts can see the same extension-provided tools without special integration code.

### What Extensions Can Register

The main API surface is intentionally small and direct:

- `api.registerTool(definition)` registers an LLM-callable tool.
- `api.registerCommand(command)` registers a slash-style extension command.
- `api.registerCapabilityProvider(provider)` adds a search/describe/invoke capability provider, including MCP-like surfaces.
- `api.registerSkillPath(path)` contributes skills from a folder, resolved relative to the extension entrypoint file.
- `await api.registerAgent(name, content)` registers a constructed agent. This call is async and must be awaited.
- `api.on(event, handler)` observes runtime events.
- `api.hook(name, handler)` participates in blocking or mutating runtime hooks.
- `api.runtime` exposes session-scoped state, active tool selection, model selection, and thinking level controls.
- `api.persistence` is an extension-scoped key-value store that persists across sessions.
- `api.exec(command, options)` runs a shell command through KodaX's helper environment.
- `api.webhook(url, payload, options)` sends a timeout-aware HTTP webhook.
- `api.logger` logs with an extension label.
- `api.config` exposes the KodaX runtime config as unknown data; validate anything you read from it.

For most ecosystem extensions, start with exactly one `registerTool` call. Add commands, hooks, agents, or persistence only when the extension has a concrete need.

### Tool Registration Checklist

Every tool should be conservative and model-friendly:

- Choose a stable snake_case name, for example `read_pdf`.
- Set `sideEffect` correctly. Pure readers should use `readonly`.
- Set `planModeAllowed: true` only when the tool is safe during planning.
- Use a small JSON schema with explicit required fields.
- Implement `toClassifierInput`. Return `''` for zero-risk read-only tools.
- Return compact text by default. Large JSON should be an opt-in diagnostics mode.
- Validate all inputs inside the handler.
- Return actionable errors; do not silently swallow failures.
- Keep heavy engines, network credentials, and long-lived services outside KodaX core.

### Recommended Package Shape

```text
extensions/my_extension/
  README.md
  HANDOFF.md              # optional but useful for agent handoff
  extension.ts            # KodaX entrypoint
  src/
    tool.ts
    format-result.ts
  tests/
    extension.test.ts
  package.json            # optional, only when the extension needs local build/test deps
```

A root `extension.ts` can stay tiny:

```ts
import type { KodaXExtensionAPI } from '@kodax-ai/kodax/coding';
import { createMyTool } from './src/tool.js';

export default function activate(api: KodaXExtensionAPI) {
  api.registerTool(createMyTool(api));
}
```

### Development Workflow

1. Create `extensions/<name>/extension.ts`.
2. Register one minimal tool and test it through `kodax --extension <folder>`.
3. Add focused tests for registration, input validation, failure messages, and formatting.
4. If the extension needs heavyweight dependencies, put them behind a sidecar CLI or HTTP service.
5. Install or symlink the extension folder into `~/.kodax/extensions/<name>` only after local `--extension` dogfood works.
6. Check `/extensions` in the REPL or extension diagnostics to confirm load source, registered tools, hooks, and failures.

### Current Extensions

- [`read_pdf`](extensions/read_pdf/README.md): provider-neutral PDF reading tool. v1 ships
  PyMuPDF text-layer extraction plus RapidOCR fallback behind a Python sidecar; MinerU and
  NoteEditor-lite backends are planned for v2. Supports connected (uv) and air-gapped
  (self-contained binary) delivery. Validated end-to-end through the compiled KodaX binary.
