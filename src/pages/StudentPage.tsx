import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "../shared/api";
import type { Current, Module } from "../entities/types";
function time(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
type Command = {
  attempt: string;
  position: number;
  option: string;
  key: string;
};
export function StudentPage({ user }: { user: string }) {
  const modules = useQuery({
    queryKey: ["modules", user],
    queryFn: () => rpc<Module[]>("student_modules"),
    refetchInterval: 15000,
  });
  const [current, setCurrent] = useState<Current | null>(null),
    [subjectId, setSubjectId] = useState(""),
    [selected, setSelected] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const command = useRef<Command | null>(null),
    busy = useRef(false),
    offset = useRef(0),
    [now, setNow] = useState(Date.now());
  const active = current && !current.done;
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  function accept(data: Current) {
    offset.current = Date.parse(data.server_now) - Date.now();
    setNow(Date.now());
    setCurrent(data);
    setSelected("");
    setError("");
    setNotice(
      data.outcome === "expired_or_stale"
        ? "Время ответа истекло или вопрос уже обработан. Показано актуальное состояние."
        : "",
    );
  }
  async function execute(fn: () => Promise<Current>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      accept(await fn());
    } catch (e) {
      setError((e as Error).message + " Ответ пока не подтверждён.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function refresh() {
    if (!current) return;
    await execute(() =>
      rpc<Current>("attempt_current", { p_attempt_id: current.attempt_id }),
    );
  }
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (command.current) return;
      if (
        Date.now() + offset.current >= Date.parse(current.question_deadline!) &&
        !busy.current
      )
        void refresh();
    }, 1500);
    return () => clearInterval(t);
  }, [current, active]);
  useEffect(() => {
    const f = () => {
      if (current && !command.current) void refresh();
    };
    window.addEventListener("online", f);
    window.addEventListener("focus", f);
    return () => {
      window.removeEventListener("online", f);
      window.removeEventListener("focus", f);
    };
  }, [current]);
  useEffect(() => {
    if (!current?.done || current.published) return;
    const t = setInterval(() => void refresh(), 15000);
    return () => clearInterval(t);
  }, [current]);
  async function send() {
    if (!current || busy.current) return;
    if (!command.current) {
      if (!selected) return;
      command.current = {
        attempt: current.attempt_id,
        position: current.index!,
        option: selected,
        key: crypto.randomUUID(),
      };
    }
    const c = command.current;
    await execute(async () => {
      const result = await rpc<Current>("attempt_submit_answer", {
        p_attempt_id: c.attempt,
        p_position: c.position,
        p_option_id: c.option,
        p_key: c.key,
      });
      command.current = null;
      return result;
    });
  }
  const remaining = current?.question_deadline
    ? Date.parse(current.question_deadline) - (now + offset.current)
    : 0;
  if (!current)
    return (
      <main className="student-home">
        <span className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</span>
        <h1>Твои экзамены</h1>
        <p className="muted">
          Выбери экзамен. Дисциплина, модуль и правила указаны на карточке.
        </p>
        {!!modules.data?.length && (
          <label>
            Дисциплина
            <select
              aria-label="Дисциплина"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">Все дисциплины</option>
              {Array.from(
                new Map(
                  modules.data
                    .filter((m) => m.subject_id)
                    .map((m) => [m.subject_id!, m.subject_name]),
                ).entries(),
              ).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {modules.error && (
          <div className="alert">
            {modules.error.message}
            <button onClick={() => void modules.refetch()}>Повторить</button>
          </div>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {modules.isPending ? (
          <p>Загружаем модули…</p>
        ) : !modules.data?.length ? (
          <div className="card empty">
            Пока нет назначенных модулей. Обратитесь к преподавателю.
          </div>
        ) : (
          <div className="module-grid">
            {modules.data
              .filter((m) => !subjectId || m.subject_id === subjectId)
              .map((m) => (
                <article className="card module-card" key={m.id}>
                  <span className="pill">
                    {m.attempt_status === "finished"
                      ? "Завершён"
                      : m.available
                        ? "Доступен"
                        : "Приём закрыт"}
                  </span>
                  <p className="eyebrow catalog-path">
                    {m.subject_name} · {m.course_module_title}
                  </p>
                  <h2>{m.title}</h2>
                  <div className="module-facts">
                    <span>
                      <b>{m.question_count}</b> вопросов
                    </span>
                    <span>
                      <b>{m.seconds_per_question} сек.</b> на вопрос
                    </span>
                    <span>
                      <b>{Math.round(m.total_seconds / 60)} мин.</b> всего
                    </span>
                  </div>
                  <p className="muted">
                    Одна попытка. Вернуться к предыдущему вопросу нельзя. После
                    старта время идёт даже при закрытой вкладке.
                  </p>
                  <button
                    className="primary full"
                    disabled={pending || (!m.available && !m.attempt_id)}
                    onClick={() =>
                      void execute(() =>
                        rpc<Current>("attempt_start_or_resume", {
                          p_module_id: m.id,
                        }),
                      )
                    }
                  >
                    {m.attempt_status === "finished"
                      ? "Посмотреть результат"
                      : m.attempt_id
                        ? "Продолжить"
                        : "Начать экзамен →"}
                  </button>
                </article>
              ))}
          </div>
        )}
      </main>
    );
  return (
    <main className="exam-shell">
      {error && (
        <div className="alert" role="alert">
          {error}
          <button
            disabled={pending}
            onClick={() => void (command.current ? send() : refresh())}
          >
            Повторить синхронизацию
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {current.done ? (
        <section className="card finish">
          <span className="finish-icon">✓</span>
          <span className="eyebrow">{current.title}</span>
          <p className="muted">
            {current.subject_name} · {current.course_module_title}
          </p>
          <h1>Тест завершён</h1>
          {current.published ? (
            <>
              <p>Ваш результат</p>
              <div className="score">
                {current.score}
                <small> / {current.max_score}</small>
              </div>
              <p className="muted">
                Правильных ответов: {current.correct} из {current.total}
              </p>
            </>
          ) : (
            <p className="muted">
              Результат будет доступен после публикации преподавателем.
            </p>
          )}
          <button
            className="secondary"
            onClick={() => {
              setCurrent(null);
              void modules.refetch();
            }}
          >
            К списку модулей
          </button>
        </section>
      ) : (
        <section className="card exam-card">
          <div className="exam-meta">
            <span className="eyebrow">
              {current.subject_name} · {current.course_module_title}
              <br />
              {current.title}
            </span>
            <span className="muted">
              Общее время{" "}
              <b>
                {time(
                  Date.parse(current.attempt_deadline) - (now + offset.current),
                )}
              </b>
            </span>
          </div>
          <div className="question-top">
            <span>
              Вопрос <b>{current.index}</b> / {current.total}
            </span>
            <span className={`timer ${remaining < 10000 ? "urgent" : ""}`}>
              {time(remaining)}
            </span>
          </div>
          <div className="progress">
            <div
              style={{
                width: `${((current.index! - 1) / current.total) * 100}%`,
              }}
            />
          </div>
          <h1>{current.question}</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <fieldset disabled={pending || !!command.current || remaining <= 0}>
              <legend className="sr-only">Выберите один ответ</legend>
              {current.options?.map((o, i) => (
                <label
                  className={`choice ${selected === o.id ? "chosen" : ""}`}
                  key={o.id}
                >
                  <input
                    type="radio"
                    name="answer"
                    value={o.id}
                    checked={selected === o.id}
                    onChange={() => setSelected(o.id)}
                  />
                  <span className="option-letter">{"ABCD"[i]}</span>
                  <span>{o.text}</span>
                </label>
              ))}
            </fieldset>
            <button
              className="primary full"
              disabled={
                pending || (!command.current && (!selected || remaining <= 0))
              }
            >
              {pending
                ? "Подтверждаем ответ…"
                : command.current
                  ? "Повторить отправку"
                  : "Ответить и продолжить →"}
            </button>
          </form>
          <p className="exam-note">
            После ответа вернуться к вопросу нельзя. Время проверяет сервер.
          </p>
        </section>
      )}
    </main>
  );
}
