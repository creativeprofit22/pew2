const fs = require("node:fs/promises");
const path = require("node:path");
const { isIP } = require("node:net");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const resourceName = "pew2_personal_network_security";

/** Only canonical, exact RFC1918 IPv4 literals — never URLs, CIDRs or names. */
function validateLanHost(host) {
  if (typeof host !== "string" || isIP(host) !== 4) {
    throw new Error("PEW2_ANDROID_LAN_HOST must be one private IPv4 address (no URL, port or wildcard)");
  }
  const [a, b] = host.split(".").map(Number);
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) {
    throw new Error("PEW2_ANDROID_LAN_HOST must be in 10/8, 172.16/12 or 192.168/16");
  }
  return host;
}

function withPersonalAndroidLan(config, { host } = {}) {
  // Also validate here: a plugin can be invoked without app.config.js.
  validateLanHost(host);
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const reference = `@xml/${resourceName}`;
    const existing = application.$["android:networkSecurityConfig"];
    if (existing && existing !== reference) {
      throw new Error("Personal LAN policy refuses to replace another Android network security config");
    }
    application.$["android:networkSecurityConfig"] = reference;
    return mod;
  });
  return withDangerousMod(config, ["android", async (mod) => {
    const directory = path.join(mod.modRequest.platformProjectRoot, "app/src/main/res/xml");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, `${resourceName}.xml`), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">${host}</domain>
  </domain-config>
</network-security-config>
`, "utf8");
    return mod;
  }]);
}

module.exports = withPersonalAndroidLan;
module.exports.validateLanHost = validateLanHost;
