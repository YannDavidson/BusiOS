declare module 'ws' {
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';
  import { EventEmitter } from 'node:events';
  export default class WebSocket extends EventEmitter {
    constructor(address: string);
    static OPEN: number; readyState: number;
    send(data: string | Buffer): void; close(code?: number, reason?: string): void;
  }
  export class WebSocketServer extends EventEmitter {
    constructor(options: { noServer: boolean });
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, callback: (ws: WebSocket) => void): void;
    emit(event: 'connection', ws: WebSocket, request: IncomingMessage): boolean;
  }
}
