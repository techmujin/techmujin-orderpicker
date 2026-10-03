// communities.json から seed.sql（ハッシュのみ）と codes.csv（配布用の合言葉）を生成する。
// communities.json の各要素は { "name": コミュニティ名, "lt": 午後の LT に参加するか }。
// 実行するたびに合言葉は作り直される。
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 0/O, 1/I を除外
const CODE_LENGTH = 8;

const communities = JSON.parse(readFileSync("communities.json", "utf8"));
const sqlStr = (s) => `'${s.replaceAll("'", "''")}'`;
const genCode = () =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const rows = communities.map(({ name, lt }, i) => ({ id: i + 1, name, inLt: lt ? 1 : 0, code: genCode() }));

const sql = rows
  .map(({ id, name, inLt, code }) => {
    const hash = createHash("sha256").update(code).digest("hex");
    return `INSERT INTO communities (id, name, code_hash, in_lt) VALUES (${id}, ${sqlStr(name)}, '${hash}', ${inLt})
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, code_hash = excluded.code_hash, in_lt = excluded.in_lt;`;
  })
  .join("\n");
writeFileSync("seed.sql", sql + "\n");

const csv = ["id,community,lt,code", ...rows.map((r) => `${r.id},"${r.name.replaceAll('"', '""')}",${r.inLt ? "参加" : "不参加"},${r.code}`)];
writeFileSync("codes.csv", csv.join("\n") + "\n");

const ltCount = rows.filter((r) => r.inLt).length;
console.log(`${rows.length} 件（うち LT 参加 ${ltCount} 件）のコミュニティを seed.sql に書き出しました。合言葉は codes.csv を参照してください。`);
