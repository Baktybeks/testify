// Run with secrets in process environment, never command line arguments.
import { createClient } from "@supabase/supabase-js";
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TEACHER_EMAIL,
  TEACHER_PASSWORD,
  TEACHER_NAME,
} = process.env;
if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !TEACHER_EMAIL ||
  !TEACHER_PASSWORD ||
  TEACHER_PASSWORD.length < 12
)
  throw new Error(
    "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEACHER_EMAIL, TEACHER_PASSWORD (12+ characters), TEACHER_NAME",
  );
const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await client.auth.admin.createUser({
  email: TEACHER_EMAIL,
  password: TEACHER_PASSWORD,
  email_confirm: true,
});
if (error) throw error;
const { error: dbError } = await client.rpc("service_teacher", {
  p_auth_id: data.user.id,
  p_name: TEACHER_NAME || "Преподаватель",
});
if (dbError) {
  await client.auth.admin.deleteUser(data.user.id);
  throw dbError;
}
console.log("Teacher account created.");
