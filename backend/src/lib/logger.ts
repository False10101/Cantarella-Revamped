import pino from "pino";

const nodeEnvironment = process.env.NODE_ENV ?? "development";

export const logger = pino({
  level:
    process.env.LOG_LEVEL ?? (nodeEnvironment === "test" ? "silent" : "info"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
      "authorization",
      "cookie",
      "set-cookie",
      "DATABASE_URL",
      "OPENROUTER_API_KEY",
      "OPENAI_API_KEY",
      "pushToken",
    ],
    censor: "[REDACTED]",
  },
  ...(nodeEnvironment === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            singleLine: true,
            ignore: "pid,hostname,req,res,responseTime,reqId",
          },
        },
      }
    : {}),
});
