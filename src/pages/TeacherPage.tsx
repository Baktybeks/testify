import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { accountAction, rpc } from "../shared/api";
import {
  downloadCsv,
  downloadXlsx,
  readRows,
  validateQuestions,
} from "../features/files";
import type { AdminData, Module, Question } from "../entities/types";
import { CatalogManager } from "../features/CatalogManager";
import { StudentJsonImport } from "../features/StudentJsonImport";
import { ExamAdmission } from "../features/ExamAdmission";
import {
  AttemptActionDialog,
  type AttemptActionTarget,
} from "../features/AttemptActionDialog";
import { RetakeControls, RetakeHistory } from "../features/RetakeControls";
import { TeacherAccounts } from "../features/TeacherAccounts";
const status: Record<string, string> = {
  draft: "Черновик",
  open: "Открыт",
  closed: "Закрыт",
  published: "Опубликован",
  archived: "Архив",
  active: "Проходит",
  finished: "Завершён",
  annulled: "Аннулирована",
};
const blankModule = {
  title: "Новая партия",
  course_module_id: "",
  question_count: 20,
  seconds_per_question: 30,
  total_seconds: 600,
  max_score: 10,
  selection_mode: "random",
  quotas: "{}",
};
const blankQuestion: Question = {
  external_id: "",
  lecture: "1",
  difficulty: "normal",
  text: "",
  options: ["", "", "", ""],
  correct: 0,
  active: true,
};
function date(v: string | null) {
  return v
    ? new Date(v).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" })
    : "—";
}
export function TeacherPage({
  user,
  role = "teacher",
}: {
  user: string;
  role?: "teacher" | "superadmin";
}) {
  const cache = useQueryClient();
  const [attemptAction, setAttemptAction] =
    useState<AttemptActionTarget | null>(null);
  const [tab, setTab] = useState("Обзор"),
    [subjectId, setSubjectId] = useState(""),
    [courseModuleId, setCourseModuleId] = useState(""),
    [mid, setMid] = useState(""),
    [gid, setGid] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [code, setCode] = useState(""),
    [codeLogin, setCodeLogin] = useState("");
  const [moduleForm, setModuleForm] = useState(blankModule),
    [editing, setEditing] = useState(""),
    [question, setQuestion] = useState<Question>(blankQuestion),
    [preview, setPreview] = useState<Question[]>([]),
    [issues, setIssues] = useState<string[]>([]),
    [studentRows, setStudentRows] = useState<Record<string, string>[]>([]),
    [groupRows, setGroupRows] = useState<Record<string, string>[]>([]);
  const data = useQuery({
    queryKey: ["admin", user, mid, gid],
    queryFn: () =>
      rpc<AdminData>("admin_data", {
        p_module_id: mid || null,
        p_group_id: gid || null,
      }),
    refetchInterval: tab === "Обзор" ? 15000 : false,
  });
  const bank = useQuery({
    queryKey: ["bank", user, courseModuleId],
    queryFn: () =>
      rpc<Question[]>("admin_course_questions", {
        p_course_module_id: courseModuleId,
      }),
    enabled: !!courseModuleId && tab === "Вопросы",
  });
  async function run(
    fn: () => Promise<unknown>,
    success = "Изменения сохранены",
  ) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(success);
      await cache.invalidateQueries({ queryKey: ["admin"] });
      await cache.invalidateQueries({ queryKey: ["bank"] });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const command = (action: string, payload: Record<string, unknown>) =>
    rpc("admin_command", { p_action: action, p_data: payload });
  const selected = data.data?.modules.find((m) => m.id === mid);
  function editModule(m: Module) {
    setEditing(m.id);
    setModuleForm({
      title: m.title,
      course_module_id: m.course_module_id || "",
      question_count: m.question_count,
      seconds_per_question: m.seconds_per_question,
      total_seconds: m.total_seconds,
      max_score: m.max_score,
      selection_mode: m.selection_mode,
      quotas: JSON.stringify(m.quotas),
    });
  }
  async function inspect(file: File, kind: string) {
    setError("");
    setIssues([]);
    setPreview([]);
    setStudentRows([]);
    setGroupRows([]);
    try {
      const rows = await readRows(file, kind);
      if (kind === "Questions") {
        const p = validateQuestions(rows);
        setPreview(p.questions);
        setIssues(p.errors);
      } else if (kind === "Students") {
        const ids = new Set<string>(),
          logins = new Set<string>();
        const errors: string[] = [];
        rows.forEach((r, i) => {
          if (
            !/^[-a-zA-Z0-9_]{2,64}$/.test(r.StudentID) ||
            !r.FullName ||
            !/^[a-z0-9_][a-z0-9_.-]{1,63}$/.test(r.Login) ||
            !data.data?.groups.some((g) => g.id === r.GroupID)
          )
            errors.push(
              `Строка ${i + 2}: проверьте ID, ФИО, логин и существующую группу`,
            );
          if (
            ids.has(r.StudentID) ||
            logins.has(r.Login) ||
            data.data?.students.some(
              (s) => s.id === r.StudentID || s.login === r.Login,
            )
          )
            errors.push(`Строка ${i + 2}: повтор ID или логина`);
          ids.add(r.StudentID);
          logins.add(r.Login);
          if (r.Password && (r.Password.length < 8 || r.Password.length > 128))
            errors.push(
              `Строка ${i + 2}: пароль должен содержать 8–128 символов`,
            );
        });
        setIssues(errors);
        setStudentRows(rows);
      } else {
        const ids = new Set<string>();
        const errors: string[] = [];
        rows.forEach((r, i) => {
          if (!r.GroupID || !r.GroupName || ids.has(r.GroupID))
            errors.push(
              `Строка ${i + 2}: нужны уникальный GroupID и GroupName`,
            );
          ids.add(r.GroupID);
        });
        setGroupRows(rows);
        setIssues(errors);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (data.isPending)
    return (
      <main>
        <p role="status">Загружаем панель…</p>
      </main>
    );
  if (!data.data)
    return (
      <main>
        <div className="alert">{data.error?.message}</div>
        <button onClick={() => void data.refetch()}>Повторить</button>
      </main>
    );
  const all = data.data;
  const visibleModules = all.modules.filter(
    (m) =>
      (!subjectId || m.subject_id === subjectId) &&
      (!courseModuleId || m.course_module_id === courseModuleId),
  );
  const visibleIds = new Set(visibleModules.map((m) => m.id));
  const attempts = all.attempts.filter((a) => visibleIds.has(a.module_id));
  const currentAttempts = attempts.filter((a) => a.is_current !== false);
  const finished = currentAttempts.filter((a) => a.status === "finished");
  const scores = finished.filter((a) => a.score !== null);
  const d = {
    ...all,
    modules: visibleModules,
    attempts,
    stats: {
      ...all.stats,
      started: currentAttempts.length,
      active: currentAttempts.filter((a) => a.status === "active").length,
      finished: finished.length,
      average: scores.length
        ? Number(
            (
              scores.reduce((n, a) => n + Number(a.score), 0) / scores.length
            ).toFixed(2),
          )
        : null,
    },
  };
  const subjects = all.subjects || [],
    courseModules = all.course_modules || [];
  const superadmin = (all.actor_role || role) === "superadmin";
  const targetFor = (
    a: AdminData["attempts"][number],
    action: AttemptActionTarget["action"],
  ): AttemptActionTarget => ({
    action,
    module_id: a.module_id,
    student_id: a.student_id,
    full_name: a.full_name,
    login: a.login,
    title: all.modules.find((m) => m.id === a.module_id)?.title || "",
    attempt_id: a.id,
    published: !!all.modules.find((m) => m.id === a.module_id)?.published_at,
  });
  const resultRows: unknown[][] = [
    [
      "Студент",
      "Дисциплина",
      "Модуль",
      "Экзамен",
      "Группа",
      "Статус",
      "Вопрос",
      "Начало",
      "Завершение",
      "Правильно",
      "Балл",
      "Номер попытки",
      "Причина аннулирования",
      "Аннулировал",
    ],
    ...d.attempts.map((a) => [
      a.full_name,
      all.modules.find((m) => m.id === a.module_id)?.subject_name,
      all.modules.find((m) => m.id === a.module_id)?.course_module_title,
      all.modules.find((m) => m.id === a.module_id)?.title,
      a.group_id,
      status[a.status],
      a.current_index,
      date(a.started_at),
      date(a.finished_at),
      a.correct_count,
      a.score,
      a.attempt_number || 1,
      a.void_reason,
      a.voided_by_name,
    ]),
  ];
  return (
    <main className="dashboard">
      <div className="page-title">
        <div>
          <span className="eyebrow">
            {superadmin ? "ПАНЕЛЬ СУПЕРАДМИНА" : "ПАНЕЛЬ ПРЕПОДАВАТЕЛЯ"}
          </span>
          <h1>Экзамены под контролем</h1>
          <p className="muted">Модули, участники и результаты в одном месте.</p>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void data.refetch()}
        >
          ↻ Обновить
        </button>
      </div>
      <nav className="tabs" aria-label="Разделы">
        {[
          "Обзор",
          ...(superadmin ? ["Преподаватели"] : []),
          "Дисциплины",
          "Экзамены",
          "Группы",
          "Студенты",
          "Вопросы",
          "Результаты",
        ].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => {
              setTab(t);
              setIssues([]);
              setPreview([]);
              setStudentRows([]);
              setGroupRows([]);
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab !== "Преподаватели" && (
        <div className="filters">
          <label>
            Дисциплина
            <select
              aria-label="Дисциплина"
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setCourseModuleId("");
                setMid("");
                setPreview([]);
                setQuestion(blankQuestion);
              }}
            >
              <option value="">Все дисциплины</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Модуль
            <select
              aria-label="Модуль"
              value={courseModuleId}
              onChange={(e) => {
                setCourseModuleId(e.target.value);
                setMid("");
                setPreview([]);
                setQuestion(blankQuestion);
              }}
            >
              <option value="">Все учебные модули</option>
              {courseModules
                .filter((c) => !subjectId || c.subject_id === subjectId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {!subjectId
                      ? subjects.find((s) => s.id === c.subject_id)?.name +
                        " · "
                      : ""}
                    {c.title}
                  </option>
                ))}
            </select>
          </label>
          {tab !== "Вопросы" && (
            <label>
              Экзамен
              <select
                aria-label="Экзамен"
                value={mid}
                onChange={(e) => {
                  setMid(e.target.value);
                  setPreview([]);
                  setQuestion(blankQuestion);
                }}
              >
                <option value="">Все экзамены</option>
                {d.modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} · {status[m.status]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Группа
            <select value={gid} onChange={(e) => setGid(e.target.value)}>
              <option value="">Все группы</option>
              {d.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {tab === "Преподаватели" && superadmin && <TeacherAccounts user={user} />}
      {tab === "Экзамены" && (subjectId || courseModuleId || mid) && (
        <button
          className="secondary"
          onClick={() => {
            setSubjectId("");
            setCourseModuleId("");
            setMid("");
          }}
        >
          Показать все экзамены, включая архив
        </button>
      )}
      {tab === "Экзамены" && (
        <p className="muted">
          Фильтры сверху меняют отображение. Доступ групп выбирается в карточке
          экзамена перед открытием.
        </p>
      )}
      {(error || data.error) && (
        <div className="alert" role="alert">
          {error || data.error?.message}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {busy && <p role="status">Выполняем операцию…</p>}
      {tab === "Обзор" && (
        <>
          <div className="stats">
            {[
              ["Студентов", d.stats.students],
              ["Начали", d.stats.started],
              ["Проходят", d.stats.active],
              ["Завершили", d.stats.finished],
              ["Средний балл", d.stats.average ?? "—"],
            ].map(([label, value]) => (
              <div className="card stat" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <section className="card">
            <h2>Текущие экзамены</h2>
            {!d.modules.length ? (
              <p className="muted">
                Создайте первый модуль, добавьте вопросы и разрешите доступ
                группам.
              </p>
            ) : (
              d.modules.map((m) => (
                <div className="module-row" key={m.id}>
                  <div>
                    <small>
                      {m.subject_name} · {m.course_module_title}
                    </small>
                    <br />
                    <b>{m.title}</b>
                    <p className="muted">
                      {m.question_count} вопросов · {m.seconds_per_question}{" "}
                      сек. ·{" "}
                      {m.selection_mode === "random"
                        ? "Все темы вперемешку"
                        : "Квоты по темам"}
                    </p>
                  </div>
                  <span className="pill">{status[m.status]}</span>
                </div>
              ))
            )}
          </section>
          <p className="muted">
            Обзор обновляется каждые 15 секунд на открытой вкладке. Время
            отображается по Бишкеку.
          </p>
        </>
      )}
      {tab === "Дисциплины" && (
        <CatalogManager
          subjects={subjects}
          course_modules={courseModules}
          busy={busy}
          save={(action, payload) => void run(() => command(action, payload))}
        />
      )}
      {tab === "Экзамены" && (
        <>
          <section className="card">
            <h2>
              {editing ? "Настройки черновика" : "Новый экзамен / партия"}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const quotas = JSON.parse(moduleForm.quotas);
                  const result = (await command("save_module", {
                    ...moduleForm,
                    quotas,
                    module_id: editing || null,
                  })) as { module_id: string };
                  setMid(result.module_id);
                  setSubjectId("");
                  setCourseModuleId("");
                  setEditing("");
                  setModuleForm(blankModule);
                });
              }}
            >
              <div className="fields">
                <label>
                  Дисциплина и модуль экзамена
                  <select
                    required
                    aria-label="Дисциплина и модуль экзамена"
                    value={moduleForm.course_module_id}
                    onChange={(e) =>
                      setModuleForm({
                        ...moduleForm,
                        course_module_id: e.target.value,
                      })
                    }
                  >
                    <option value="">Выберите учебный модуль</option>
                    {subjects.map((s) => (
                      <optgroup key={s.id} label={s.name}>
                        {courseModules
                          .filter((c) => c.subject_id === s.id)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {s.name} · {c.title}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="span2">
                  Название экзамена / партии
                  <input
                    required
                    maxLength={200}
                    value={moduleForm.title}
                    onChange={(e) =>
                      setModuleForm({ ...moduleForm, title: e.target.value })
                    }
                  />
                </label>
                {(
                  [
                    "question_count",
                    "seconds_per_question",
                    "total_seconds",
                    "max_score",
                  ] as const
                ).map((k, i) => (
                  <label key={k}>
                    {
                      [
                        "Вопросов в попытке",
                        "Секунд на вопрос",
                        "Общее время, сек.",
                        "Максимум баллов",
                      ][i]
                    }
                    <input
                      type="number"
                      min="1"
                      required
                      value={moduleForm[k]}
                      onChange={(e) =>
                        setModuleForm({
                          ...moduleForm,
                          [k]: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Выбор вопросов
                  <select
                    value={moduleForm.selection_mode}
                    onChange={(e) =>
                      setModuleForm({
                        ...moduleForm,
                        selection_mode: e.target.value,
                      })
                    }
                  >
                    <option value="random">Все темы вперемешку</option>
                    <option value="quotas">Квоты по темам</option>
                  </select>
                </label>
                {moduleForm.selection_mode === "quotas" && (
                  <label>
                    Квоты: тема → количество
                    <input
                      value={moduleForm.quotas}
                      onChange={(e) =>
                        setModuleForm({ ...moduleForm, quotas: e.target.value })
                      }
                      placeholder={'{"1":3,"2":3}'}
                    />
                  </label>
                )}
              </div>
              <button className="primary" disabled={busy}>
                Сохранить
              </button>
              {editing && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setEditing("");
                    setModuleForm(blankModule);
                  }}
                >
                  Отмена
                </button>
              )}
            </form>
          </section>
          {d.modules.map((m) => (
            <section className="card" key={m.id}>
              <p className="eyebrow">
                {m.subject_name} · {m.course_module_title}
              </p>
              <div className="space">
                <h2>{m.title}</h2>
                <span className="pill">{status[m.status]}</span>
              </div>
              <p className="muted">
                {m.question_count} вопросов · {m.seconds_per_question} сек. на
                вопрос · {m.total_seconds} сек. всего · {m.max_score} баллов
              </p>
              <ExamAdmission
                exam={m}
                groups={d.groups}
                access={d.module_groups}
                busy={busy}
                onOpen={(ids) =>
                  run(
                    () =>
                      rpc("admin_open_exam_groups", {
                        p_module_id: m.id,
                        p_group_ids: ids,
                      }),
                    "Экзамен открыт для выбранных групп",
                  )
                }
              />
              <div className="toolbar">
                {m.status === "draft" && (
                  <button className="secondary" onClick={() => editModule(m)}>
                    Настроить
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => command("copy_module", { module_id: m.id }))
                  }
                >
                  Создать копию
                </button>
                {(m.status === "draft" ||
                  (superadmin && m.status !== "open")) && (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      const title = prompt(
                        `Удалить экзамен «${m.title}»? Банк вопросов учебного модуля сохранится. Введите название экзамена для подтверждения. Экзамен с попытками или разрешениями пересдачи удалить нельзя.`,
                      );
                      if (title === null) return;
                      void run(async () => {
                        await rpc("admin_delete_unused_exam", {
                          p_module_id: m.id,
                          p_confirmation: title,
                        });
                        if (mid === m.id) setMid("");
                        if (editing === m.id) setEditing("");
                      }, "Экзамен удалён");
                    }}
                  >
                    Удалить экзамен
                  </button>
                )}
                {superadmin && m.status !== "open" && (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      const title = prompt(
                        `Удалить «${m.title}» со ВСЕМИ попытками, ответами, результатами и разрешениями пересдачи безвозвратно? Банк вопросов сохранится. Введите точное название экзамена.`,
                      );
                      if (title === null) return;
                      if (title !== m.title) {
                        setError("Введите точное название экзамена");
                        return;
                      }
                      const reason = prompt(
                        "Причина полного удаления экзамена (3–1000 символов)",
                      );
                      if (reason === null) return;
                      if (
                        reason.trim().length < 3 ||
                        reason.trim().length > 1000
                      ) {
                        setError("Укажите причину удаления: 3–1000 символов");
                        return;
                      }
                      void run(async () => {
                        await rpc("admin_delete_exam_with_history", {
                          p_module_id: m.id,
                          p_confirmation: title,
                          p_reason: reason.trim(),
                        });
                        if (mid === m.id) setMid("");
                        if (editing === m.id) setEditing("");
                      }, "Экзамен и его история удалены. Банк вопросов сохранён");
                    }}
                  >
                    Удалить экзамен со всей историей
                  </button>
                )}
                {m.status === "open" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm("Закрыть приём? Начатые попытки продолжатся.")
                      )
                        void run(() =>
                          command("transition", {
                            module_id: m.id,
                            status: "closed",
                          }),
                        );
                    }}
                  >
                    Закрыть приём
                  </button>
                )}
                {m.status === "closed" && (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Опубликовать оценки? Повторное открытие будет запрещено.",
                        )
                      )
                        void run(() =>
                          command("transition", {
                            module_id: m.id,
                            status: "published",
                          }),
                        );
                    }}
                  >
                    Опубликовать
                  </button>
                )}
                {["closed", "published"].includes(m.status) && (
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Перенести модуль в архив?"))
                        void run(() =>
                          command("transition", {
                            module_id: m.id,
                            status: "archived",
                          }),
                        );
                    }}
                  >
                    В архив
                  </button>
                )}
              </div>
            </section>
          ))}
        </>
      )}
      {tab === "Группы" && (
        <>
          <section className="card">
            <h2>Добавить или переименовать группу</h2>
            <form
              className="fields"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(() =>
                  command("save_group", {
                    id: f.get("id"),
                    name: f.get("name"),
                  }),
                );
              }}
            >
              <label>
                ID группы
                <input name="id" required />
              </label>
              <label>
                Название
                <input name="name" required />
              </label>
              <button className="primary" disabled={busy}>
                Сохранить
              </button>
            </form>
            <label>
              Импорт групп CSV / XLSX
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => {
                  if (e.target.files?.[0])
                    void inspect(e.target.files[0], "Groups");
                  e.target.value = "";
                }}
              />
            </label>
            {groupRows.length > 0 && (
              <>
                <p>
                  Проверено строк: {groupRows.length}. Существующие названия
                  будут обновлены.
                </p>
                <button
                  disabled={busy || !!issues.length}
                  onClick={() =>
                    void run(async () => {
                      for (const r of groupRows)
                        await command("save_group", {
                          id: r.GroupID,
                          name: r.GroupName,
                        });
                      setGroupRows([]);
                    })
                  }
                >
                  Импортировать группы
                </button>
              </>
            )}
          </section>
          <section className="card">
            <h2>Доступ и окна сдачи</h2>
            <p className="muted">
              Выберите экзамен сверху. Окна задаются в UTC; рядом показано время
              Бишкека (UTC+6).
            </p>
            {d.groups.map((g) => {
              const access = d.module_groups.find(
                (a) => a.module_id === mid && a.group_id === g.id,
              );
              return (
                <form
                  className="group-row"
                  key={`${g.id}-${mid}-${access?.window_start}-${access?.access}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(() =>
                      command("group_access", {
                        module_id: mid,
                        group_id: g.id,
                        access: f.get("access") === "on",
                        window_start: f.get("start")
                          ? new Date(String(f.get("start")) + "Z").toISOString()
                          : null,
                        window_end: f.get("end")
                          ? new Date(String(f.get("end")) + "Z").toISOString()
                          : null,
                      }),
                    );
                  }}
                >
                  <b>{g.name}</b>
                  <label className="check">
                    <input
                      name="access"
                      type="checkbox"
                      defaultChecked={access?.access}
                    />
                    Разрешён
                  </label>
                  <label>
                    Начало UTC
                    <input
                      name="start"
                      type="datetime-local"
                      defaultValue={access?.window_start?.slice(0, 16)}
                    />
                    <small>{date(access?.window_start || null)}</small>
                  </label>
                  <label>
                    Конец UTC
                    <input
                      name="end"
                      type="datetime-local"
                      defaultValue={access?.window_end?.slice(0, 16)}
                    />
                    <small>{date(access?.window_end || null)}</small>
                  </label>
                  <button disabled={!mid || busy} className="secondary">
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Удалить группу? Группу со студентами удалить нельзя.",
                        )
                      )
                        void run(() => command("delete_group", { id: g.id }));
                    }}
                  >
                    Удалить
                  </button>
                </form>
              );
            })}
          </section>
        </>
      )}
      {tab === "Студенты" && (
        <>
          {code && (
            <div className="dialog-backdrop">
              <section
                className="action-dialog card"
                role="dialog"
                aria-modal="true"
                aria-label="Новый пароль студента"
              >
                <h2>Новый пароль студента</h2>
                <p>
                  Логин: <b>{codeLogin}</b>
                </p>
                <p>
                  Передайте пароль студенту. Он показан здесь и не отправляется
                  по почте.
                </p>
                <code className="access-code">{code}</code>
                <button
                  autoFocus
                  className="primary"
                  onClick={() => {
                    setCode("");
                    setCodeLogin("");
                  }}
                >
                  Закрыть
                </button>
              </section>
            </div>
          )}
          <details className="card student-accordion">
            <summary>Импорт студентов из JSON</summary>
            <StudentJsonImport
              groups={d.groups}
              disabled={busy}
              onImported={async () => {
                await data.refetch();
              }}
            />
          </details>
          <details className="card student-accordion">
            <summary>Новый студент</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  const r = await accountAction({
                    action: "create",
                    login: f.get("login"),
                    full_name: f.get("name"),
                    group_id: f.get("group"),
                  });
                  setCode(r.code || "");
                  setCodeLogin(String(f.get("login") || ""));
                });
              }}
            >
              <div className="fields">
                <label>
                  ФИО
                  <input name="name" required maxLength={150} />
                </label>
                <label>
                  Логин
                  <input
                    name="login"
                    required
                    pattern="[a-z0-9_][a-z0-9_.\-]{1,63}"
                    autoCapitalize="none"
                  />
                </label>
                <label>
                  Группа
                  <select name="group" required>
                    <option value="">Выберите</option>
                    {d.groups.map((g) => (
                      <option key={g.id}>{g.id}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="primary" disabled={busy}>
                Создать и выдать код
              </button>
            </form>
          </details>
          <details className="card student-accordion">
            <summary>Массовый импорт</summary>
            <p className="muted">
              Колонки StudentID, FullName, GroupID, Login, Status, Password
              (необязательно). Если Password заполнен, он станет паролем
              студента; иначе создаётся случайный код. Старые AccessCode
              игнорируются. Новые коды выгружаются отдельным приватным CSV.
            </p>
            <input
              type="file"
              aria-label="Импорт студентов"
              accept=".csv,.xlsx"
              onChange={(e) => {
                if (e.target.files?.[0])
                  void inspect(e.target.files[0], "Students");
                e.target.value = "";
              }}
            />
            {studentRows.length > 0 && (
              <>
                <p>Проверено студентов: {studentRows.length}</p>
                <button
                  disabled={busy || !!issues.length}
                  onClick={() =>
                    void run(async () => {
                      const issued: unknown[][] = [
                        ["StudentID", "Login", "AccessCode"],
                      ];
                      const remaining = [...studentRows];
                      try {
                        while (remaining.length) {
                          const r = remaining[0];
                          const result = await accountAction({
                            action: "create",
                            id: r.StudentID,
                            login: r.Login,
                            full_name: r.FullName,
                            group_id: r.GroupID,
                            active: r.Status?.toLowerCase() !== "blocked",
                            password: r.Password || undefined,
                          });
                          issued.push([r.StudentID, r.Login, result.code]);
                          remaining.shift();
                          r.Password = "";
                          setStudentRows([...remaining]);
                          setMessage(
                            `Создано ${issued.length - 1} из ${studentRows.length}`,
                          );
                          if (remaining.length)
                            await new Promise((resolve) =>
                              setTimeout(resolve, 2100),
                            );
                        }
                      } finally {
                        if (issued.length > 1)
                          downloadCsv("private-student-codes.csv", issued);
                      }
                    }, "Импорт завершён. Сохраните файл кодов в защищённом месте.")
                  }
                >
                  Создать аккаунты
                </button>
              </>
            )}
          </details>
          <details className="card student-accordion" open>
            <summary>Студенты · {d.students.length}</summary>
            <input
              aria-label="Поиск студентов"
              placeholder="Поиск по ФИО, логину или ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Студент</th>
                    <th>Логин</th>
                    <th>Группа</th>
                    <th>Доступ</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {d.students
                    .filter(
                      (s) =>
                        (!gid || s.group_id === gid) &&
                        `${s.full_name} ${s.login} ${s.id}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    )
                    .map((s) => (
                      <tr key={s.id}>
                        <td>
                          <b>{s.full_name}</b>
                        </td>
                        <td>{s.login}</td>
                        <td>{s.group_id}</td>
                        <td>{s.active ? "Активен" : "Заблокирован"}</td>
                        <td>
                          <div className="toolbar">
                            <button
                              disabled={busy}
                              className="secondary"
                              onClick={() =>
                                void run(() =>
                                  command("student_status", {
                                    id: s.id,
                                    active: !s.active,
                                  }),
                                )
                              }
                            >
                              {s.active ? "Блокировать" : "Разрешить"}
                            </button>
                            <button
                              disabled={busy}
                              className="ghost"
                              onClick={() => {
                                const name = prompt("ФИО", s.full_name);
                                if (!name) return;
                                const group = prompt("ID группы", s.group_id);
                                if (group)
                                  void run(() =>
                                    command("rename_student", {
                                      id: s.id,
                                      full_name: name,
                                      group_id: group,
                                    }),
                                  );
                              }}
                            >
                              Изменить
                            </button>
                            <button
                              disabled={busy}
                              className="ghost"
                              onClick={() => {
                                if (
                                  confirm(
                                    "Заменить личный код? Старый перестанет работать.",
                                  )
                                )
                                  void run(async () => {
                                    const r = await accountAction({
                                      action: "reset",
                                      id: s.id,
                                    });
                                    setCode(r.code || "");
                                    setCodeLogin(s.login);
                                  });
                              }}
                            >
                              Новый код
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {tab === "Вопросы" &&
        (!courseModuleId ? (
          <section className="card empty">
            Выберите дисциплину и учебный модуль для работы с банком вопросов.
          </section>
        ) : (
          <>
            <section className="card">
              <h2>Банк вопросов · {bank.data?.length || 0}</h2>
              <p className="eyebrow">
                {
                  subjects.find(
                    (s) =>
                      s.id ===
                      courseModules.find((c) => c.id === courseModuleId)
                        ?.subject_id,
                  )?.name
                }{" "}
                → {courseModules.find((c) => c.id === courseModuleId)?.title}
              </p>
              <p className="muted">
                Общий банк учебного модуля для всех его экзаменов. Изменения
                применяются к новым попыткам; начатые попытки сохраняют свои
                вопросы. Удаление экзамена сохраняет этот банк.
              </p>
              <label>
                Импорт CSV / XLSX (лист Questions)
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.files?.[0])
                      void inspect(e.target.files[0], "Questions");
                    e.target.value = "";
                  }}
                />
              </label>
              {preview.length > 0 && (
                <>
                  <p>
                    Проверено вопросов: {preview.length}. Совпадающие QuestionID
                    будут обновлены.
                  </p>
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Тема</th>
                          <th>Вопрос</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.slice(0, 10).map((q, i) => (
                          <tr key={i}>
                            <td>{q.external_id}</td>
                            <td>{q.lecture}</td>
                            <td>{q.text}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    className="primary"
                    disabled={busy || !!issues.length}
                    onClick={() =>
                      void run(async () => {
                        await rpc("admin_bank_command", {
                          p_action: "save_questions",
                          p_course_module_id: courseModuleId,
                          p_data: {
                            questions: preview,
                          },
                        });
                        setPreview([]);
                      })
                    }
                  >
                    Импортировать {preview.length} вопросов
                  </button>
                </>
              )}
            </section>
            <section className="card">
              <h2>Добавить / обновить вопрос</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await rpc("admin_bank_command", {
                      p_action: "save_questions",
                      p_course_module_id: courseModuleId,
                      p_data: { questions: [question] },
                    });
                    setQuestion(blankQuestion);
                  });
                }}
              >
                <fieldset disabled={busy}>
                  <div className="fields">
                    <label>
                      QuestionID
                      <input
                        required
                        value={question.external_id}
                        onChange={(e) =>
                          setQuestion({
                            ...question,
                            external_id: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Тема / лекция
                      <input
                        required
                        value={question.lecture}
                        onChange={(e) =>
                          setQuestion({ ...question, lecture: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Сложность
                      <input
                        value={question.difficulty}
                        onChange={(e) =>
                          setQuestion({
                            ...question,
                            difficulty: e.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Текст вопроса
                    <textarea
                      required
                      value={question.text}
                      onChange={(e) =>
                        setQuestion({ ...question, text: e.target.value })
                      }
                    />
                  </label>
                  <div className="fields">
                    {question.options.map((o, i) => (
                      <label key={i}>
                        Вариант {"ABCD"[i]}
                        <input
                          required
                          value={o}
                          onChange={(e) =>
                            setQuestion({
                              ...question,
                              options: question.options.map((v, j) =>
                                i === j ? e.target.value : v,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    Правильный ответ
                    <select
                      value={question.correct}
                      onChange={(e) =>
                        setQuestion({
                          ...question,
                          correct: Number(e.target.value),
                        })
                      }
                    >
                      {[0, 1, 2, 3].map((i) => (
                        <option key={i} value={i}>
                          {"ABCD"[i]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={question.active}
                      onChange={(e) =>
                        setQuestion({ ...question, active: e.target.checked })
                      }
                    />
                    Активен
                  </label>
                  <button className="primary">Сохранить вопрос</button>
                </fieldset>
              </form>
            </section>
            <section className="card">
              <h2>Вопросы модуля</h2>
              {bank.error && <p className="alert">{bank.error.message}</p>}
              {bank.data?.map((q) => (
                <div className="module-row" key={q.id}>
                  <div>
                    <small>
                      {q.external_id} · тема {q.lecture} ·{" "}
                      {q.active ? "активен" : "отключён"}
                    </small>
                    <p>{q.text}</p>
                  </div>
                  <div className="toolbar">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setQuestion(q);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Изменить
                    </button>
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (confirm("Удалить вопрос?"))
                          void run(() =>
                            rpc("admin_bank_command", {
                              p_action: "delete_question",
                              p_course_module_id: courseModuleId,
                              p_data: { id: q.id },
                            }),
                          );
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </section>
          </>
        ))}
      {issues.length > 0 && (
        <div className="alert" role="alert">
          <b>Импорт пока недоступен:</b>
          <ul>
            {issues.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {tab === "Результаты" && (
        <>
          <RetakeControls
            key={mid}
            exam={selected}
            students={all.students}
            counters={all.attempt_counters || []}
            superadmin={superadmin}
            busy={busy}
            onGrant={(s) => {
              if (!selected) return;
              const a = all.attempts.find(
                (a) =>
                  a.module_id === selected.id &&
                  a.student_id === s.id &&
                  a.is_current !== false,
              );
              setAttemptAction({
                action: "grant_retake",
                module_id: selected.id,
                student_id: s.id,
                full_name: s.full_name,
                login: s.login,
                title: selected.title,
                attempt_id: a?.id,
                published: !!selected.published_at,
              });
            }}
          />
          <RetakeHistory
            modules={all.modules}
            grants={(all.retake_grants || []).filter((g) =>
              visibleIds.has(g.module_id),
            )}
            superadmin={superadmin}
            busy={busy}
            onRevoke={(g) =>
              setAttemptAction({
                action: "revoke_retake",
                module_id: g.module_id,
                student_id: g.student_id,
                full_name: g.full_name,
                login: g.login,
                title:
                  all.modules.find((m) => m.id === g.module_id)?.title || "",
                grant_id: g.id,
                published: !!all.modules.find((m) => m.id === g.module_id)
                  ?.published_at,
              })
            }
          />
        </>
      )}
      {(tab === "Результаты" || tab === "Обзор") && (
        <section className="card">
          <div className="space">
            <h2>Попытки и результаты</h2>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(
                  () => downloadXlsx("results.xlsx", resultRows),
                  "Результаты выгружены",
                )
              }
            >
              Экспорт XLSX
            </button>
            <button
              className="secondary"
              onClick={() => downloadCsv("results.csv", resultRows)}
            >
              Экспорт CSV
            </button>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Студент</th>
                  <th>Экзамен</th>
                  <th>Группа</th>
                  <th>Статус</th>
                  <th>Прогресс</th>
                  <th>Начало · Бишкек</th>
                  <th>Верно</th>
                  <th>Балл</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {d.attempts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.full_name}
                      <small>Попытка №{a.attempt_number || 1}</small>
                    </td>
                    <td>
                      {all.modules.find((m) => m.id === a.module_id)?.title}
                      <small>
                        {
                          all.modules.find((m) => m.id === a.module_id)
                            ?.subject_name
                        }{" "}
                        ·{" "}
                        {
                          all.modules.find((m) => m.id === a.module_id)
                            ?.course_module_title
                        }
                      </small>
                    </td>
                    <td>{a.group_id}</td>
                    <td>
                      <span className="pill">{status[a.status]}</span>
                      {a.void_reason && (
                        <small className="reason-cell">
                          {a.void_reason} · {a.voided_by_name}
                        </small>
                      )}
                    </td>
                    <td>
                      {a.current_index} / {a.question_count}
                    </td>
                    <td>{date(a.started_at)}</td>
                    <td>{a.correct_count ?? "—"}</td>
                    <td>
                      {a.is_current === false ? (
                        <>
                          <s>{a.score ?? "—"}</s>
                          <small>Не учитывается</small>
                        </>
                      ) : (
                        <b>{a.score ?? "—"}</b>
                      )}
                    </td>
                    <td>
                      <div className="toolbar">
                        {a.is_current !== false &&
                          !["draft", "archived"].includes(
                            all.modules.find((m) => m.id === a.module_id)
                              ?.status || "",
                          ) &&
                          (!all.modules.find((m) => m.id === a.module_id)
                            ?.published_at ||
                            superadmin) && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                setAttemptAction(targetFor(a, "grant_retake"))
                              }
                            >
                              Разрешить пересдачу
                            </button>
                          )}
                        {superadmin &&
                          a.is_current !== false &&
                          a.status === "finished" &&
                          !a.result_published_at &&
                          all.modules.find((m) => m.id === a.module_id)
                            ?.published_at && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                setAttemptAction(targetFor(a, "publish_result"))
                              }
                            >
                              Опубликовать результат
                            </button>
                          )}
                        {superadmin && (
                          <button
                            className="danger"
                            disabled={busy}
                            onClick={() =>
                              setAttemptAction(targetFor(a, "delete_attempt"))
                            }
                          >
                            Удалить навсегда
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d.attempts.length && (
              <p className="empty muted">
                Пока нет попыток для выбранных фильтров.
              </p>
            )}
          </div>
        </section>
      )}
      {attemptAction && (
        <AttemptActionDialog
          target={attemptAction}
          busy={busy}
          onClose={() => setAttemptAction(null)}
          onSubmit={async (payload) => {
            if (busy) throw new Error("Дождитесь завершения операции");
            setBusy(true);
            setError("");
            try {
              await rpc("admin_attempt_action", payload);
              await cache.invalidateQueries({ queryKey: ["admin"] });
              setMessage("Операция сохранена в журнале");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </main>
  );
}
