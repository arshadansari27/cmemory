const PREFIX = '[cmemory]';

export function debug(...args: unknown[]): void {
  if (process.env.CMEMORY_DEBUG) {
    process.stderr.write(`${PREFIX} DEBUG: ${args.map(String).join(' ')}\n`);
  }
}

export function info(...args: unknown[]): void {
  process.stderr.write(`${PREFIX} ${args.map(String).join(' ')}\n`);
}

export function warn(...args: unknown[]): void {
  process.stderr.write(`${PREFIX} WARN: ${args.map(String).join(' ')}\n`);
}

export function error(...args: unknown[]): void {
  process.stderr.write(`${PREFIX} ERROR: ${args.map(String).join(' ')}\n`);
}
