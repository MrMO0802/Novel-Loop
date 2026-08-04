import { readFile } from 'node:fs/promises';

import { adoptDesktopChapterDraft } from '../../dist/desktop/index.js';
import { FileStore } from '../../dist/storage/FileStore.js';

const [projectRoot, payloadPath] = process.argv.slice(2);
if (projectRoot === undefined || payloadPath === undefined) {
  throw new Error('Expected project root and payload path.');
}

const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
const originalWriteJson = FileStore.prototype.writeJson;
FileStore.prototype.writeJson = async function writeJsonAndCrash(
  filePath,
  value,
  schema
) {
  const result = await originalWriteJson.call(this, filePath, value, schema);
  if (
    filePath.endsWith('draft_revision_v1.json')
    && typeof value === 'object'
    && value !== null
    && value.state === 'superseded'
  ) {
    process.kill(process.pid, 'SIGKILL');
  }
  return result;
};

await adoptDesktopChapterDraft({
  projectRoot,
  markdown: payload.markdown,
  expectedSourceHash: payload.expectedSourceHash
});

throw new Error('Crash injection boundary was not reached.');
