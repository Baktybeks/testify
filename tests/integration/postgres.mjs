import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";

// Only a disposable database with this exact name may be used.
const connectionString = process.env.TEST_DATABASE_URL;
test(
  "independent PostgreSQL sessions serialize start/answer under contention",
  { skip: !connectionString },
  async () => {
    if (new URL(connectionString).pathname !== "/testify_test")
      throw new Error("Use a disposable database named testify_test");
    const setup = new pg.Client({ connectionString });
    await setup.connect();
    const clients = [];
    try {
      const existing = await setup.query(
        `select 1 from information_schema.schemata where schema_name in ('exam_private','auth')`,
      );
      if (existing.rowCount)
        throw new Error(
          "Expected a fresh disposable database; no existing schemas will be deleted.",
        );
      await setup.query(
        `do $roles$ declare r text; begin foreach r in array array['anon','authenticated','service_role'] loop if not exists(select 1 from pg_roles where rolname=r) then execute format('create role %I',r);end if;end loop;end $roles$;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
      );
      for (const f of (await readdir("supabase/migrations"))
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await setup.query(await readFile("supabase/migrations/" + f, "utf8"));
      const teacher = crypto.randomUUID(),
        student = crypto.randomUUID();
      await setup.query(`insert into auth.users values($1),($2);`, [
        teacher,
        student,
      ]);
      await setup.query(
        `insert into exam_private.profiles values($1,'teacher','Test teacher',true),($2,'student','Test student',true)`,
        [teacher, student],
      );
      await setup.query(
        `insert into exam_private.groups values('test','Test');insert into exam_private.students values('S1','${student}','student_1','test');`,
      );
      await setup.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
        teacher,
      ]);
      const cmd = async (action, data) =>
        (
          await setup.query("select public.admin_command($1,$2) result", [
            action,
            data,
          ])
        ).rows[0].result;
      const { module_id: id } = await cmd("save_module", {
        title: "Concurrency",
        question_count: 20,
        seconds_per_question: 30,
        total_seconds: 600,
        max_score: 10,
        selection_mode: "random",
        quotas: {},
      });
      await cmd("group_access", {
        module_id: id,
        group_id: "test",
        access: true,
      });
      await cmd("save_questions", {
        module_id: id,
        questions: Array.from({ length: 90 }, (_, i) => ({
          external_id: "Q" + i,
          lecture: String(i % 7),
          text: "Question " + i,
          options: ["one", "two", "three", "four"],
          correct: 0,
          active: true,
        })),
      });
      await cmd("transition", { module_id: id, status: "open" });
      for (let i = 0; i < 8; i++) {
        const client = new pg.Client({ connectionString });
        await client.connect();
        await client.query(
          `select set_config('request.jwt.claim.sub',$1,false)`,
          [student],
        );
        clients.push(client);
      }
      const attempts = await Promise.all(
        clients.map(
          async (c) =>
            (
              await c.query(
                "select public.attempt_start_or_resume($1) result",
                [id],
              )
            ).rows[0].result,
        ),
      );
      assert.equal(new Set(attempts.map((a) => a.attempt_id)).size, 1);
      const a = attempts[0];
      const responses = await Promise.all(
        clients.map(
          async (c, i) =>
            (
              await c.query(
                "select public.attempt_submit_answer($1,$2,$3,$4) result",
                [a.attempt_id, 1, a.options[i % 4].id, crypto.randomUUID()],
              )
            ).rows[0].result,
        ),
      );
      assert.equal(responses.filter((r) => r.outcome === "accepted").length, 1);
      const count = await setup.query(
        "select count(*)::int n from exam_private.answers where attempt_id=$1",
        [a.attempt_id],
      );
      assert.equal(count.rows[0].n, 1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
      await setup.end();
    }
  },
);
