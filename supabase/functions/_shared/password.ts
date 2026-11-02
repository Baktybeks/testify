export function providedPassword(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 8 || value.length > 128)
    throw new Error("Пароль должен содержать 8–128 символов");
  return value;
}
