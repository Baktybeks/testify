import { useState } from "react";
import type {
  AdminData,
  Module,
  Student,
  RetakeGrant,
} from "../entities/types";
export function RetakeControls({
  exam,
  students,
  counters,
  superadmin,
  busy,
  onGrant,
}: {
  exam: Module | undefined;
  students: Student[];
  counters: NonNullable<AdminData["attempt_counters"]>;
  superadmin: boolean;
  busy: boolean;
  onGrant: (s: Student) => void;
}) {
  const [id, setId] = useState("");
  if (!exam)
    return (
      <p className="muted">
        Выберите экзамен сверху, чтобы выдать пересдачу конкретному студенту.
      </p>
    );
  if (["draft", "archived"].includes(exam.status)) return null;
  if (exam.published_at && !superadmin)
    return (
      <p className="muted">После публикации пересдачи разрешает суперадмин.</p>
    );
  const eligible = students.filter((s) =>
    counters.some(
      (c) =>
        c.module_id === exam.id && c.student_id === s.id && c.started_count > 0,
    ),
  );
  return (
    <section className="card">
      <h2>Разрешить ещё одну попытку</h2>
      <p className="muted">
        Для студентов, уже начинавших этот экзамен, в том числе после удаления
        попытки. Новое разрешение заменит предыдущее неиспользованное
        разрешение.
      </p>
      <label>
        Студент для пересдачи
        <select
          value={id}
          onChange={(e) => setId(e.target.value)}
          disabled={busy}
        >
          <option value="">Выберите студента</option>
          {eligible.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name} · {s.group_id}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary"
        disabled={busy || !eligible.some((s) => s.id === id)}
        onClick={() => {
          const s = eligible.find((s) => s.id === id);
          if (s) onGrant(s);
        }}
      >
        Указать причину и разрешить
      </button>
    </section>
  );
}
export function RetakeHistory({
  grants,
  superadmin,
  modules,
  busy,
  onRevoke,
}: {
  grants: RetakeGrant[];
  superadmin: boolean;
  modules: Module[];
  busy: boolean;
  onRevoke: (g: RetakeGrant) => void;
}) {
  if (!grants.length) return null;
  return (
    <details className="card">
      <summary>Разрешения на пересдачу · {grants.length}</summary>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Студент</th>
              <th>Причина</th>
              <th>Выдал</th>
              <th>Начать до · Бишкек</th>
              <th>Состояние</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => {
              const pending =
                !g.consumed_at &&
                !g.revoked_at &&
                Date.parse(g.start_deadline) > Date.now();
              const m = modules.find((m) => m.id === g.module_id);
              return (
                <tr key={g.id}>
                  <td>
                    {g.full_name}
                    <small>{m?.title}</small>
                  </td>
                  <td className="reason-cell">{g.reason}</td>
                  <td>{g.actor_name}</td>
                  <td>
                    {new Date(g.start_deadline).toLocaleString("ru-RU", {
                      timeZone: "Asia/Bishkek",
                    })}
                  </td>
                  <td>
                    {g.consumed_at
                      ? "Использовано"
                      : g.revoked_at
                        ? "Отозвано"
                        : pending
                          ? "Ожидает начала"
                          : "Истекло"}
                  </td>
                  <td>
                    {pending && (!m?.published_at || superadmin) && (
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() => onRevoke(g)}
                      >
                        Отозвать
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
