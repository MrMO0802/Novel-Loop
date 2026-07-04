import type { Command } from 'commander';

import type { CodexProfile } from '../providers/providerTypes.js';
import { AppError } from '../utils/AppError.js';

export interface CodexCliOptions {
  provider?: string;
  codexBin?: string;
  codexProfile?: string;
  codexJsonRetries?: string;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: string;
}

export interface ResolvedCodexCliOptions {
  codexBin?: string;
  codexProfile: CodexProfile;
  codexJsonRetries: number;
  codexJsonRepair: boolean;
  codexJsonRepairRetries: number;
}

export function addCodexOptions(command: Command): Command {
  return command
    .option('--codex-bin <path>', 'path to local codex CLI binary when using --provider codex-text')
    .option('--codex-profile <profile>', 'codex runtime profile: default, clean, or debug', 'default')
    .option('--codex-json-retries <count>', 'codex JSON retry attempts before repair', '1')
    .option('--codex-json-repair', 'enable codex JSON repair fallback', true)
    .option('--no-codex-json-repair', 'disable codex JSON repair fallback')
    .option('--codex-json-repair-retries <count>', 'codex JSON repair attempts after retries fail', '1');
}

export function resolveCodexCliOptions(options: CodexCliOptions): ResolvedCodexCliOptions {
  return {
    ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
    codexProfile: parseCodexProfile(options.codexProfile ?? 'default'),
    codexJsonRetries: parseNonNegativeInteger(options.codexJsonRetries ?? '1', 'codexJsonRetries'),
    codexJsonRepair: options.codexJsonRepair !== false,
    codexJsonRepairRetries: parseNonNegativeInteger(options.codexJsonRepairRetries ?? '1', 'codexJsonRepairRetries')
  };
}

export function resolveCodexCliOptionsIfNeeded(options: CodexCliOptions): Partial<ResolvedCodexCliOptions> {
  if (options.provider !== 'codex-text') {
    return options.codexBin === undefined ? {} : { codexBin: options.codexBin };
  }
  return resolveCodexCliOptions(options);
}

function parseCodexProfile(value: string): CodexProfile {
  if (value === 'default' || value === 'clean' || value === 'debug') {
    return value;
  }
  throw new AppError('INVALID_CODEX_PROFILE', 'codexProfile must be one of: default, clean, debug', 2);
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a non-negative integer`, 2);
  }
  return parsed;
}
