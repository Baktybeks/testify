import { createClient } from "@supabase/supabase-js";
import publicConfig from "./public-config.json";
const url = import.meta.env.VITE_SUPABASE_URL || publicConfig.url;
const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY || publicConfig.publishableKey;
export const configured = Boolean(url && key && !url.includes("YOUR_PROJECT"));
export const supabase = createClient(
  configured ? url : "https://example.supabase.co",
  configured ? key : "not-configured",
);
export async function rpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function accountAction(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("manage-account", {
    body,
  });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  return data as { code?: string; id?: string };
}
export const studentEmail = (login: string) =>
  `${login.trim().toLowerCase()}@students.testify.invalid`;
