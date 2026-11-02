import { test } from "node:test";
import assert from "node:assert/strict";
import { teacherInput } from "../supabase/functions/_shared/teacher-input.ts";
test("teacher input requires email, name and an explicit password of at least eight characters", () => {
  assert.deepEqual(
    teacherInput({
      full_name: "  Иван Иванов  ",
      email: " Teacher@Example.com ",
      password: "12345678",
    }),
    {
      full_name: "Иван Иванов",
      email: "teacher@example.com",
      password: "12345678",
    },
  );
  for (const override of [
    { full_name: "А" },
    { email: "invalid" },
    { password: "1234567" },
    { password: undefined },
  ])
    assert.throws(() =>
      teacherInput({
        full_name: "Иван Иванов",
        email: "teacher@example.com",
        password: "12345678",
        ...override,
      }),
    );
});
