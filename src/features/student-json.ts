export type StudentInput = {
  id: string;
  login: string;
  full_name: string;
  group_id: string;
  active: boolean;
  password?: string;
};
export function parseStudentJson(
  text: string,
  commonPassword: string,
  defaultGroup: string,
  groups: ReadonlySet<string>,
): StudentInput[] {
  if (text.length > 1_000_000) throw new Error("JSON больше 1 МБ");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Некорректный JSON. Проверьте кавычки и запятые.");
  }
  if (!Array.isArray(data) || data.length < 1 || data.length > 500)
    throw new Error("Нужен массив от 1 до 500 студентов.");
  const ids = new Set<string>(),
    logins = new Set<string>();
  return data.map((row, index) => {
    const r =
      row && typeof row === "object" && !Array.isArray(row)
        ? (row as Record<string, unknown>)
        : {};
    const string = (...keys: string[]) => {
      for (const key of keys)
        if (typeof r[key] === "string") return r[key] as string;
      return "";
    };
    const login = string("login", "Login").trim().toLowerCase();
    const id = string("id", "StudentID").trim() || login;
    const full_name = string("name", "full_name", "FullName").trim();
    const group_id =
      string("group", "group_id", "GroupID").trim() || defaultGroup;
    const status = string("status", "Status").trim().toLowerCase();
    const password = r.password === undefined ? commonPassword : r.password;
    const fail = (message: string): never => {
      throw new Error(`Запись ${index + 1}: ${message}`);
    };
    if (!/^[a-z0-9_][a-z0-9_.-]{1,63}$/.test(login))
      fail("проверьте логин: 2–64 латинских символа, цифры, _, - или .");
    if (!/^[-a-zA-Z0-9_.]{2,64}$/.test(id))
      fail("проверьте StudentID: 2–64 латинских символа, цифры, _, - или .");
    if (full_name.length < 2 || full_name.length > 150)
      fail("ФИО должно содержать 2–150 символов");
    if (!groups.has(group_id))
      fail("выберите существующую группу в форме или укажите group в записи");
    if (status && !["active", "blocked"].includes(status))
      fail("status должен быть active или blocked");
    if (
      (r.password !== undefined || password !== "") &&
      (typeof password !== "string" ||
        password.length < 8 ||
        password.length > 128)
    )
      fail("пароль должен содержать 8–128 символов");
    if (ids.has(id) || logins.has(login)) fail("повторяется ID или логин");
    ids.add(id);
    logins.add(login);
    return {
      id,
      login,
      full_name,
      group_id,
      active: status !== "blocked",
      ...(password ? { password: password as string } : {}),
    };
  });
}
