import { test, expect } from "@playwright/test";
const url = "https://exam-test.supabase.co";
test("mobile login, answer, reload/resume, hidden and published results", async ({
  page,
}) => {
  let finished = false,
    annulled = false,
    retake = false,
    aid = "a1",
    published = false,
    index = 1;
  const user = {
    id: "00000000-0000-0000-0000-000000000002",
    aud: "authenticated",
    role: "authenticated",
    email: "student@students.testify.invalid",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const snapshot = () => ({
    attempt_id: aid,
    annulled,
    void_reason: annulled ? "Телефон выключился" : undefined,
    attempt_number: aid === "a1" ? 1 : 2,
    done: finished,
    published,
    title: "Growing Landing",
    index,
    total: 20,
    question: "Какой тег задаёт заголовок?",
    options: [
      { id: "o1", text: "<h1>" },
      { id: "o2", text: "<head>" },
      { id: "o3", text: "<title>" },
      { id: "o4", text: "<header>" },
    ],
    server_now: new Date().toISOString(),
    question_deadline: new Date(Date.now() + 30000).toISOString(),
    attempt_deadline: new Date(Date.now() + 600000).toISOString(),
    ...(published ? { score: 10, correct: 20, max_score: 10 } : {}),
  });
  await page.route(url + "/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (p.includes("/token"))
      data = {
        access_token: "test-token",
        refresh_token: "test-refresh",
        expires_in: 3600,
        token_type: "bearer",
        user,
      };
    else if (p.endsWith("/user")) data = user;
    else if (p.endsWith("/my_profile"))
      data = {
        id: user.id,
        role: "student",
        full_name: "Тестовый студент",
        active: true,
      };
    else if (p.endsWith("/student_exam_history"))
      data = [
        {
          id: "old-exam",
          title: "Архивный экзамен",
          status: "archived",
          attempt_id: "old-attempt",
          subject_id: "web",
          subject_name: "Web-разработка",
          course_module_title: "Модуль 1",
        },
      ];
    else if (p.endsWith("/student_modules"))
      data = [
        {
          id: "m1",
          title: "Growing Landing",
          subject_id: "web",
          subject_name: "Web-разработка",
          course_module_id: "web1",
          course_module_title: "Модуль 1",
          status: "open",
          question_count: 20,
          seconds_per_question: 30,
          total_seconds: 600,
          max_score: 10,
          available: true,
          attempt_id: retake ? null : index > 1 ? aid : null,
          retake_allowed: retake,
          retake_deadline: new Date(Date.now() + 3600000).toISOString(),
          retake_reason: "Телефон выключился",
        },
      ];
    else if (p.endsWith("/attempt_start_or_resume") && retake) {
      retake = false;
      annulled = false;
      finished = false;
      index = 1;
      aid = "a2";
      data = snapshot();
    } else if (p.endsWith("/attempt_submit_answer")) {
      index++;
      data = { ...snapshot(), outcome: "accepted" };
    } else data = snapshot();
    await route.fulfill({
      json: data,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.goto("/");
  await page.getByLabel("Логин", { exact: true }).fill("student");
  await page.getByLabel("Пароль", { exact: true }).fill("individual-secret");
  await page.getByRole("button", { name: "Войти и продолжить" }).click();
  await expect(
    page.getByRole("heading", { name: "Архивный экзамен" }),
  ).toHaveCount(0);
  await page.getByText("История экзаменов", { exact: true }).click();
  const history = page
    .locator("details")
    .filter({
      has: page
        .locator("summary")
        .getByText("История экзаменов", { exact: true }),
    });
  await expect(history).toContainText("Архивный экзамен");
  await expect(
    history.getByRole("button", { name: "Посмотреть результат" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Начать экзамен" }).click();
  await expect(
    page.getByRole("heading", { name: "Какой тег задаёт заголовок?" }),
  ).toBeVisible();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Ответить и продолжить" }).click();
  await expect(page.getByText("Вопрос 2 / 20")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page.getByText("Вопрос 2 / 20")).toBeVisible();
  finished = true;
  await page.reload();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Тест завершён" }),
  ).toBeVisible();
  await expect(page.getByText("Результат будет доступен")).toBeVisible();
  published = true;
  await page.reload();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page.getByText("Правильных ответов: 20 из 20")).toBeVisible();
  annulled = true;
  published = false;
  await page.reload();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Попытка аннулирована" }),
  ).toBeVisible();
  retake = true;
  await page
    .getByRole("button", { name: "К списку экзаменов", exact: true })
    .click();
  await expect(page.getByText(/Вам разрешена повторная попытка/)).toBeVisible();
  await page.getByRole("button", { name: "Начать пересдачу" }).click();
  await expect(page.getByText("Вопрос 1 / 20")).toBeVisible();
});
