import { randomBytes } from 'node:crypto';

export function createRunId(now = new Date(), suffix = randomBytes(3).toString('hex')): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');

  return `run_${year}${month}${day}_${hours}${minutes}${seconds}_${suffix}`;
}
