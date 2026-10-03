-- 午後の LT は一部のコミュニティのみ参加する。1 = 参加, 0 = 不参加
ALTER TABLE communities ADD COLUMN in_lt INTEGER NOT NULL DEFAULT 1;
