// communities.json から seed.sql（ハッシュのみ）と codes.csv（配布用の合言葉）を生成する。
// 実行するたびに合言葉は作り直される。
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 0/O, 1/I を除外
const CODE_LENGTH = 8;

const names = JSON.parse(readFileSync("communities.json", "utf8"));
const sqlStr = (s) => `'${s.replaceAll("'", "''")}'`;
const genCode = () =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const rows = names.map((name, i) => ({ id: i + 1, name, code: genCode() }));

const sql = rows
  .map(({ id, name, code }) => {
    const hash = createHash("sha256").update(code).digest("hex");
    return `INSERT INTO communities (id, name, code_hash) VALUES (${id}, ${sqlStr(name)}, '${hash}')
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, code_hash = excluded.code_hash;`;
  })
  .join("\n");
writeFileSync("seed.sql", sql + "\n");

const csv = ["id,community,code", ...rows.map((r) => `${r.id},"${r.name.replaceAll('"', '""')}",${r.code}`)];
writeFileSync("codes.csv", csv.join("\n") + "\n");

console.log(`${rows.length} 件のコミュニティを seed.sql に書き出しました。合言葉は codes.csv を参照してください。`);
