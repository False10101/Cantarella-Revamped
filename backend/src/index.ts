import { createApp } from "./app.js";
import { getEnvironment } from "./config/env.js";
import { startJobWorker } from "./jobs/worker.js";
import { logger } from "./lib/logger.js";
import { startReminderWorker } from "./reminders/reminder-worker.js";

const environment = getEnvironment();
const app = createApp();
const jobWorker = startJobWorker();
const reminderWorker = startReminderWorker();

const server = app.listen(environment.PORT, () => {
  logger.info({ port: environment.PORT }, "Cantarella backend listening");
});

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, "Shutting down Cantarella backend");
  jobWorker.stop();
  reminderWorker.stop();

  server.close((error) => {
    if (error) {
      logger.error({ error }, "Failed to close HTTP server");
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
