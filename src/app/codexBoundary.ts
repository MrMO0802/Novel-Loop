import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { JsonResponseParser } from '../llm/JsonResponseParser.js';
import { RunLogger } from '../logging/RunLogger.js';
import { shouldRedactPromptArtifacts } from '../logging/PromptArtifactWriter.js';
import { CodexSafetyPolicySchema } from '../schemas/index.js';
import type { CodexSafetyPolicy, RunEventType } from '../schemas/index.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROJECT_ID = 'codex-boundary';
const DEFAULT_TIMEOUT_MS = 120_000;
const CODEX_SANDBOX = 'read-only';

const CODEX_SAFETY_POLICY: CodexSafetyPolicy = CodexSafetyPolicySchema.parse({
  sandbox: CODEX_SANDBOX,
  workspaceWriteAllowed: false,
  shellCommandsAllowed: false,
  storyStateCommitAllowed: false,
  authFilesRead: false
});

const UnknownJsonSchema = z.unknown();

export interface CodexBoundaryInput {
  codexBin?: string;
  projectsRoot?: string;
  projectId?: string;
  cwd?: string;
  runId?: string;
  parentPromptCallId?: string;
  parentPromptId?: string;
  parentStage?: string;
  parentRunId?: string;
  timeoutMs?: number;
  codexProfile?: CodexProfile;
}

export interface CodexExecTextInput extends CodexBoundaryInput {
  promptPath: string;
}

export interface CodexExecPromptTextInput extends CodexBoundaryInput {
  promptText: string;
  promptSourcePath?: string;
}

export interface CodexExecJsonInput extends CodexExecTextInput {
  schemaPath: string;
}

export interface CodexExecPromptJsonInput extends CodexExecPromptTextInput {
  schemaPath: string;
}

export interface CodexStatusResult {
  binaryFound: boolean;
  binaryPath: string;
  version: string;
  loginStatus: string;
  healthOk: boolean;
  doctorJson: string;
  sandbox: 'read-only';
  safety: CodexSafetyPolicy;
}

export interface CodexExecResult {
  ok: boolean;
  runId: string;
  sandbox: 'read-only';
  rawOutputPath: string;
  finalOutputPath: string;
  text: string;
  rawResponseRedacted: string;
  latencyMs: number;
  safety: CodexSafetyPolicy;
  codexProfile?: CodexProfile;
  stderrExcerpt?: string;
}

export interface CodexExecJsonResult extends CodexExecResult {
  parsedJsonPath: string;
  parsedJson: unknown;
}

interface CodexCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  timingEvents?: CodexTimingEvent[];
}

interface CodexTimingEvent {
  eventType: RunEventType;
  timestamp: string;
  payload?: Record<string, unknown>;
}

interface ExecPromptInput extends CodexBoundaryInput {
  operation: 'smoke' | 'exec-text' | 'exec-json';
  promptText: string;
  promptSourcePath?: string;
  schemaPath?: string;
}

export async function checkCodexStatus(input: CodexBoundaryInput = {}): Promise<CodexStatusResult> {
  const binaryPath = await resolveCodexBinary(input.codexBin);
  const version = await runCodexCommand(binaryPath, ['--version'], input);
  const login = await runCodexCommandAllowFailure(binaryPath, ['login', 'status'], input);
  const doctor = await runCodexCommandAllowFailure(binaryPath, ['doctor', '--json'], input);
  const doctorJson = redactSensitive(`${doctor.stdout}${doctor.stderr}`);
  return {
    binaryFound: true,
    binaryPath,
    version: redactSensitive(version.stdout).trim(),
    loginStatus: redactSensitive(`${login.stdout}${login.stderr}`).trim(),
    healthOk: doctor.exitCode === 0 && isDoctorHealthy(doctor.stdout),
    doctorJson,
    sandbox: CODEX_SANDBOX,
    safety: CODEX_SAFETY_POLICY
  };
}

export async function runCodexSmoke(input: CodexBoundaryInput = {}): Promise<CodexExecResult> {
  const result = await execCodexPrompt({
    ...input,
    operation: 'smoke',
    promptText: [
      'Reply with exactly: CODEX_SMOKE_OK',
      'Do not modify files.',
      'Do not run shell commands.',
      'Return only the final text.'
    ].join('\n')
  });
  return {
    ok: true,
    runId: result.runId,
    sandbox: result.sandbox,
    rawOutputPath: result.rawOutputPath,
    finalOutputPath: result.finalOutputPath,
    text: result.text,
    rawResponseRedacted: result.rawResponseRedacted,
    latencyMs: result.latencyMs,
    safety: result.safety
  };
}

export async function execCodexText(input: CodexExecTextInput): Promise<CodexExecResult> {
  const fileStore = new FileStore();
  const promptText = await fileStore.readText(input.promptPath);
  const result = await execCodexPrompt({
    ...input,
    operation: 'exec-text',
    promptText,
    promptSourcePath: input.promptPath
  });
  return {
    ok: true,
    runId: result.runId,
    sandbox: result.sandbox,
    rawOutputPath: result.rawOutputPath,
    finalOutputPath: result.finalOutputPath,
    text: result.text,
    rawResponseRedacted: result.rawResponseRedacted,
    latencyMs: result.latencyMs,
    safety: result.safety
  };
}

export async function execCodexTextPrompt(input: CodexExecPromptTextInput): Promise<CodexExecResult> {
  const result = await execCodexPrompt({
    ...input,
    operation: 'exec-text',
    promptText: input.promptText,
    ...(input.promptSourcePath === undefined ? {} : { promptSourcePath: input.promptSourcePath })
  });
  return {
    ok: true,
    runId: result.runId,
    sandbox: result.sandbox,
    rawOutputPath: result.rawOutputPath,
    finalOutputPath: result.finalOutputPath,
    text: result.text,
    rawResponseRedacted: result.rawResponseRedacted,
    latencyMs: result.latencyMs,
    safety: result.safety
  };
}

export async function execCodexJson(input: CodexExecJsonInput): Promise<CodexExecJsonResult> {
  const fileStore = new FileStore();
  const promptText = await fileStore.readText(input.promptPath);
  return execCodexJsonPrompt({
    ...input,
    promptText,
    promptSourcePath: input.promptPath
  });
}

export async function execCodexJsonPrompt(input: CodexExecPromptJsonInput): Promise<CodexExecJsonResult> {
  const fileStore = new FileStore();
  const schemaText = await fileStore.readText(input.schemaPath);
  const schema = parseJsonSchema(schemaText, input.schemaPath);
  const result = await execCodexPrompt({
    ...input,
    operation: 'exec-json',
    promptText: input.promptText,
    ...(input.promptSourcePath === undefined ? {} : { promptSourcePath: input.promptSourcePath }),
    schemaPath: input.schemaPath
  });
  const paths = projectPaths(input);
  const projectFileStore = FileStore.forProject(paths.projectRoot);
  const finalText = await projectFileStore.readText(paths.projectArtifact(result.finalOutputPath));
  await result.runLogger.recordEvent(result.runId, 'CODEX_PARSE_STARTED', {
    stage: 'codex',
    relatedArtifactPaths: [result.finalOutputPath],
    payload: { artifactKind: 'final_output' }
  });
  const parsedJson = new JsonResponseParser().parse(finalText);
  await result.runLogger.recordEvent(result.runId, 'CODEX_PARSE_COMPLETED', {
    stage: 'codex',
    relatedArtifactPaths: [result.finalOutputPath],
    payload: { artifactKind: 'final_output' }
  });
  await result.runLogger.recordEvent(result.runId, 'CODEX_SCHEMA_VALIDATE_STARTED', {
    stage: 'codex',
    relatedArtifactPaths: [result.finalOutputPath],
    payload: { schemaPath: safePromptPath(input.schemaPath) }
  });
  validateJsonSchemaSubset(parsedJson, schema);
  await result.runLogger.recordEvent(result.runId, 'CODEX_SCHEMA_VALIDATE_COMPLETED', {
    stage: 'codex',
    relatedArtifactPaths: [result.finalOutputPath],
    payload: { schemaPath: safePromptPath(input.schemaPath) }
  });
  await recordArtifactWriteEvent(result.runLogger, result.runId, 'started', result.parsedJsonPath, 'parsed_output');
  await projectFileStore.writeJson(paths.projectArtifact(result.parsedJsonPath), parsedJson, UnknownJsonSchema);
  await recordArtifactWriteEvent(result.runLogger, result.runId, 'completed', result.parsedJsonPath, 'parsed_output');
  await result.runLogger.recordArtifact(result.runId, result.parsedJsonPath, {
    action: 'generated',
    derivedFrom: [result.finalOutputPath],
    stage: 'codex',
    provenanceNote: 'parsed and schema-validated from Codex final output'
  });
  return {
    ok: true,
    runId: result.runId,
    sandbox: result.sandbox,
    rawOutputPath: result.rawOutputPath,
    finalOutputPath: result.finalOutputPath,
    parsedJsonPath: result.parsedJsonPath,
    text: result.text,
    rawResponseRedacted: result.rawResponseRedacted,
    latencyMs: result.latencyMs,
    parsedJson,
    safety: result.safety
  };
}

async function execCodexPrompt(input: ExecPromptInput): Promise<
  CodexExecResult & {
    parsedJsonPath: string;
    runLogger: RunLogger;
    text: string;
    rawResponseRedacted: string;
    latencyMs: number;
  }
> {
  const binaryPath = await resolveCodexBinary(input.codexBin);
  const paths = projectPaths(input);
  await new FileStore().ensureDir(paths.projectRoot);
  const fileStore = FileStore.forProject(paths.projectRoot);
  const runId = input.runId ?? createRunId(input.operation);
  const runLogger = new RunLogger(paths, fileStore);
  const promptArtifactPath = posixJoin('codex', 'runs', runId, 'prompt.md');
  const rawOutputPath = posixJoin('codex', 'runs', runId, 'raw_output.jsonl');
  const finalOutputPath = posixJoin('codex', 'runs', runId, input.operation === 'exec-json' ? 'final_output.json' : 'final_output.md');
  const parsedJsonPath = posixJoin('codex', 'runs', runId, 'parsed_output.json');
  const codexRunDir = paths.projectArtifact(posixJoin('codex', 'runs', runId));
  await fileStore.ensureDir(codexRunDir);
  await fileStore.assertSafePath(paths.projectArtifact(finalOutputPath));
  await fileStore.writeText(
    paths.projectArtifact(promptArtifactPath),
    shouldRedactPromptArtifacts() ? `[redacted codex prompt artifact for ${input.operation}]\n` : input.promptText
  );
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  await runLogger.startRun({
    runId,
    command: 'codex',
    args: {
      operation: input.operation,
      provider: 'codex-cli',
      sandbox: CODEX_SANDBOX,
      workspaceWriteAllowed: false,
      shellCommandsAllowed: false,
      storyStateCommitAllowed: false,
      codexProfile: input.codexProfile ?? 'default',
      ...(input.promptSourcePath === undefined ? {} : { promptPath: safePromptPath(input.promptSourcePath) }),
      ...(input.schemaPath === undefined ? {} : { schemaPath: safePromptPath(input.schemaPath) })
    }
  });
  await runLogger.recordArtifact(runId, promptArtifactPath, {
    action: 'generated',
    stage: 'codex',
    provenanceNote: 'prompt copied for Codex execution boundary'
  });

  let privateOutputDir: string | undefined;
  try {
    privateOutputDir = await mkdtemp(
      path.join(os.tmpdir(), 'novel-loop-codex-output-')
    );
    const privateOutputPath = path.join(
      privateOutputDir,
      path.basename(finalOutputPath)
    );
    const boundaryFileStore = new FileStore();
    const args = buildCodexExecArgs({
      outputFile: privateOutputPath,
      promptText: input.promptText,
      ...(input.schemaPath === undefined ? {} : { schemaPath: input.schemaPath })
    });
    const commandResult = await runCodexExecCommand(binaryPath, args, input, input.promptText);
    await recordTimingEvents(runLogger, runId, commandResult.timingEvents ?? []);
    const endedAt = new Date().toISOString();
    const rawResponseRedacted = redactSensitive(commandResult.stdout);
    const stderrExcerpt = redactSensitive(commandResult.stderr).slice(0, 4000);
    await recordArtifactWriteEvent(runLogger, runId, 'started', rawOutputPath, 'raw_output');
    await fileStore.writeText(paths.projectArtifact(rawOutputPath), rawResponseRedacted);
    await recordArtifactWriteEvent(runLogger, runId, 'completed', rawOutputPath, 'raw_output');
    if (commandResult.timedOut === true) {
      throw new AppError('CODEX_TIMEOUT', `Codex CLI command timed out after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms: ${stderrExcerpt || 'no stderr'}`, 1, {
        reason: `timeoutMs=${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}`
      });
    }
    const privateOutputExists = await boundaryFileStore.exists(privateOutputPath);
    const privateFinalText = privateOutputExists
      ? await boundaryFileStore.readText(privateOutputPath)
      : '';
    if (commandResult.exitCode !== 0) {
      if (privateOutputExists) {
        await recordArtifactWriteEvent(runLogger, runId, 'started', finalOutputPath, 'final_output');
        await fileStore.writeText(
          paths.projectArtifact(finalOutputPath),
          redactSensitive(privateFinalText)
        );
        await recordArtifactWriteEvent(runLogger, runId, 'completed', finalOutputPath, 'final_output');
      }
      const failureMessage = jsonlFailureMessage(commandResult.stdout);
      throw new AppError('CODEX_EXEC_FAILED', `Codex CLI command failed: ${failureMessage || stderrExcerpt || 'non-zero exit; inspect redacted raw JSONL'}`, 1, {
        reason: `exit=${commandResult.exitCode}`
      });
    }
    const finalText = privateFinalText.trim().length === 0
      ? extractFinalMessage(commandResult.stdout)
      : redactSensitive(privateFinalText);
    if (finalText.trim().length === 0) {
      throw new AppError('CODEX_OUTPUT_MISSING', 'Codex CLI did not produce a final output file or final message.', 1, {
        reason: stderrExcerpt || 'missing final output'
      });
    }
    await recordArtifactWriteEvent(runLogger, runId, 'started', finalOutputPath, 'final_output');
    await fileStore.writeText(paths.projectArtifact(finalOutputPath), finalText);
    await recordArtifactWriteEvent(runLogger, runId, 'completed', finalOutputPath, 'final_output');
    const latencyMs = Math.max(0, Date.now() - startedAtMs);
    const schemaBytes = input.schemaPath === undefined
      ? 0
      : await safeFileSize(input.schemaPath, new FileStore());
    await runLogger.recordLlmCall(runId, {
      promptId: `codex.${input.operation}`,
      provider: 'codex-cli',
      model: 'local-codex-cli',
      codexProfile: input.codexProfile ?? 'default',
      wrapperCallType: wrapperCallTypeFor(input.operation),
      attributionMode: input.parentPromptCallId === undefined ? 'unclassified' : 'parent_child',
      attributionConfidence: input.parentPromptCallId === undefined ? 'low' : 'high',
      attributionReason: input.parentPromptCallId === undefined ? 'boundary wrapper call has no parent metadata' : 'boundary wrapper call received parent metadata',
      ...(input.parentPromptCallId === undefined ? {} : { parentPromptCallId: input.parentPromptCallId }),
      ...(input.parentPromptId === undefined ? {} : { parentPromptId: input.parentPromptId }),
      ...(input.parentStage === undefined ? {} : { parentStage: input.parentStage }),
      ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
      status: 'succeeded',
      startedAt,
      endedAt,
      latencyMs,
      promptInputBytes: byteLength(input.promptText),
      contextBytes: byteLength(input.promptText),
      schemaBytes,
      outputBytes: byteLength(finalText),
      rawJsonlBytes: byteLength(rawResponseRedacted),
      inputArtifactPath: promptArtifactPath,
      outputArtifactPath: finalOutputPath,
      inputHash: sha256(input.promptText),
      outputHash: sha256(finalText),
      redacted: true,
      redactionReason: 'Codex raw output and final output are secret-redacted before persistence',
      jsonParsed: input.operation === 'exec-json',
      ...(input.operation === 'exec-json' ? { schemaName: 'CodexOutputSchema', schemaValid: true } : {}),
      retryCount: 0
    });
    await runLogger.recordArtifact(runId, rawOutputPath, {
      action: 'generated',
      stage: 'codex',
      provenanceNote: 'redacted Codex --json JSONL stdout'
    });
    await runLogger.recordArtifact(runId, finalOutputPath, {
      action: 'generated',
      derivedFrom: [rawOutputPath],
      stage: 'codex',
      provenanceNote: 'Codex --output-last-message final output'
    });
    await runLogger.endRun(runId, 'success');
    return {
      ok: true,
      runId,
      sandbox: CODEX_SANDBOX,
      rawOutputPath,
      finalOutputPath,
      parsedJsonPath,
      text: finalText,
      rawResponseRedacted,
      latencyMs,
      safety: CODEX_SAFETY_POLICY,
      codexProfile: input.codexProfile ?? 'default',
      stderrExcerpt,
      runLogger
    };
  } catch (error) {
    await runLogger.recordError(runId, {
      code: error instanceof AppError ? error.code : 'CODEX_EXEC_FAILED',
      message: getErrorMessage(error),
      recoverable: true
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  } finally {
    if (privateOutputDir !== undefined) {
      await rm(privateOutputDir, { recursive: true, force: true });
    }
  }
}

function wrapperCallTypeFor(operation: ExecPromptInput['operation']): 'exec_text' | 'exec_json' | 'smoke' {
  if (operation === 'exec-json') return 'exec_json';
  if (operation === 'smoke') return 'smoke';
  return 'exec_text';
}

async function resolveCodexBinary(codexBin?: string): Promise<string> {
  const directories = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);
  // execFile cannot launch npm's Windows .cmd shim safely. Prefer the native
  // Codex executable, even if an npm shim occurs earlier on PATH.
  const candidates = codexBin === undefined
    ? process.platform === 'win32'
      ? [
          ...directories.flatMap((directory) => [
          path.join(directory, 'codex.exe'),
          path.join(directory, 'codex.com')
          ]),
          ...directories.map((directory) => path.join(
            directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'
          ))
        ]
      : directories.map((directory) => path.join(directory, 'codex'))
    : [path.resolve(codexBin)];
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  throw new AppError('CODEX_BINARY_NOT_FOUND', 'Codex CLI binary was not found. Install Codex CLI or pass --codex-bin <path>.', 2, {
    suggestedNextCommand: 'codex --help'
  });
}

function codexInvocation(binaryPath: string, args: string[]): {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  // Explicit JavaScript Codex fixtures and wrappers need Node on Windows;
  // execFile cannot execute a shebang script there.
  return process.platform === 'win32' && /\.(?:c|m)?js$/iu.test(binaryPath)
    ? {
        file: process.execPath,
        args: [binaryPath, ...args],
        env: process.versions.electron === undefined
          ? process.env
          : { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      }
    : { file: binaryPath, args, env: process.env };
}

async function runCodexCommand(binaryPath: string, args: string[], input: CodexBoundaryInput, stdinText?: string): Promise<CodexCommandResult> {
  return new Promise((resolve, reject) => {
    const invocation = codexInvocation(binaryPath, args);
    const child = execFile(
      invocation.file,
      invocation.args,
      {
        cwd: input.cwd ?? process.cwd(),
        timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        env: invocation.env
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const childError = error as Error & { code?: unknown; signal?: unknown; killed?: unknown };
          const redactedStderr = redactSensitive(String(stderr ?? ''));
          const redactedStdout = redactSensitive(String(stdout ?? ''));
          const timedOut = childError.signal === 'SIGTERM' || childError.killed === true || /timed out|timeout/i.test(childError.message);
          reject(
            new AppError(timedOut ? 'CODEX_TIMEOUT' : 'CODEX_EXEC_FAILED', `Codex CLI command failed: ${redactedStderr || redactedStdout || childError.message}`, 1, {
              reason: `exit=${String(childError.code ?? 'unknown')} signal=${String(childError.signal ?? 'none')}`
            })
          );
          return;
        }
        resolve({
          stdout: typeof stdout === 'string' ? stdout : String(stdout),
          stderr: typeof stderr === 'string' ? stderr : String(stderr),
          exitCode: 0
        });
      }
    );
    if (stdinText !== undefined) {
      child.stdin?.end(stdinText);
    } else {
      child.stdin?.end();
    }
  });
}

async function runCodexCommandAllowFailure(binaryPath: string, args: string[], input: CodexBoundaryInput): Promise<CodexCommandResult> {
  try {
    return await runCodexCommand(binaryPath, args, input);
  } catch (error) {
    const childError = error as { stdout?: unknown; stderr?: unknown; code?: unknown };
    if (error instanceof AppError) {
      return {
        stdout: '',
        stderr: error.message,
        exitCode: error.exitCode
      };
    }
    return {
      stdout: redactSensitive(String(childError.stdout ?? '')),
      stderr: redactSensitive(String(childError.stderr ?? getErrorMessage(error))),
      exitCode: typeof childError.code === 'number' ? childError.code : 1
    };
  }
}

function buildCodexExecArgs(input: { outputFile: string; schemaPath?: string; promptText: string }): string[] {
  const args = [
    '--ask-for-approval',
    'never',
    'exec',
    '--sandbox',
    CODEX_SANDBOX,
    '--skip-git-repo-check',
    '--ephemeral',
    '--json',
    '--output-last-message',
    input.outputFile
  ];
  if (input.schemaPath !== undefined) {
    args.push('--output-schema', path.resolve(input.schemaPath));
  }
  args.push('-');
  return args;
}

async function runCodexExecCommand(binaryPath: string, args: string[], input: CodexBoundaryInput, stdinText: string): Promise<CodexCommandResult> {
  return new Promise((resolve) => {
    const timingEvents: CodexTimingEvent[] = [];
    const record = (eventType: RunEventType, payload: Record<string, unknown> = {}) => {
      timingEvents.push({ eventType, timestamp: new Date().toISOString(), payload });
    };
    record('CODEX_PROCESS_SPAWN_STARTED', { sandbox: CODEX_SANDBOX });
    const invocation = codexInvocation(binaryPath, args);
    const child = execFile(
      invocation.file,
      invocation.args,
      {
        cwd: input.cwd ?? process.cwd(),
        timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        env: invocation.env
      },
      (error, stdout, stderr) => {
        const childError = error as (Error & { code?: unknown; signal?: unknown; killed?: unknown }) | null;
        const timedOut = childError !== null && (childError.signal === 'SIGTERM' || childError.killed === true || /timed out|timeout/i.test(childError.message));
        record('CODEX_PROCESS_EXITED', {
          exitCode: error === null ? 0 : typeof childError?.code === 'number' ? childError.code : 1,
          timedOut
        });
        resolve({
          stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
          stderr: typeof stderr === 'string' ? stderr : String(stderr ?? childError?.message ?? ''),
          exitCode: error === null ? 0 : typeof childError?.code === 'number' ? childError.code : 1,
          ...(timedOut ? { timedOut: true } : {}),
          timingEvents
        });
      }
    );
    record('CODEX_PROCESS_SPAWNED', {
      pid: child.pid ?? 'unknown',
      sandbox: CODEX_SANDBOX
    });
    let stdoutBuffer = '';
    let firstJsonlSeen = false;
    let finalMessageSeen = false;
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const parsed = parseJsonlEvent(trimmed);
        if (parsed === undefined) continue;
        if (!firstJsonlSeen) {
          firstJsonlSeen = true;
          record('CODEX_FIRST_JSONL_EVENT', { jsonlType: jsonlType(parsed) });
        }
        if (!finalMessageSeen && isFinalMessageEvent(parsed)) {
          finalMessageSeen = true;
          record('CODEX_FINAL_MESSAGE_SEEN', { jsonlType: jsonlType(parsed) });
        }
      }
    });
    child.stdin?.on('error', () => {
      // The Codex process may exit before stdin is fully flushed in smoke/failure paths.
    });
    try {
      child.stdin?.end(stdinText);
    } catch {
      // Callback resolution handles process failure; avoid leaking EPIPE as an uncaught exception.
    }
    record('CODEX_STDIN_WRITTEN', { bytes: byteLength(stdinText) });
  });
}

async function recordTimingEvents(runLogger: RunLogger, runId: string, events: CodexTimingEvent[]): Promise<void> {
  for (const event of events) {
    await runLogger.recordEvent(runId, event.eventType, {
      stage: 'codex',
      timestamp: event.timestamp,
      payload: event.payload ?? {}
    });
  }
}

async function recordArtifactWriteEvent(runLogger: RunLogger, runId: string, status: 'started' | 'completed', artifactPath: string, artifactKind: string): Promise<void> {
  await runLogger.recordEvent(runId, status === 'started' ? 'CODEX_ARTIFACT_WRITE_STARTED' : 'CODEX_ARTIFACT_WRITE_COMPLETED', {
    stage: 'codex',
    relatedArtifactPaths: [artifactPath],
    payload: { artifactKind, path: artifactPath }
  });
}

function parseJsonlEvent(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function jsonlFailureMessage(stdout: string): string | undefined {
  // Only failure events are diagnostic input; never forward assistant text or prompts.
  const lines = stdout.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const event = parseJsonlEvent(lines[index]!);
    if (!isRecord(event) || (event.type !== 'error' && event.type !== 'turn.failed')) continue;
    const message = isRecord(event.error) ? event.error.message : event.message;
    if (typeof message !== 'string' || !message.trim()) continue;
    const nested = parseJsonlEvent(message);
    const detail = isRecord(nested) && isRecord(nested.error) && typeof nested.error.message === 'string'
      ? nested.error.message
      : message;
    return redactSensitive(detail).slice(0, 4000);
  }
  return undefined;
}

function jsonlType(value: unknown): string {
  if (!isRecord(value)) return 'unknown';
  if (typeof value.type === 'string') return value.type;
  return 'unknown';
}

function isFinalMessageEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.text === 'string') return true;
  if (isRecord(value.message) && typeof value.message.content === 'string') return true;
  if (!isRecord(value.item)) return false;
  return value.item.type === 'agent_message' && (typeof value.item.text === 'string' || (isRecord(value.item.message) && typeof value.item.message.content === 'string'));
}

function projectPaths(input: CodexBoundaryInput): ProjectPaths {
  return new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId ?? DEFAULT_PROJECT_ID);
}

function isDoctorHealthy(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { ok?: unknown; status?: unknown };
    if (typeof parsed.ok === 'boolean') return parsed.ok;
    if (typeof parsed.status === 'string') return parsed.status.toLowerCase() !== 'error';
    return true;
  } catch {
    return stdout.trim().length > 0;
  }
}

function redactSensitive(text: string): string {
  const redacted = text
    .replace(/\bsk-(?:SECRET|[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_TOKEN]')
    .replace(/CODEX_ACCESS_TOKEN\s*=\s*[^"'\s,}]+/g, '[REDACTED_ENV_TOKEN]')
    .replace(/OPENAI_API_KEY\s*=\s*[^"'\s,}]+/g, '[REDACTED_ENV_TOKEN]')
    .replace(/\bCODEX_ACCESS_TOKEN\b/g, '[REDACTED_ENV_TOKEN]')
    .replace(/\bOPENAI_API_KEY\b/g, '[REDACTED_ENV_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  return redacted.replace(/[^\s"',}]+/g, (token) => (
    /(?:^|[\\/])(?:\.codex[\\/])?auth\.json/i.test(token)
      ? '[REDACTED_AUTH_FILE]'
      : token
  ));
}

function parseJsonSchema(schemaText: string, schemaPath: string): JsonSchemaNode {
  try {
    return JsonSchemaNodeSchema.parse(JSON.parse(schemaText));
  } catch (error) {
    throw new AppError('CODEX_OUTPUT_SCHEMA_INVALID', `Invalid output schema at ${schemaPath}: ${getErrorMessage(error)}`, 1);
  }
}

const JsonSchemaNodeSchema: z.ZodType<JsonSchemaNode> = z.lazy(() =>
  z.object({
    type: z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']).optional(),
    enum: z.array(z.unknown()).optional(),
    anyOf: z.array(JsonSchemaNodeSchema).min(1).optional(),
    required: z.array(z.string()).optional(),
    properties: z.record(z.string(), JsonSchemaNodeSchema).optional(),
    items: JsonSchemaNodeSchema.optional(),
    additionalProperties: z.union([z.boolean(), JsonSchemaNodeSchema]).optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional()
  })
);

interface JsonSchemaNode {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' | undefined;
  enum?: unknown[] | undefined;
  anyOf?: JsonSchemaNode[] | undefined;
  required?: string[] | undefined;
  properties?: Record<string, JsonSchemaNode> | undefined;
  items?: JsonSchemaNode | undefined;
  additionalProperties?: boolean | JsonSchemaNode | undefined;
  minItems?: number | undefined;
  maxItems?: number | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
}

function validateJsonSchemaSubset(value: unknown, schema: JsonSchemaNode, pointer = '$'): void {
  if (schema.anyOf !== undefined) {
    const matched = schema.anyOf.some((candidate) => {
      try {
        validateJsonSchemaSubset(value, candidate, pointer);
        return true;
      } catch {
        return false;
      }
    });
    if (!matched) {
      throw new AppError('CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', `Codex JSON output failed schema validation at ${pointer}: no anyOf branch matched`, 1);
    }
  }
  if (schema.type !== undefined && !matchesJsonType(value, schema.type)) {
    throw new AppError('CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', `Codex JSON output failed schema validation at ${pointer}: expected ${schema.type}`, 1);
  }
  if (schema.enum !== undefined && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    throw new AppError('CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', `Codex JSON output failed schema validation at ${pointer}: value is not in enum`, 1);
  }
  if (schema.type === 'object' || schema.properties !== undefined) {
    if (!isRecord(value)) {
      throw new AppError('CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', `Codex JSON output failed schema validation at ${pointer}: expected object`, 1);
    }
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in value)) {
        throw new AppError('CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', `Codex JSON output failed schema validation at ${pointer}.${requiredKey}: missing required property`, 1);
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) validateJsonSchemaSubset(value[key], propertySchema, `${pointer}.${key}`);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          throw new AppError('CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', `Codex JSON output failed schema validation at ${pointer}.${key}: additional property`, 1);
        }
      }
    }
  }
  if ((schema.type === 'array' || schema.items !== undefined) && Array.isArray(value) && schema.items !== undefined) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw new AppError('CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', `Codex JSON output failed schema validation at ${pointer}: expected at least ${schema.minItems} items`, 1);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw new AppError('CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', `Codex JSON output failed schema validation at ${pointer}: expected at most ${schema.maxItems} items`, 1);
    }
    value.forEach((item, index) => validateJsonSchemaSubset(item, schema.items!, `${pointer}[${index}]`));
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new AppError('CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', `Codex JSON output failed schema validation at ${pointer}: string is shorter than ${schema.minLength}`, 1);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new AppError('CODEX_OUTPUT_SCHEMA_VALIDATION_FAILED', `Codex JSON output failed schema validation at ${pointer}: string is longer than ${schema.maxLength}`, 1);
    }
  }
}

function matchesJsonType(value: unknown, type: NonNullable<JsonSchemaNode['type']>): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number';
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  return value === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractFinalMessage(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!) as {
        text?: unknown;
        message?: { content?: unknown };
        item?: { type?: unknown; text?: unknown; message?: { content?: unknown } };
      };
      if (typeof parsed.text === 'string') return redactSensitive(parsed.text);
      if (typeof parsed.message?.content === 'string') return redactSensitive(parsed.message.content);
      if (parsed.item?.type === 'agent_message' && typeof parsed.item.text === 'string') return redactSensitive(parsed.item.text);
      if (parsed.item?.type === 'agent_message' && typeof parsed.item.message?.content === 'string') return redactSensitive(parsed.item.message.content);
    } catch {
      // Keep looking for a JSONL message event.
    }
  }
  return redactSensitive(stdout);
}

function createRunId(operation: string): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `run_codex_${operation.replace(/[^a-z0-9]+/gi, '_')}_${timestamp}_${suffix}`;
}

function safePromptPath(filePath: string): string {
  return path.resolve(filePath);
}

async function safeFileSize(filePath: string, fileStore: FileStore): Promise<number> {
  try {
    return byteLength(await fileStore.readText(filePath));
  } catch {
    return 0;
  }
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function posixJoin(...segments: string[]): string {
  return path.posix.join(...segments);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
