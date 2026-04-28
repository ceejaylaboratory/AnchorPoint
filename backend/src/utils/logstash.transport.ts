import * as net from "net";
import winston from "winston";
import Transport from "winston-transport";

export interface LogstashTransportOptions
  extends Transport.TransportStreamOptions {
  host: string;
  port: number;
  maxBufferSize?: number; // default 1000
  reconnectInterval?: number; // ms, default 5000
}

interface DLQEntry {
  payload: string; // serialised JSON line
  enqueuedAt: number; // Date.now()
}

export class LogstashTransport extends Transport {
  private readonly host: string;
  private readonly port: number;
  private readonly maxBufferSize: number;
  private readonly reconnectInterval: number;

  // Exposed for testability (read-only externally via accessor)
  private _dlq: DLQEntry[] = [];

  private socket: net.Socket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(opts: LogstashTransportOptions) {
    super(opts);
    this.host = opts.host;
    this.port = opts.port;
    this.maxBufferSize = opts.maxBufferSize ?? 1000;
    this.reconnectInterval = opts.reconnectInterval ?? 5000;
    this.connect();
  }

  /** Read-only view of the DLQ for testing purposes. */
  get dlq(): ReadonlyArray<DLQEntry> {
    return this._dlq;
  }

  /** Enqueue a payload into the DLQ, evicting the oldest entry when at capacity. */
  private enqueue(payload: string): void {
    if (this._dlq.length >= this.maxBufferSize) {
      const dropped = this._dlq.splice(0, 1);
      console.warn(
        `[LogstashTransport] DLQ full (capacity ${this.maxBufferSize}). Dropped 1 entry enqueued at ${dropped[0].enqueuedAt}.`,
      );
    }
    this._dlq.push({ payload, enqueuedAt: Date.now() });
  }

  private connect(): void {
    // Tear down any existing socket before creating a new one
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }

    const sock = new net.Socket();
    this.socket = sock;

    sock.on("connect", () => {
      this.connected = true;
      this.flushDLQ();
    });

    sock.on("error", (err) => {
      this.connected = false;
      console.warn(
        `[LogstashTransport] Socket error: ${err.message}. Buffering entries.`,
      );
      this.scheduleReconnect();
    });

    sock.on("close", () => {
      if (this.connected) {
        this.connected = false;
        console.warn(
          "[LogstashTransport] Socket closed unexpectedly. Buffering entries.",
        );
        this.scheduleReconnect();
      }
    });

    try {
      sock.connect(this.port, this.host);
    } catch (err) {
      // connect() itself should not throw synchronously, but guard anyway
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return; // already scheduled
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }

  /** Flush the DLQ in FIFO order over the live socket. */
  private flushDLQ(): void {
    if (this.flushing || !this.connected || this._dlq.length === 0) return;
    this.flushing = true;

    while (this._dlq.length > 0 && this.connected) {
      const entry = this._dlq.shift()!;
      this.writeToSocket(entry.payload);
    }

    this.flushing = false;
  }

  private writeToSocket(payload: string): void {
    if (!this.socket || !this.connected) return;
    try {
      this.socket.write(payload + "\n");
    } catch (err) {
      // If write throws (e.g. socket destroyed), buffer the entry
      this.connected = false;
      this.enqueue(payload);
      this.scheduleReconnect();
    }
  }

  /**
   * Winston calls this method for every log entry.
   * Must return immediately (non-blocking) and never throw synchronously.
   */
  log(info: Record<string, unknown>, callback: () => void): void {
    try {
      // Serialise the log entry to a JSON string
      let payload: string;
      try {
        payload = JSON.stringify(info);
      } catch {
        payload = JSON.stringify({
          level: "error",
          message: "Failed to serialise log entry",
        });
      }

      if (this.connected && this._dlq.length === 0) {
        // Fast path: socket is live and DLQ is empty — write directly
        this.writeToSocket(payload);
        // If writeToSocket detected an error it will have enqueued the payload
      } else {
        // Slow path: not connected or DLQ has pending entries — buffer
        this.enqueue(payload);
      }
    } catch {
      // Absolute last resort — swallow to satisfy "never throw synchronously"
    }

    // Always call callback immediately (non-blocking requirement)
    setImmediate(callback);
  }

  /** Gracefully close the transport (called by Winston on logger.close()). */
  close(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }
}
