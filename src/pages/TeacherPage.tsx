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
const status: Record<string, string> = {
  draft: "Черновик",
  open: "Открыт",
  closed: "Закрыт",
  published: "Опубликован",
  archived: "Архив",
  active: "Проходит",
  finished: "Завершён",
};
const blankModule = {
  title: "Growing Landing — Модуль №1",
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
export function TeacherPage({ user }: { user: string }) {
  const cache = useQueryClient();
  const [tab, setTab] = useState("Обзор"),
    [mid, setMid] = useState(""),
    [gid, setGid] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [code, setCode] = useState("");
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
    queryKey: ["bank", user, mid],
    queryFn: () => rpc<Question[]>("admin_questions", { p_module_id: mid }),
    enabled: !!mid && tab === "Вопросы",
  });
  async function run(
    fn: () => Promise<unknown>,
    success = "Изменения сохранены",
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(success);
      await cache.invalidateQueries({ queryKey: ["admin"] });
      await cache.invalidateQueries({ queryKey: ["bank"] });
    } catch (e) {
      setError((e as Error).message);
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
  const d = data.data;
  const resultRows: unknown[][] = [
    [
      "Студент",
      "Группа",
      "Статус",
      "Вопрос",
      "Начало",
      "Завершение",
      "Правильно",
      "Балл",
    ],
    ...d.attempts.map((a) => [
      a.full_name,
      a.group_id,
      status[a.status],
      a.current_index,
      date(a.started_at),
      date(a.finished_at),
      a.correct_count,
      a.score,
    ]),
  ];
  return (
    <main className="dashboard">
      <div className="page-title">
        <div>
          <span className="eyebrow">ПАНЕЛЬ ПРЕПОДАВАТЕЛЯ</span>
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
        {["Обзор", "Модули", "Группы", "Студенты", "Вопросы", "Результаты"].map(
          (t) => (
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
          ),
        )}
      </nav>
      <div className="filters">
        <label>
          Модуль
          <select
            value={mid}
            onChange={(e) => {
              setMid(e.target.value);
              setPreview([]);
              setQuestion(blankQuestion);
            }}
          >
            <option value="">Все модули</option>
            {d.modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} · {status[m.status]}
              </option>
            ))}
          </select>
        </label>
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
            <h2>Текущие модули</h2>
            {!d.modules.length ? (
              <p className="muted">
                Создайте первый модуль, добавьте вопросы и разрешите доступ
                группам.
              </p>
            ) : (
              d.modules.map((m) => (
                <div className="module-row" key={m.id}>
                  <div>
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
      {tab === "Модули" && (
        <>
          <section className="card">
            <h2>{editing ? "Настройки черновика" : "Новый модуль"}</h2>
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
                  setEditing("");
                  setModuleForm(blankModule);
                });
              }}
            >
              <div className="fields">
                <label className="span2">
                  Название
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
              <div className="space">
                <h2>{m.title}</h2>
                <span className="pill">{status[m.status]}</span>
              </div>
              <p className="muted">
                {m.question_count} вопросов · {m.seconds_per_question} сек. на
                вопрос · {m.total_seconds} сек. всего · {m.max_score} баллов
              </p>
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
                {(m.status === "draft" || m.status === "closed") && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Открыть приём? Проверьте вопросы и доступ групп.",
                        )
                      )
                        void run(() =>
                          command("transition", {
                            module_id: m.id,
                            status: "open",
                          }),
                        );
                    }}
                  >
                    Открыть
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
                    Закрыть
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
              Выберите модуль сверху. Окна задаются в UTC; рядом показано время
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
          <section className="card">
            <h2>Новый студент</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  const r = await accountAction({
                    action: "create",
                    id: f.get("id"),
                    login: f.get("login"),
                    full_name: f.get("name"),
                    group_id: f.get("group"),
                  });
                  setCode(r.code || "");
                });
              }}
            >
              <div className="fields">
                <label>
                  StudentID
                  <input name="id" required pattern="[-a-zA-Z0-9_]{2,64}" />
                </label>
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
            {code && (
              <div className="notice">
                <p>Новый личный код. Передайте только этому студенту.</p>
                <code className="access-code">{code}</code>
                <button className="ghost" onClick={() => setCode("")}>
                  Скрыть
                </button>
              </div>
            )}
          </section>
          <section className="card">
            <h2>Массовый импорт</h2>
            <p className="muted">
              Колонки StudentID, FullName, GroupID, Login, Status. Старые
              AccessCode игнорируются. Новые коды выгружаются отдельным
              приватным CSV.
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
                          });
                          issued.push([r.StudentID, r.Login, result.code]);
                          remaining.shift();
                          setStudentRows([...remaining]);
                          setMessage(
                            `Создано ${issued.length - 1} из ${studentRows.length}`,
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
          </section>
          <section className="card">
            <h2>Студенты · {d.students.length}</h2>
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
                          <small>{s.id}</small>
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
          </section>
        </>
      )}
      {tab === "Вопросы" &&
        (!mid ? (
          <section className="card empty">
            Выберите модуль для работы с банком.
          </section>
        ) : (
          <>
            <section className="card">
              <h2>Банк вопросов · {bank.data?.length || 0}</h2>
              <p className="muted">
                Размер банка произвольный. Изменения доступны в черновике; для
                следующей партии скопируйте модуль.
              </p>
              <label>
                Импорт CSV / XLSX (лист Questions)
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  disabled={selected?.status !== "draft" || busy}
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
                        await command("save_questions", {
                          module_id: mid,
                          questions: preview,
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
                    await command("save_questions", {
                      module_id: mid,
                      questions: [question],
                    });
                    setQuestion(blankQuestion);
                  });
                }}
              >
                <fieldset disabled={busy || selected?.status !== "draft"}>
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
                      disabled={selected?.status !== "draft"}
                      onClick={() => {
                        setQuestion(q);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Изменить
                    </button>
                    <button
                      className="ghost"
                      disabled={busy || selected?.status !== "draft"}
                      onClick={() => {
                        if (confirm("Удалить вопрос?"))
                          void run(() =>
                            command("delete_question", {
                              module_id: mid,
                              id: q.id,
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
              onClick={() =>
                downloadCsv("results.csv", [
                  [
                    "Студент",
                    "Группа",
                    "Статус",
                    "Вопрос",
                    "Начало",
                    "Завершение",
                    "Правильно",
                    "Балл",
                  ],
                  ...d.attempts.map((a) => [
                    a.full_name,
                    a.group_id,
                    status[a.status],
                    a.current_index,
                    date(a.started_at),
                    date(a.finished_at),
                    a.correct_count,
                    a.score,
                  ]),
                ])
              }
            >
              Экспорт CSV
            </button>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Студент</th>
                  <th>Группа</th>
                  <th>Статус</th>
                  <th>Прогресс</th>
                  <th>Начало · Бишкек</th>
                  <th>Верно</th>
                  <th>Балл</th>
                </tr>
              </thead>
              <tbody>
                {d.attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.full_name}</td>
                    <td>{a.group_id}</td>
                    <td>
                      <span className="pill">{status[a.status]}</span>
                    </td>
                    <td>
                      {a.current_index} / {a.question_count}
                    </td>
                    <td>{date(a.started_at)}</td>
                    <td>{a.correct_count ?? "—"}</td>
                    <td>
                      <b>{a.score ?? "—"}</b>
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
    </main>
  );
}
