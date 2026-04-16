import { describe, test, expect } from "bun:test";
import { buildSubprocessEnv } from "../runtime";

function withEnv(overrides: Record<string, string>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k] of Object.entries(overrides)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// ── Normal vars pass through ────────────────────────────────

describe("buildSubprocessEnv: passthrough", () => {
  test("passes PATH", () => {
    withEnv({ PATH: "/usr/bin" }, () => {
      expect(buildSubprocessEnv().PATH).toBe("/usr/bin");
    });
  });

  test("passes HOME", () => {
    withEnv({ HOME: "/home/test" }, () => {
      expect(buildSubprocessEnv().HOME).toBe("/home/test");
    });
  });

  test("passes NODE_ENV", () => {
    withEnv({ NODE_ENV: "production" }, () => {
      expect(buildSubprocessEnv().NODE_ENV).toBe("production");
    });
  });

  test("passes OC_API_URL and OC_WS_URL", () => {
    withEnv({ OC_API_URL: "http://localhost:4000", OC_WS_URL: "ws://localhost:4000/ws" }, () => {
      const env = buildSubprocessEnv();
      expect(env.OC_API_URL).toBe("http://localhost:4000");
      expect(env.OC_WS_URL).toBe("ws://localhost:4000/ws");
    });
  });

  test("passes Windows system vars (any casing)", () => {
    withEnv({ SYSTEMROOT: "C:\\WINDOWS", WINDIR: "C:\\WINDOWS", PROGRAMFILES: "C:\\Program Files" }, () => {
      const env = buildSubprocessEnv();
      expect(env.SYSTEMROOT).toBe("C:\\WINDOWS");
      expect(env.WINDIR).toBe("C:\\WINDOWS");
      expect(env.PROGRAMFILES).toBe("C:\\Program Files");
    });
  });

  test("passes USERPROFILE, APPDATA, LOCALAPPDATA", () => {
    withEnv({ USERPROFILE: "C:\\Users\\test", APPDATA: "C:\\Users\\test\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }, () => {
      const env = buildSubprocessEnv();
      expect(env.USERPROFILE).toBe("C:\\Users\\test");
      expect(env.APPDATA).toBe("C:\\Users\\test\\AppData\\Roaming");
      expect(env.LOCALAPPDATA).toBe("C:\\Users\\test\\AppData\\Local");
    });
  });

  test("passes TMP and TEMP", () => {
    withEnv({ TMP: "/tmp", TEMP: "/tmp" }, () => {
      const env = buildSubprocessEnv();
      expect(env.TMP).toBe("/tmp");
      expect(env.TEMP).toBe("/tmp");
    });
  });
});

// ── Secret blocking ─────────────────────────────────────────

describe("buildSubprocessEnv: blocks secrets", () => {
  const SECRETS: [string, string][] = [
    ["DATABASE_URL", "postgres://user:pass@host/db"],
    ["REDIS_URL", "redis://localhost:6379"],
    ["MONGO_URI", "mongodb://host/db"],
    ["MONGODB_URI", "mongodb+srv://user:pass@cluster.mongodb.net/db"],
    ["MONGODB_URL", "mongodb+srv://user:pass@cluster.mongodb.net/db"],
    ["SESSION_SECRET", "super-secret"],
    ["JWT_SECRET", "jwt-secret"],
    ["APP_SECRET", "app-secret"],
    ["ENCRYPTION_SECRET", "enc-secret"],
    ["DB_PASSWORD", "dbpass"],
    ["ADMIN_PASSWORD", "adminpass"],
    ["AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE"],
    ["AWS_SECRET_ACCESS_KEY", "aws-secret"],
    ["AWS_SESSION_TOKEN", "aws-session"],
    ["AZURE_CLIENT_SECRET", "azure-client"],
    ["GCP_PRIVATE_KEY", "-----BEGIN RSA-----"],
    ["GOOGLE_APPLICATION_CREDENTIALS", "/path/to/creds.json"],
    ["NPM_CONFIG__AUTH", "base64-auth"],
    ["NPM_CONFIG_AUTHTOKEN", "npm-token"],
    ["SSH_AUTH_SOCK", "/tmp/ssh-agent.sock"],
    ["KUBECONFIG", "/home/user/.kube/config"],
    ["SENTRY_DSN", "https://key@sentry.io/project"],
    ["GITHUB_PAT", "ghp_personal_access_token"],
    ["OPENAI_API_KEY", "sk-openai"],
    ["GITHUB_TOKEN", "ghp_test"],
    ["TELEGRAM_BOT_TOKEN", "123456:ABC"],
    ["STRIPE_SECRET_KEY", "sk_live_test"],
    ["SSH_PRIVATE_KEY", "-----BEGIN OPENSSH-----"],
    ["AWS_CREDENTIAL", "cred-value"],
  ];

  for (const [key, value] of SECRETS) {
    test(`blocks ${key}`, () => {
      withEnv({ [key]: value }, () => {
        expect(buildSubprocessEnv()).not.toHaveProperty(key);
      });
    });
  }
});

// ── Auth credentials blocked too ─────────────────────────────
// System claude binary handles its own OAuth. No API keys needed in subprocess.

describe("buildSubprocessEnv: blocks auth credentials", () => {
  test("blocks ANTHROPIC_API_KEY", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () => {
      expect(buildSubprocessEnv()).not.toHaveProperty("ANTHROPIC_API_KEY");
    });
  });

  test("blocks CLAUDE_CODE_OAUTH_TOKEN", () => {
    withEnv({ CLAUDE_CODE_OAUTH_TOKEN: "oauth-tok" }, () => {
      expect(buildSubprocessEnv()).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    });
  });
});

// ── Extra parameter ─────────────────────────────────────────

describe("buildSubprocessEnv: extra parameter", () => {
  test("merges extra into output", () => {
    const env = buildSubprocessEnv({ CUSTOM_VAR: "custom" });
    expect(env.CUSTOM_VAR).toBe("custom");
  });

  test("extra overrides env values", () => {
    withEnv({ NODE_ENV: "production" }, () => {
      expect(buildSubprocessEnv({ NODE_ENV: "test" }).NODE_ENV).toBe("test");
    });
  });

  test("defaults to empty when no extra given", () => {
    const env = buildSubprocessEnv();
    expect(typeof env).toBe("object");
  });

  test("filters blocked keys out of extra (can't smuggle secrets through extra)", () => {
    const env = buildSubprocessEnv({
      AWS_ACCESS_KEY_ID: "AKIA-leaked",
      SESSION_SECRET: "leaked",
      NORMAL_VAR: "ok",
    });
    expect(env).not.toHaveProperty("AWS_ACCESS_KEY_ID");
    expect(env).not.toHaveProperty("SESSION_SECRET");
    expect(env.NORMAL_VAR).toBe("ok");
  });
});

// ── Pattern matching ────────────────────────────────────────

describe("buildSubprocessEnv: pattern robustness", () => {
  test("blocks all vars ending in _KEY", () => {
    withEnv({ SOME_RANDOM_KEY: "value", ANTHROPIC_API_KEY: "sk-ant", OPENAI_API_KEY: "sk-oai" }, () => {
      const env = buildSubprocessEnv();
      expect(env).not.toHaveProperty("SOME_RANDOM_KEY");
      expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(env).not.toHaveProperty("OPENAI_API_KEY");
    });
  });

  test("blocks all vars ending in _TOKEN", () => {
    withEnv({ SLACK_BOT_TOKEN: "xoxb-test", CLAUDE_CODE_OAUTH_TOKEN: "oauth", GITHUB_TOKEN: "ghp" }, () => {
      const env = buildSubprocessEnv();
      expect(env).not.toHaveProperty("SLACK_BOT_TOKEN");
      expect(env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
      expect(env).not.toHaveProperty("GITHUB_TOKEN");
    });
  });

  test("blocks vars containing SECRET regardless of position", () => {
    withEnv({ MY_SECRET_VALUE: "s1", SECRET_THING: "s2", THING_SECRET: "s3" }, () => {
      const env = buildSubprocessEnv();
      expect(env).not.toHaveProperty("MY_SECRET_VALUE");
      expect(env).not.toHaveProperty("SECRET_THING");
      expect(env).not.toHaveProperty("THING_SECRET");
    });
  });

  test("blocks vars containing PASSWORD regardless of case", () => {
    withEnv({ db_password: "p1", DB_PASSWORD: "p2" }, () => {
      const env = buildSubprocessEnv();
      expect(env).not.toHaveProperty("db_password");
      expect(env).not.toHaveProperty("DB_PASSWORD");
    });
  });

  test("does not block innocent vars that happen to be short", () => {
    withEnv({ EDITOR: "vim", SHELL: "/bin/bash", TERM: "xterm", LANG: "en_US.UTF-8" }, () => {
      const env = buildSubprocessEnv();
      expect(env.EDITOR).toBe("vim");
      expect(env.SHELL).toBe("/bin/bash");
      expect(env.TERM).toBe("xterm");
      expect(env.LANG).toBe("en_US.UTF-8");
    });
  });
});
