import { useRef, useState } from "react";
export type AttemptAction =
  "grant_retake" | "revoke_retake" | "delete_attempt" | "publish_result";
export type AttemptActionTarget = {
  action: AttemptAction;
  module_id: string;
  student_id: string;
  full_name: string;
  login: string;
  title: string;
  attempt_id?: string;
  grant_id?: string;
  published: boolean;
};
const titles: Record<AttemptAction, string> = {
  grant_retake: "Разрешить пересдачу",
  revoke_retake: "Отозвать разрешение",
  delete_attempt: "Удалить попытку навсегда",
  publish_result: "Опубликовать результат пересдачи",
};
export function AttemptActionDialog({
  target,
  busy,
  onClose,
  onSubmit,
}: {
  target: AttemptActionTarget;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [reason, setReason] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [deadline, setDeadline] = useState(
      new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    ),
    [error, setError] = useState("");
  const request = useRef({ payload: "", key: "" }),
    running = useRef(false);
  return (
    <div className="dialog-backdrop">
      <section
        className="action-dialog card"
        role="dialog"
        aria-modal="true"
        aria-label={titles[target.action]}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
        }}
      >
        <h2>{titles[target.action]}</h2>
        <p>
          <b>{target.full_name}</b>
          <br />
          {target.title}
        </p>
        {target.action === "grant_retake" && (
          <p className="muted">
            Текущая попытка будет аннулирована и сохранена в истории. Студент
            получит один новый запуск с полным временем. Разрешение можно
            выдавать повторно с новой причиной.
          </p>
        )}
        {target.action === "delete_attempt" && (
          <p className="alert">
            Попытка, ответы и результат будут удалены навсегда. В журнале
            останутся действие и причина. Для новой попытки потребуется
            отдельное разрешение.
          </p>
        )}
        {target.action === "publish_result" && (
          <p className="muted">Новая оценка станет видна студенту.</p>
        )}
        {target.action === "grant_retake" && target.published && (
          <p className="notice">
            Результат пересдачи будет скрыт до отдельной публикации
            суперадмином.
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (running.current || busy) return;
            running.current = true;
            setError("");
            try {
              const body = {
                p_action: target.action,
                p_module_id: target.module_id,
                p_student_id: target.student_id,
                p_reason: reason.trim(),
                p_attempt_id: target.attempt_id || null,
                p_grant_id: target.grant_id || null,
                p_confirmation:
                  target.action === "delete_attempt" ? confirmation : null,
                p_start_deadline:
                  target.action === "grant_retake" && deadline
                    ? new Date(deadline + "Z").toISOString()
                    : null,
              };
              const serialized = JSON.stringify(body);
              if (request.current.payload !== serialized)
                request.current = {
                  payload: serialized,
                  key: crypto.randomUUID(),
                };
              await onSubmit({ ...body, p_key: request.current.key });
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              running.current = false;
            }
          }}
        >
          <label>
            Причина
            <textarea
              autoFocus
              required
              minLength={3}
              maxLength={1000}
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: телефон выключился во время экзамена"
            />
          </label>
          {target.action === "grant_retake" && (
            <label>
              Начать пересдачу до (UTC)
              <input
                type="datetime-local"
                required
                disabled={busy}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <small>
                Время запуска не идёт до нажатия студентом «Начать пересдачу».
              </small>
            </label>
          )}
          {target.action === "delete_attempt" && (
            <label>
              Введите логин {target.login} для подтверждения
              <input
                autoComplete="off"
                disabled={busy}
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="toolbar">
            <button
              className={
                target.action === "delete_attempt" ? "danger" : "primary"
              }
              disabled={
                busy ||
                reason.trim().length < 3 ||
                (target.action === "delete_attempt" &&
                  confirmation !== target.login)
              }
            >
              {busy ? "Выполняем…" : "Подтвердить"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Отмена
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
