# 카일스쿨 Claude Code 스킬

카일스쿨 유튜브 Claude Code 시리즈에서 만들고 쓰는 스킬 모음입니다.

| 스킬 | 하는 일 | 영상 |
|---|---|---|
| `memory-place` | 다시 가고 싶은 곳을 걸어 다니는 3D 공간으로 만들기. 묻기 → 기획안 → 구현 → 고치기 → 공유 | 2편 |
| `cloudflare-deploy` | 만든 페이지를 Cloudflare에 올려 링크를 받은 사람끼리 같이 보기 | 2편 |

## 설치

스킬은 작업할 프로젝트 폴더에 설치합니다. Claude Code를 그 폴더에서 열고 이렇게 말하면 됩니다.

```
https://github.com/zzsza/kyleschool-skills 의 skills 폴더에 있는 스킬을 이 프로젝트의 .claude/skills 폴더에 설치해 줘
```

직접 설치하려면 프로젝트 폴더의 터미널에서 아래 세 줄을 실행합니다.

```bash
git clone https://github.com/zzsza/kyleschool-skills.git
mkdir -p .claude/skills && cp -R kyleschool-skills/skills/* .claude/skills/
rm -rf kyleschool-skills
```

설치한 뒤 Claude Code를 그 프로젝트 폴더에서 새로 열면 스킬이 보입니다. 다른 폴더에서 쓰려면 그 폴더에도 설치합니다.

## 쓰는 법

- "다시 가고 싶은 곳 만들어 줘" : `memory-place`가 장소와 사진을 묻고 기획안부터 씁니다.
- "Cloudflare에 올려줘" : `cloudflare-deploy`가 로그인, 배포, 링크 2개(공유 링크, 주인 링크)까지 처리합니다.

## 필요한 것

- Claude Code
- 친구와 같이 볼 때만 : Node.js 22 이상(`npx`), Cloudflare 무료 계정

Mac에서 확인했습니다. Windows는 아직 확인하지 않았습니다(배포 스크립트가 bash).
