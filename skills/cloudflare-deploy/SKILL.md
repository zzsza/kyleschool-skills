---
name: cloudflare-deploy
description: HTML로 만든 웹페이지나 공간을 Cloudflare에 배포한다. 3D 공원, 게임, 전시장 같은 공간을 Cloudflare에 올려 링크를 받은 사람끼리 서로의 캐릭터와 움직임이 보이게(함께 보기, 멀티플레이) 한다. 접속자 중계 서버(Durable Objects, WebSocket)와 클라이언트가 템플릿으로 들어 있어서 코드를 새로 짜지 않는다. 아티팩트의 room, user 기능으로 만든 HTML은 고치지 않고 그대로 올라간다. "Cloudflare에 올려줘", "배포해줘", "같이 볼 수 있게 해줘", "여럿이 들어오게", "멀티플레이로", "함께 보기", "링크로 공유", "/cloudflare-deploy" 같은 요청에 사용.
---

# Cloudflare 배포 (함께 보기 포함)

HTML 폴더 하나를 Cloudflare Workers에 올린다. 같은 주소를 연 사람끼리 위치, 자세, 이름 같은 상태를 실시간으로 주고받는다.
Claude Code, Codex 어느 쪽에서 실행해도 결과가 같다. 필요한 것은 Node.js(`npx`)와 Cloudflare 무료 계정뿐이다.

## 구성

| 파일 | 하는 일 |
|---|---|
| `scripts/deploy.sh` | `build`, `dev`, `deploy`, `links` 명령 |
| `template/src/worker.js` | 서버. 페이지 주소마다 방 하나(Durable Object), 접속자 상태 중계, 주인 확인 |
| `template/client.js` | 브라우저 쪽. `window.claude.use('room')`, `use('user')`와 같은 모양을 만든다 |
| `template/wrangler.jsonc` | Cloudflare 설정. 이름과 주인 이름을 `build`가 채움 |

```bash
T=.claude/skills/cloudflare-deploy/scripts/deploy.sh
```

## 순서

1. **사이트 폴더 확인** : `index.html`이 있는 폴더인지 본다. 모델, 이미지 같은 파일은 HTML에서 상대 경로로 부르는지 본다. 한 파일 25MiB를 넘으면 올라가지 않는다.
2. **함께 보기 코드 확인** : HTML이 `window.claude.use('room')`을 쓰면 그대로 둔다. 없으면 아래 '함께 보기 코드 뼈대'를 넣는다.
3. **이름 정하기** : 영어 소문자와 하이픈(예 : `moru-sunset`). 주소가 `https://<이름>.<계정 서브도메인>.workers.dev`가 된다. 주인 이름(예 : `카일`)도 묻는다.
4. **build** : 배포 폴더는 사이트 폴더 옆에 `deploy/`로 둔다.
   ```bash
   $T build <사이트 폴더> <배포 폴더> <이름> <주인 이름>
   ```
5. **dev로 미리 보기** : `$T dev <배포 폴더> 8787`로 미리 보기 서버를 띄우고 http://localhost:8787 을 연다(Claude Code 데스크톱 앱이면 `.claude/launch.json`에 등록해 미리 보기 창으로 연다). 탭 두 개를 열어 서로 캐릭터가 보이는지, 사람 수가 2로 바뀌는지 확인한다. 다른 사람처럼 들어와 보려면 시크릿 창이나 다른 브라우저를 쓴다(이름표와 옷 색이 달라짐). `scripts/smoke_test.mjs`로 서버만 따로 확인할 수도 있다. 주인 키는 배포 폴더의 `.owner-key`에 있다. `dev`가 실행되지 않으면(Windows 일부 환경) 건너뛰고, 배포한 주소에서 탭 두 개로 확인한다.
   ```bash
   node .claude/skills/cloudflare-deploy/scripts/smoke_test.mjs http://localhost:8787 [주인 키]
   ```
6. **deploy** : 사용자에게 먼저 묻고 실행한다(외부 공개). 로그인이 필요하면 스크립트가 기기 인증(`wrangler login --device`)을 띄운다. 사용자가 브라우저에서 로그인하고, 터미널에 나온 코드가 맞는지 확인한 뒤 5분 안에 승인한다. 로그인 명령은 사용자가 화면의 코드를 볼 수 있는 터미널에서 실행한다(데스크톱 앱이면 터미널 패널). 기본 로그인(`wrangler login`)은 쓰지 않는다. 콜백 서버가 `[::1]:8976`에서만 2분 대기해서 브라우저에 'localhost 연결 거부'가 뜨는 경우가 있다(2026-11-06). 계정에 workers.dev 서브도메인이 없으면 wrangler가 하나 정하라고 묻는다.
   ```bash
   $T deploy <배포 폴더>
   ```
7. **링크 전달** : 공유 링크와 주인 링크를 따로 알려 준다. 주인 링크는 공유하지 말라고 적는다. 공유 링크만 그 작업의 기획 문서(예 : `plan.md`)에 적고, 주인 링크는 파일에 적지 않는다. `build`는 `plan.md`와 숨김 파일을 올리지 않는다.

다시 올릴 때는 `build`와 `deploy`만 다시 한다. 설정(`wrangler.jsonc`)과 주인 키(`.owner-key`)는 처음 만든 것을 계속 쓴다.

## 함께 보기 코드 뼈대

새로 만드는 페이지는 이 모양으로 짠다. 아티팩트에서도, Cloudflare에서도 그대로 동작한다.

```js
// 1) 접속: 둘 다 없으면 혼자 보기
const room = window.claude?.use ? await window.claude.use('room') : null;
const user = window.claude?.use ? await window.claude.use('user') : null;
const iAmOwner = user ? await user.isOwner() : false;   // 주인 링크로 들어온 브라우저면 true

// 2) 내 상태 보내기: 바뀔 때만, 초당 10번 이하. 1KB 이하의 JSON
room?.presence({ v: 1, x, z, face, sit, nick });

// 3) 다른 사람 받기
room?.onPeers((change) => {
  for (const p of change.left) removeFriend(p.peer);
  for (const p of [...change.joined, ...change.updated]) {
    if (p.sameTab) continue;                 // 나 자신
    const s = p.presence || {};
    if (s.v !== 1) continue;                 // 아직 상태를 안 보낸 사람
    // 남이 보낸 값이라 숫자 범위, 색 형식, 글자 길이를 확인하고 쓴다
    upsertFriend(p.peer, s, p.name);         // p.name : 주인이면 주인 이름, 아니면 null
  }
  setPeopleCount(change.peers.length);
}, () => { /* 연결이 끝내 끊김 : 혼자 보기로 */ });
```

| 값 | 뜻 |
|---|---|
| `p.peer` | 탭 하나의 아이디. 다시 연결하면 바뀐다 |
| `p.by` | 브라우저 하나의 아이디. 같은 브라우저의 탭 여러 개는 같다 |
| `p.isMe`, `p.sameTab` | 내 브라우저인지, 지금 이 탭인지 |
| `p.owner`, `p.name` | 주인인지, 이름(주인만 서버가 채움) |
| `user.profiles(ids)` | `by` 아이디 목록으로 이름을 찾는다. 이름이 없는 사람은 빠진다 |

이름이 없는 사람에게는 페이지가 랜덤 별명(예 : 졸린 갈매기)을 붙이고 presence의 `nick`으로 보낸다.

## 한도와 주의

- 무료 요금제로 된다. Durable Object는 SQLite 기반만 무료라 템플릿이 그것을 쓴다.
- 무료 한도(Cloudflare 요금 문서, 2026-11-06 확인) : 페이지 파일(assets) 요청은 무제한. 함께 보기 방(Durable Objects)은 하루 10만 요청이고, 들어오는 WebSocket 메시지는 20개를 요청 1개로 센다 => 하루 약 200만 개. 클라이언트가 움직일 때만 0.1초 간격으로 보내므로 1명이 쉬지 않고 움직이면 약 55시간 분량. 한도를 넘었을 때 어떻게 되는지는 아직 확인하지 않았다.
- 한 방 50명, 상태 1KB, 한 사람 초당 30개 메시지까지 받는다(`worker.js` 맨 위 값).
- 링크를 아는 사람은 누구나 들어온다. 로그인한 사람만 들이는 기능은 없다. 아티팩트처럼 공유 대상을 고르려면 Cloudflare Access를 따로 켠다.
- 상태는 저장하지 않는다. 모두 나가면 방이 비고, 사진첩 같은 개인 기록은 각자 브라우저(localStorage)에 남는다.
- 아티팩트 기능 중 `room`, `user`만 대신한다. `db` 같은 다른 기능은 Cloudflare에서 `null`이 된다.
- `.owner-key`, `.dev.vars`는 git에 올리지 않는다(템플릿 `.gitignore`).
- `build` 뒤 화면이 그대로면 강력 새로고침(Mac : Cmd+Shift+R)을 한다. 일반 새로고침에 이전 페이지가 나온 적이 있다(2026-11-09 로컬 `dev`, 원인 미확인).
- 파일을 더블클릭해서 열면(`file://`) 함께 보기와 모델 불러오기가 안 된다. 항상 `dev`나 배포 주소로 연다.
