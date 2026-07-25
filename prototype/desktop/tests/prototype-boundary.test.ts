import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

type ForbiddenPattern = {
  name: string;
  pattern: RegExp;
};

const forbiddenPatterns: ForbiddenPattern[] = [
  {
    name: 'production module import',
    pattern: /(?:\bfrom\s+|\bimport\s*(?:type\s+)?(?:\(\s*)?|\brequire\s*\(\s*|\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s*)(?:['"])(?:[^'"]*\/)?src\/(?:app|storage|providers|cli)(?:\/|['"])/
  },
  {
    name: 'Node module import',
    pattern: /(?:\bfrom\s+|\bimport\s*(?:type\s+)?(?:\(\s*)?|\brequire\s*\(\s*|\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s*)(?:['"])(?:node:[^'"]+|(?:assert|async_hooks|buffer|child_process|cluster|console|constants|crypto|dgram|diagnostics_channel|dns|domain|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|wasi|worker_threads|zlib)(?:\/[^'"]*)?)(?:['"])/
  },
  {
    name: 'Node process API',
    pattern: /\bprocess\s*(?:\.|\[|\()/
  },
  {
    name: 'Node runtime API',
    pattern: /\b(?:Buffer|__dirname|__filename|global|module|exports|require)\b/
  },
  {
    name: 'filesystem API',
    pattern: /\b(?:access|accessSync|appendFile|appendFileSync|chmod|chmodSync|copyFile|copyFileSync|cp|cpSync|createReadStream|createWriteStream|existsSync|lstat|lstatSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|open|openSync|read|readFile|readFileSync|readdir|readdirSync|realpath|realpathSync|rename|renameSync|rm|rmSync|rmdir|rmdirSync|stat|statSync|unlink|unlinkSync|watch|write|writeFile|writeFileSync)\s*\(/
  },
  {
    name: 'Node child-process API',
    pattern: /\b(?:exec|execFile|execSync|fork|spawn|spawnSync)\s*\(/
  },
  {
    name: 'Electron module import',
    pattern: /\belectron(?:[/'"]|$)/i
  },
  {
    name: 'Electron API',
    pattern: /\b(?:BrowserWindow|contextBridge|ipcMain|ipcRenderer|nativeImage|session|webContents)\b|\bshell\s*(?:\.\s*(?!css(?:['"]|$))[A-Za-z_$]|\[)/
  },
  {
    name: 'Codex executable invocation',
    pattern: /\b(?:exec|execFile|execSync|fork|spawn|spawnSync)\s*\(\s*['"]codex['"]/i
  },
  {
    name: 'Codex CLI command',
    pattern: /['"`]\s*codex\s+(?:exec|login|logout|--[\w-]+)/i
  },
  {
    name: 'Codex integration API',
    pattern: /\b(?:codexClient|CodexClient|invokeCodex|runCodex|executeCodex)\b|\bwindow\s*\.\s*codex\b/
  }
];

function sourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((entry) => {
    const absolute = path.join(root, entry);
    return statSync(absolute).isDirectory() ? sourceFiles(absolute) : [absolute];
  }).filter((file) => /\.(ts|tsx)$/.test(file));
}

function withoutFixtureSessionIdentifier(content: string): string {
  return content.replace(/(['"`])session\.previous-close\.incomplete\1/g, '');
}

function findForbiddenPatterns(content: string): ForbiddenPattern[] {
  const contentWithoutFixtureIdentifier = withoutFixtureSessionIdentifier(content);

  return forbiddenPatterns.filter(({ name, pattern }) => (
    pattern.test(contentWithoutFixtureIdentifier)
  ));
}

describe('prototype boundary', () => {
  test.each([
    ['a CLI import', "import { run } from '../src/cli/runner';", 'production module import'],
    ['a side-effect production import', "import '../src/storage/register';", 'production module import'],
    ['a dynamic production import', "const load = () => import('../src/providers/runtime');", 'production module import'],
    ['a Node built-in import', "import path from 'path';", 'Node module import'],
    ['a process API', 'const projectPath = process.cwd();', 'Node process API'],
    ['a filesystem API', "fs.readFileSync('project.json', 'utf8');", 'filesystem API'],
    ['an Electron API binding', "window.ipcRenderer.send('open-project');", 'Electron API'],
    ['a computed Electron API binding', "window['ipcRenderer'].send('open-project');", 'Electron API'],
    ['a computed Electron session binding', "window['session'].defaultSession.clearStorageData();", 'Electron API'],
    ['an Electron shell API binding', "shell.openPath('draft.txt');", 'Electron API'],
    ['an Electron session API binding', 'session.defaultSession.clearStorageData();', 'Electron API'],
    ['a Codex executable invocation', "spawn('codex', ['exec', '--json']);", 'Codex executable invocation'],
    ['a Codex CLI command string', "const command = 'codex exec --json';", 'Codex CLI command'],
    ['a Codex integration API', 'codexClient.run(request);', 'Codex integration API']
  ])('rejects %s', (_description, source, expectedName) => {
    expect(findForbiddenPatterns(source).map(({ name }) => name)).toContain(expectedName);
  });

  test('allows imports from the prototype presentation shell', () => {
    expect(findForbiddenPatterns("import { ApplicationShell } from '../shell/ApplicationShell';")).toEqual([]);
    expect(findForbiddenPatterns("import './styles/shell.css';")).toEqual([]);
  });

  test('allows author-facing Codex copy and message keys', () => {
    const copy = "const ready = 'Codex 已准备好'; const key = 'setup.codex.ready';";

    expect(findForbiddenPatterns(copy)).toEqual([]);
  });

  test('allows fixture technical identifiers that contain the word session', () => {
    const fixture = "const technical = 'session.previous-close.incomplete';";

    expect(findForbiddenPatterns(fixture)).toEqual([]);
  });

  test('does not import production engine, Node, Electron, or provider integration APIs', () => {
    for (const file of sourceFiles(path.resolve('src'))) {
      const content = readFileSync(file, 'utf8');
      expect(findForbiddenPatterns(content), file).toEqual([]);
    }
  });
});
