// 함께 보기 서버.
// 같은 페이지를 연 사람끼리 위치, 자세 같은 상태(presence)를 주고받게 중계한다.
// 페이지 주소마다 방(Durable Object) 하나를 쓴다. 상태는 저장하지 않고, 연결된 소켓의 첨부 데이터에만 둔다.
// 정적 파일(HTML, 모델, 이미지)은 assets가 바로 내보내고, 이 Worker는 /__together/ 아래 요청만 받는다.
import { DurableObject } from 'cloudflare:workers';

const MAX_PEERS = 50;          // 한 방에 동시에 들어올 수 있는 사람 수
const MAX_PRESENCE = 1024;     // 한 사람이 보내는 상태의 최대 크기(바이트). 소켓 첨부 데이터 한도가 2KB라 작게 둔다
const MAX_NAME = 24;
const MAX_MSG_PER_SEC = 30;    // 넘으면 그 초의 나머지 메시지는 버린다

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/__together/room') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('websocket only', { status: 426 });
      }
      const roomName = (url.searchParams.get('r') || '/').slice(0, 200);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomName));
      return stub.fetch(request);
    }

    if (url.pathname === '/__together/owner' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return Response.json({ owner: isOwnerKey(env, body.key) });
    }

    return env.ASSETS.fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new WeakMap();   // 소켓별 초당 메시지 수. 방이 잠들었다 깨면 초기화돼도 괜찮다
  }

  async fetch() {
    if (this.ctx.getWebSockets().length >= MAX_PEERS) {
      return new Response('room full', { status: 503 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peer: crypto.randomUUID(), ready: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_PRESENCE + 256) return;
    if (!this.allow(ws)) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const a = ws.deserializeAttachment();

    if (msg.t === 'hello' && !a.ready) {
      a.ready = true;
      a.by = cleanId(msg.by) || a.peer;
      a.owner = isOwnerKey(this.env, msg.key);
      a.name = a.owner ? cleanName(this.env.OWNER_NAME) : cleanName(msg.name);
      a.presence = null;
      ws.serializeAttachment(a);
      ws.send(JSON.stringify({ t: 'welcome', you: a.peer, peers: this.peers() }));
      this.broadcast({ t: 'join', peer: view(a) }, ws);
      return;
    }

    if (msg.t === 'presence' && a.ready) {
      const text = JSON.stringify(msg.state ?? null);
      if (text.length > MAX_PRESENCE) return;
      a.presence = JSON.parse(text);
      ws.serializeAttachment(a);
      this.broadcast({ t: 'update', peer: view(a) }, ws);
    }
  }

  async webSocketClose(ws, code) {
    this.leave(ws, code);
  }

  async webSocketError(ws) {
    this.leave(ws, 1011);
  }

  leave(ws, code) {
    const a = ws.deserializeAttachment();
    if (a && a.ready) this.broadcast({ t: 'leave', peer: a.peer }, ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* 이미 닫힘 */ }
  }

  allow(ws) {
    const now = Date.now();
    const r = this.rate.get(ws) || { start: now, count: 0 };
    if (now - r.start >= 1000) { r.start = now; r.count = 0; }
    r.count += 1;
    this.rate.set(ws, r);
    return r.count <= MAX_MSG_PER_SEC;
  }

  peers() {
    return this.ctx.getWebSockets()
      .map((w) => w.deserializeAttachment())
      .filter((a) => a && a.ready)
      .map(view);
  }

  broadcast(msg, except) {
    const text = JSON.stringify(msg);
    for (const w of this.ctx.getWebSockets()) {
      if (w === except) continue;
      const a = w.deserializeAttachment();
      if (!a || !a.ready) continue;
      try { w.send(text); } catch { /* 끊긴 소켓은 close 이벤트에서 정리된다 */ }
    }
  }
}

function view(a) {
  return { peer: a.peer, by: a.by, name: a.name, owner: a.owner, presence: a.presence };
}

function cleanId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
}

function cleanName(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮<>]/g, '').trim().slice(0, MAX_NAME);
  return s || null;
}

// 주인 확인. OWNER_KEY는 wrangler secret으로 넣는다(배포 스크립트가 처리)
function isOwnerKey(env, key) {
  const want = env.OWNER_KEY;
  if (typeof want !== 'string' || !want || typeof key !== 'string' || key.length !== want.length) return false;
  const enc = new TextEncoder();
  return crypto.subtle.timingSafeEqual(enc.encode(key), enc.encode(want));
}
