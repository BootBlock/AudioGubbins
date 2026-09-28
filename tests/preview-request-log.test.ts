import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  createServer,
  get,
  type RequestListener,
  type Server,
  type ServerOptions,
} from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { devices } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_HEADER, testLabel } from './e2e/test.js';
import { inRepository } from './repository.js';

/**
 * The preview server's request log, over a real HTTP server on a loopback port
 * the system chooses.
 *
 * The plugin is driven through the hook Vite calls, with the server this file
 * starts in place of the preview server, so no build and no Vite server is
 * needed. It is loaded by a URL built at run time, so the compiler leaves the
 * module out of this project, whose root is `tests/`; the root project
 * compiles it.
 */

/** The environment variable the suite names each server's log in. */
const REQUEST_LOG = 'AUDIOGUBBINS_PREVIEW_REQUEST_LOG';

/** What this file calls of the module. */
type PreviewRequestLog = () =>
  | { readonly configurePreviewServer: (server: { readonly httpServer: unknown }) => void }
  | undefined;

/** The module's plugin factory, narrowed from what the import gives. */
async function loadPreviewRequestLog(): Promise<PreviewRequestLog> {
  const loaded: unknown = await import(
    pathToFileURL(inRepository('apps', 'web', 'preview-request-log.ts')).href
  );
  if (
    typeof loaded !== 'object' ||
    loaded === null ||
    !('previewRequestLog' in loaded) ||
    typeof loaded.previewRequestLog !== 'function'
  ) {
    throw new Error('apps/web/preview-request-log.ts no longer exports previewRequestLog.');
  }
  return loaded.previewRequestLog as PreviewRequestLog;
}

/**
 * The names of the plugins the web application's build configuration gives
 * Vite for a preview, with the environment as it is now.
 */
async function previewPluginNames(): Promise<readonly string[]> {
  const loaded: unknown = await import(
    pathToFileURL(inRepository('apps', 'web', 'vite.config.ts')).href
  );
  const configure =
    typeof loaded === 'object' && loaded !== null && 'default' in loaded
      ? loaded.default
      : undefined;
  if (typeof configure !== 'function') {
    throw new Error('apps/web/vite.config.ts no longer exports a configuration function.');
  }
  const config: unknown = (
    configure as (environment: {
      readonly command: string;
      readonly mode: string;
      readonly isPreview: boolean;
    }) => unknown
  )({ command: 'serve', mode: 'production', isPreview: true });
  const plugins =
    typeof config === 'object' && config !== null && 'plugins' in config
      ? config.plugins
      : undefined;
  if (!Array.isArray(plugins)) {
    throw new Error('apps/web/vite.config.ts no longer gives its plugins as a list.');
  }
  // A plugin may be given as a list of plugins, and an absent one as nothing.
  return plugins
    .flat(Number.POSITIVE_INFINITY)
    .flatMap((plugin: unknown) =>
      typeof plugin === 'object' &&
      plugin !== null &&
      'name' in plugin &&
      typeof plugin.name === 'string'
        ? [plugin.name]
        : [],
    );
}

/** A line's time, and the milliseconds since the log began, before what it says. */
const STAMP = String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z \+\d+\.\d`;

/** A pattern for one whole line of the log that says `text`, written as a pattern. */
function line(text: string): RegExp {
  return new RegExp(`^${STAMP} ${text}$`, 'm');
}

let folder: string;
let servers: Server[];

/** For each server, a promise for each connection it has had, kept when that connection closes. */
const connectionsClosed = new WeakMap<Server, Promise<void>[]>();

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'audiogubbins-request-log-'));
  servers = [];
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers) {
    if (server.listening) await closed(server);
  }
  rmSync(folder, { recursive: true, force: true });
});

/**
 * A server answering with `handler`, given the request log as the preview
 * server would be where the environment names `file`, and listening.
 */
async function serve(
  file: string | undefined,
  handler: RequestListener,
  options: ServerOptions = {},
): Promise<{ readonly server: Server; readonly port: number; readonly attached: boolean }> {
  vi.stubEnv(REQUEST_LOG, file);
  const server = createServer(options, handler);
  servers.push(server);
  const plugin = (await loadPreviewRequestLog())();
  plugin?.configurePreviewServer({ httpServer: server });
  // Added after the log's own listener, so each is kept after the log has
  // written the connection's closing.
  const closings: Promise<void>[] = [];
  connectionsClosed.set(server, closings);
  server.on('connection', (socket: Socket) => {
    closings.push(
      new Promise((resolve) => {
        socket.once('close', () => {
          resolve();
        });
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, port, attached: plugin !== undefined };
}

/**
 * Closes a server and waits until it and every connection it had have
 * closed, and the responses on them with them, after which the log has
 * written its last line and closed its file.
 *
 * A response says it has closed in a callback its connection's closing
 * queues, which runs before the next turn of the event loop.
 */
async function closed(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  await Promise.all(connectionsClosed.get(server) ?? []);
  await new Promise((resolve) => setImmediate(resolve));
}

/** Requests a path and waits for the whole answer, returning its status. */
function fetchStatus(
  port: number,
  path: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, headers }, (response) => {
      response.resume();
      response.on('end', () => {
        resolve(response.statusCode);
      });
    }).on('error', reject);
  });
}

/** What came back down a connection of its own, and whether the server closed it. */
interface Exchange {
  readonly answer: string;
  readonly closed: boolean;
}

/**
 * Sends `text` down a connection of its own and gathers what comes back,
 * until the server closes the connection or a second has passed with it
 * still open.
 *
 * A second is far longer than a server takes to answer and close on the
 * loopback, and the connection a server leaves open is the failure measured,
 * which only a bound on the wait can report rather than time out on.
 */
function exchange(port: number, text: string): Promise<Exchange> {
  return new Promise((resolve) => {
    const client = connect({ host: '127.0.0.1', port });
    const received: Buffer[] = [];
    const settle = (closed: boolean): void => {
      clearTimeout(bound);
      client.destroy();
      resolve({ answer: Buffer.concat(received).toString('latin1'), closed });
    };
    const bound = setTimeout(() => {
      settle(false);
    }, 1_000);
    client.on('data', (chunk: Buffer) => {
      received.push(chunk);
    });
    // A server that destroys its end may reset the connection once its answer
    // is out, which is a closing as much as an orderly end is.
    client.on('error', () => undefined);
    client.once('close', () => {
      settle(true);
    });
    client.write(text);
  });
}

/** The status lines among what came back down a connection. */
function statusLines(answer: string): readonly string[] {
  return answer.split('\r\n').filter((one) => one.startsWith('HTTP/'));
}

/** The head of a request whose body comes in chunks. */
const CHUNKED_HEAD = 'POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n';

/**
 * Each `name="value"` field of the log's request lines, in the order the
 * requests came, read back to the value the request carried; `-` stands for
 * a request that carried none.
 */
function fieldsOf(log: string, name: string): readonly string[] {
  return [...log.matchAll(new RegExp(` ${name}=("(?:[^"\\\\]|\\\\.)*"|-)`, 'g'))].map(
    ([, field]) => (field === '-' ? '-' : (JSON.parse(field ?? '') as string)),
  );
}

describe('the preview request log', () => {
  it("is among the build configuration's plugins only where a file is named", async () => {
    vi.stubEnv(REQUEST_LOG, undefined);
    const without = await previewPluginNames();
    vi.stubEnv(REQUEST_LOG, join(folder, 'preview-requests.log'));
    const named = await previewPluginNames();

    // A control: the configuration's own plugin is read either way.
    expect(without).toContain('audiogubbins:content-security-policy');
    expect(without).not.toContain('audiogubbins:preview-request-log');
    expect(named).toContain('audiogubbins:preview-request-log');
  });

  it('attaches nothing, and writes nothing, where no file is named', async () => {
    const { server, port, attached } = await serve(undefined, (_request, response) => {
      response.end();
    });
    const listeners = server.listenerCount('request');

    expect(attached).toBe(false);
    expect(await fetchStatus(port, '/')).toBe(200);
    expect(listeners).toBe(1);
    expect(readdirSync(folder)).toEqual([]);
  });

  it('writes the server it listens on, and a request it answered with its status, in a folder it makes', async () => {
    // Into a folder that does not exist yet, as the suite's output folder does
    // not when its servers start.
    const file = join(folder, 'test-results', 'preview-requests.log');
    const { server, port } = await serve(file, (_request, response) => {
      response.statusCode = 204;
      response.end();
    });

    expect(await fetchStatus(port, '/answered?x=1')).toBe(204);
    await closed(server);
    const log = readFileSync(file, 'utf8');

    expect(log).toMatch(
      line(
        `listening ${String(port)} keepAliveTimeout=\\d+ headersTimeout=\\d+ ` +
          `requestTimeout=\\d+ maxRequestsPerSocket=\\d+ node=v[\\d.]+`,
      ),
    );
    expect(log).toMatch(line(String.raw`c1 request GET /answered\?x=1 connection=\S+ ua=- test=-`));
    expect(log).toMatch(line(String.raw`c1 finish GET /answered\?x=1 204 \d+\.\dms`));
    expect(log).not.toMatch(/closed-unfinished/);
  });

  it('writes the closing of a connection that outlasts the server', async () => {
    // The client keeps its connection open for the next request, so it is
    // still open when the server is shut, and its closing is reported after
    // the server's, as the suite's servers are shut at the end of a run.
    const file = join(folder, 'preview-requests.log');
    const { server, port } = await serve(file, (_request, response) => {
      response.end();
    });
    expect(await fetchStatus(port, '/')).toBe(200);
    expect(readFileSync(file, 'utf8')).not.toMatch(/ close /);

    await closed(server);

    expect(readFileSync(file, 'utf8')).toMatch(line('c1 close hadError=false'));
  });

  it('empties a log a previous run left', async () => {
    const file = join(folder, 'preview-requests.log');
    writeFileSync(file, 'a line from the run before\n', 'utf8');
    const { server } = await serve(file, (_request, response) => {
      response.end();
    });
    await closed(server);

    expect(readFileSync(file, 'utf8')).not.toContain('the run before');
    expect(readFileSync(file, 'utf8')).toMatch(line('listening .*'));
  });

  it('writes a request never answered with no finish, and as unfinished once its connection goes', async () => {
    const file = join(folder, 'preview-requests.log');
    let received: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      received = resolve;
    });
    let responseClosed: () => void = () => undefined;
    const gone = new Promise<void>((resolve) => {
      responseClosed = resolve;
    });
    const { server, port } = await serve(file, (_request, response) => {
      // Never answered, as a page load that hangs is not.
      response.on('close', () => {
        setImmediate(responseClosed);
      });
      setImmediate(received);
    });

    const request = get({ host: '127.0.0.1', port, path: '/unanswered' });
    request.on('error', () => undefined);
    await arrived;

    const waiting = readFileSync(file, 'utf8');
    expect(waiting).toMatch(line('c1 request GET /unanswered connection=\\S+ ua=- test=-'));
    expect(waiting).not.toMatch(/finish|closed-unfinished/);

    request.destroy();
    await gone;
    await closed(server);
    const log = readFileSync(file, 'utf8');

    expect(log).toMatch(line('c1 closed-unfinished GET /unanswered'));
    expect(log).not.toMatch(/ finish /);
  });

  it("writes a connection's opening, with its peer, and its closing", async () => {
    const file = join(folder, 'preview-requests.log');
    const { server, port } = await serve(file, (_request, response) => {
      response.end();
    });
    const serverSide = new Promise<Socket>((resolve) => {
      server.once('connection', resolve);
    });

    const client = connect({ host: '127.0.0.1', port });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    const peer = client.localPort;
    const socket = await serverSide;
    const socketClosed = new Promise<void>((resolve) =>
      socket.once('close', () => {
        resolve();
      }),
    );
    client.end();
    await socketClosed;
    await closed(server);
    const log = readFileSync(file, 'utf8');

    expect(log).toMatch(line(`c1 open 127\\.0\\.0\\.1:${String(peer)}`));
    expect(log).toMatch(line('c1 end'));
    expect(log).toMatch(line('c1 close hadError=false'));
  });

  it('tells a Chromium request from a Firefox one, by the whole user agent', async () => {
    // The two desktop devices the suite's projects are made from, whose agents
    // begin with the same forty characters, the platform's.
    const file = join(folder, 'preview-requests.log');
    const { server, port } = await serve(file, (_request, response) => {
      response.end();
    });
    const chromium = devices['Desktop Chrome'].userAgent;
    const firefox = devices['Desktop Firefox'].userAgent;
    expect(chromium.slice(0, 40)).toBe(firefox.slice(0, 40));

    expect(await fetchStatus(port, '/', { 'User-Agent': chromium })).toBe(200);
    expect(await fetchStatus(port, '/', { 'User-Agent': firefox })).toBe(200);
    await closed(server);
    const agents = fieldsOf(readFileSync(file, 'utf8'), 'ua');

    expect(agents).toEqual([chromium, firefox]);
    expect(agents[0]).toContain('Chrome/');
    expect(agents[1]).toContain('Firefox/');
  });

  it('writes the header naming the project and the test, whole, as the suite sends it', async () => {
    // Built as the suite's `test` builds it, from a title holding what a
    // header value cannot carry as it stands: spaces, quotation marks, a
    // per cent sign and letters outside ASCII.
    const file = join(folder, 'preview-requests.log');
    const { server, port } = await serve(file, (_request, response) => {
      response.end();
    });
    const titlePath = ['smoke.spec.ts', 'the workspace', 'names "Café" at 50% of the width'];
    const label = testLabel('firefox-text-110', titlePath);

    expect(await fetchStatus(port, '/labelled', { [TEST_HEADER]: label })).toBe(200);
    await closed(server);
    const labels = fieldsOf(readFileSync(file, 'utf8'), 'test');

    expect(labels).toEqual([label]);
    expect(labels[0]?.split(' ').map((part) => decodeURIComponent(part))).toEqual([
      'firefox-text-110',
      ...titlePath,
    ]);
  });

  it.each([
    ['a request line it cannot read', 'BROKEN REQUEST LINE\r\n\r\n', 400, 'HPE_INVALID_METHOD'],
    [
      'headers longer than it takes',
      `GET / HTTP/1.1\r\nHost: localhost\r\nX-Long: ${'a'.repeat(20_000)}\r\n\r\n`,
      431,
      'HPE_HEADER_OVERFLOW',
    ],
    [
      'chunk extensions longer than it takes',
      `${CHUNKED_HEAD}1;a=${'b'.repeat(20_000)}\r\nx\r\n0\r\n\r\n`,
      413,
      'HPE_CHUNK_EXTENSIONS_OVERFLOW',
    ],
  ])('answers %s as Node does, and closes the connection', async (_case, text, status, code) => {
    // Listening for client errors takes them over from Node, which answers one
    // and closes the connection only where nothing listens. The response is
    // begun only once the body has been read, so a client error in the body
    // meets a response that has written nothing.
    const file = join(folder, 'preview-requests.log');
    const { server, port } = await serve(file, (request, response) => {
      request.resume();
      request.on('end', () => {
        response.end();
      });
    });

    const { answer, closed: gone } = await exchange(port, text);
    await closed(server);

    expect({ answer: answer.split('\r\n')[0], closed: gone }).toEqual({
      answer: expect.stringMatching(new RegExp(`^HTTP/1\\.1 ${String(status)} `)),
      closed: true,
    });
    expect(readFileSync(file, 'utf8')).toMatch(
      line(`c1 clientError ${code} answer=${String(status)}`),
    );
  });

  it('answers a request that runs out of time as Node does, with 408, and closes the connection', async () => {
    // A request whose headers never end, on a server that checks its
    // connections often, so the time runs out within the test.
    const file = join(folder, 'preview-requests.log');
    const { server, port } = await serve(
      file,
      (_request, response) => {
        response.end();
      },
      { connectionsCheckingInterval: 20, headersTimeout: 100, requestTimeout: 100 },
    );

    const { answer, closed: gone } = await exchange(port, 'GET / HTTP/1.1\r\nHost: localhost\r\n');
    await closed(server);

    expect({ answer: answer.split('\r\n')[0], closed: gone }).toEqual({
      answer: 'HTTP/1.1 408 Request Timeout',
      closed: true,
    });
    expect(readFileSync(file, 'utf8')).toMatch(
      line('c1 clientError ERR_HTTP_REQUEST_TIMEOUT answer=408'),
    );
  });

  it('writes no second answer after a response that has written its head, and closes the connection', async () => {
    // The head is written to the connection before the body arrives, whose
    // chunk size cannot be read. A second status line would be read by the
    // browser as the start of the body.
    const file = join(folder, 'preview-requests.log');
    const { server, port } = await serve(file, (_request, response) => {
      response.writeHead(200);
      response.flushHeaders();
    });

    const { answer, closed: gone } = await exchange(port, `${CHUNKED_HEAD}zz\r\n`);
    await closed(server);

    expect({ answers: statusLines(answer), closed: gone }).toEqual({
      answers: ['HTTP/1.1 200 OK'],
      closed: true,
    });
    expect(readFileSync(file, 'utf8')).toMatch(
      line('c1 clientError HPE_INVALID_CHUNK_SIZE answer=-'),
    );
  });

  it('answers as Node does, with 400, after a response that has built its head but written none of it', async () => {
    // `writeHead` builds the head and writes nothing to the connection, so
    // Node still answers the client error there, and the head built is never
    // sent.
    const file = join(folder, 'preview-requests.log');
    const { server, port } = await serve(file, (_request, response) => {
      response.writeHead(200);
    });

    const { answer, closed: gone } = await exchange(port, `${CHUNKED_HEAD}zz\r\n`);
    await closed(server);

    expect({ answers: statusLines(answer), closed: gone }).toEqual({
      answers: ['HTTP/1.1 400 Bad Request'],
      closed: true,
    });
    expect(readFileSync(file, 'utf8')).toMatch(
      line('c1 clientError HPE_INVALID_CHUNK_SIZE answer=400'),
    );
  });

  it('writes nothing to a connection the server has ended, and writes its client error down', async () => {
    // The server ends its side of the connection on the first request, and a
    // second it cannot read follows on it, with no response to it begun.
    const file = join(folder, 'preview-requests.log');
    const { server, port } = await serve(file, (request) => {
      request.socket.end();
    });

    const { answer, closed: gone } = await exchange(
      port,
      'GET / HTTP/1.1\r\nHost: localhost\r\n\r\nBROKEN REQUEST LINE\r\n\r\n',
    );
    await closed(server);

    expect({ answer, closed: gone }).toEqual({ answer: '', closed: true });
    expect(readFileSync(file, 'utf8')).toMatch(line('c1 clientError HPE_INVALID_METHOD answer=-'));
  });

  it('refuses a server that is not a plain HTTP server', async () => {
    vi.stubEnv(REQUEST_LOG, join(folder, 'preview-requests.log'));
    const plugin = (await loadPreviewRequestLog())();

    expect(plugin).toBeDefined();
    expect(() => plugin?.configurePreviewServer({ httpServer: {} })).toThrow(REQUEST_LOG);
    expect(existsSync(join(folder, 'preview-requests.log'))).toBe(false);
  });
});
