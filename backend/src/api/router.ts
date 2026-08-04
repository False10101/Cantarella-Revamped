import { Router } from "express";

import {
  createAccountService,
  type AccountService,
} from "./account/account.service.js";
import { createAccountRouter } from "./account/account.routes.js";
import { createConversationRouter } from "./conversations/conversation.routes.js";
import {
  createConversationService,
  type ConversationService,
} from "./conversations/conversation.service.js";
import { createMemoryRouter } from "./memories/memory.routes.js";
import {
  createMemoryService,
  type MemoryService,
} from "./memories/memory.service.js";
import { createReminderRouter } from "./reminders/reminder.routes.js";
import {
  createReminderService,
  type ReminderService,
} from "./reminders/reminder.service.js";

export interface ApiRouterDependencies {
  accountService?: AccountService;
  conversationService?: ConversationService;
  memoryService?: MemoryService;
  reminderService?: ReminderService;
}

export function createApiRouter(
  dependencies: ApiRouterDependencies = {},
): Router {
  const router = Router();
  const accountService = dependencies.accountService ?? createAccountService();
  const conversationService =
    dependencies.conversationService ?? createConversationService();
  const memoryService = dependencies.memoryService ?? createMemoryService();
  const reminderService =
    dependencies.reminderService ?? createReminderService();

  router.use(createAccountRouter(accountService));
  router.use(createConversationRouter(conversationService));
  router.use(createMemoryRouter(memoryService));
  router.use(createReminderRouter(reminderService));

  return router;
}
