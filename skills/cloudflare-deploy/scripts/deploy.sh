#!/usr/bin/env bash
# 함께 보기 사이트를 Cloudflare Workers에 올리는 도구.
#
#   deploy.sh build  <사이트 폴더> <배포 폴더> <영문 이름> [주인 이름]
#   deploy.sh dev    <배포 폴더> [포트]
#   deploy.sh deploy <배포 폴더>
#   deploy.sh links  <배포 폴더>
#
# build : 템플릿과 사이트 파일을 배포 폴더로 모으고, HTML마다 함께 보기 클라이언트를 넣는다
# dev   : 내 컴퓨터에서 미리 보기(http://localhost:<포트>). 탭 두 개를 열면 서로 보인다
# deploy: Cloudflare 로그인 확인, 배포, 주인 키 등록 후 공유 링크와 주인 링크를 출력한다
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$SKILL_DIR/template"
WRANGLER=(npx --yes wrangler@4.158.0)
CLIENT_TAG='<script src="/__together/client.js"></script>'

die() { echo "오류: $*" >&2; exit 1; }

cmd_build() {
  local site=${1:-} out=${2:-} name=${3:-} owner_name=${4:-}
  [[ -n $site && -n $out && -n $name ]] || die "사용법: deploy.sh build <사이트 폴더> <배포 폴더> <영문 이름> [주인 이름]"
  [[ -d $site ]] || die "사이트 폴더가 없습니다: $site"
  [[ -f $site/index.html ]] || die "사이트 폴더에 index.html이 있어야 합니다: $site"
  [[ $name =~ ^[a-z0-9]([a-z0-9-]{0,52}[a-z0-9])?$ ]] || die "이름은 영어 소문자, 숫자, 하이픈만 됩니다(예: moru-sunset): $name"

  mkdir -p "$out"
  out="$(cd "$out" && pwd)"
  site="$(cd "$site" && pwd)"
  [[ $out != "$site" && $out != "$site"/* ]] || die "배포 폴더를 사이트 폴더 안에 두면 안 됩니다"

  # 설정 파일은 처음 한 번만 만든다(카일이 고친 값을 덮어쓰지 않음)
  if [[ ! -f $out/wrangler.jsonc ]]; then
    # JSON 문자열을 깨는 따옴표와 역슬래시만 뺀다. &, / 같은 글자는 그대로 둔다
    local safe_owner=${owner_name//\"/}
    safe_owner=${safe_owner//\\/}
    SKILL_NAME="$name" SKILL_OWNER="$safe_owner" perl -pe 's/__NAME__/$ENV{SKILL_NAME}/g; s/__OWNER_NAME__/$ENV{SKILL_OWNER}/g' "$TEMPLATE/wrangler.jsonc" > "$out/wrangler.jsonc"
  fi
  [[ -f $out/.gitignore ]] || cp "$TEMPLATE/gitignore" "$out/.gitignore"

  # 서버 코드와 사이트 파일은 매번 새로 맞춘다
  rm -rf "$out/src" "$out/public"
  cp -R "$TEMPLATE/src" "$out/src"
  mkdir -p "$out/public"
  # 기획 문서와 숨김 파일은 올리지 않는다(주소, 메모가 인터넷에 공개되는 것을 막음)
  (cd "$site" && find . -type f ! -name 'plan.md' ! -path './.*' ! -path './node_modules/*' -print0 | while IFS= read -r -d '' f; do
    mkdir -p "$out/public/$(dirname "$f")"
    cp "$f" "$out/public/$f"
  done)
  mkdir -p "$out/public/__together"
  cp "$TEMPLATE/client.js" "$out/public/__together/client.js"

  # HTML마다 클라이언트를 페이지 스크립트보다 먼저 넣는다.
  # <head>가 있으면 그 바로 뒤에 넣는다(<header>와 헷갈리지 않게 태그 이름 뒤를 확인).
  # 아티팩트용 HTML은 <head> 없이 본문만 있는 경우가 많다. 아티팩트가 감싸 주던 문서 골격을 맨 앞에 붙인다
  local count=0
  while IFS= read -r -d '' html; do
    if ! grep -q '/__together/client.js' "$html"; then
      if grep -qiE '<head([[:space:]][^>]*)?>' "$html"; then
        TAG="$CLIENT_TAG" perl -0pi -e 's{(<head(?:\s[^>]*)?>)}{$1\n$ENV{TAG}}i' "$html"
      else
        local skeleton='<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        grep -qi '<!doctype' "$html" && skeleton=''
        { printf "$skeleton"; printf '%s\n' "$CLIENT_TAG"; cat "$html"; } > "$html.tmp" && mv "$html.tmp" "$html"
      fi
    fi
    count=$((count + 1))
  done < <(find "$out/public" -name '*.html' -print0)

  # 주인 키 : 주인 링크로 한 번 들어오면 그 브라우저가 주인으로 표시된다
  if [[ ! -f $out/.owner-key ]]; then
    openssl rand -hex 16 > "$out/.owner-key"
    chmod 600 "$out/.owner-key"
  fi
  printf 'OWNER_KEY=%s\n' "$(cat "$out/.owner-key")" > "$out/.dev.vars"
  chmod 600 "$out/.dev.vars"

  local size
  size=$(du -sh "$out/public" | cut -f1)
  echo "준비 완료: ${out} (HTML ${count}개, 전체 ${size})"
}

cmd_dev() {
  local out=${1:-} port=${2:-8787}
  [[ -f ${out:-.}/wrangler.jsonc ]] || die "먼저 build를 실행하세요: $out"
  cd "$out"
  echo "미리 보기: http://localhost:$port  /  주인으로 보기: http://localhost:$port/?owner=$(cat .owner-key)"
  exec "${WRANGLER[@]}" dev --port "$port"
}

cmd_deploy() {
  local out=${1:-}
  [[ -f ${out:-.}/wrangler.jsonc ]] || die "먼저 build를 실행하세요: $out"
  out="$(cd "$out" && pwd)"   # 아래에서 cd 한 뒤에도 links가 같은 폴더를 찾도록 절대 경로로 바꾼다
  cd "$out"

  # "Not logged in"도 'logged in'을 포함하므로 로그인됐을 때만 나오는 문구로 확인한다
  if ! "${WRANGLER[@]}" whoami 2>&1 | grep -qi 'associated with the email\|you are logged in'; then
    # 기본 로그인은 localhost:8976 콜백을 2분만 기다리고, IPv6([::1])에서만 대기해서 브라우저가 '연결 거부'를 띄우는 경우가 있다.
    # 기기 인증(--device)은 화면의 코드를 브라우저에 넣는 방식이라 콜백이 필요 없고 5분을 준다
    echo "Cloudflare 로그인이 필요합니다. 브라우저가 열리면 로그인하고, 아래 코드가 맞는지 확인한 뒤 승인하세요(5분 안)."
    "${WRANGLER[@]}" login --device
  fi

  local log
  log=$(mktemp)
  "${WRANGLER[@]}" deploy 2>&1 | tee "$log"
  local url
  url=$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$log" | head -1 || true)
  rm -f "$log"

  # 주인 키를 Worker 비밀값으로 넣는다(화면과 기록에 남지 않게 표준 입력으로 전달)
  "${WRANGLER[@]}" secret put OWNER_KEY < .owner-key > /dev/null
  [[ -n $url ]] && printf '%s\n' "$url" > .url
  cmd_links "$out"
}

cmd_links() {
  local out=${1:-.}
  [[ -f $out/.url ]] || die "배포 주소를 모릅니다. deploy 출력에서 workers.dev 주소를 찾아 $out/.url에 적어 주세요"
  local url
  url=$(cat "$out/.url")
  echo "공유 링크: $url"
  echo "주인 링크(나만 쓰기, 공유 금지): $url/?owner=$(cat "$out/.owner-key")"
}

case "${1:-}" in
  build) shift; cmd_build "$@" ;;
  dev) shift; cmd_dev "$@" ;;
  deploy) shift; cmd_deploy "$@" ;;
  links) shift; cmd_links "$@" ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
