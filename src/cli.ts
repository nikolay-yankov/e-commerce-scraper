#!/usr/bin/env node
/**
 * Process entrypoint. Everything testable lives in main.ts; this file only maps the
 * result onto the process: exit code, fatal-error line, and pipe behaviour.
 */
import { errorMessage, main, ShutdownError } from './main.js';

// `cli | head` closes our stdout early. That's the reader's choice, not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

// Set exitCode rather than calling process.exit(): stdout writes to a pipe are async and
// exit() would truncate large reports at ~64 KB before the buffer is flushed.
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(`fatal: ${errorMessage(err)}`);
    process.exitCode = err instanceof ShutdownError ? err.exitCode : 1;
  });
