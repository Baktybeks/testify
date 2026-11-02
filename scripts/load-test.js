import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
const users = new SharedArray("accounts", () =>
  JSON.parse(open(__ENV.ACCOUNTS || "../private/load-accounts.json")),
);
export const options = {
  scenarios: {
    exam: {
      executor: "per-vu-iterations",
      vus: Number(__ENV.VUS || 150),
      iterations: 1,
      maxDuration: "15m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    "http_req_duration{kind:rpc}": ["p(95)<500"],
  },
};
const base = __ENV.SUPABASE_URL,
  key = __ENV.SUPABASE_ANON_KEY,
  moduleId = __ENV.MODULE_ID;
function rpc(name, body, token) {
  const r = http.post(`${base}/rest/v1/rpc/${name}`, JSON.stringify(body), {
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    tags: { kind: "rpc", operation: name },
  });
  check(r, { [`${name} OK`]: (r) => r.status === 200 });
  if (r.status !== 200) throw new Error(`RPC ${name}: ${r.status}`);
  return r.json();
}
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}
export default function () {
  const account = users[__VU - 1];
  if (!account) throw new Error("One unique account per VU required");
  const login = http.post(
    `${base}/auth/v1/token?grant_type=password`,
    JSON.stringify({
      email: `${account.login}@students.testify.invalid`,
      password: account.code,
    }),
    {
      headers: { apikey: key, "Content-Type": "application/json" },
      tags: { kind: "auth" },
    },
  );
  check(login, { "login OK": (r) => r.status === 200 });
  if (login.status !== 200) return;
  const token = login.json("access_token");
  let state = rpc("attempt_start_or_resume", { p_module_id: moduleId }, token);
  const start = rpc(
    "attempt_start_or_resume",
    { p_module_id: moduleId },
    token,
  );
  check(start, { "same attempt": (s) => s.attempt_id === state.attempt_id });
  while (!state.done) {
    sleep(Number(__ENV.ANSWER_DELAY || 25));
    const command = {
      p_attempt_id: state.attempt_id,
      p_position: state.index,
      p_option_id: state.options[0].id,
      p_key: uuid(),
    };
    state = rpc("attempt_submit_answer", command, token);
    const retry = rpc("attempt_submit_answer", command, token);
    check(retry, {
      "duplicate stable": (s) =>
        s.index === state.index && s.done === state.done,
    });
    state = rpc("attempt_current", { p_attempt_id: state.attempt_id }, token);
  }
  check(state, {
    finished: (s) => s.done,
    "grade hidden": (s) => !s.published && s.score === undefined,
  });
}
