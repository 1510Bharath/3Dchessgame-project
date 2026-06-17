// multiplayer.js
// Peer-to-peer online play over WebRTC via PeerJS's free public signalling
// broker — no game server of ours is involved, so two devices connect
// directly once they share a 6-character room code.

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O/1/I/L ambiguity
const ROOM_PREFIX = 'oakwood-chess-';

function randomCode(length = 6) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export class Multiplayer {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.code = null;
    this.isHost = false;
    this._listeners = {};
  }

  on(event, cb) {
    (this._listeners[event] ||= []).push(cb);
    return this;
  }

  _emit(event, payload) {
    for (const cb of (this._listeners[event] || [])) cb(payload);
  }

  _wireConn(conn) {
    this.conn = conn;
    conn.on('open', () => this._emit('connected', { isHost: this.isHost, code: this.code }));
    conn.on('data', (data) => this._emit('message', data));
    conn.on('close', () => this._emit('disconnected', {}));
    conn.on('error', (err) => this._emit('error', { message: String(err) }));
  }

  /** Host flow: claim a fresh room code, then wait for a guest to connect. */
  createRoom() {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        reject(new Error('Online play library failed to load.'));
        return;
      }
      this.isHost = true;
      const attempt = (triesLeft) => {
        const code = randomCode();
        const peer = new window.Peer(ROOM_PREFIX + code, { debug: 0 });
        let settled = false;

        peer.on('open', () => {
          settled = true;
          this.peer = peer;
          this.code = code;
          peer.on('connection', (conn) => this._wireConn(conn));
          resolve(code);
        });
        peer.on('error', (err) => {
          if (settled) { this._emit('error', { message: String(err) }); return; }
          peer.destroy();
          if (String(err).includes('unavailable-id') && triesLeft > 0) {
            attempt(triesLeft - 1); // code collision (rare) — pick another
          } else {
            reject(new Error('Could not create a room. Check your connection and try again.'));
          }
        });
      };
      attempt(3);
    });
  }

  /** Guest flow: dial a host's room code directly. */
  joinRoom(code) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        reject(new Error('Online play library failed to load.'));
        return;
      }
      const clean = String(code || '').trim().toUpperCase();
      if (!clean) { reject(new Error('Enter a room code first.')); return; }
      this.isHost = false;
      this.code = clean;
      const peer = new window.Peer({ debug: 0 });

      peer.on('open', () => {
        this.peer = peer;
        const conn = peer.connect(ROOM_PREFIX + clean, { reliable: true });
        let opened = false;
        conn.on('open', () => { opened = true; this._wireConn(conn); resolve(clean); });
        conn.on('error', (err) => { if (!opened) reject(new Error('Could not reach that room.')); });
        setTimeout(() => { if (!opened) reject(new Error('That room code was not found.')); }, 9000);
      });
      peer.on('error', (err) => {
        reject(new Error(String(err).includes('peer-unavailable')
          ? 'That room code was not found.'
          : 'Could not connect. Check your connection and try again.'));
      });
    });
  }

  send(payload) {
    if (this.conn && this.conn.open) this.conn.send(payload);
  }

  leave() {
    try { if (this.conn) this.conn.close(); } catch (_) {}
    try { if (this.peer) this.peer.destroy(); } catch (_) {}
    this.conn = null;
    this.peer = null;
    this.code = null;
  }
}
