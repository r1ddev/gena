CREATE TYPE "public"."purchase_status" AS ENUM('open', 'completed');--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "status" "purchase_status" DEFAULT 'open' NOT NULL;