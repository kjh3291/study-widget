// PostgreSQL 연결과 스키마. 시작할 때마다 migrate()가 없는 테이블만 만든다.
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  username     TEXT UNIQUE NOT NULL,
  pw_hash      TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',   -- member | admin
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | suspended
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ,
  revoked     BOOLEAN NOT NULL DEFAULT false
);
CREATE SEQUENCE IF NOT EXISTS item_rev;
-- 할 일·일정·시간표 과목·설정·집중 기록을 항목 단위로 저장(kind로 구분).
CREATE TABLE IF NOT EXISTS items (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  id          TEXT NOT NULL,
  data        JSONB,
  updated_at  BIGINT NOT NULL,          -- 클라이언트 수정 시각(ms), 항목 단위 최신 우선
  deleted     BOOLEAN NOT NULL DEFAULT false,
  rev         BIGINT NOT NULL,          -- 서버 변경 순번(커서)
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS items_user_rev ON items (user_id, rev);
-- 변경 기록: 덮어써진 값과 늦게 도착한 오래된 값을 30일 보관(되돌리기·확인용).
CREATE TABLE IF NOT EXISTS items_history (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  id          TEXT NOT NULL,
  data        JSONB,
  updated_at  BIGINT NOT NULL,
  deleted     BOOLEAN NOT NULL DEFAULT false,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS items_history_item ON items_history (user_id, kind, id, recorded_at);
-- 개인 파일(보조자료·과제): 현재 파일 1행 + 이전 버전들. 내용은 디스크에 sha256 이름으로 보관(같은 내용은 1번만).
CREATE SEQUENCE IF NOT EXISTS file_rev;
CREATE TABLE IF NOT EXISTS files (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,            -- '과목/보조자료/파일.pdf'
  sha256      TEXT NOT NULL,
  size        BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,          -- 수정 시각(ms), 나중 것이 현재 파일
  deleted     BOOLEAN NOT NULL DEFAULT false,
  deleted_at  TIMESTAMPTZ,              -- 휴지통에 들어간 시각(30일 뒤 영구 삭제)
  rev         BIGINT NOT NULL,
  PRIMARY KEY (user_id, path)
);
CREATE INDEX IF NOT EXISTS files_user_rev ON files (user_id, rev);
CREATE TABLE IF NOT EXISTS file_versions (
  vid         SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  size        BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS file_versions_path ON file_versions (user_id, path, recorded_at);
`;

export async function migrate() {
  await pool.query(SCHEMA);
}
