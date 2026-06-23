/**
 * Minimal local type shims for the subset of the KodaX extension API that
 * `read_pdf` uses. These mirror `@kodax-ai/coding` so the extension type-checks
 * without depending on the KodaX source tree. They are type-only: erased at
 * build time and never present at runtime.
 *
 * When an official `@kodax-ai/coding` types package is published, replace these
 * imports with it.
 */

export type ToolSideEffect =
  | 'readonly'
  | 'mutates-fs'
  | 'mutates-shell'
  | 'mutates-network'
  | 'mutates-state';

export type ToolInterruptBehavior = 'cancel' | 'wait';

export interface ExecOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly timeout?: number;
  readonly shell?: 'bash' | 'powershell';
}

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface WebhookOptions {
  readonly method?: 'POST' | 'PUT';
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeout?: number;
}

export interface WebhookResult {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: string;
}

export interface KodaXToolInputSchema {
  readonly type: 'object';
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
}

export interface LocalToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: KodaXToolInputSchema;
  readonly sideEffect: ToolSideEffect;
  readonly planModeAllowed?: boolean;
  readonly interruptBehavior?: ToolInterruptBehavior;
  readonly toClassifierInput: (input: unknown) => string;
  readonly handler: (input: Record<string, unknown>, context?: unknown) => Promise<string>;
}

export interface ExtensionLogger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
}

export interface KodaXExtensionAPI {
  registerTool: (definition: LocalToolDefinition) => () => void;
  logger: ExtensionLogger;
  config: Readonly<Record<string, unknown>>;
  exec: (command: string, options?: ExecOptions) => Promise<ExecResult>;
  webhook: (url: string, payload: unknown, options?: WebhookOptions) => Promise<WebhookResult>;
}
