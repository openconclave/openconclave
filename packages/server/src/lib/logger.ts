type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  msg: string;
  timestamp: string;
  [key: string]: unknown;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const RESET = "\x1b[0m";

function formatLog(entry: LogEntry): string {
  const { level, msg, timestamp, ...extra } = entry;
  const color = LEVEL_COLORS[level];
  const extraStr = Object.keys(extra).length > 0
    ? ` ${JSON.stringify(extra)}`
    : "";
  return `${color}[${level.toUpperCase()}]${RESET} ${timestamp} ${msg}${extraStr}`;
}

function createLogFn(level: LogLevel) {
  return (msg: string, extra?: Record<string, unknown>) => {
    const entry: LogEntry = {
      level,
      msg,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    const output = formatLog(entry);

    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  };
}

export const logger = {
  debug: createLogFn("debug"),
  info: createLogFn("info"),
  warn: createLogFn("warn"),
  error: createLogFn("error"),
};
