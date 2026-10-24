CREATE TABLE "assessment_pairings" (
	"part_id" text PRIMARY KEY,
	"pairings" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_parts" (
	"id" text PRIMARY KEY,
	"assignment_id" text NOT NULL,
	"name" text NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"slos" jsonb DEFAULT '[]' NOT NULL,
	"is_assessment" boolean DEFAULT false NOT NULL,
	"required_all" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slos" jsonb,
	"collapsed" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_settings" (
	"id" integer PRIMARY KEY,
	"master_password_hash" text,
	"revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selections" (
	"part_id" text,
	"student_id" text,
	"weight" integer NOT NULL,
	CONSTRAINT "selections_pkey" PRIMARY KEY("part_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "slos" (
	"position" integer PRIMARY KEY,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_passwords" (
	"team_id" text PRIMARY KEY,
	"password_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assignment_parts_assignment_id_idx" ON "assignment_parts" ("assignment_id");--> statement-breakpoint
CREATE INDEX "students_team_id_idx" ON "students" ("team_id");--> statement-breakpoint
ALTER TABLE "assignment_parts" ADD CONSTRAINT "assignment_parts_assignment_id_assignments_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;