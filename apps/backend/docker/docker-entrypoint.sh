#!/bin/sh
# =============================================================================
# 开项 Kaiplan —— backend 容器入口（v3-docker-compose-runtime-foundation, design D2/D3）
#
# 三种确定性动作：
#   init-config  一次性初始化：原子 create-if-absent 生成 APP_KEY / JWT_ACCESS_SECRET
#                （默认栈另含 POSTGRES password）到 runtime-secret volume，
#                只输出键名/状态/指纹，绝不输出正文；随后为 runtime-secret/SQLite/
#                storage volume 设置最小 UID/GID 权限。以 root 运行（唯一允许 root 的 job）。
#   migrate      从 secret files export 到既有 env schema，执行 build 产物中的
#                `migration:run --force`；失败退出码非 0，Compose 依赖闸门 fail closed。
#   serve        同样 export secrets 后启动 HTTP server。
#
# 固定非 root 运行身份：UID/GID 10001（aiproj）。migrate/serve 必须以该身份运行。
# 自带 secret：设置 AIPROJ_APP_KEY / AIPROJ_JWT_ACCESS_SECRET / AIPROJ_POSTGRES_PASSWORD
# 环境变量时优先于 volume 文件（init-config 首次会把它们落盘，之后复用）。
# =============================================================================
set -eu

APP_ROOT="/app/apps/backend/build"
SECRETS_DIR="${AIPROJ_SECRETS_DIR:-/run/aiproj-secrets}"
RUNTIME_UID=10001
RUNTIME_GID=10001
ACTION="${1:-serve}"

TSX_IMPORT="tsx"

log() {
  # 只输出低敏键名/状态/指纹；调用方禁止把 secret 值作为参数传入。
  echo "entrypoint[$ACTION]: $1"
}

random_base64() {
  node -e "process.stdout.write(require('node:crypto').randomBytes($1).toString('base64url'))"
}

fingerprint() {
  # 输出文件内容的 sha256 前 12 位（低敏指纹，用于跨重启比对）
  sha256sum "$1" | cut -c1-12
}

write_secret_if_absent() {
  # $1=文件名  $2=字节数  $3=可选的环境变量覆盖值（空=自动生成）
  name="$1"; bytes="$2"; override="${3:-}"
  target="$SECRETS_DIR/$name"
  if [ -s "$target" ]; then
    status="exists"
  else
    umask 077
    tmp="$target.tmp.$$"
    if [ -n "$override" ]; then
      printf '%s' "$override" >"$tmp"
    else
      random_base64 "$bytes" >"$tmp"
    fi
    chmod 0440 "$tmp"
    # noclobber 兜底（mv -n）：并发/重入时已有文件永不被覆盖
    mv -n "$tmp" "$target" 2>/dev/null || true
    rm -f "$tmp"
    if [ -s "$target" ]; then status="created"; else status="error"; fi
  fi
  # runtime 组可读（migrate/backend 以 gid 10001 运行），其他位清零
  chown 0:"$RUNTIME_GID" "$target"
  chmod 0440 "$target"
  log "key=$name status=$status sha256_12=$(fingerprint "$target")"
}

fix_volume_permissions() {
  # 只对挂载进容器的专用路径做最小权限初始化；已有正确属主时不动。
  for d in /app/data /app/storage; do
    if [ -d "$d" ]; then
      owner="$(stat -c %u "$d")"
      if [ "$owner" != "$RUNTIME_UID" ]; then
        chown -R "$RUNTIME_UID:$RUNTIME_GID" "$d"
        log "chown path=$d owner=$RUNTIME_UID:$RUNTIME_GID"
      fi
    fi
  done
}

export_secrets() {
  # 环境变量优先（自带 secret），否则读 volume 文件。
  if [ -n "${AIPROJ_APP_KEY:-}" ]; then
    export APP_KEY="$AIPROJ_APP_KEY"
  else
    export APP_KEY="$(cat "$SECRETS_DIR/app_key")"
  fi
  if [ -n "${AIPROJ_JWT_ACCESS_SECRET:-}" ]; then
    export JWT_ACCESS_SECRET="$AIPROJ_JWT_ACCESS_SECRET"
  else
    export JWT_ACCESS_SECRET="$(cat "$SECRETS_DIR/jwt_access_secret")"
  fi
  if [ "${DB_CONNECTION:-sqlite}" = "pg" ]; then
    if [ -n "${DB_PASSWORD:-}" ]; then
      export DB_PASSWORD
    elif [ -n "${AIPROJ_POSTGRES_PASSWORD:-}" ]; then
      export DB_PASSWORD="$AIPROJ_POSTGRES_PASSWORD"
    else
      export DB_PASSWORD="$(cat "$SECRETS_DIR/pg_password")"
    fi
  fi
}

select_supabase_database() {
  # compose.supabase.yaml 设 AIPROJ_DB_SELECT=supabase：在容器内按 direct → pooler 探测，
  # 目标机无需 pnpm 启动器插值 DB_HOST。选择器只把 export 语句写到 stdout 供 eval，不落日志。
  if [ "${AIPROJ_DB_SELECT:-}" = "supabase" ]; then
    selection="$(node /app/docker/select-database.mjs)" || {
      log "refused: Supabase 数据库选择失败（检查 apps/backend/.env 挂载与网络）"
      exit 2
    }
    eval "$selection"
    unset selection
  fi
}

assert_non_root() {
  uid="$(id -u)"
  if [ "$uid" = "0" ]; then
    log "refused: migrate/serve 禁止以 root 运行（设计 D3/红线）"
    exit 1
  fi
}

case "$ACTION" in
  init-config)
    mkdir -p "$SECRETS_DIR"
    write_secret_if_absent "app_key" 32 "${AIPROJ_APP_KEY:-}"
    write_secret_if_absent "jwt_access_secret" 48 "${AIPROJ_JWT_ACCESS_SECRET:-}"
    if [ "${AIPROJ_INIT_POSTGRES:-true}" = "true" ]; then
      write_secret_if_absent "pg_password" 24 "${AIPROJ_POSTGRES_PASSWORD:-}"
    else
      log "key=pg_password status=skipped reason=sqlite-stack"
    fi
    fix_volume_permissions
    log "done"
    ;;
  migrate)
    assert_non_root
    select_supabase_database
    export_secrets
    cd "$APP_ROOT"
    exec node --import "$TSX_IMPORT" bin/console.js migration:run --force
    ;;
  serve)
    assert_non_root
    select_supabase_database
    export_secrets
    cd "$APP_ROOT"
    exec node --import "$TSX_IMPORT" bin/server.js
    ;;
  admin-create)
    # 交互式建立/升级平台超级管理员（免两步验证）；密码只经隐藏输入读取，不经参数、不打印。
    # 用法：docker compose -f compose.supabase.yaml run --rm backend admin-create
    assert_non_root
    select_supabase_database
    export_secrets
    cd "$APP_ROOT"
    shift
    exec node --import "$TSX_IMPORT" bin/console.js admin:create-super "$@"
    ;;
  *)
    log "unknown action: $ACTION（允许 init-config|migrate|serve|admin-create）"
    exit 64
    ;;
esac
