import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { configured, rpc, supabase } from "../shared/api";
import type { Profile } from "../entities/types";
import { Login } from "../pages/Login";
import { StudentPage } from "../pages/StudentPage";
const TeacherPage = lazy(() =>
  import("../pages/TeacherPage").then((m) => ({ default: m.TeacherPage })),
);
import "./styles.css";
const cache = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
function App() {
  const [user, setUser] = useState<string | null>(null),
    [initial, setInitial] = useState(true);
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser((previous) => {
        if (previous !== (session?.user.id || null)) cache.clear();
        return session?.user.id || null;
      });
      setInitial(false);
    });
    return () => subscription.unsubscribe();
  }, []);
  const profile = useQuery({
    queryKey: ["profile", user],
    queryFn: () => rpc<Profile>("my_profile"),
    enabled: !!user,
  });
  if (!configured)
    return (
      <main className="setup card">
        <span className="eyebrow">exam-platform</span>
        <h1>Подключим экзамены</h1>
        <p>
          Приложение собрано. Для работы подключите Supabase по инструкции в
          README.
        </p>
        <ol>
          <li>Примените миграции базы.</li>
          <li>Создайте аккаунт преподавателя.</li>
          <li>Укажите VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в .env.</li>
        </ol>
        <p className="muted">
          Данные и оценки появятся после подключения. Демонстрационные
          результаты не используются.
        </p>
      </main>
    );
  if (initial)
    return (
      <main className="setup">
        <p role="status">Восстанавливаем сессию…</p>
      </main>
    );
  if (!user) return <Login />;
  return (
    <>
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-icon">E</span>
          <span>
            exam-platform<small>Платформа экзаменов</small>
          </span>
        </a>
        <div className="identity">
          <span>{profile.data?.full_name}</span>
          <button
            className="ghost"
            onClick={() => void supabase.auth.signOut()}
          >
            Выйти
          </button>
        </div>
      </header>
      <Suspense fallback={<main>Загружаем панель…</main>}>
        {profile.isPending ? (
          <main>
            <p role="status">Проверяем доступ…</p>
          </main>
        ) : profile.error ? (
          <main>
            <div className="alert">{profile.error.message}</div>
            <button onClick={() => void profile.refetch()}>Повторить</button>
          </main>
        ) : !profile.data?.active ? (
          <main>
            <div className="alert">
              Аккаунт заблокирован. Обратитесь к преподавателю.
            </div>
          </main>
        ) : profile.data.role === "teacher" ? (
          <TeacherPage user={user} />
        ) : (
          <StudentPage user={user} />
        )}
      </Suspense>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={cache}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
