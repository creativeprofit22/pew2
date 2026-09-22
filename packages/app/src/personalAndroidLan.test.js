import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileModsAsync, withPlugins } from "expo/config-plugins";
import appConfig from "../app.config.js";
import appJson from "../app.json";
import withPersonalAndroidLan from "../plugins/withPersonalAndroidLan.js";

function configWithHost(host) {
  const previous = process.env.PEW2_ANDROID_LAN_HOST;
  try {
    if (host === undefined) delete process.env.PEW2_ANDROID_LAN_HOST;
    else process.env.PEW2_ANDROID_LAN_HOST = host;
    return appConfig();
  } finally {
    if (previous === undefined) delete process.env.PEW2_ANDROID_LAN_HOST;
    else process.env.PEW2_ANDROID_LAN_HOST = previous;
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "personal-lan-"));
  const main = join(root, "android/app/src/main");
  mkdirSync(main, { recursive: true });
  writeFileSync(join(main, "AndroidManifest.xml"), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="io.github.kenkaiii.pew2">
  <application android:name=".MainApplication" android:label="pew2" />
</manifest>`);
  return {
    root,
    manifest: join(main, "AndroidManifest.xml"),
    policy: join(main, "res/xml/pew2_personal_network_security.xml"),
  };
}

async function generate(target, host, twice = false) {
  const configured = configWithHost(host);
  // Use the actual app.config.js registration, but not unrelated native plugins.
  const personal = configured.plugins.filter((entry) =>
    Array.isArray(entry) && entry[0] === "./plugins/withPersonalAndroidLan");
  let config = { name: configured.name, slug: configured.slug, _internal: { projectRoot: target.root } };
  config = withPlugins(config, personal.map(([, options]) => [withPersonalAndroidLan, options]));
  if (twice) config = withPersonalAndroidLan(config, { host });
  await compileModsAsync(config, { projectRoot: target.root, platforms: ["android"] });
}

describe("personal Android LAN build opt-in", () => {
  test("absent opt-in leaves upstream plugins and native defaults untouched", async () => {
    expect(configWithHost(undefined).plugins).toEqual(appJson.expo.plugins);
    const target = fixture();
    const before = readFileSync(target.manifest, "utf8");
    await generate(target, undefined);
    expect(readFileSync(target.manifest, "utf8")).toBe(before);
    expect(existsSync(target.policy)).toBe(false);
  });

  for (const host of ["10.1.2.3", "172.16.1.2", "172.31.254.1", "192.168.50.7"]) {
    test(`generates exact deny-by-default policy for ${host}`, async () => {
      const target = fixture();
      await generate(target, host);
      expect(readFileSync(target.policy, "utf8")).toBe(`<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">${host}</domain>
  </domain-config>
</network-security-config>
`);
      const manifest = readFileSync(target.manifest, "utf8");
      expect(manifest).toContain('android:networkSecurityConfig="@xml/pew2_personal_network_security"');
      expect(manifest).not.toContain("usesCleartextTraffic");
      expect(manifest).toContain('android:label="pew2"');
    });
  }

  test("repeated registration and generation are idempotent; a new host replaces the old one", async () => {
    const target = fixture();
    await generate(target, "192.168.50.7");
    const manifest = readFileSync(target.manifest, "utf8");
    const policy = readFileSync(target.policy, "utf8");
    await generate(target, "192.168.50.7", true);
    expect(readFileSync(target.manifest, "utf8")).toBe(manifest);
    expect(readFileSync(target.policy, "utf8")).toBe(policy);
    await generate(target, "10.2.3.4");
    expect(readFileSync(target.policy, "utf8")).toContain(">10.2.3.4</domain>");
    expect(readFileSync(target.policy, "utf8")).not.toContain("192.168.50.7");
  });

  for (const host of ["", " ", "8.8.8.8", "127.0.0.1", "0.0.0.0", "169.254.1.2",
    "172.15.1.2", "172.32.1.2", "192.169.1.2", "224.0.0.1", "255.255.255.255",
    "192.168.1.256", "192.168.01.2", "192.168.1", "3232235778", "0xc0a80102",
    "192.168.1.2\n", " 192.168.1.2", "192.168.1.2:8787", "ws://192.168.1.2",
    "192.168.1.0/24", "192.168.*.*", "*.home", "localhost", "::1", "::ffff:192.168.1.2",
    '192.168.1.2</domain><domain>8.8.8.8']) {
    test(`rejects invalid opt-in ${JSON.stringify(host)}`, () => {
      expect(() => configWithHost(host)).toThrow("PEW2_ANDROID_LAN_HOST");
      expect(() => withPersonalAndroidLan({}, { host })).toThrow("PEW2_ANDROID_LAN_HOST");
    });
  }

  test("refuses to silently replace an unrelated network policy", async () => {
    const target = fixture();
    writeFileSync(target.manifest, readFileSync(target.manifest, "utf8").replace(
      'android:label="pew2"', 'android:label="pew2" android:networkSecurityConfig="@xml/other_policy"'));
    await expect(generate(target, "10.1.2.3")).rejects.toThrow("refuses to replace");
    expect(readFileSync(target.manifest, "utf8")).toContain("@xml/other_policy");
  });
});
