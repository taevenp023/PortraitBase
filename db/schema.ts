import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

// Student learning outcomes. Parts reference these by their position (index).
export const slos = pgTable("slos", {
  position: integer().primaryKey(),
  name: text().notNull(),
  description: text().notNull().default(""),
});

export const teams = pgTable("teams", {
  id: text().primaryKey(),
  name: text().notNull(),
  position: integer().notNull().default(0),
});

export const students = pgTable(
  "students",
  {
    id: text().primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text().notNull(),
    position: integer().notNull().default(0),
  },
  (t) => [index("students_team_id_idx").on(t.teamId)],
);

export const assignments = pgTable("assignments", {
  id: text().primaryKey(),
  name: text().notNull(),
  // Legacy assignment-level SLO indices (SLOs now live on each part).
  slos: jsonb().$type<number[]>(),
  collapsed: boolean().notNull().default(false),
  position: integer().notNull().default(0),
});

export const assignmentParts = pgTable(
  "assignment_parts",
  {
    id: text().primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    name: text().notNull(),
    weight: integer().notNull().default(0),
    slos: jsonb().$type<number[]>().notNull().default([]),
    isAssessment: boolean("is_assessment").notNull().default(false),
    requiredAll: boolean("required_all").notNull().default(false),
    position: integer().notNull().default(0),
  },
  (t) => [index("assignment_parts_assignment_id_idx").on(t.assignmentId)],
);

// A student's pick of an assignment part, with the weight they claim.
export const selections = pgTable(
  "selections",
  {
    partId: text("part_id").notNull(),
    studentId: text("student_id").notNull(),
    weight: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.partId, t.studentId] })],
);

export type Pairing = {
  aId?: string;
  aName?: string;
  aTeam?: string;
  bId?: string;
  bName?: string;
  bTeam?: string;
  cId?: string;
  cName?: string;
  cTeam?: string;
  crossTeam?: boolean;
  triangle?: boolean;
  unpaired?: boolean;
};

// Generated peer-assessment pairings for an assessment part.
export const assessmentPairings = pgTable("assessment_pairings", {
  partId: text("part_id").primaryKey(),
  pairings: jsonb().$type<Pairing[]>().notNull(),
});

// SHA-256 hashes of each team's login password.
export const teamPasswords = pgTable("team_passwords", {
  teamId: text("team_id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
});

// Single-row table for dashboard-wide settings.
export const dashboardSettings = pgTable("dashboard_settings", {
  id: integer().primaryKey(),
  masterPasswordHash: text("master_password_hash"),
  // Bumped on every write so browsers can cheaply detect changes.
  revision: integer().notNull().default(0),
});
