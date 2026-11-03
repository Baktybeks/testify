import { test } from "node:test";
import assert from "node:assert/strict";
import { validateQuestions } from "../src/features/files.ts";
const row = {
  Lecture: "HTML",
  Question: "Новый вопрос",
  OptionA: "A",
  OptionB: "B",
  OptionC: "C",
  OptionD: "D",
  CorrectOption: "A",
};
test("default question import needs no IDs and ignores supplied IDs to prevent overwriting", () => {
  const result = validateQuestions([
    row,
    { ...row, QuestionID: "Q001" },
    { ...row, QuestionID: "Q001" },
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.questions.map((q) => q.external_id),
    ["", "", ""],
  );
});
test("explicit update mode requires unique IDs and preserves them for upserts", () => {
  assert.ok(
    validateQuestions([row], true).errors.some((e) => e.includes("QuestionID")),
  );
  assert.ok(
    validateQuestions(
      [
        { ...row, QuestionID: "Q1" },
        { ...row, QuestionID: "Q1" },
      ],
      true,
    ).errors.some((e) => e.includes("QuestionID")),
  );
  assert.equal(
    validateQuestions([{ ...row, QuestionID: "Q1" }], true).questions[0]
      .external_id,
    "Q1",
  );
});
