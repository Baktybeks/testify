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
        modules: [module],
        groups: [{ id: "G1", name: "ПИ-1-26" }],
        students: [],
        attempts: [],
        module_groups: [],
        stats: {
          students: 0,
          groups: 1,
          started: 0,
          active: 0,
          finished: 0,
          average: null,
        },
      };
    else if (path.endsWith("/admin_questions")) data = [];
    else if (path.endsWith("/admin_command")) {
      commands.push(route.request().postDataJSON());
      data = { ok: true, module_id: "m1" };
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
  await page.getByRole("button", { name: "Модули", exact: true }).click();
  await expect(page.getByLabel("Выбор вопросов")).toHaveValue("random");
  await page.getByRole("button", { name: "Вопросы", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Модуль", exact: true })
    .selectOption("m1");
  const input = page.getByLabel("Импорт CSV / XLSX (лист Questions)");
  await input.setInputFiles({
    name: "questions.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "QuestionID,Lecture,Question,OptionA,OptionB,OptionC,OptionD,CorrectOption\nQ1,HTML,Заголовок?,h1,head,title,header,A",
    ),
  });
  await expect(page.getByText("Проверено вопросов: 1.")).toBeVisible();
  await page.getByRole("button", { name: "Импортировать 1 вопросов" }).click();
  await expect(page.getByText("Изменения сохранены")).toBeVisible();
  expect(commands.some((c) => c.p_action === "save_questions")).toBeTruthy();
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
});
