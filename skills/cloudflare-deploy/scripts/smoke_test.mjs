// 함께 보기 서버 점검: 두 사람이 들어와 서로의 상태를 받고, 한 사람이 나가면 다른 사람이 알게 되는지 본다.
// 사용법: node smoke_test.mjs http://localhost:8787 [주인 키]
const base = process.argv[2] || 'http://localhost:8787';
const ownerKey = process.argv[3] || '';
const wsUrl = base.replace(/^http/, 'ws') + '/__together/room?r=' + encodeURIComponent('/smoke-test');

function open(name, key) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const inbox = [];
    ws.onmessage = (e) => inbox.push(JSON.parse(e.data));
    ws.onerror = (e) => reject(new Error(`${name} 연결 실패: ${e.message || e.type}`));
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', by: crypto.randomUUID(), key, name }));
      resolve({ ws, inbox });
    };
  });
}

async function waitFor(inbox, pred, label) {
  for (let i = 0; i < 50; i++) {
    const m = inbox.find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`기다린 메시지가 오지 않음: ${label}`);
}

const a = await open('A', ownerKey);
const welcomeA = await waitFor(a.inbox, (m) => m.t === 'welcome', 'A welcome');
const b = await open('B', '');
const welcomeB = await waitFor(b.inbox, (m) => m.t === 'welcome', 'B welcome');
console.log(`B가 들어올 때 방 인원: ${welcomeB.peers.length}명`);
if (welcomeB.peers.length < 2) throw new Error('B의 welcome에 A가 없음');

await waitFor(a.inbox, (m) => m.t === 'join' && m.peer.peer === welcomeB.you, 'A가 B 입장 알림 받기');
a.ws.send(JSON.stringify({ t: 'presence', state: { v: 1, x: 1.5, z: 2 } }));
const upd = await waitFor(b.inbox, (m) => m.t === 'update' && m.peer.peer === welcomeA.you, 'B가 A 상태 받기');
console.log(`B가 받은 A 상태: ${JSON.stringify(upd.peer.presence)}, 주인 여부: ${upd.peer.owner}, 이름: ${upd.peer.name}`);

b.ws.send(JSON.stringify({ t: 'presence', state: { big: 'x'.repeat(2000) } }));
await new Promise((r) => setTimeout(r, 300));
if (a.inbox.some((m) => m.t === 'update' && m.peer.presence && m.peer.presence.big)) throw new Error('1KB 넘는 상태가 전달됨');
console.log('1KB 넘는 상태는 버려짐');

b.ws.close();
await waitFor(a.inbox, (m) => m.t === 'leave' && m.peer === welcomeB.you, 'A가 B 퇴장 알림 받기');
console.log('B 퇴장 알림 받음');
a.ws.close();
console.log('통과');
process.exit(0);
