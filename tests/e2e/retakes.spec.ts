import { test, expect } from "@playwright/test";
for (const role of ["teacher", "superadmin"] as const)
  test(`${role}: retake reasons, publication and deletion permissions`, async ({
    page,
  }) => {
    const url = "https://exam-test.supabase.co",
      requests: Record<string, unknown>[] = [];
    const user = {
      id: "00000000-0000-0000-0000-000000000001",
      aud: "authenticated",
      role: "authenticated",
      email: "teacher@example.com",
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    };
    const exam = {
      id: "m1",
      title: "UX/UI · Модуль 1",
      status: role === "superadmin" ? "published" : "closed",
      published_at: role === "superadmin" ? "2026-01-01T00:00:00Z" : null,
      question_count: 30,
      seconds_per_question: 50,
      total_seconds: 1500,
      max_score: 15,
      selection_mode: "random",
      quotas: {},
    };
    const student = {
      id: "S1",
      auth_id: "student-id",
      full_name: "Тестовый студент",
      login: "student_one",
      group_id: "G1",
      active: true,
    };
    let attempts: Record<string, unknown>[] = [
      {
        id: "a1",
        module_id: "m1",
        student_id: "S1",
        login: student.login,
        full_name: student.full_name,
        group_id: "G1",
        status: "finished",
        is_current: true,
        attempt_number: 1,
        current_index: 30,
        question_count: 30,
        started_at: "2026-01-01T00:00:00Z",
        finished_at: "2026-01-01T00:25:00Z",
        score: 2,
        correct_count: 4,
        result_published_at: null,
      },
    ];
    const grants: Record<string, unknown>[] = [];
    const staff: Record<string, unknown>[] = [];
    await page.route(url + "/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = {};
      if (path.includes("/token"))
        data = {
          access_token: "test-token",
          refresh_token: "test-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user,
        };
      else if (path.endsWith("/user")) data = user;
      else if (path.endsWith("/my_profile"))
        data = { id: user.id, role, full_name: "Преподаватель", active: true };
      else if (path.endsWith("/superadmin_teachers")) data = staff;
      else if (path.endsWith("/manage-account")) {
        const body = route.request().postDataJSON();
        requests.push(body);
        staff.push({
          id: "new-teacher",
          full_name: body.full_name,
          email: body.email,
          role: "teacher",
          active: true,
        });
        data = { id: "new-teacher" };
      } else if (path.endsWith("/admin_data"))
        data = {
          actor_role: role,
          modules: [exam],
          subjects: [],
          course_modules: [],
          groups: [{ id: "G1", name: "CS-21-25" }],
          students: [student],
          attempts,
          module_groups: [],
          attempt_counters: [
            {
              module_id: "m1",
              student_id: "S1",
              started_count: 1,
              last_number: 1,
            },
          ],
          retake_grants: grants,
          stats: {
            students: 1,
            groups: 1,
            started: 1,
            active: 0,
            finished: 1,
            average: 2,
          },
        };
      else if (path.endsWith("/admin_attempt_action")) {
        const b = route.request().postDataJSON();
        requests.push(b);
        if (b.p_action === "publish_result")
          attempts[0].result_published_at = new Date().toISOString();
        if (b.p_action === "grant_retake") {
          if (attempts[0])
            Object.assign(attempts[0], {
              status: "annulled",
              is_current: false,
              void_reason: b.p_reason,
              voided_by_name: "Преподаватель",
            });
          for (const g of grants) g.revoked_at = new Date().toISOString();
          grants.push({
            id: "g" + (grants.length + 1),
            module_id: "m1",
            student_id: "S1",
            full_name: student.full_name,
            login: student.login,
            group_id: "G1",
            actor_name: "Преподаватель",
            reason: b.p_reason,
            granted_at: new Date().toISOString(),
            start_deadline: b.p_start_deadline,
            consumed_at: null,
            revoked_at: null,
          });
        }
        if (b.p_action === "revoke_retake")
          grants.find((g) => g.id === b.p_grant_id)!.revoked_at =
            new Date().toISOString();
        if (b.p_action === "delete_attempt") attempts = [];
        data = { ok: true };
      }
      await route.fulfill({ json: data });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Вход для преподавателя" }).click();
    await page.getByLabel("Email", { exact: true }).fill("teacher@example.com");
    await page.getByLabel("Пароль", { exact: true }).fill("test-password-only");
    await page.getByRole("button", { name: "Войти и продолжить" }).click();
    await expect(
      page.getByText(
        role === "superadmin" ? "ПАНЕЛЬ СУПЕРАДМИНА" : "ПАНЕЛЬ ПРЕПОДАВАТЕЛЯ",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator(".role-badge")).toHaveText(
      role === "superadmin" ? "Суперадмин" : "Преподаватель",
    );
    if (role === "superadmin") {
      await page
        .getByRole("button", { name: "Преподаватели", exact: true })
        .click();
      await page
        .getByLabel("ФИО преподавателя", { exact: true })
        .fill("Новый преподаватель");
      await page
        .getByLabel("Email преподавателя", { exact: true })
        .fill("newteacher@example.com");
      await page
        .getByLabel("Пароль преподавателя", { exact: true })
        .fill("12345678");
      await page
        .getByRole("button", { name: "Создать преподавателя", exact: true })
        .click();
      await expect(
        page.getByRole("cell", { name: "newteacher@example.com", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Пароль преподавателя", { exact: true }),
      ).toHaveValue("");
      const created = requests.find((r) => r.action === "create-teacher");
      expect(created?.password).toBe("12345678");
      expect(created).not.toHaveProperty("role");
    } else
      await expect(
        page.getByRole("button", { name: "Преподаватели", exact: true }),
      ).toHaveCount(0);
    await page.getByRole("button", { name: "Результаты", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Экзамен", exact: true })
      .selectOption("m1");
    if (role === "superadmin") {
      await page
        .getByRole("button", { name: "Опубликовать результат", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Причина", { exact: true })
        .fill("Пересдача проверена");
      await dialog
        .getByRole("button", { name: "Подтвердить", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
    } else
      await expect(
        page.getByRole("button", { name: "Удалить навсегда", exact: true }),
      ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Разрешить пересдачу", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Подтвердить", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByLabel("Причина", { exact: true })
      .fill("Телефон выключился");
    await dialog
      .getByRole("button", { name: "Подтвердить", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Аннулирована", { exact: true })).toBeVisible();
    expect(requests.find((r) => r.p_action === "grant_retake")?.p_reason).toBe(
      "Телефон выключился",
    );
    if (role === "superadmin") {
      await page
        .getByRole("button", { name: "Удалить навсегда", exact: true })
        .click();
      const remove = page.getByRole("dialog");
      await remove
        .getByLabel("Причина", { exact: true })
        .fill("Ошибочная тестовая попытка");
      await expect(
        remove.getByRole("button", { name: "Подтвердить", exact: true }),
      ).toBeDisabled();
      await remove.getByLabel(/Введите логин/).fill("student_one");
      await remove
        .getByRole("button", { name: "Подтвердить", exact: true })
        .click();
      await expect(remove).toHaveCount(0);
      await expect(
        page.getByText("Пока нет попыток для выбранных фильтров."),
      ).toBeVisible();
      await page
        .getByRole("combobox", { name: "Студент для пересдачи", exact: true })
        .selectOption("S1");
      await expect(
        page.getByRole("button", {
          name: "Указать причину и разрешить",
          exact: true,
        }),
      ).toBeEnabled();
    } else {
      await page
        .getByText("Разрешения на пересдачу · 1", { exact: true })
        .click();
      await page.getByRole("button", { name: "Отозвать", exact: true }).click();
      const revoke = page.getByRole("dialog");
      await revoke
        .getByLabel("Причина", { exact: true })
        .fill("Студент отказался");
      await revoke
        .getByRole("button", { name: "Подтвердить", exact: true })
        .click();
      await expect(revoke).toHaveCount(0);
      await expect(page.getByText("Отозвано", { exact: true })).toBeVisible();
    }
  });
