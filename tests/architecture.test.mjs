import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const layers = ["shared", "entities", "features", "widgets", "pages", "app"];
test("imports point down through FSD layers; no service secret in frontend", async () => {
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) await walk(f);
      else if (/\.(tsx?|mjs)$/.test(f)) {
        const source = await readFile(f, "utf8");
        assert.ok(!source.includes("SERVICE_ROLE_KEY"));
        const layer = path.relative("src", f).split(path.sep)[0];
        for (const [, target] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          if (!target.startsWith(".")) continue;
          const resolved = path
            .relative("src", path.resolve(path.dirname(f), target))
            .split(path.sep)[0];
          assert.ok(
            layers.indexOf(resolved) <= layers.indexOf(layer),
            `${f} imports ${target}`,
          );
        }
      }
    }
  }
  await walk("src");
});
