CREATE TABLE communities (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL
);

-- session: 'intro' = 午前のコミュニティ紹介, 'lt' = 午後のライトニングトーク
-- UNIQUE 制約で「1コミュニティ1回」「1枠1コミュニティ」を DB レベルで保証する
CREATE TABLE draws (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session      TEXT    NOT NULL CHECK (session IN ('intro', 'lt')),
  community_id INTEGER NOT NULL REFERENCES communities(id),
  slot         INTEGER NOT NULL,
  drawer       TEXT    NOT NULL,
  drawn_at     TEXT    NOT NULL,
  UNIQUE (session, community_id),
  UNIQUE (session, slot)
);
