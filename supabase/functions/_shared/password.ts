export function providedPassword(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new Error("Пароль должен содержать 12–128 символов");
  return value;
}
