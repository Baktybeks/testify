import { createClient } from "npm:@supabase/supabase-js@2";
import { providedPassword } from "../_shared/password.ts";
import { resolveStudentId } from "../_shared/student-id.ts";
import { teacherInput } from "../_shared/teacher-input.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const origin = Deno.env.get("ALLOWED_ORIGIN") || "https://baktybeks.github.io";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
  "Content-Type": "application/json",
};
Deno.serve(async (req) => {
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (!origin || req.headers.get("origin") !== origin)
    return reply({ error: "Origin запрещён" }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST")
    return reply({ error: "Метод не поддерживается" }, 405);
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!token) return reply({ error: "Нужен вход" }, 401);
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error: authError,
    } = await caller.auth.getUser(token);
    if (authError || !user) return reply({ error: "Сессия истекла" }, 401);
    const { data: profile, error: profileError } =
      await caller.rpc("my_profile");
    if (
      profileError ||
      !["teacher", "superadmin"].includes(profile?.role) ||
      !profile.active
    )
      return reply({ error: "Доступ запрещён" }, 403);
    const service = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: limit, error: limitError } = await caller.rpc(
      "admin_account_limit",
    );
    if (limitError || !limit)
      return reply({ error: "Лимит операций. Повторите позже." }, 429);
    const raw = await req.text();
    if (raw.length > 10000)
      return reply({ error: "Запрос слишком большой" }, 413);
    const b = JSON.parse(raw);
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new Error("Некорректный запрос");
    if (b.action === "create-teacher") {
      if (profile.role !== "superadmin")
        return reply(
          { error: "Создавать преподавателей может только суперадмин" },
          403,
        );
      const input = teacherInput(b);
      const { data, error } = await service.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
      });
      if (error) throw error;
      const { error: dbError } = await service.rpc("service_register_teacher", {
        p_actor: user.id,
        p_auth_id: data.user.id,
        p_name: input.full_name,
      });
      if (dbError) {
        const { error: cleanup } = await service.auth.admin.deleteUser(
          data.user.id,
        );
        if (cleanup)
          console.error(
            JSON.stringify({
              event: "teacher_compensation_failed",
              user_id: data.user.id,
            }),
          );
        throw new Error(dbError.message);
      }
      return reply({ id: data.user.id });
    }
    const password = providedPassword(b.password);
    const alphabet =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const random = crypto.getRandomValues(new Uint8Array(24));
    const code =
      password ??
      Array.from(random, (n) => alphabet[n % alphabet.length]).join("");
    if (b.action === "reset") {
      const { data: target, error: findError } = await caller.rpc(
        "admin_student_auth",
        { p_id: b.id },
      );
      if (findError || !target) throw new Error("Студент не найден");
      const { error } = await service.auth.admin.updateUserById(target, {
        password: code,
      });
      if (error) throw error;
      const { error: auditError } = await service.rpc("service_account_audit", {
        p_actor: user.id,
        p_target: b.id,
        p_action: "code_reset",
      });
      if (auditError) throw auditError;
      return reply({ code });
    }
    const id = resolveStudentId(b.id);
    if (
      b.action !== "create" ||
      !/^[a-z0-9_][a-z0-9_.-]{1,63}$/.test(b.login) ||
      typeof b.full_name !== "string" ||
      b.full_name.trim().length < 2 ||
      b.full_name.length > 150 ||
      typeof b.group_id !== "string" ||
      !b.group_id
    )
      throw new Error("Проверьте логин, ФИО и группу");
    const { data, error } = await service.auth.admin.createUser({
      email: `${b.login}@students.testify.invalid`,
      password: code,
      email_confirm: true,
    });
    if (error) throw error;
    const { error: dbError } = await service.rpc(
      "service_register_student_with_status",
      {
        p_auth_id: data.user.id,
        p_id: id,
        p_login: b.login,
        p_name: b.full_name.trim(),
        p_group: b.group_id,
        p_active: b.active !== false,
      },
    );
    if (dbError) {
      const { error: cleanup } = await service.auth.admin.deleteUser(
        data.user.id,
      );
      if (cleanup)
        console.error(
          JSON.stringify({
            event: "account_compensation_failed",
            user_id: data.user.id,
          }),
        );
      throw dbError;
    }
    const { error: auditError } = await service.rpc("service_account_audit", {
      p_actor: user.id,
      p_target: id,
      p_action: "student_created",
    });
    if (auditError) throw auditError;
    return reply({ id, code });
  } catch (e) {
    console.error(JSON.stringify({ event: "account_action_failed" }));
    return reply(
      { error: e instanceof Error ? e.message : "Ошибка операции" },
      400,
    );
  }
});
