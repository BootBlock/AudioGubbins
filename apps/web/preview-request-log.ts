import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { STATUS_CODES, Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import type { Plugin } from 'vite';

/**
 * A log of what the preview server received and answered, for the browser
 * suite.
 *
 * A page load that times out in the suite shows, in the browser's trace, a
 * request with no response. Whether the server received that request and
 * answered it is what separates a server that stalled from a browser that
 * never sent the request, and Vite's preview server logs no requests. The
 * suite names a file in the variable below for each server it starts, and the
 * server writes each connection, each request and each response to it.
 *
 * Each line is written synchronously through the one descriptor, so the lines
 * written before a hang are on disk when the suite kills the server at the end
 * of the run. What a line holds is the request line, the connection header,
 * the whole user agent, the header in which the suite names the project and
 * the test that made the request, and the status: no other header and no body.
 * The user agent tells one engine from another, and the suite's header tells
 * one project and one test from another where several run against the one
 * server at once.
 *
 * The log keeps the server's answers as Node gives them. Listening for a
 * client error takes the connection over from Node, which answers one and
 * closes the connection only where nothing listens, so the listener here
 * answers and closes as Node would once it has written the error down.
 */

/** The environment variable that names the log file. */
const REQUEST_LOG = 'AUDIOGUBBINS_PREVIEW_REQUEST_LOG';

/**
 * The request header in which the browser suite names the project and the
 * test that made a request, written as Node gives a header's name, in lower
 * case.
 *
 * The suite declares the header it sends in `tests/e2e/test.ts`, which the
 * compiler keeps apart from this module, and
 * `tests/preview-request-log.test.ts` sends it as the suite does and finds it
 * here, so the two cannot name different headers unseen.
 */
const TEST_HEADER = 'audiogubbins-test';

/**
 * The status Node's HTTP server answers a client error with where nothing
 * listens for one, by the error's code: 400 for any code not here.
 */
const CLIENT_ERROR_STATUS: ReadonlyMap<string, number> = new Map([
  ['HPE_HEADER_OVERFLOW', 431],
  ['HPE_CHUNK_EXTENSIONS_OVERFLOW', 413],
  ['ERR_HTTP_REQUEST_TIMEOUT', 408],
]);

/**
 * The request log, as a plugin of the preview server alone, or nothing where
 * the environment names no file.
 *
 * Nothing rather than a plugin that does nothing: Vite skips its check that the
 * build exists before a preview whenever any plugin configures the preview
 * server, so a plugin present in every configuration would lose a developer
 * that check. The hook runs in the preview server only, never in a build or in
 * the development server.
 */
export function previewRequestLog(): Plugin | undefined {
  const file = process.env[REQUEST_LOG];
  if (file === undefined) return undefined;
  return {
    name: 'audiogubbins:preview-request-log',
    configurePreviewServer: (server) => {
      // The preview server is an HTTP/2 server only when it is given a
      // certificate, which the suite never gives it, and the events read below
      // are the HTTP/1 server's.
      if (!(server.httpServer instanceof Server)) {
        throw new Error(`${REQUEST_LOG} is read by a plain HTTP preview server only.`);
      }
      logRequests(server.httpServer, file);
    },
  };
}

/** The code of a socket's error, or its message where it has none. */
function errorCode(error: Error): string {
  return 'code' in error && typeof error.code === 'string' ? error.code : error.message;
}

/**
 * Whether a response has written its head to its connection, read as Node's
 * own answer to a client error reads it.
 *
 * `headersSent` is true once the head is built, and `writeHead` builds it
 * without writing it: Node still answers a client error then, since nothing of
 * the response is on the connection yet. What Node reads is a field of its
 * own, which Node's types leave out, so it is read here as Node reads it, and
 * the request log's tests hold both sides of it.
 */
function headWritten(response: ServerResponse | undefined): boolean {
  return response !== undefined && '_headerSent' in response && response._headerSent === true;
}

/**
 * A header's value as a line of the log holds it: quoted, so the spaces a
 * user agent holds cannot end its field, or `-` where the request has none.
 */
function headerField(value: string | readonly string[] | undefined): string {
  if (value === undefined) return '-';
  return JSON.stringify(typeof value === 'string' ? value : value.join(', '));
}

/**
 * Writes what `server` receives and answers to `file`, from now until the
 * server and everything it opened have closed.
 *
 * The file is emptied first. Playwright empties its output folder before it
 * starts a server, so the folder is made here if it is missing.
 */
function logRequests(server: Server, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const descriptor = openSync(file, 'w');
  const started = performance.now();
  const log = (text: string): void => {
    const elapsed = (performance.now() - started).toFixed(1);
    writeSync(descriptor, `${new Date().toISOString()} +${elapsed} ${text}\n`);
  };

  // Each connection is numbered in the order it opened, so a request and the
  // connection it came on can be matched up in the log.
  const connections = new WeakMap<Socket, number>();

  // The responses each connection has yet to finish, in the order their
  // requests came. The first is the one Node has given the connection, and
  // an answer to a client error is written only while that one has sent
  // nothing, as Node's own is.
  const unfinished = new WeakMap<Socket, ServerResponse[]>();
  const settled = (socket: Socket, response: ServerResponse): void => {
    const waiting = unfinished.get(socket) ?? [];
    const index = waiting.indexOf(response);
    if (index >= 0) waiting.splice(index, 1);
  };
  let opened = 0;
  const named = (socket: Socket): string => `c${String(connections.get(socket) ?? '?')}`;

  // The descriptor is closed once nothing is left to write about. The server
  // reports that it has closed before its last connections do, and a response
  // reports closing after its connection, so closing it with the server would
  // refuse the last lines, and each connection and each response is held open
  // here until it has said so.
  const openSockets = new Set<Socket>();
  const openResponses = new Set<ServerResponse>();
  let serverClosed = false;
  const closeWhenQuiet = (): void => {
    if (serverClosed && openSockets.size === 0 && openResponses.size === 0) {
      closeSync(descriptor);
    }
  };

  const listening = (): void => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : address;
    log(
      `listening ${String(port)} keepAliveTimeout=${String(server.keepAliveTimeout)}` +
        ` headersTimeout=${String(server.headersTimeout)}` +
        ` requestTimeout=${String(server.requestTimeout)}` +
        ` maxRequestsPerSocket=${String(server.maxRequestsPerSocket)} node=${process.version}`,
    );
  };
  if (server.listening) listening();
  else server.once('listening', listening);

  server.on('connection', (socket: Socket) => {
    opened += 1;
    connections.set(socket, opened);
    unfinished.set(socket, []);
    openSockets.add(socket);
    const name = named(socket);
    log(`${name} open ${String(socket.remoteAddress)}:${String(socket.remotePort)}`);
    socket.on('end', () => {
      log(`${name} end`);
    });
    socket.on('timeout', () => {
      log(`${name} timeout`);
    });
    socket.on('error', (error) => {
      log(`${name} error ${errorCode(error)}`);
    });
    socket.on('close', (hadError) => {
      log(`${name} close hadError=${String(hadError)}`);
      openSockets.delete(socket);
      closeWhenQuiet();
    });
  });

  server.on('clientError', (error: Error, socket: Socket) => {
    const begun = headWritten(unfinished.get(socket)?.[0]);
    const status =
      socket.writable && !begun ? (CLIENT_ERROR_STATUS.get(errorCode(error)) ?? 400) : undefined;
    log(
      `${named(socket)} clientError ${errorCode(error)} answer=${status === undefined ? '-' : String(status)}`,
    );
    if (status !== undefined) {
      socket.write(
        `HTTP/1.1 ${String(status)} ${String(STATUS_CODES[status])}\r\nConnection: close\r\n\r\n`,
      );
    }
    socket.destroy(error);
  });
  server.on('dropRequest', (request: IncomingMessage, socket: Socket) => {
    log(`${named(socket)} dropRequest ${String(request.method)} ${String(request.url)}`);
  });

  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    const name = named(request.socket);
    const line = `${String(request.method)} ${String(request.url)}`;
    const received = performance.now();
    const { socket } = request;
    openResponses.add(response);
    unfinished.get(socket)?.push(response);
    log(
      `${name} request ${line} connection=${request.headers.connection ?? '-'}` +
        ` ua=${headerField(request.headers['user-agent'])}` +
        ` test=${headerField(request.headers[TEST_HEADER])}`,
    );
    response.on('finish', () => {
      settled(socket, response);
      const took = (performance.now() - received).toFixed(1);
      log(`${name} finish ${line} ${String(response.statusCode)} ${took}ms`);
    });
    // A response that closes before it finishes is one the server never
    // completed: the connection went first.
    response.on('close', () => {
      settled(socket, response);
      if (!response.writableFinished) log(`${name} closed-unfinished ${line}`);
      openResponses.delete(response);
      closeWhenQuiet();
    });
  });

  server.once('close', () => {
    serverClosed = true;
    closeWhenQuiet();
  });
}
