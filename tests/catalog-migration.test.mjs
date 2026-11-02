import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("catalog upgrade preserves existing exams, questions, attempts and published results", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,created_at timestamptz default clock_timestamp());create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
    );
    const files = (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const catalogIndex = files.findIndex((f) => f.includes("subject_catalog"));
    for (const file of files.slice(0, catalogIndex))
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    const uid = crypto.randomUUID();
    await db.exec(
      `insert into auth.users values('${uid}');insert into exam_private.profiles values('${uid}','student','Existing student',true);insert into exam_private.groups values('old','Existing group');insert into exam_private.students values('S1','${uid}','existing','old');`,
    );
    const mid = (
      await db.query(
        `insert into exam_private.modules(title,status,question_count) values('Existing exam','open',2) returning id`,
      )
    ).rows[0].id;
    await db.query(
      `insert into exam_private.module_groups values($1,'old',true,null,null)`,
      [mid],
    );
    for (let i = 0; i < 2; i++)
      await db.query(
        `insert into exam_private.questions(module_id,external_id,lecture,text,options,correct) values($1,$2,'1',$3,'["a","b","c","d"]',0)`,
        [mid, "Q" + i, "Existing question " + i],
      );
    const duplicate = (
      await db.query(
        "insert into exam_private.modules(title,status) values('Duplicate','draft') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into exam_private.questions(module_id,external_id,lecture,text,options,correct) select $1,external_id,lecture,text,options,correct from exam_private.questions where module_id=$2",
      [duplicate, mid],
    );
    await db.query(
      "update exam_private.questions set text='Divergent version' where module_id=$1 and external_id='Q1'",
      [duplicate],
    );
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
      uid,
    ]);
    const aid = (
      await db.query("select public.attempt_start_or_resume($1) state", [mid])
    ).rows[0].state.attempt_id;
    const snapshots = (
      await db.query(
        "select * from exam_private.attempt_questions where attempt_id=$1 order by position",
        [aid],
      )
    ).rows;
    for (const q of snapshots)
      await db.query("select public.attempt_submit_answer($1,$2,$3,$4)", [
        aid,
        q.position + 1,
        q.correct_id,
        crypto.randomUUID(),
      ]);
    await db.query(
      `update exam_private.modules set status='published',published_at=clock_timestamp() where id=$1`,
      [mid],
    );
    const before = (
      await db.query("select public.attempt_current($1) state", [aid])
    ).rows[0].state;
    for (const file of files.slice(catalogIndex))
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    const after = (
      await db.query("select public.attempt_current($1) state", [aid])
    ).rows[0].state;
    assert.equal(after.attempt_id, before.attempt_id);
    assert.equal(after.score, before.score);
    assert.equal(after.correct, before.correct);
    assert.equal(after.subject_name, "Web-разработка");
    assert.equal(after.course_module_title, "Модуль 1");
    assert.deepEqual(
      (
        await db.query(
          "select * from exam_private.attempt_questions where attempt_id=$1 order by position",
          [aid],
        )
      ).rows,
      snapshots,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from exam_private.questions where course_module_id=(select course_module_id from exam_private.modules where id=$1)",
          [mid],
        )
      ).rows[0].n,
      3,
    );
    const catalog = (await db.query("select public.student_modules() data"))
      .rows[0].data;
    assert.equal(
      catalog.some((m) => m.id === mid),
      false,
    );
    const history = (
      await db.query("select public.student_exam_history() data")
    ).rows[0].data;
    assert.equal(history.find((m) => m.id === mid).attempt_id, aid);
  } finally {
    await db.close();
  }
});
