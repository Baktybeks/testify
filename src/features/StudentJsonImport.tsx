import { useEffect, useRef, useState } from "react";
import type { Group, Student } from "../entities/types";
import { accountAction, rpc } from "../shared/api";
import { parseStudentJson, type StudentInput } from "./student-json";
import { downloadCsv } from "./files";
const example =
  '[\n  {"name": "Иванов Иван Иванович", "login": "ivanov_i_i"},\n  {"name": "Петров Пётр Петрович", "login": "petrov_p_p"}\n]';
type Result = { login: string; status: string };
export function StudentJsonImport({
  groups,
  disabled,
  onImported,
}: {
  groups: Group[];
  disabled: boolean;
  onImported: () => Promise<void>;
}) {
  const [text, setText] = useState(""),
    [password, setPassword] = useState(""),
    [group, setGroup] = useState(""),
    [preview, setPreview] = useState<StudentInput[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [results, setResults] = useState<Result[]>([]);
  const cancelled = useRef(false),
    running = useRef(false);
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );
  function invalidate() {
    setPreview([]);
    setError("");
  }
  async function importStudents() {
    if (running.current || !preview.length) return;
    running.current = true;
    setBusy(true);
    setError("");
    setResults([]);
    cancelled.current = false;
    const rows = [...preview],
      issued: unknown[][] = [["StudentID", "Login", "AccessCode"]],
      remaining: StudentInput[] = [];
    setPreview([]);
    setText("");
    setPassword("");
    try {
      const data = await rpc<{ students: Student[] }>("admin_data");
      const existingLogins = new Set(data.students.map((s) => s.login)),
        existingIds = new Set(data.students.map((s) => s.id));
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (cancelled.current) {
          remaining.push(...rows.slice(i));
          break;
        }
        setProgress(`Обрабатываем ${i + 1} из ${rows.length}: ${row.login}`);
        let status = "Уже существует — пропущен";
        if (!existingLogins.has(row.login) && existingIds.has(row.id)) {
          status = "StudentID занят другим логином";
          remaining.push(row);
        } else if (!existingLogins.has(row.login)) {
          try {
            const result = await accountAction({ action: "create", ...row });
            issued.push([row.id, row.login, result.code]);
            existingLogins.add(row.login);
            existingIds.add(row.id);
            status = "Создан";
          } catch (e) {
            status = (e as Error).message;
            remaining.push(row);
          }
          // Stay within the server limit of 30 account operations per minute.
          if (i < rows.length - 1 && !cancelled.current)
            await new Promise((resolve) => setTimeout(resolve, 2100));
        }
        setResults((previous) => [...previous, { login: row.login, status }]);
      }
      setProgress(
        cancelled.current
          ? "Импорт остановлен. Созданные аккаунты сохранены."
          : remaining.length
            ? "Импорт завершён с ошибками. Необработанные записи можно проверить и повторить."
            : "Импорт завершён.",
      );
    } catch (e) {
      setError((e as Error).message);
      remaining.push(...rows);
    } finally {
      if (issued.length > 1) downloadCsv("private-student-codes.csv", issued);
      rows.forEach((r) => {
        r.password = undefined;
      });
      remaining.forEach((r) => {
        r.password = undefined;
      });
      if (remaining.length)
        setText(
          JSON.stringify(
            remaining.map(({ password: _secret, ...r }) => ({
              name: r.full_name,
              login: r.login,
              id: r.id,
              group: r.group_id,
              status: r.active ? "active" : "blocked",
            })),
            null,
            2,
          ),
        );
      setBusy(false);
      running.current = false;
      await onImported();
    }
  }
  return (
    <section className="card">
      <h2>Добавить студентов через JSON</h2>
      <p className="muted">
        Вставьте список или загрузите .json. Можно указать общий пароль для всех
        новых аккаунтов. Без пароля система создаст индивидуальные коды.
      </p>
      <details>
        <summary>Пример и поля JSON</summary>
        <pre className="json-example">{example}</pre>
        <p className="muted">
          Обязательны name и login. Группу выберите ниже или укажите group в
          записи. Необязательные поля: id (по умолчанию login), password,
          status: active / blocked. До 500 записей. Существующие аккаунты
          пропускаются; их пароли сохраняются.
        </p>
      </details>
      <fieldset disabled={busy || disabled}>
        <label>
          Группа для записей без group
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              invalidate();
            }}
          >
            <option value="">Выберите группу</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Загрузить JSON
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              invalidate();
              try {
                if (file.size > 1_000_000) throw new Error("Файл больше 1 МБ");
                setText(await file.text());
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </label>
        <label>
          JSON со студентами
          <textarea
            rows={9}
            required
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              invalidate();
            }}
            placeholder={example}
          />
        </label>
        <label>
          Общий пароль для записей без password
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              invalidate();
            }}
            placeholder="12–128 символов или оставьте пустым"
          />
        </label>
        <p className="muted">
          При общем пароле знающий его сможет войти в чужой аккаунт по чужому
          логину. Пароль хранится в Supabase Auth в виде хеша.
        </p>
        <button
          className="secondary"
          onClick={() => {
            try {
              setPreview(
                parseStudentJson(
                  text,
                  password,
                  group,
                  new Set(groups.map((g) => g.id)),
                ),
              );
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Проверить JSON
        </button>
      </fieldset>
      {preview.length > 0 && (
        <>
          <p>Готово к импорту: {preview.length}. Пример записей:</p>
          <ul>
            {preview.slice(0, 5).map((r) => (
              <li key={r.id}>
                {r.full_name} · {r.login} · {r.group_id}
              </li>
            ))}
          </ul>
          <button
            className="primary"
            disabled={busy || disabled}
            onClick={() => void importStudents()}
          >
            Создать студентов из JSON
          </button>
        </>
      )}
      {busy && (
        <button
          className="ghost"
          onClick={() => {
            cancelled.current = true;
            setProgress("Останавливаем после текущего запроса…");
          }}
        >
          Остановить импорт
        </button>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <p role="status">{progress}</p>
      {results.length > 0 && (
        <ul>
          {results.map((r) => (
            <li key={r.login}>
              <b>{r.login}</b> — {r.status}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
