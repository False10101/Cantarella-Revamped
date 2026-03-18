-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE `cron_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reminder` text NOT NULL,
	`schedule` varchar(255) NOT NULL,
	`next_trigger` datetime NOT NULL,
	`is_recurring` tinyint(1) DEFAULT 0,
	`triggered` tinyint(1) DEFAULT 0,
	`created_at` timestamp DEFAULT 'CURRENT_TIMESTAMP',
	`user_id` int NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`content` longtext NOT NULL,
	`category` varchar(255) DEFAULT 'general',
	`created_at` timestamp DEFAULT 'CURRENT_TIMESTAMP',
	`vector_id` varchar(255),
	`user_id` int NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` longtext NOT NULL,
	`platform` enum('web','telegram','system') NOT NULL,
	`is_proactive` tinyint(1) DEFAULT 0,
	`created_at` timestamp DEFAULT 'CURRENT_TIMESTAMP',
	`user_id` int NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`token` varchar(255) NOT NULL,
	`expires_at` datetime,
	`created_at` timestamp DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`status` varchar(255) DEFAULT 'pending',
	`due_date` datetime,
	`created_at` timestamp DEFAULT 'CURRENT_TIMESTAMP',
	`user_id` int NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_state` (
	`key` varchar(255) NOT NULL,
	`user_id` int NOT NULL DEFAULT 1,
	`value` text,
	`updated_at` datetime DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`google_id` varchar(255) NOT NULL,
	`telegram_id` varchar(255),
	`role` enum('owner','user') DEFAULT 'user',
	`created_at` timestamp DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE INDEX `token` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `name` ON `users` (`name`);--> statement-breakpoint
CREATE INDEX `email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `google_id` ON `users` (`google_id`);--> statement-breakpoint
CREATE INDEX `telegram_id` ON `users` (`telegram_id`);
*/