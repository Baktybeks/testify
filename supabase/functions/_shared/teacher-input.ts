import { providedPassword } from "./password.ts";
export function teacherInput(body: Record<string, unknown>) {
  const full_name =
    typeof body.full_name === "string" ? body.full_name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = providedPassword(body.password);
  if (
    full_name.length < 2 ||
    full_name.length > 150 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw new Error("Укажите ФИО (2–150 символов) и корректный email");
  if (!password)
    throw new Error("Задайте пароль преподавателя: 8–128 символов");
  return { full_name, email, password };
}
