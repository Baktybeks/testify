import { useState } from "react";
import type { AdminData } from "../entities/types";
type Props = Pick<AdminData, "subjects" | "course_modules"> & {
  busy: boolean;
  save: (action: string, data: Record<string, unknown>) => void;
};
export function CatalogManager({
  subjects,
  course_modules,
  busy,
  save,
}: Props) {
  const [subjectId, setSubjectId] = useState(""),
    [name, setName] = useState("");
  const [moduleId, setModuleId] = useState(""),
    [parent, setParent] = useState(""),
    [title, setTitle] = useState(""),
    [position, setPosition] = useState(1);
  return (
    <>
      <section className="card">
        <h2>Дисциплины</h2>
        <p className="muted">
          Например, Web-разработка и UX/UI. Учебные модули и экзамены хранятся
          внутри своей дисциплины.
        </p>
        <form
          className="fields"
          onSubmit={(e) => {
            e.preventDefault();
            save("save_subject", { id: subjectId || null, name });
          }}
        >
          <label>
            Название дисциплины
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button disabled={busy} className="primary">
            {subjectId ? "Сохранить дисциплину" : "Добавить дисциплину"}
          </button>
          {subjectId && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setSubjectId("");
                setName("");
              }}
            >
              Отмена
            </button>
          )}
        </form>
        {subjects.map((s) => (
          <div className="module-row" key={s.id}>
            <b>{s.name}</b>
            <button
              className="secondary"
              onClick={() => {
                setSubjectId(s.id);
                setName(s.name);
              }}
            >
              Переименовать
            </button>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Учебные модули</h2>
        <form
          className="fields"
          onSubmit={(e) => {
            e.preventDefault();
            save("save_course_module", {
              id: moduleId || null,
              subject_id: parent,
              title,
              position,
            });
          }}
        >
          <label>
            Дисциплина учебного модуля
            <select
              required
              disabled={!!moduleId}
              value={parent}
              onChange={(e) => setParent(e.target.value)}
            >
              <option value="">Выберите дисциплину</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Название учебного модуля
            <input
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Модуль 1"
            />
          </label>
          <label>
            Порядковый номер
            <input
              type="number"
              required
              min={1}
              max={1000}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
            />
          </label>
          <button className="primary" disabled={busy}>
            {moduleId ? "Сохранить учебный модуль" : "Добавить учебный модуль"}
          </button>
          {moduleId && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setModuleId("");
                setTitle("");
              }}
            >
              Отмена
            </button>
          )}
        </form>
        {subjects.map((s) => (
          <div key={s.id}>
            <h3>{s.name}</h3>
            {course_modules
              .filter((c) => c.subject_id === s.id)
              .map((c) => (
                <div className="module-row" key={c.id}>
                  <span>{c.title}</span>
                  <button
                    className="secondary"
                    onClick={() => {
                      setModuleId(c.id);
                      setParent(c.subject_id);
                      setTitle(c.title);
                      setPosition(c.position);
                    }}
                  >
                    Изменить модуль
                  </button>
                </div>
              ))}
          </div>
        ))}
      </section>
    </>
  );
}
