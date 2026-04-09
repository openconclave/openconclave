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

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

function createLogFn(level: LogLevel) {
  return (msg: string, extra?: Record<string, unknown>) => {
    if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return;
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
