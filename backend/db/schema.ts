import { mysqlTable, mysqlSchema, AnyMySqlColumn, int, tinyint, text, varchar, datetime, timestamp, longtext, mysqlEnum, index } from "drizzle-orm/mysql-core"
import { sql } from "drizzle-orm"

export const cronJobs = mysqlTable("cron_jobs", {
	id: int().autoincrement().notNull(),
	reminder: text().notNull(),
	schedule: varchar({ length: 255 }).notNull(),
	nextTrigger: datetime("next_trigger", { mode: 'string'}).notNull(),
	isRecurring: tinyint("is_recurring").default(0),
	triggered: tinyint().default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	userId: int("user_id").notNull(),
});

export const memories = mysqlTable("memories", {
	id: int().autoincrement().notNull(),
	content: longtext().notNull(),
	category: varchar({ length: 255 }).default('general'),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	vectorId: varchar("vector_id", { length: 255 }),
	userId: int("user_id").notNull(),
});

export const messages = mysqlTable("messages", {
	id: int().autoincrement().notNull(),
	role: mysqlEnum(['user','assistant','system']).notNull(),
	content: longtext().notNull(),
	platform: mysqlEnum(['web','telegram','system']).notNull(),
	isProactive: tinyint("is_proactive").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	userId: int("user_id").notNull(),
});

export const sessions = mysqlTable("sessions", {
	id: int().autoincrement().notNull(),
	userId: int("user_id").notNull(),
	token: varchar({ length: 255 }).notNull(),
	expiresAt: datetime("expires_at", { mode: 'string'}),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("token").on(table.token),
]);

export const tasks = mysqlTable("tasks", {
	id: int().autoincrement().notNull(),
	title: varchar({ length: 255 }).notNull(),
	status: varchar({ length: 255 }).default('pending'),
	dueDate: datetime("due_date", { mode: 'string'}),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	userId: int("user_id").notNull(),
});

export const userState = mysqlTable("user_state", {
	key: varchar({ length: 255 }).notNull(),
	userId: int("user_id").default(1).notNull(),
	value: text(),
	updatedAt: datetime("updated_at", { mode: 'string'}).default(sql`(CURRENT_TIMESTAMP)`),
});

export const users = mysqlTable("users", {
	id: int().autoincrement().notNull(),
	name: varchar({ length: 255 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	googleId: varchar("google_id", { length: 255 }).notNull(),
	telegramId: varchar("telegram_id", { length: 255 }),
	role: mysqlEnum(['owner','user']).default('user'),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("name").on(table.name),
	index("email").on(table.email),
	index("google_id").on(table.googleId),
	index("telegram_id").on(table.telegramId),
]);
