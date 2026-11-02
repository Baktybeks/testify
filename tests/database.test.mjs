import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
let db;
const teacher = "00000000-0000-0000-0000-000000000001",
  student = "00000000-0000-0000-0000-000000000002",
  other = "00000000-0000-0000-0000-000000000003";
before(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
  );
  for (const f of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await db.exec(
    `insert into auth.users values('${teacher}'),('${student}'),('${other}');insert into exam_private.profiles values('${teacher}','teacher','Teacher',true),('${student}','student','Student',true),('${other}','student','Other',true);insert into exam_private.groups values('G1','Group 1');insert into exam_private.students values('S1','${student}','student_1','G1'),('S2','${other}','student_2','G1');`,
  );
});
after(async () => await db?.close());
test("subject catalog: independent modules, bank copies and role boundaries", async () => {
  await as(teacher);
  const catalog = await call("admin_data");
  assert.equal(catalog.subjects.length, 2);
  assert.equal(catalog.course_modules.length, 4);
  const web = catalog.subjects.find((s) => s.name === "Web-разработка"),
    ux = catalog.subjects.find((s) => s.name === "UX/UI");
  const web1 = catalog.course_modules.find(
      (c) => c.subject_id === web.id && c.position === 1,
    ),
    ux2 = catalog.course_modules.find(
      (c) => c.subject_id === ux.id && c.position === 2,
    );
  const source = await module();
  await as(teacher);
  const { module_id: copy } = await command("copy_module", {
    module_id: source,
    course_module_id: ux2.id,
  });
  const data = await call("admin_data");
  assert.equal(
    data.modules.find((m) => m.id === source).course_module_id,
    web1.id,
  );
  assert.equal(data.modules.find((m) => m.id === copy).subject_name, "UX/UI");
  assert.equal((await call("admin_questions", [copy])).length, 90);
  await command("save_questions", {
    module_id: copy,
    questions: [
      {
        external_id: "Q0",
        lecture: "UX",
        text: "Independent UX question",
        options: ["one", "two", "three", "four"],
        correct: 1,
        active: true,
      },
    ],
  });
  assert.notEqual(
    (await call("admin_questions", [source]))[0].text,
    "Independent UX question",
  );
  const { subject_id: newSubject } = await command("save_subject", {
    name: "Дизайн",
  });
  await command("save_course_module", {
    subject_id: newSubject,
    title: "Модуль 3",
    position: 3,
  });
  await assert.rejects(() =>
    command("save_subject", { name: "web-разработка" }),
  );
  await assert.rejects(
    () =>
      command("save_course_module", {
        id: ux2.id,
        subject_id: web.id,
        title: "Модуль 2",
        position: 2,
      }),
    /переносить/,
  );
  await as(student);
  await assert.rejects(
    () => command("save_subject", { name: "Forbidden" }),
    /преподавателя/,
  );
});
async function as(id) {
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [id]);
}
async function call(name, args = []) {
  const result = await db.query(
    `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
    args,
  );
  return result.rows[0].result;
}
async function command(action, data) {
  return call("admin_command", [action, JSON.stringify(data)]);
}
async function module(count = 20, mode = "random", quotas = {}) {
  await as(teacher);
  const { module_id: id } = await command("save_module", {
    title: "Test",
    question_count: count,
    seconds_per_question: 30,
    total_seconds: 600,
    max_score: 10,
    selection_mode: mode,
    quotas,
  });
  await command("group_access", {
    module_id: id,
    group_id: "G1",
    access: true,
  });
  await command("save_questions", {
    module_id: id,
    questions: Array.from({ length: 90 }, (_, i) => ({
      external_id: "Q" + i,
      lecture: String((i % 7) + 1),
      text: "Question " + i,
      options: ["A", "B", "C", "D"],
      correct: i % 4,
      active: true,
    })),
  });
  await command("transition", { module_id: id, status: "open" });
  return id;
}
test("start/resume, stable snapshots and secrecy; all 20 answers score once", async () => {
  const id = await module();
  await as(student);
  const a = await call("attempt_start_or_resume", [id]);
  assert.equal(a.total, 20);
  assert.equal(a.index, 1);
  assert.ok(!JSON.stringify(a).includes("correct"));
  assert.equal(
    (await call("attempt_start_or_resume", [id])).attempt_id,
    a.attempt_id,
  );
  assert.deepEqual(
    (await call("attempt_current", [a.attempt_id])).options,
    a.options,
  );
  const questions = (
    await db.query(
      "select * from exam_private.attempt_questions where attempt_id=$1 order by position",
      [a.attempt_id],
    )
  ).rows;
  assert.equal(new Set(questions.map((q) => q.question_id)).size, 20);
  const key = crypto.randomUUID();
  const first = await call("attempt_submit_answer", [
    a.attempt_id,
    1,
    questions[0].correct_id,
    key,
  ]);
  assert.equal(first.index, 2);
  assert.equal(first.outcome, "accepted");
  const duplicate = await call("attempt_submit_answer", [
    a.attempt_id,
    1,
    questions[0].correct_id,
    key,
  ]);
  assert.equal(duplicate.index, 2);
  await assert.rejects(() =>
    call("attempt_submit_answer", [
      a.attempt_id,
      2,
      questions[1].correct_id,
      key,
    ]),
  );
  // A bank edit cannot alter attempt snapshots (even if done outside the API).
  await db.query(
    "update exam_private.questions set correct=(correct+1)%4 where module_id=$1",
    [id],
  );
  for (let i = 1; i < 20; i++)
    await call("attempt_submit_answer", [
      a.attempt_id,
      i + 1,
      questions[i].correct_id,
      crypto.randomUUID(),
    ]);
  const done = await call("attempt_current", [a.attempt_id]);
  assert.equal(done.done, true);
  assert.equal(done.score, undefined);
  await as(other);
  await assert.rejects(
    () => call("attempt_current", [a.attempt_id]),
    /недоступна/,
  );
  await as(teacher);
  await command("transition", { module_id: id, status: "closed" });
  await command("transition", { module_id: id, status: "published" });
  await assert.rejects(
    () => command("transition", { module_id: id, status: "open" }),
    /переход/,
  );
  await as(student);
  const result = await call("attempt_current", [a.attempt_id]);
  assert.equal(result.score, 10);
  assert.equal(result.correct, 20);
});
test("elapsed questions catch up; late answer cannot be accepted", async () => {
  const id = await module();
  await as(student);
  const a = await call("attempt_start_or_resume", [id]);
  await db.query(
    `update exam_private.attempts set question_deadline=clock_timestamp()-interval '61 seconds' where id=$1`,
    [a.attempt_id],
  );
  const state = await call("attempt_submit_answer", [
    a.attempt_id,
    1,
    a.options[0].id,
    crypto.randomUUID(),
  ]);
  assert.equal(state.index, 4);
  assert.equal(state.outcome, "expired_or_stale");
  const answers = (
    await db.query("select * from exam_private.answers where attempt_id=$1", [
      a.attempt_id,
    ])
  ).rows;
  assert.equal(answers.length, 3);
  assert.ok(answers.every((a) => a.option_id === null));
  await db.query(
    `update exam_private.attempts set deadline_at=clock_timestamp()-interval '1 second' where id=$1`,
    [a.attempt_id],
  );
  const done = await call("attempt_current", [a.attempt_id]);
  assert.equal(done.done, true);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from exam_private.answers where attempt_id=$1",
        [a.attempt_id],
      )
    ).rows[0].n,
    20,
  );
});
test("closing stops new starts, allows existing attempts, prevents early publication", async () => {
  const id = await module();
  await as(student);
  const a = await call("attempt_start_or_resume", [id]);
  await as(teacher);
  await command("transition", { module_id: id, status: "closed" });
  await assert.rejects(
    () => command("transition", { module_id: id, status: "published" }),
    /незавершённые/,
  );
  await as(other);
  await assert.rejects(() => call("attempt_start_or_resume", [id]), /закрыт/);
  await as(student);
  assert.equal(
    (await call("attempt_start_or_resume", [id])).attempt_id,
    a.attempt_id,
  );
});
test("quota selection exact, insufficient topic blocks opening, copies are independent", async () => {
  const quotas = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 2, 6: 3, 7: 3 };
  const id = await module(20, "quotas", quotas);
  await as(student);
  const a = await call("attempt_start_or_resume", [id]);
  const counts = (
    await db.query(
      "select q.lecture,count(*)::int n from exam_private.attempt_questions aq join exam_private.questions q on q.id=aq.question_id where aq.attempt_id=$1 group by q.lecture",
      [a.attempt_id],
    )
  ).rows;
  assert.deepEqual(
    Object.fromEntries(counts.map((r) => [r.lecture, r.n])),
    quotas,
  );
  await as(teacher);
  const { module_id: copy } = await command("copy_module", { module_id: id });
  assert.notEqual(copy, id);
  await command("group_access", {
    module_id: copy,
    group_id: "G1",
    access: true,
  });
  await db.query(
    `update exam_private.questions set active=false where module_id=$1 and lecture='7'`,
    [copy],
  );
  await assert.rejects(
    () => command("transition", { module_id: copy, status: "open" }),
    /теме 7/,
  );
});
test("student cannot access admin; private tables and helper functions inaccessible", async () => {
  await as(student);
  await assert.rejects(() => call("admin_data"), /преподавателя/);
  assert.equal(
    (
      await db.query(
        `select has_schema_privilege('authenticated','exam_private','USAGE') ok`,
      )
    ).rows[0].ok,
    false,
  );
  assert.equal(
    (
      await db.query(
        `select has_function_privilege('anon','public.attempt_current(uuid)','EXECUTE') ok`,
      )
    ).rows[0].ok,
    false,
  );
  assert.equal(
    (
      await db.query(
        `select has_function_privilege('authenticated','public.service_teacher(uuid,text)','EXECUTE') ok`,
      )
    ).rows[0].ok,
    false,
  );
  const exposed = (
    await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='exam_private' and has_function_privilege('authenticated',p.oid,'EXECUTE')`,
    )
  ).rows;
  assert.deepEqual(exposed, []);
});
test("parallel queued commands cannot create duplicate attempts or answers (embedded engine)", async () => {
  const id = await module();
  await as(student);
  const states = await Promise.all(
    Array.from({ length: 8 }, () => call("attempt_start_or_resume", [id])),
  );
  assert.equal(new Set(states.map((a) => a.attempt_id)).size, 1);
  const a = states[0];
  await Promise.all(
    Array.from({ length: 8 }, () =>
      call("attempt_submit_answer", [
        a.attempt_id,
        1,
        a.options[0].id,
        crypto.randomUUID(),
      ]),
    ),
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from exam_private.answers where attempt_id=$1",
        [a.attempt_id],
      )
    ).rows[0].n,
    1,
  );
});
