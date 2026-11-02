import config from "../src/shared/public-config.json" with { type: "json" };
const headers = {
  apikey: config.publishableKey,
  "Content-Type": "application/json",
};
const settings = await fetch(config.url + "/auth/v1/settings", { headers });
if (!settings.ok) throw new Error("Auth settings endpoint: " + settings.status);
const auth = await settings.json();
console.log(
  JSON.stringify({ authReachable: true, disableSignup: auth.disable_signup }),
);
const rpc = await fetch(config.url + "/rest/v1/rpc/admin_data", {
  method: "POST",
  headers,
  body: "{}",
});
if (rpc.status !== 401 && rpc.status !== 403)
  throw new Error(
    "Anonymous admin RPC access unexpectedly returned " + rpc.status,
  );
console.log("Anonymous admin access denied: " + rpc.status);
const edge = await fetch(config.url + "/functions/v1/manage-account", {
  method: "POST",
  headers: { ...headers, Origin: "https://baktybeks.github.io" },
  body: "{}",
});
if (edge.status !== 401)
  throw new Error(
    "Unauthenticated Edge access unexpectedly returned " + edge.status,
  );
console.log("Unauthenticated account management denied: " + edge.status);
