import { test, expect } from "@playwright/test";
test("teacher dashboard, module settings and validated CSV import", async ({
  page,
}) => {
  const url = "https://exam-test.supabase.co";
  const user = {
    id: "00000000-0000-0000-0000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "teacher@example.com",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const commands: Record<string, unknown>[] = [];
  const accounts: Record<string, unknown>[] = [];
  let access: unknown[] = [];
  const module = {
    id: "m1",
    title: "Новая партия · 90 вопросов",
    status: "draft",
    question_count: 20,
    seconds_per_question: 30,
    total_seconds: 600,
    max_score: 10,
    selection_mode: "random",
    quotas: {},
    subject_id: "web",
    subject_name: "Web-разработка",
    course_module_id: "web1",
    course_module_title: "Модуль 1",
  };
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
      data = {
        id: user.id,
        role: "teacher",
        full_name: "Преподаватель",
        active: true,
      };
    else if (path.endsWith("/admin_data"))
      data = {
        subjects: [
          { id: "web", name: "Web-разработка" },
          { id: "ux", name: "UX/UI" },
        ],
        course_modules: [
          { id: "web1", subject_id: "web", title: "Модуль 1", position: 1 },
          { id: "ux1", subject_id: "ux", title: "Модуль 1", position: 1 },
        ],
        modules: [module],
        groups: [{ id: "G1", name: "ПИ-1-26" }],
        students: [
          {
            id: "S0",
            login: "already_exists",
            full_name: "Existing Student",
            group_id: "G1",
            auth_id: "existing-id",
            active: true,
          },
        ],
        attempts: [],
        module_groups: access,
        stats: {
          students: 0,
          groups: 1,
          started: 0,
          active: 0,
          finished: 0,
          average: null,
        },
      };
    else if (
      path.endsWith("/admin_questions") ||
      path.endsWith("/admin_course_questions")
    )
      data = [];
    else if (path.endsWith("/admin_open_exam_groups")) {
      const body = route.request().postDataJSON();
      commands.push({ p_action: "open_exam_groups", p_data: body });
      module.status = "open";
      access = body.p_group_ids.map((id: string) => ({
        module_id: "m1",
        group_id: id,
        access: true,
        window_start: null,
        window_end: null,
      }));
      data = { ok: true, module_id: "m1" };
    } else if (path.endsWith("/admin_delete_unused_exam")) {
      commands.push({
        p_action: "delete_unused_exam",
        p_data: route.request().postDataJSON(),
      });
      data = { deleted: true };
    } else if (
      path.endsWith("/admin_command") ||
      path.endsWith("/admin_bank_command")
    ) {
      commands.push(route.request().postDataJSON());
      data = { ok: true, module_id: "m1" };
    } else if (path.endsWith("/manage-account")) {
      const body = route.request().postDataJSON();
      accounts.push(body);
      data = {
        id: body.id || "generated-student-id",
        code: body.password || "Random-test-2026!",
      };
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Вход для преподавателя" }).click();
  await page.getByLabel("Email", { exact: true }).fill("teacher@example.com");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("teacher-test-password");
  await page.getByRole("button", { name: "Войти и продолжить" }).click();
  await expect(
    page.getByRole("heading", { name: "Экзамены под контролем" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Дисциплина", exact: true })
    .selectOption("ux");
  await expect(
    page
      .getByRole("combobox", { name: "Экзамен", exact: true })
      .getByRole("option", { name: /Новая партия/ }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Дисциплина", exact: true })
    .selectOption("web");
  await page
    .getByRole("combobox", { name: "Модуль", exact: true })
    .selectOption("web1");
  await page.getByRole("button", { name: "Экзамены", exact: true }).click();
  await expect(page.getByLabel("Выбор вопросов")).toHaveValue("random");
  await page
    .getByRole("combobox", {
      name: "Дисциплина и модуль экзамена",
      exact: true,
    })
    .selectOption("ux1");
  await page.getByLabel("Название экзамена / партии").fill("UX/UI · партия 2");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect
    .poll(() =>
      commands.some(
        (c) =>
          c.p_action === "save_module" &&
          (c.p_data as { course_module_id: string }).course_module_id === "ux1",
      ),
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "Вопросы", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Модуль", exact: true })
    .selectOption("web1");
  await expect(
    page.getByRole("combobox", { name: "Экзамен", exact: true }),
  ).toHaveCount(0);
  const input = page.getByLabel("Импорт CSV / XLSX (лист Questions)");
  await input.setInputFiles({
    name: "questions.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Lecture,Question,OptionA,OptionB,OptionC,OptionD,CorrectOption\nHTML,Заголовок?,h1,head,title,header,A",
    ),
  });
  await expect(page.getByText("Проверено вопросов: 1.")).toBeVisible();
  await page.getByRole("button", { name: "Импортировать 1 вопросов" }).click();
  await expect(page.getByText("Изменения сохранены")).toBeVisible();
  expect(commands.some((c) => c.p_action === "save_questions")).toBeTruthy();
  expect(
    (
      commands.find((c) => c.p_action === "save_questions")?.p_data as {
        questions: { external_id: string }[];
      }
    ).questions[0].external_id,
  ).toBe("");
  await input.setInputFiles({
    name: "bad.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "QuestionID,Lecture,Question,OptionA,OptionB,OptionC,OptionD,CorrectOption\nQ1,HTML,Ошибка,a,a,b,c,X",
    ),
  });
  await expect(
    page.getByRole("button", { name: "Импортировать 1 вопросов" }),
  ).toBeDisabled();
  await expect(page.getByText("Импорт пока недоступен:")).toBeVisible();
  await page.getByRole("button", { name: "Студенты", exact: true }).click();
  await page.getByText("Импорт студентов из JSON", { exact: true }).click();
  await page.getByLabel("Группа для записей без group").selectOption("G1");
  await page.getByLabel("JSON со студентами").fill(
    JSON.stringify([
      { name: "Первый студент", login: "first_student" },
      { name: "Уже существует", login: "already_exists" },
      { name: "Второй студент", login: "second_student", status: "blocked" },
    ]),
  );
  await page
    .getByLabel("Общий пароль для записей без password")
    .fill("Common-test-2026!");
  await page
    .getByRole("button", { name: "Проверить JSON", exact: true })
    .click();
  await expect(page.getByText("Готово к импорту: 3.")).toBeVisible();
  await page
    .getByRole("button", { name: "Создать студентов из JSON", exact: true })
    .click();
  await expect(page.getByText("Импорт завершён.", { exact: true })).toBeVisible(
    { timeout: 10000 },
  );
  expect(accounts).toHaveLength(2);
  expect(accounts[0].password).toBe("Common-test-2026!");
  expect(accounts[1].active).toBe(false);
  await expect(
    page.getByLabel("Общий пароль для записей без password"),
  ).toHaveValue("");
  await expect(page.getByText("Уже существует — пропущен")).toBeVisible();
  await page.getByText("Новый студент", { exact: true }).click();
  const manual = page.locator("details").filter({
    has: page.locator("summary").getByText("Новый студент", { exact: true }),
  });
  await expect(manual.getByLabel("StudentID", { exact: true })).toHaveCount(0);
  await manual.getByLabel("ФИО", { exact: true }).fill("Новый студент");
  await manual.getByLabel("Логин", { exact: true }).fill("manual_student");
  await manual
    .getByRole("combobox", { name: "Группа", exact: true })
    .selectOption("G1");
  await manual
    .getByRole("button", { name: "Создать и выдать код", exact: true })
    .click();
  await expect.poll(() => accounts.length).toBe(3);
  expect(accounts[2]).not.toHaveProperty("id");
  const issued = page.getByRole("dialog", { name: "Новый пароль студента" });
  await expect(issued).toContainText("manual_student");
  await expect(issued).toContainText("Random-test-2026!");
  await issued.getByRole("button", { name: "Закрыть", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Новый код", exact: true }).click();
  await expect(issued).toContainText("already_exists");
  await expect(issued).toContainText("Random-test-2026!");
  expect(accounts[3]).toEqual({ action: "reset", id: "S0" });
  await issued.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Экзамены", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept(module.title));
  await page
    .getByRole("button", { name: "Удалить экзамен", exact: true })
    .click();
  await expect
    .poll(() => commands.some((c) => c.p_action === "delete_unused_exam"))
    .toBeTruthy();
  const open = page.getByRole("button", {
    name: "Открыть экзамен для выбранных групп",
    exact: true,
  });
  await expect(open).toBeDisabled();
  await page.getByRole("checkbox", { name: "ПИ-1-26", exact: true }).check();
  await expect(open).toBeEnabled();
  await open.click();
  await expect(
    page.getByRole("group", { name: "Подтверждение открытия" }),
  ).toContainText("Группы: ПИ-1-26");
  await page
    .getByRole("button", { name: "Подтвердить открытие", exact: true })
    .click();
  await expect(
    page.getByText("Приём открыт: ПИ-1-26", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Закрыть приём", exact: true }),
  ).toBeVisible();
  expect(
    commands.filter((c) => c.p_action === "open_exam_groups"),
  ).toHaveLength(1);
  expect(
    (
      commands.find((c) => c.p_action === "open_exam_groups")?.p_data as {
        p_group_ids: string[];
      }
    ).p_group_ids,
  ).toEqual(["G1"]);
  await page.getByRole("button", { name: "Студенты", exact: true }).click();
  await page.getByText("Массовый импорт", { exact: true }).click();
  await page.getByLabel("Импорт студентов", { exact: true }).setInputFiles({
    name: "students.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "StudentID,FullName,GroupID,Login,Status,Password\nimport_student,Импорт Студент,G1,import_student,active,12345678",
    ),
  });
  await page
    .getByRole("button", { name: "Создать аккаунты", exact: true })
    .click();
  await expect.poll(() => accounts.length).toBe(5);
  expect(accounts[4].password).toBe("12345678");
});
