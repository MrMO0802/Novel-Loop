#!/usr/bin/env node
import { createProgram } from './program.js';
import { formatCliError, getCliExitCode } from './errors.js';

const program = createProgram();

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(formatCliError(error));
  process.exitCode = getCliExitCode(error);
});
