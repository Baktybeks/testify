import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStudentJson } from "../src/features/student-json.ts";
import { providedPassword } from "../supabase/functions/_shared/password.ts";
const groups = new Set(["G1", "G2"]);
const input = [
  { name: "Иванов Иван", login: "Ivanov_i_i" },
  {
    name: "Петров Пётр",
    login: "petrov_p_p",
    group: "G2",
    password: "Personal-test-2026!",
    status: "blocked",
  },
];
test("JSON import resolves group and ID defaults, normalizes logins and applies common password", () => {
  const rows = parseStudentJson(
    JSON.stringify(input),
    "Common-test-2026!",
    "G1",
    groups,
  );
  assert.deepEqual(rows[0], {
    id: "ivanov_i_i",
    login: "ivanov_i_i",
    full_name: "Иванов Иван",
    group_id: "G1",
    active: true,
    password: "Common-test-2026!",
  });
  assert.equal(rows[1].password, "Personal-test-2026!");
  assert.equal(rows[1].group_id, "G2");
  assert.equal(rows[1].active, false);
});
test("JSON supports spreadsheet aliases and random codes when password is omitted", () => {
  const [row] = parseStudentJson(
    JSON.stringify([
      {
        StudentID: "S01",
        FullName: "Студент Один",
        Login: "student_one",
        GroupID: "G1",
        Status: "active",
      },
    ]),
    "",
    "",
    groups,
  );
  assert.equal(row.id, "S01");
  assert.equal(row.password, undefined);
  assert.equal(row.group_id, "G1");
});
test("invalid JSON, duplicates, unknown groups and malformed passwords are rejected before import", () => {
  for (const text of [
    "{",
    "{}",
    "[]",
    JSON.stringify(Array(501).fill(input[0])),
    JSON.stringify([input[0], { ...input[0], login: "ivanov_i_i" }]),
  ])
    assert.throws(() =>
      parseStudentJson(text, "Common-test-2026!", "G1", groups),
    );
  for (const row of [
    { ...input[0], group: "Missing" },
    { ...input[0], password: "short" },
    { ...input[0], password: "" },
    { ...input[0], password: 42 },
    { ...input[0], password: "x".repeat(129) },
    { ...input[0], status: "unknown" },
  ])
    assert.throws(() =>
      parseStudentJson(
        JSON.stringify([row]),
        "Common-test-2026!",
        "G1",
        groups,
      ),
    );
});
test("server accepts supplied 8–128 character passwords verbatim and rejects invalid types", () => {
  assert.equal(providedPassword(undefined), undefined);
  assert.equal(providedPassword(" password-test "), " password-test ");
  assert.equal(providedPassword('12345678'),'12345678');
  assert.equal(parseStudentJson(JSON.stringify([input[0]]),'12345678','G1',groups)[0].password,'12345678');
  assert.throws(()=>parseStudentJson(JSON.stringify([input[0]]),'1234567','G1',groups));
  for (const value of [null, {}, false, 123, "", "1234567", "x".repeat(129)])
    assert.throws(() => providedPassword(value));
});
