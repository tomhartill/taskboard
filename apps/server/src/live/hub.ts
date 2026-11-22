import pg from 'pg';
import type { WebSocket } from 'ws';
import { ClientMessage, type ServerMessage } from '@taskboard/shared';
import { EVENTS_CHANNEL, type Store } from '../store';

/** A client further behind than this is told to fetch a fresh snapshot instead. */
const MAX_REPLAY = 500;

interface Client {
  socket: WebSocket;
  /** Highest seq sent to this socket. */
  sent: number;
  /** False until the client has said hello and been caught up. */
  live: boolean;
}

type Logger = { info: (o: object | string, m?: string) => void; error: (o: object | string, m?: string) => void };

/**
 * Fans out board events to every open WebSocket.
 *
 * One dedicated Postgres connection LISTENs on the events channel. All work (a
 * NOTIFY arriving, or a client saying hello) runs through one queue, so a client
 * being caught up can never interleave with a live broadcast and miss or reorder
 * an event.
 */
export class LiveHub {
  private clients = new Set<Client>();
  private queue: Promise<void> = Promise.resolve();
  private listener: pg.Client | null = null;
  private lastSeq = 0;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private store: Store,
    private databaseUrl: string,
    private log: Logger,
  ) {}

  async start() {
    this.lastSeq = await this.store.latestSeq();
    await this.connect();
  }

  private async connect() {
    const client = new pg.Client({ connectionString: this.databaseUrl });
    client.on('notification', () => this.enqueue(() => this.flush()));
    client.on('error', (err) => {
      this.log.error({ err }, 'LISTEN connection lost');
      this.scheduleReconnect();
    });
    client.on('end', () => this.scheduleReconnect());
    await client.connect();
    await client.query(`LISTEN ${EVENTS_CHANNEL}`);
    this.listener = client;
    // Anything committed while we were disconnected.
    this.enqueue(() => this.flush());
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.listener = null;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        this.log.info('LISTEN connection restored');
      } catch (err) {
        this.log.error({ err }, 'LISTEN reconnect failed');
        this.scheduleReconnect();
      }
    }, 1000);
  }

  async stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const c of this.clients) c.socket.close(1001, 'Server shutting down');
    this.clients.clear();
    await this.queue;
    await this.listener?.end().catch(() => {});
  }

  get size() {
    return this.clients.size;
  }

  private enqueue(job: () => Promise<void>) {
    this.queue = this.queue.then(job).catch((err) => this.log.error({ err }, 'Live hub job failed'));
  }

  /** Send every committed event newer than the last one broadcast. */
  private async flush() {
    for (;;) {
      const events = await this.store.eventsSince(this.lastSeq, 200);
      if (!events.length) return;
      for (const event of events) {
        for (const c of this.clients) {
          if (c.live && event.seq > c.sent) {
            send(c.socket, { type: 'event', event });
            c.sent = event.seq;
          }
        }
        this.lastSeq = event.seq;
      }
    }
  }

  /** Catch a client up from the seq it last saw, then mark it live. */
  private async hello(client: Client, since: number) {
    if (!this.clients.has(client)) return;
    // Bring the hub itself up to date first, so lastSeq is the true latest.
    await this.flush();
    if (this.lastSeq - since > MAX_REPLAY || since > this.lastSeq) {
      send(client.socket, { type: 'resync' });
      client.sent = this.lastSeq;
    } else {
      let cursor = since;
      while (cursor < this.lastSeq) {
        const events = await this.store.eventsSince(cursor, 200);
        if (!events.length) break;
        for (const event of events) {
          if (event.seq > this.lastSeq) break;
          send(client.socket, { type: 'event', event });
          cursor = event.seq;
        }
      }
      client.sent = this.lastSeq;
    }
    client.live = true;
    send(client.socket, { type: 'ready', seq: client.sent });
  }

  attach(socket: WebSocket) {
    const client: Client = { socket, sent: 0, live: false };
    this.clients.add(client);

    // Drop connections that stop answering (a phone that went to sleep mid-socket).
    let alive = true;
    socket.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, 30_000);

    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = ClientMessage.parse(JSON.parse(String(raw)));
      } catch {
        return socket.close(1008, 'Bad message');
      }
      if (msg.type === 'ping') send(socket, { type: 'pong' });
      if (msg.type === 'hello') this.enqueue(() => this.hello(client, msg.since));
    });
    socket.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(client);
    });
  }
}

function send(socket: WebSocket, msg: ServerMessage) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}
