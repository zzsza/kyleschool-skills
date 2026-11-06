// 함께 보기 클라이언트.
// 아티팩트의 window.claude.use('room'), use('user')와 같은 모양을 Cloudflare 함께 보기 서버로 만든다.
// 그래서 아티팩트로 만든 HTML을 고치지 않고 Cloudflare에 올려도 함께 보기가 그대로 동작한다.
// 배포 스크립트가 모든 HTML의 <head> 맨 앞에 이 파일을 넣는다.
(() => {
  if (window.claude && window.claude.use) return;   // 아티팩트 안에서는 원래 기능을 쓴다

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 동작은 한다 */ } },
  };

  // 주인 링크(?owner=키)로 한 번 들어오면 키를 기억하고 주소에서 지운다
  const here = new URL(location.href);
  if (here.searchParams.has('owner')) {
    store.set('together-owner', here.searchParams.get('owner'));
    here.searchParams.delete('owner');
    history.replaceState(null, '', here);
  }
  const ownerKey = store.get('together-owner') || '';

  // 같은 브라우저의 여러 탭을 같은 사람으로 묶는 아이디
  let by = store.get('together-by');
  if (!by) { by = crypto.randomUUID(); store.set('together-by', by); }

  let ownerCheck = null;
  function isOwner() {
    if (!ownerCheck) {
      ownerCheck = !ownerKey ? Promise.resolve(false) : fetch('/__together/owner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: ownerKey }),
      }).then((r) => r.json()).then((j) => j.owner === true).catch(() => false);
    }
    return ownerCheck;
  }

  let room = null;
  function getRoom() {
    if (room) return room;
    const peers = new Map();
    const listeners = [];
    const closers = [];
    let me = null;
    let ws = null;
    let last;                 // 마지막으로 보낸 상태. 다시 연결되면 바로 보낸다
    let tries = 0;
    let dead = false;

    const toPeer = (v) => ({
      peer: v.peer, by: v.by, name: v.name || null, owner: v.owner === true,
      kind: 'viewer', isMe: v.by === by, sameTab: v.peer === me, presence: v.presence ?? null,
    });
    const emit = (joined = [], left = [], updated = []) => {
      const change = { peers: [...peers.values()], joined, left, updated };
      for (const fn of listeners) { try { fn(change); } catch (e) { console.error(e); } }
    };
    const send = (obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/__together/room?r=${encodeURIComponent(location.pathname)}`);
      ws.onopen = () => send({ t: 'hello', by, key: ownerKey, name: store.get('together-name') });
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') {
          tries = 0;
          me = m.you;
          const joined = m.peers.map(toPeer);
          for (const p of joined) peers.set(p.peer, p);
          emit(joined);
          if (last !== undefined) send({ t: 'presence', state: last });
        } else if (m.t === 'join' || m.t === 'update') {
          const p = toPeer(m.peer);
          const known = peers.has(p.peer);
          peers.set(p.peer, p);
          if (known) emit([], [], [p]); else emit([p]);
        } else if (m.t === 'leave') {
          const p = peers.get(m.peer);
          if (p) { peers.delete(m.peer); emit([], [p]); }
        }
      };
      ws.onclose = () => {
        const left = [...peers.values()];
        peers.clear();
        me = null;
        if (left.length) emit([], left);
        if (dead) return;
        tries += 1;
        if (tries > 8) { dead = true; for (const fn of closers) { try { fn(); } catch (e) { console.error(e); } } return; }
        setTimeout(connect, Math.min(15000, 500 * 2 ** tries));
      };
    }

    room = {
      presence(state) {
        last = state;
        if (me) send({ t: 'presence', state });
        return Promise.resolve();
      },
      onPeers(fn, onClose) {
        listeners.push(fn);
        if (typeof onClose === 'function') closers.push(onClose);
        if (me) { const all = [...peers.values()]; try { fn({ peers: all, joined: all, left: [], updated: [] }); } catch (e) { console.error(e); } }
        return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
      },
      peers() { return [...peers.values()]; },
    };
    connect();
    return room;
  }

  const user = {
    isOwner,
    async me() { return { id: by, name: store.get('together-name') || null }; },
    // 다른 사람 이름. 주인은 서버가 OWNER_NAME으로 채우고, 나머지는 각자 정한 이름(없으면 null)
    async profiles(ids) {
      const out = {};
      const list = room ? room.peers() : [];
      for (const id of ids) {
        const p = list.find((x) => x.by === id && x.name);
        if (p) out[id] = { name: p.name };
      }
      return out;
    },
  };

  window.claude = {
    together: true,   // Cloudflare 함께 보기 서버로 동작 중이라는 표시
    async use(name) {
      if (name === 'room') return getRoom();
      if (name === 'user') return user;
      return null;     // 그 밖의 아티팩트 기능(db 등)은 없다
    },
  };
})();
