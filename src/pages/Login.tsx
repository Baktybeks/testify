import { useState } from "react";
import { studentEmail, supabase } from "../shared/api";
export function Login() {
  const [teacher, setTeacher] = useState(false),
    [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: teacher ? login.trim() : studentEmail(login),
        password,
      });
      if (error) throw error;
    } catch {
      setError("Не удалось войти. Проверьте данные и подключение к сети.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <aside className="login-story">
        <a className="brand" href="#">
          <span className="brand-icon">G</span>Growing Landing
        </a>
        <div>
          <span className="eyebrow">ПРОСТРАНСТВО ДЛЯ ЗНАНИЙ</span>
          <h1>
            Твой следующий
            <br />
            шаг в разработке.
          </h1>
          <p>
            Сосредоточься на вопросах.
            <br />
            Остальное мы организовали.
          </p>
          <div className="story-lines">
            <span>
              01 <b>Войди в свой аккаунт</b>
            </span>
            <span>
              02 <b>Выбери доступный модуль</b>
            </span>
            <span>
              03 <b>Покажи, что умеешь</b>
            </span>
          </div>
        </div>
        <small>Growing Landing · Учебная платформа</small>
      </aside>
      <main className="login-main">
        <section className="login-card">
          <span className="pill">{teacher ? "Преподаватель" : "Студент"}</span>
          <h1>Добро пожаловать</h1>
          <p className="muted">
            {teacher
              ? "Войдите, чтобы управлять экзаменами."
              : "Введите логин и личный код от преподавателя."}
          </p>
          <form onSubmit={submit}>
            <label>
              {teacher ? "Email" : "Логин"}
              <input
                autoComplete="username"
                type={teacher ? "email" : "text"}
                autoCapitalize="none"
                spellCheck={false}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                required
                placeholder={teacher ? "teacher@example.com" : "ivanov_i_i"}
              />
            </label>
            <label>
              {teacher ? "Пароль" : "Личный код"}
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Введите код доступа"
              />
            </label>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? "Входим…" : "Войти и продолжить →"}
            </button>
          </form>
          <p className="login-note">
            Прогресс начатого экзамена сохраняется.
            <br />
            Повторный вход продолжит вашу попытку.
          </p>
          <button
            className="link"
            onClick={() => {
              setTeacher(!teacher);
              setError("");
              setLogin("");
              setPassword("");
            }}
          >
            {teacher ? "← Вход для студента" : "Вход для преподавателя"}
          </button>
        </section>
      </main>
    </div>
  );
}
