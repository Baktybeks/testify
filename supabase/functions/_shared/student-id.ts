export function resolveStudentId(value: unknown): string {
  if (value === undefined || value === "") return crypto.randomUUID();
  if (typeof value !== "string" || !/^[-a-zA-Z0-9_.]{2,64}$/.test(value))
    throw new Error("Некорректный идентификатор студента");
  return value;
}
