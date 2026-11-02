import { useState } from "react";
import type { AdminData, Group, Module } from "../entities/types";
type Props = {
  exam: Module;
  groups: Group[];
  access: AdminData["module_groups"];
  busy: boolean;
  onOpen: (ids: string[]) => Promise<boolean>;
};
export function ExamAdmission({ exam, groups, access, busy, onOpen }: Props) {
  const [selection, setSelection] = useState<string[] | null>(null),
    [confirming, setConfirming] = useState(false);
  const allowed = access
    .filter((a) => a.module_id === exam.id && a.access)
    .map((a) => a.group_id);
  const selected = (selection ?? allowed).filter((id) =>
    groups.some((g) => g.id === id),
  );
  const names = (ids: string[]) =>
    groups
      .filter((g) => ids.includes(g.id))
      .map((g) => g.name)
      .join(", ");
  if (exam.status === "open")
    return (
      <div className="notice">
        <b>Приём открыт: {names(allowed) || "нет разрешённых групп"}</b>
        <p className="admission-note">
          Начало и конец сдачи учитывают окна групп из раздела «Группы».
        </p>
      </div>
    );
  if (!["draft", "closed"].includes(exam.status)) return null;
  return (
    <section
      className="exam-admission"
      aria-label={`Доступ к экзамену ${exam.title}`}
    >
      <h3>Кому открыть экзамен?</h3>
      <fieldset disabled={busy}>
        <legend className="sr-only">Группы с доступом к экзамену</legend>
        <div className="admission-groups">
          {groups.map((g) => (
            <label className="check" key={g.id}>
              <input
                type="checkbox"
                checked={selected.includes(g.id)}
                onChange={(e) => {
                  setSelection(
                    e.target.checked
                      ? [...selected, g.id]
                      : selected.filter((id) => id !== g.id),
                  );
                  setConfirming(false);
                }}
              />
              {g.name}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="muted">
        Выбрано групп: {selected.length}.{" "}
        {groups.length
          ? "Окна сдачи настраиваются в разделе «Группы»."
          : "Сначала создайте группы в разделе «Группы»."}
      </p>
      {!confirming ? (
        <button
          className="primary"
          disabled={busy || !selected.length}
          onClick={() => setConfirming(true)}
        >
          Открыть экзамен для выбранных групп
        </button>
      ) : (
        <div
          className="admission-confirm"
          role="group"
          aria-label="Подтверждение открытия"
        >
          <b>Открыть «{exam.title}»?</b>
          <p>Группы: {names(selected)}</p>
          <p>
            {exam.question_count} вопросов · {exam.seconds_per_question} сек. на
            вопрос · {Number((exam.total_seconds / 60).toFixed(1))} мин. всего ·
            максимум {exam.max_score} баллов
          </p>
          <p className="muted">
            Будут применены сохранённые настройки экзамена и окна выбранных
            групп. Остальные группы не получат доступ.
          </p>
          <div className="toolbar">
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (await onOpen(selected)) {
                  setSelection(null);
                  setConfirming(false);
                }
              }}
            >
              Подтвердить открытие
            </button>
            <button
              className="ghost"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Отмена открытия
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
