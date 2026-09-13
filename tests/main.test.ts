import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { links, productHtml } from './helpers.js';

const ROOT = 'https://shop.test/static';

/** A `fetch` serving an in-memory site; unknown URLs get a 404. */
function fakeFetch(pages: Record<string, string>): typeof fetch {
  return async (input) => {
    const html = pages[String(input)];
    return new Response(html ?? 'not found', { status: html === undefined ? 404 : 200 });
  };
}

function capture() {
  const stream = new PassThrough();
  let text = '';
  stream.on('data', (chunk: Buffer) => (text += chunk.toString()));
  return { stream, text: () => text };
}

const site: Record<string, string> = {
  [ROOT]: links('/static/product/1', '/static/product/2'),
  [`${ROOT}/product/1`]: productHtml('Laptop', '$100'),
  [`${ROOT}/product/2`]: productHtml('Phone', '$9.99'),
};

async function run(argv: string[], pages = site) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(['--url', ROOT, ...argv], {
    fetch: fakeFetch(pages),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

describe('main', () => {
  it('prints the report to stdout and a summary to stderr, exit 0', async () => {
    const { code, stdout, stderr } = await run([]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      results: [
        { name: 'Laptop', description: 'desc', price: 100 },
        { name: 'Phone', description: 'desc', price: 9.99 },
      ],
      total: 109.99,
    });
    expect(stderr).toMatch(/info {2}done .*results=2 total=109.99 failures=0/);
  });

  it('writes to --output and nothing to stdout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scraper-'));
    const file = join(dir, 'out.json');

    const { code, stdout } = await run(['--output', file]);

    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(JSON.parse(await readFile(file, 'utf8')).total).toBe(109.99);
  });

  it('exits 2 and logs each failure when some product pages fail', async () => {
    const partial = Object.fromEntries(
      Object.entries(site).filter(([url]) => !url.endsWith('/product/2')),
    );

    const { code, stdout, stderr } = await run([], partial);

    expect(code).toBe(2);
    expect(JSON.parse(stdout).results).toHaveLength(1);
    expect(stderr).toMatch(/error product page failed url=.*product\/2 reason=".*HTTP 404.*"/);
  });

  it('emits JSON lines with --log-format json', async () => {
    const { stderr } = await run(['--log-format', 'json', '--quiet']);
    expect(stderr).toBe(''); // quiet: nothing at info level

    const { stderr: verbose } = await run(['--log-format', 'json']);
    const last = JSON.parse(verbose.trim().split('\n').at(-1)!);
    expect(last).toMatchObject({ level: 'info', msg: 'done', results: 2 });
  });

  it('prints help and exits 0', async () => {
    const { code, stdout } = await run(['--help']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Usage: ecommerce-scraper/);
  });

  it.each([
    [['--concurrency', '0'], /--concurrency: /],
    [['--delay', 'abc'], /--delay: /],
    [['--max-pages', '1.5'], /--max-pages: /],
    [['--log-format', 'xml'], /--log-format: /],
    [['--url', 'not a url'], /--url: /],
    [['--output', '/nonexistent-dir/out.json'], /ENOENT.*\/nonexistent-dir/],
    [['--bogus'], /Unknown option/],
  ])('rejects invalid arguments %j before crawling', async (argv, message) => {
    await expect(run(argv)).rejects.toThrow(message);
  });
});
