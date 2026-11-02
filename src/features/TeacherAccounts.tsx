import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { accountAction, rpc } from "../shared/api";
type Staff = {
  id: string;
  full_name: string;
  email: string | null;
  role: "teacher" | "superadmin";
  active: boolean;
  created_at: string;
};
export function TeacherAccounts({ user }: { user: string }) {
  const list = useQuery({
    queryKey: ["teachers", user],
    queryFn: () => rpc<Staff[]>("superadmin_teachers"),
  });
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const running = useRef(false);
  return (
    <>
      <section className="card">
        <h2>Создать преподавателя</h2>
        <p className="muted">
          Новый аккаунт получит обычную роль «Преподаватель» и вход по email и
          паролю. Создавать преподавателей может только суперадмин.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (running.current) return;
            running.current = true;
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const address = email.trim().toLowerCase();
              await accountAction({
                action: "create-teacher",
                full_name: name.trim(),
                email: address,
                password,
              });
              setName("");
              setEmail("");
              setPassword("");
              setMessage(
                `Преподаватель ${address} создан. Передайте ему email и заданный пароль.`,
              );
            } catch (e) {
              setError(
                (e as Error).message +
                  " Проверьте список перед повторной отправкой.",
              );
            } finally {
              await list.refetch();
              setBusy(false);
              running.current = false;
            }
          }}
        >
          <fieldset disabled={busy}>
            <div className="fields">
              <label>
                ФИО преподавателя
                <input
                  required
                  minLength={2}
                  maxLength={150}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Email преподавателя
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoCapitalize="none"
                  autoComplete="off"
                />
              </label>
              <label>
                Пароль преподавателя
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Не менее 8 символов"
                />
              </label>
            </div>
            <button className="primary">
              {busy ? "Создаём…" : "Создать преподавателя"}
            </button>
          </fieldset>
        </form>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </section>
      <section className="card">
        <div className="space">
          <h2>Преподаватели и суперадмины</h2>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void list.refetch()}
          >
            Обновить список
          </button>
        </div>
        {list.isPending ? (
          <p role="status">Загружаем список…</p>
        ) : list.error ? (
          <p className="alert" role="alert">
            {list.error.message}
          </p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>ФИО</th>
                  <th>Email</th>
                  <th>Роль</th>
                  <th>Доступ</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.map((s) => (
                  <tr key={s.id}>
                    <td>{s.full_name}</td>
                    <td>{s.email || "—"}</td>
                    <td>
                      {s.role === "superadmin" ? "Суперадмин" : "Преподаватель"}
                    </td>
                    <td>{s.active ? "Активен" : "Заблокирован"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
