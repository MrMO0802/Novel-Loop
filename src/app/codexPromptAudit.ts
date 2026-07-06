import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { CodexPromptAuditReportSchema } from '../schemas/index.js';
import type { CodexPromptAuditReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';

export interface AuditCodexPromptsInput {
  promptRoot: string;
  maxPromptBytes?: number;
  projectId?: string;
}

export interface AuditCodexPromptsResult {
  report: CodexPromptAuditReport;
}

const REQUIRED_METADATA = ['promptId', 'task', 'expectedOutput', 'contextBudget', 'qualityRisks'];
const SECRET_TERM_PATTERN = /\b(auth|token|api[_ -]?key|secret|bearer|password)\b/i;

export async function auditCodexPrompts(input: AuditCodexPromptsInput, fileStore = new FileStore()): Promise<AuditCodexPromptsResult> {
  const maxPromptBytes = input.maxPromptBytes ?? 16_000;
  const promptPaths = await listMarkdownFiles(input.promptRoot);
  const issues: CodexPromptAuditReport['issues'] = [];
  const auditedPrompts: CodexPromptAuditReport['auditedPrompts'] = [];
  for (const promptPath of promptPaths) {
    const relativePath = path.relative(input.promptRoot, promptPath).split(path.sep).join(path.posix.sep);
    const text = await fileStore.readText(promptPath);
    const sizeBytes = Buffer.byteLength(text, 'utf8');
    const metadata = parseFrontMatter(text);
    if (metadata === undefined) {
      issues.push(issue('PROMPT_METADATA_MISSING', relativePath, 'Prompt is missing M27 YAML metadata.'));
    } else {
      for (const key of REQUIRED_METADATA) {
        if ((metadata[key] ?? '').trim().length === 0) {
          issues.push(issue('PROMPT_METADATA_FIELD_MISSING', relativePath, `Prompt metadata field ${key} is missing.`));
        }
      }
    }
    if (sizeBytes > maxPromptBytes) {
      issues.push(issue('PROMPT_TOO_LONG', relativePath, `Prompt is ${sizeBytes} bytes, above limit ${maxPromptBytes}.`));
    }
    if (SECRET_TERM_PATTERN.test(text)) {
      issues.push(issue('PROMPT_SECRET_TERM', relativePath, 'Prompt contains secret/auth/token wording that can encourage leaking credentials.'));
    }
    if (/json/i.test(metadata?.expectedOutput ?? relativePath) && !/schema|output-schema|json schema/i.test(text)) {
      issues.push(issue('PROMPT_JSON_SCHEMA_NOT_EXPLICIT', relativePath, 'JSON prompt must explicitly require schema-constrained output.'));
    }
    auditedPrompts.push({
      path: relativePath,
      ...(metadata?.promptId === undefined ? {} : { promptId: metadata.promptId }),
      ...(metadata?.task === undefined ? {} : { task: metadata.task }),
      ...(metadata?.expectedOutput === undefined ? {} : { expectedOutput: metadata.expectedOutput }),
      ...(metadata?.contextBudget === undefined ? {} : { contextBudget: metadata.contextBudget }),
      ...(metadata?.qualityRisks === undefined ? {} : { qualityRisks: metadata.qualityRisks }),
      sizeBytes
    });
  }
  const report = CodexPromptAuditReportSchema.parse({
    reportId: 'codex_prompt_audit_report',
    projectId: input.projectId ?? 'prompt-pack',
    promptRoot: input.promptRoot,
    generatedAt: new Date().toISOString(),
    ok: issues.every((item) => item.severity !== 'error'),
    promptCount: promptPaths.length,
    maxPromptBytes,
    issues,
    auditedPrompts
  });
  return { report };
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(absolute)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(absolute);
    } else if (!entry.isDirectory()) {
      const info = await stat(absolute);
      if (info.isFile() && entry.name.endsWith('.md')) files.push(absolute);
    }
  }
  return files.sort();
}

function parseFrontMatter(text: string): Record<string, string> | undefined {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (match === null) return undefined;
  const result: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    result[key] = value;
  }
  return result;
}

function issue(code: string, pathValue: string, message: string): CodexPromptAuditReport['issues'][number] {
  return {
    code,
    path: pathValue,
    message,
    severity: 'error'
  };
}
