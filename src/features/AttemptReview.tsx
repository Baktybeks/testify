import { useQuery } from "@tanstack/react-query";
import { rpc } from "../shared/api";
type Review = {
  position: number;
  text: string;
  options: { id: string; text: string }[];
  correct_id: string;
  selected_id: string | null;
  correct: boolean | null;
  received_at: string | null;
};
export function AttemptReview({
  attemptId,
  user,
}: {
  attemptId: string;
  user: string;
}) {
  const review = useQuery({
    queryKey: ["attempt-review", user, attemptId],
    queryFn: () =>
      rpc<Review[]>("admin_attempt_review", { p_attempt_id: attemptId }),
    staleTime: 0,
  });
  return (
    <section aria-label="Ответы студента">
      <h3>Ответы студента</h3>
      <p className="muted">
        Вопросы и варианты сохранены в момент начала попытки.
      </p>
      {review.isPending ? (
        <p role="status">Загружаем ответы…</p>
      ) : review.error ? (
        <p className="alert" role="alert">
          {review.error.message}
          <button onClick={() => void review.refetch()}>Повторить</button>
        </p>
      ) : (
        review.data?.map((q) => (
          <article className="attempt-review-question" key={q.position}>
            <h4>
              {q.position}. {q.text}
            </h4>
            <p>
              <b
                className={
                  !q.selected_id || !q.correct
                    ? "review-status-incorrect"
                    : undefined
                }
              >
                {!q.selected_id
                  ? "Нет ответа"
                  : q.correct
                    ? "Верно"
                    : "Неверно"}
              </b>
            </p>
            <ul>
              {q.options.map((o) => (
                <li
                  key={o.id}
                  className={
                    o.id === q.correct_id
                      ? "review-correct"
                      : o.id === q.selected_id
                        ? "review-incorrect"
                        : ""
                  }
                >
                  {o.text}
                  {o.id === q.selected_id && <strong> — ответ студента</strong>}
                  {o.id === q.correct_id && (
                    <strong> — правильный ответ</strong>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))
      )}
    </section>
  );
}
