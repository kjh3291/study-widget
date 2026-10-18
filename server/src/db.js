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
-- 계정 확장: GitHub 연결·대표 메일, 가입 동의, 임시 비밀번호, 삭제(30일 보관)
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id BIGINT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_login TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_pw BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
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
-- 커뮤니티: 프로필·공지·채팅방·메시지. 사진은 공용 미디어(sha256 이름)로 보관.
CREATE TABLE IF NOT EXISTS profiles (
  user_id       INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname      TEXT,
  bio           TEXT NOT NULL DEFAULT '',
  avatar_sha    TEXT,
  show_study    BOOLEAN NOT NULL DEFAULT false,   -- 오늘 공부 시간 공개
  show_timetable BOOLEAN NOT NULL DEFAULT false,  -- 시간표 공개
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notices (
  id          SERIAL PRIMARY KEY,
  author_id   INT REFERENCES users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  pinned      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted     BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS rooms (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  topic       TEXT NOT NULL DEFAULT '',
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived    BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO rooms (name, topic) VALUES ('전체', '동아리 전체 채팅') ON CONFLICT (name) DO NOTHING;
CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  room_id     INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL DEFAULT '',
  image       JSONB,                              -- { sha, mime, size, width, height }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ,
  deleted     BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS messages_room ON messages (room_id, id);
-- 탈퇴 계정이 완전히 삭제(30일 후)되면 그 사람의 메시지도 함께 지운다(가입 동의 내용).
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_user_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CREATE TABLE IF NOT EXISTS media (
  sha256      TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  size        BIGINT NOT NULL,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function migrate() {
  await pool.query(SCHEMA);
}
