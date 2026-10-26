import { Injectable } from '@angular/core';
import { Peer, type DataConnection } from 'peerjs';
import { ClientMsg, HostMsg, ROOM_PREFIX } from './protocol';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONNECT_TIMEOUT_MS = 15000;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function describe(err: unknown): string {
  const e = err as { type?: string; message?: string };
  switch (e.type) {
    case 'peer-unavailable':
      return 'Room not found. Check the code and make sure the host is still online.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Cannot reach the PeerJS signaling server. Check your internet connection.';
    default:
      return e.message ?? 'Connection failed.';
  }
}

/** Thin PeerJS (WebRTC) wrapper. It only moves messages; game rules live in GameService. */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  private peer: Peer | null = null;
  private hostConn: DataConnection | null = null;
  private readonly guests = new Map<string, DataConnection>();
  /** Bumped by close() so callbacks from an abandoned peer are ignored. */
  private generation = 0;

  /** Opens a room. Resolves with the room code. */
  openHost(
    onMessage: (connId: string, msg: unknown) => void,
    onClosed: (connId: string) => void,
  ): Promise<string> {
    this.close();
    const gen = this.generation;
    return new Promise((resolve, reject) => {
      const attempt = (tries: number): void => {
        const code = randomCode();
        const peer = new Peer(ROOM_PREFIX + code);
        let opened = false;

        peer.on('open', () => {
          if (gen !== this.generation) {
            peer.destroy();
            return;
          }
          opened = true;
          this.peer = peer;
          resolve(code);
        });

        peer.on('connection', (conn) => {
          if (gen !== this.generation) return;
          conn.on('open', () => this.guests.set(conn.peer, conn));
          conn.on('data', (data: unknown) => {
            if (gen === this.generation) onMessage(conn.peer, data);
          });
          conn.on('close', () => {
            if (gen !== this.generation) return;
            if (this.guests.get(conn.peer) === conn) this.guests.delete(conn.peer);
            onClosed(conn.peer);
          });
        });

        peer.on('disconnected', () => {
          if (opened && !peer.destroyed) peer.reconnect();
        });

        peer.on('error', (err) => {
          if (opened) return;
          peer.destroy();
          const type = (err as { type?: string }).type;
          if (type === 'unavailable-id' && tries < 5) attempt(tries + 1);
          else reject(new Error(describe(err)));
        });
      };
      attempt(0);
    });
  }

  /** Connects to a room as a guest. Resolves once the data channel is open. */
  joinRoom(
    code: string,
    onMessage: (msg: HostMsg) => void,
    onClosed: () => void,
  ): Promise<void> {
    this.close();
    const gen = this.generation;
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      let settled = false;
      const fail = (err: unknown): void => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error(typeof err === 'string' ? err : describe(err)));
      };

      peer.on('open', () => {
        const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          if (settled) return;
          settled = true;
          this.hostConn = conn;
          resolve();
        });
        conn.on('data', (data: unknown) => {
          if (gen === this.generation) onMessage(data as HostMsg);
        });
        conn.on('close', () => {
          if (gen === this.generation) onClosed();
        });
      });
      peer.on('error', (err) => fail(err));
      setTimeout(() => fail('Timed out while connecting to the room.'), CONNECT_TIMEOUT_MS);
    });
  }

  sendToHost(msg: ClientMsg): void {
    this.hostConn?.send(msg);
  }

  sendTo(connId: string, msg: HostMsg): void {
    this.guests.get(connId)?.send(msg);
  }

  close(): void {
    this.generation++;
    this.hostConn = null;
    this.guests.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}
