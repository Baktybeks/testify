import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
let db;
const teacher = "00000000-0000-0000-0000-000000000001",
  boss = "00000000-0000-0000-0000-000000000004",
  student = "00000000-0000-0000-0000-000000000002",
  other = "00000000-0000-0000-0000-000000000003";
before(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,created_at timestamptz default clock_timestamp());create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
  );
  for (const f of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await db.exec(
    `insert into auth.users values('${teacher}'),('${student}'),('${other}'),('${boss}');insert into exam_private.profiles values('${teacher}','teacher','Teacher',true),('${student}','student','Student',true),('${other}','student','Other',true),('${boss}','superadmin','Superadmin',true);insert into exam_private.groups values('G1','Group 1');insert into exam_private.students values('S1','${student}','student_1','G1'),('S2','${other}','student_2','G1');`,
  );
});
after(async () => await db?.close());
test("answer review is staff-only and uses immutable attempt snapshots", async () => {
  const mid = await module();
  await as(student);
  const a = await call("attempt_start_or_resume", [mid]);
  const snapshots = (
    await db.query(
      "select * from exam_private.attempt_questions where attempt_id=$1 order by position",
      [a.attempt_id],
    )
  ).rows;
  await call("attempt_submit_answer", [
    a.attempt_id,
    1,
    snapshots[0].correct_id,
    crypto.randomUUID(),
  ]);
  await assert.rejects(
    () => call("admin_attempt_review", [a.attempt_id]),
    /преподавателя/,
  );
  await as(teacher);
  const review = await call("admin_attempt_review", [a.attempt_id]);
  assert.equal(review.length, 20);
  assert.equal(review[0].selected_id, snapshots[0].correct_id);
  assert.equal(review[0].correct, true);
  assert.equal(review[1].selected_id, null);
  await db.query(
    "update exam_private.questions set text='Changed bank' where id=$1",
    [snapshots[0].question_id],
  );
  assert.equal(
    (await call("admin_attempt_review", [a.attempt_id]))[0].text,
    snapshots[0].text,
  );
  await as(boss);
  assert.equal((await call("admin_attempt_review", [a.attempt_id])).length, 20);
  await assert.rejects(
    () => call("admin_attempt_review", [crypto.randomUUID()]),
    /не найдена/,
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('anon','public.admin_attempt_review(uuid)','execute') ok",
      )
    ).rows[0].ok,
    false,
  );
});
test("full exam deletion requires superadmin, title and reason, removes history and retains the shared bank", async () => {
  const mid = await module();
  await as(student);
  const attempt = await call("attempt_start_or_resume", [mid]);
  await call("attempt_submit_answer", [
    attempt.attempt_id,
    1,
    attempt.options[0].id,
    crypto.randomUUID(),
  ]);
  await as(teacher);
  await assert.rejects(
    () => call("admin_delete_exam_with_history", [mid, "Test", "Test cleanup"]),
    /суперадмин/,
  );
  await as(boss);
  await assert.rejects(
    () => call("admin_delete_exam_with_history", [mid, "Test", "Test cleanup"]),
    /закройте/,
  );
  await db.query(
    "update exam_private.modules set status='closed' where id=$1",
    [mid],
  );
  await assert.rejects(
    () =>
      call("admin_delete_exam_with_history", [mid, "Wrong", "Test cleanup"]),
    /название/,
  );
  await assert.rejects(
    () => call("admin_delete_exam_with_history", [mid, "Test", ""]),
    /причину/,
  );
  await as(student);
  await finishAttempt(attempt.attempt_id);
  await as(boss);
  await attemptAction("grant_retake", mid, attempt.attempt_id);
  const cid = (
    await db.query(
      "select course_module_id from exam_private.modules where id=$1",
      [mid],
    )
  ).rows[0].course_module_id;
  await call("admin_delete_exam_with_history", [
    mid,
    "Test",
    "Ошибочно созданный экзамен",
  ]);
  for (const table of [
    "modules",
    "attempts",
    "attempt_slots",
    "retake_grants",
    "module_groups",
  ])
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from exam_private.${table} where ${table === "modules" ? "id" : "module_id"}=$1`,
          [mid],
        )
      ).rows[0].n,
      0,
    );
  for (const table of ["answers", "commands", "results", "attempt_questions"])
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from exam_private.${table} where attempt_id=$1`,
          [attempt.attempt_id],
        )
      ).rows[0].n,
      0,
    );
  assert.equal((await call("admin_course_questions", [cid])).length, 90);
  const audit = (
    await db.query(
      "select details from exam_private.audit_logs where action='exam_with_history_deleted' and target=$1",
      [mid],
    )
  ).rows[0].details;
  assert.equal(audit.reason, "Ошибочно созданный экзамен");
  assert.equal(audit.attempts, 1);
  assert.equal(audit.results, 1);
});
test("module bank works without exams, is shared by exam copies and survives exam deletion", async () => {
  await as(teacher);
  const catalog = await call("admin_data");
  const { course_module_id: cid } = await command("save_course_module", {
    subject_id: catalog.subjects[0].id,
    title: "Standalone bank",
    position: 2,
  });
  const q = {
    external_id: "BANK1",
    lecture: "1",
    text: "Shared question",
    options: ["a", "b", "c", "d"],
    correct: 0,
  };
  await call("admin_bank_command", ["save_questions", cid, { questions: [q] }]);
  assert.equal((await call("admin_course_questions", [cid])).length, 1);
  const config = {
    title: "Bank exam",
    course_module_id: cid,
    question_count: 1,
    seconds_per_question: 30,
    total_seconds: 60,
    max_score: 10,
    selection_mode: "random",
    quotas: {},
  };
  const { module_id: exam } = await command("save_module", config);
  const { module_id: copy } = await command("copy_module", { module_id: exam });
  assert.equal((await call("admin_questions", [copy])).length, 1);
  await call("admin_bank_command", [
    "save_questions",
    cid,
    { questions: [{ ...q, text: "Updated shared question" }] },
  ]);
  assert.equal(
    (await call("admin_questions", [exam]))[0].text,
    "Updated shared question",
  );
  assert.equal(
    (await call("admin_questions", [copy]))[0].text,
    "Updated shared question",
  );
  await call("admin_delete_unused_exam", [exam, config.title]);
  assert.equal((await call("admin_course_questions", [cid])).length, 1);
  await as(student);
  await assert.rejects(
    () => call("admin_course_questions", [cid]),
    /преподавателя/,
  );
  await assert.rejects(
    () =>
      call("admin_bank_command", [
        "delete_question",
        cid,
        { id: crypto.randomUUID() },
      ]),
    /преподавателя/,
  );
});
test("unused exam deletion checks role, title, state and retained history", async () => {
  const mid = await module();
  await as(student);
  await assert.rejects(() => call("admin_delete_unused_exam", [mid, "Test"]));
  await as(teacher);
  const title = (
    await db.query("select title from exam_private.modules where id=$1", [mid])
  ).rows[0].title;
  await assert.rejects(
    () => call("admin_delete_unused_exam", [mid, "wrong"]),
    /название/,
  );
  await db.query("update exam_private.modules set status='open' where id=$1", [
    mid,
  ]);
  await assert.rejects(
    () => call("admin_delete_unused_exam", [mid, title]),
    /закройте/,
  );
  await db.query("update exam_private.modules set status='draft' where id=$1", [
    mid,
  ]);
  await db.query(
    "insert into exam_private.attempt_slots(module_id,student_id,started_count,last_number) values($1,'S1',1,1)",
    [mid],
  );
  await assert.rejects(
    () => call("admin_delete_unused_exam", [mid, title]),
    /история/,
  );
  await db.query("delete from exam_private.attempt_slots where module_id=$1", [
    mid,
  ]);
  const cid = (
    await db.query(
      "select course_module_id from exam_private.modules where id=$1",
      [mid],
    )
  ).rows[0].course_module_id;
  await call("admin_delete_unused_exam", [mid, title]);
  assert.equal((await call("admin_course_questions", [cid])).length, 90);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from exam_private.modules where id=$1",
        [mid],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from exam_private.questions where module_id=$1",
        [mid],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from exam_private.audit_logs where action='unused_exam_deleted' and target=$1",
        [mid],
      )
    ).rows[0].n,
    1,
  );
});
test("only superadmin can remove published or archived exams without attempts, retaining their bank", async () => {
  for (const state of ["published", "archived"]) {
    const mid = await module();
    await as(teacher);
    await db.query("update exam_private.modules set status=$2 where id=$1", [
      mid,
      state,
    ]);
    const cid = (
      await db.query(
        "select course_module_id from exam_private.modules where id=$1",
        [mid],
      )
    ).rows[0].course_module_id;
    await assert.rejects(
      () => call("admin_delete_unused_exam", [mid, "Test"]),
      /суперадмин/,
    );
    await db.query(
      "insert into exam_private.attempt_slots(module_id,student_id,started_count,last_number) values($1,'S1',2,2)",
      [mid],
    );
    await as(boss);
    await assert.rejects(
      () => call("admin_delete_unused_exam", [mid, "Wrong"]),
      /название/,
    );
    await call("admin_delete_unused_exam", [mid, "Test"]);
    assert.equal((await call("admin_course_questions", [cid])).length, 90);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from exam_private.attempt_slots where module_id=$1",
          [mid],
        )
      ).rows[0].n,
      0,
    );
  }
  const mid = await module();
  await as(student);
  await call("attempt_start_or_resume", [mid]);
  await as(boss);
  await db.query(
    "update exam_private.modules set status='closed' where id=$1",
    [mid],
  );
  await assert.rejects(
    () => call("admin_delete_unused_exam", [mid, "Test"]),
    /история/,
  );
});
test("teacher management is superadmin-only and never assigns superadmin to a new teacher", async () => {
  await as(teacher);
  await assert.rejects(() => call("superadmin_teachers"), /суперадмин/i);
  await as(student);
  await assert.rejects(() => call("superadmin_teachers"));
  const uid = "00000000-0000-0000-0000-000000000099";
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    uid,
    "newteacher@example.com",
  ]);
  await assert.rejects(
    () =>
      call("service_register_teacher", [teacher, uid, "Новый преподаватель"]),
    /суперадмин/i,
  );
  await call("service_register_teacher", [boss, uid, "Новый преподаватель"]);
  await as(boss);
  const staff = await call("superadmin_teachers");
  assert.equal(staff.find((s) => s.id === uid).role, "teacher");
  assert.equal(staff.find((s) => s.id === uid).email, "newteacher@example.com");
  const acl = await db.query(
    "select has_function_privilege('authenticated','public.service_register_teacher(uuid,uuid,text)','execute') browser,has_function_privilege('service_role','public.service_register_teacher(uuid,uuid,text)','execute') service",
  );
  assert.deepEqual(acl.rows[0], { browser: false, service: true });
  const audit = await db.query(
    "select count(*)::int n from exam_private.audit_logs where action='teacher_created' and target=$1",
    [uid],
  );
  assert.equal(audit.rows[0].n, 1);
});
async function attemptAction(action, mid, aid = null, options = {}) {
  return call("admin_attempt_action", [
    action,
    mid,
    "S1",
    options.reason ?? "Телефон выключился",
    options.key ?? crypto.randomUUID(),
    aid,
    options.deadline ?? null,
    options.confirmation ?? null,
    options.grant ?? null,
  ]);
}
async function finishAttempt(aid) {
  await db.query(
    `update exam_private.attempts set deadline_at=clock_timestamp()-interval '1 second' where id=$1`,
    [aid],
  );
  return call("attempt_current", [aid]);
}
test("repeatable retakes retain history, consume one permission and reject the old tab", async () => {
  const mid = await module();
  await as(student);
  const first = await call("attempt_start_or_resume", [mid]);
  await call("attempt_submit_answer", [
    first.attempt_id,
    1,
    first.options[0].id,
    crypto.randomUUID(),
  ]);
  await as(teacher);
  const key = crypto.randomUUID();
  const permission = await attemptAction(
    "grant_retake",
    mid,
    first.attempt_id,
    { key },
  );
  assert.deepEqual(
    await attemptAction("grant_retake", mid, first.attempt_id, { key }),
    permission,
  );
  await assert.rejects(
    () =>
      attemptAction("grant_retake", mid, first.attempt_id, {
        key,
        reason: "Другая причина",
      }),
    /Ключ/,
  );
  await as(student);
  const stale = await call("attempt_submit_answer", [
    first.attempt_id,
    2,
    first.options[0].id,
    crypto.randomUUID(),
  ]);
  assert.equal(stale.annulled, true);
  assert.equal(stale.score, undefined);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from exam_private.answers where attempt_id=$1",
        [first.attempt_id],
      )
    ).rows[0].n,
    1,
  );
  const cards = await call("student_modules");
  assert.equal(cards.find((m) => m.id === mid).retake_allowed, true);
  const second = await call("attempt_start_or_resume", [mid]);
  assert.equal(second.attempt_number, 2);
  assert.notEqual(second.attempt_id, first.attempt_id);
  assert.notDeepEqual(second.options, first.options);
  assert.equal(
    (await call("attempt_start_or_resume", [mid])).attempt_id,
    second.attempt_id,
  );
  await as(teacher);
  await attemptAction("grant_retake", mid, second.attempt_id, {
    reason: "Повторный технический сбой",
  });
  await as(student);
  const third = await call("attempt_start_or_resume", [mid]);
  assert.equal(third.attempt_number, 3);
  await as(teacher);
  const report = await call("admin_data", [mid, null]);
  assert.equal(report.attempts.length, 3);
  assert.equal(
    report.attempts.filter((a) => a.status === "annulled").length,
    2,
  );
  assert.equal(report.stats.active, 1);
  assert.equal(report.stats.started, 1);
});
test("only superadmin grants retakes after publication and publishes the replacement grade", async () => {
  const mid = await module();
  await as(student);
  const first = await call("attempt_start_or_resume", [mid]);
  await finishAttempt(first.attempt_id);
  await as(teacher);
  await command("transition", { module_id: mid, status: "closed" });
  await command("transition", { module_id: mid, status: "published" });
  await assert.rejects(
    () => attemptAction("grant_retake", mid, first.attempt_id),
    /суперадмин/,
  );
  await as(boss);
  assert.equal((await call("my_profile")).role, "superadmin");
  await attemptAction("grant_retake", mid, first.attempt_id);
  await as(student);
  assert.equal(
    (await call("attempt_current", [first.attempt_id])).published,
    false,
  );
  const second = await call("attempt_start_or_resume", [mid]);
  assert.equal((await finishAttempt(second.attempt_id)).published, false);
  await as(teacher);
  await assert.rejects(
    () => attemptAction("publish_result", mid, second.attempt_id),
    /суперадмин/,
  );
  await as(boss);
  await attemptAction("publish_result", mid, second.attempt_id, {
    reason: "Проверена пересдача после сбоя",
  });
  await as(student);
  const visible = await call("attempt_current", [second.attempt_id]);
  assert.equal(visible.published, true);
  assert.equal(visible.score, 0);
});
test("permanent deletion requires superadmin, reason and login; it cannot create a free new attempt", async () => {
  const mid = await module();
  await as(student);
  const first = await call("attempt_start_or_resume", [mid]);
  await finishAttempt(first.attempt_id);
  await as(teacher);
  await assert.rejects(
    () =>
      attemptAction("delete_attempt", mid, first.attempt_id, {
        confirmation: "student_1",
      }),
    /суперадмин/,
  );
  await as(boss);
  await assert.rejects(
    () =>
      attemptAction("delete_attempt", mid, first.attempt_id, {
        confirmation: "wrong",
      }),
    /логин/,
  );
  await assert.rejects(
    () =>
      attemptAction("delete_attempt", mid, first.attempt_id, {
        confirmation: "student_1",
        reason: "",
      }),
    /причину/,
  );
  const key = crypto.randomUUID();
  await attemptAction("delete_attempt", mid, first.attempt_id, {
    confirmation: "student_1",
    key,
  });
  await attemptAction("delete_attempt", mid, first.attempt_id, {
    confirmation: "student_1",
    key,
  });
  for (const table of ["answers", "commands", "results", "attempt_questions"])
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from exam_private.${table} where attempt_id=$1`,
          [first.attempt_id],
        )
      ).rows[0].n,
      0,
    );
  await as(student);
  await assert.rejects(
    () => call("attempt_current", [first.attempt_id]),
    /недоступна/,
  );
  await assert.rejects(
    () => call("attempt_start_or_resume", [mid]),
    /разрешение/,
  );
  await as(boss);
  await attemptAction("grant_retake", mid);
  await as(student);
  const replacement = await call("attempt_start_or_resume", [mid]);
  assert.equal(replacement.attempt_number, 2);
  const audit = (
    await db.query(
      `select details from exam_private.audit_logs where action='delete_attempt' and target=$1`,
      [first.attempt_id],
    )
  ).rows;
  assert.equal(audit.length, 1);
  assert.ok(!JSON.stringify(audit).includes("score"));
});
test("pending grants block global publication, can be revoked and cannot be used after expiry", async () => {
  const mid = await module();
  await as(student);
  const first = await call("attempt_start_or_resume", [mid]);
  await as(teacher);
  const grant = await attemptAction("grant_retake", mid, first.attempt_id);
  await command("transition", { module_id: mid, status: "closed" });
  await assert.rejects(
    () => command("transition", { module_id: mid, status: "published" }),
    /неиспользованные/,
  );
  await attemptAction("revoke_retake", mid, null, {
    grant: grant.grant_id,
    reason: "Студент отказался от пересдачи",
  });
  const next = await attemptAction("grant_retake", mid);
  await db.query(
    `update exam_private.retake_grants set start_deadline=clock_timestamp()-interval '1 second' where id=$1`,
    [next.grant_id],
  );
  await as(student);
  await assert.rejects(
    () => call("attempt_start_or_resume", [mid]),
    /разрешение/,
  );
  await as(teacher);
  await assert.rejects(
    () =>
      attemptAction("grant_retake", mid, null, {
        deadline: "2000-01-01T00:00:00Z",
      }),
    /будущем/,
  );
  await command("transition", { module_id: mid, status: "published" });
});
test("opening selected groups is atomic, preserves windows and rejects invalid admission", async () => {
  const id = await module();
  await as(teacher);
  await command("save_group", { id: "G2", name: "Group 2" });
  await command("transition", { module_id: id, status: "closed" });
  await assert.rejects(
    () => call("admin_open_exam_groups", [id, []]),
    /Выберите/,
  );
  await assert.rejects(
    () => call("admin_open_exam_groups", [id, ["Missing"]]),
    /не найдена/,
  );
  await db.query(
    "update exam_private.questions set active=false where course_module_id=(select course_module_id from exam_private.modules where id=$1)",
    [id],
  );
  await assert.rejects(
    () => call("admin_open_exam_groups", [id, ["G2"]]),
    /Недостаточно/,
  );
  let groups = (
    await db.query(
      "select group_id,access from exam_private.module_groups where module_id=$1 order by group_id",
      [id],
    )
  ).rows;
  assert.deepEqual(groups, [{ group_id: "G1", access: true }]);
  assert.equal(
    (
      await db.query("select status from exam_private.modules where id=$1", [
        id,
      ])
    ).rows[0].status,
    "closed",
  );
  await db.query(
    "update exam_private.questions set active=true where course_module_id=(select course_module_id from exam_private.modules where id=$1)",
    [id],
  );
  const future = "2099-01-01T00:00:00.000Z";
  await command("group_access", {
    module_id: id,
    group_id: "G2",
    access: false,
    window_start: future,
    window_end: null,
  });
  await as(student);
  await assert.rejects(
    () => call("admin_open_exam_groups", [id, ["G2"]]),
    /преподавателя/,
  );
  await as(teacher);
  const opened = await call("admin_open_exam_groups", [id, ["G2", "G2"]]);
  assert.deepEqual(opened.group_ids, ["G2"]);
  groups = (
    await db.query(
      "select group_id,access from exam_private.module_groups where module_id=$1 order by group_id",
      [id],
    )
  ).rows;
  assert.deepEqual(groups, [
    { group_id: "G1", access: false },
    { group_id: "G2", access: true },
  ]);
  assert.equal(
    new Date(
      (
        await db.query(
          "select window_start from exam_private.module_groups where module_id=$1 and group_id='G2'",
          [id],
        )
      ).rows[0].window_start,
    ).toISOString(),
    future,
  );
  await assert.rejects(
    () => call("admin_open_exam_groups", [id, ["G1"]]),
    /черновика/,
  );
  await command("transition", { module_id: id, status: "closed" });
  await command("group_access", {
    module_id: id,
    group_id: "G2",
    access: true,
    window_start: null,
    window_end: "2000-01-01T00:00:00Z",
  });
  await assert.rejects(
    () => call("admin_open_exam_groups", [id, ["G2"]]),
    /истекло/,
  );
});
test("subject catalog: independent modules, banks and role boundaries", async () => {
  await as(teacher);
  const catalog = await call("admin_data");
  assert.equal(catalog.subjects.length, 2);
  assert.ok(catalog.course_modules.length >= 4);
  const web = catalog.subjects.find((s) => s.name === "Web-разработка"),
    ux = catalog.subjects.find((s) => s.name === "UX/UI");
  const web1 = catalog.course_modules.find(
      (c) => c.subject_id === web.id && c.title === "Модуль 1",
    ),
    ux2 = catalog.course_modules.find(
      (c) => c.subject_id === ux.id && c.title === "Модуль 2",
    );
  const source = await module(20, "random", {}, web1.id);
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
  assert.equal((await call("admin_questions", [copy])).length, 0);
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
async function module(
  count = 20,
  mode = "random",
  quotas = {},
  courseId = null,
) {
  await as(teacher);
  if (!courseId) {
    const subject = (await call("admin_data")).subjects[0];
    courseId = (
      await command("save_course_module", {
        subject_id: subject.id,
        title: "Isolated " + crypto.randomUUID(),
        position: 1,
      })
    ).course_module_id;
  }
  const { module_id: id } = await command("save_module", {
    course_module_id: courseId,
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
    "update exam_private.questions set correct=(correct+1)%4 where course_module_id=(select course_module_id from exam_private.modules where id=$1)",
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
test("quota selection exact, insufficient topic blocks opening, copies share their module bank", async () => {
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
    `update exam_private.questions set active=false where course_module_id=(select course_module_id from exam_private.modules where id=$1) and lecture='7'`,
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
