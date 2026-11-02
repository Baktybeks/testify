import readXlsxFile from "read-excel-file";
import type { Question } from "../entities/types";
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw new Error("Незакрытая кавычка CSV");
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export async function readRows(
  file: File,
  sheet: string,
): Promise<Record<string, string>[]> {
  if (file.size > 5_000_000) throw new Error("Файл больше 5 МБ");
  const rows = file.name.toLowerCase().endsWith(".xlsx")
    ? (await readXlsxFile(file, { sheet })).map((r) =>
        r.map((v) => (v === null ? "" : String(v))),
      )
    : parseCsv((await file.text()).replace(/^\uFEFF/, ""));
  const headers = rows.shift();
  if (!headers) throw new Error("Пустой файл");
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) =>
      Object.fromEntries(headers.map((h, i) => [h.trim(), r[i]?.trim() || ""])),
    );
}
export function validateQuestions(rows: Record<string, string>[]): {
  questions: Question[];
  errors: string[];
} {
  const errors: string[] = [],
    seen = new Set<string>();
  const questions = rows.map((r, i) => {
    const options = [r.OptionA, r.OptionB, r.OptionC, r.OptionD];
    const correct = "ABCD".indexOf(r.CorrectOption?.toUpperCase());
    if (!r.QuestionID || seen.has(r.QuestionID))
      errors.push(`Строка ${i + 2}: пустой или повторный QuestionID`);
    seen.add(r.QuestionID);
    if (
      !r.Question ||
      !r.Lecture ||
      options.some((v) => !v) ||
      new Set(options).size !== 4 ||
      correct < 0 ||
      r.CorrectOption?.length !== 1
    )
      errors.push(
        `Строка ${i + 2}: проверьте текст, тему, четыре разных варианта и CorrectOption A–D`,
      );
    return {
      external_id: r.QuestionID,
      lecture: r.Lecture,
      difficulty: r.Difficulty || "normal",
      text: r.Question,
      options,
      correct,
      active: !["false", "0"].includes(r.Active?.toLowerCase()),
    };
  });
  if (!questions.length) errors.push("Нет вопросов");
  return { questions, errors };
}
export function downloadCsv(name: string, rows: unknown[][]) {
  const safe = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + rows.map((r) => r.map(safe).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadXlsx(name: string, rows: unknown[][]) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const cells = rows.map((row, index) =>
    row.map((value) => ({
      value: typeof value === "number" ? value : String(value ?? ""),
      type: typeof value === "number" ? Number : String,
      ...(index === 0
        ? { fontWeight: "bold" as const, backgroundColor: "#EDF1FF" }
        : {}),
    })),
  );
  await writeXlsxFile(cells, {
    sheet: "Результаты",
    columns: rows[0].map(() => ({ width: 22 })),
  }).toFile(name);
}
