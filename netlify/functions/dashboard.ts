import type { Config, Context } from "@netlify/functions";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  slos,
  teams,
  students,
  assignments,
  assignmentParts,
  selections,
  assessmentPairings,
  teamPasswords,
  dashboardSettings,
  type Pairing,
} from "../../db/schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type DashboardState = {
  teams: { id: string; name: string; students?: { id: string; name: string }[] }[];
  slos: string[];
  sloDescriptions?: string[];
  assignments: {
    id: string;
    name: string;
    slos?: number[];
    collapsed?: boolean;
    parts: {
      id: string;
      name: string;
      weight?: number;
      slos?: number[];
      isAssessment?: boolean;
      requiredAll?: boolean;
    }[];
  }[];
  assessmentPairings?: Record<string, Pairing[]>;
  teamPasswords?: Record<string, string>;
  masterPassword?: string | null;
};

type SelectionMap = Record<string, { weight: number }>;

const SETTINGS_ID = 1;

async function getRevision(): Promise<number> {
  const [row] = await db
    .select({ revision: dashboardSettings.revision })
    .from(dashboardSettings)
    .where(eq(dashboardSettings.id, SETTINGS_ID));
  return row?.revision ?? 0;
}

async function bumpRevision(tx: Tx, masterPassword?: string | null) {
  const set: Record<string, unknown> = { revision: sql`${dashboardSettings.revision} + 1` };
  if (masterPassword !== undefined) set.masterPasswordHash = masterPassword;
  const [row] = await tx
    .insert(dashboardSettings)
    .values({ id: SETTINGS_ID, masterPasswordHash: masterPassword ?? null, revision: 1 })
    .onConflictDoUpdate({ target: dashboardSettings.id, set })
    .returning({ revision: dashboardSettings.revision });
  return row.revision;
}

// Rebuilds the nested document shape the dashboard works with.
async function loadState() {
  const [
    sloRows,
    teamRows,
    studentRows,
    assignmentRows,
    partRows,
    selectionRows,
    pairingRows,
    passwordRows,
    settingsRows,
  ] = await Promise.all([
    db.select().from(slos).orderBy(asc(slos.position)),
    db.select().from(teams).orderBy(asc(teams.position)),
    db.select().from(students).orderBy(asc(students.position)),
    db.select().from(assignments).orderBy(asc(assignments.position)),
    db.select().from(assignmentParts).orderBy(asc(assignmentParts.position)),
    db.select().from(selections),
    db.select().from(assessmentPairings),
    db.select().from(teamPasswords),
    db.select().from(dashboardSettings).where(eq(dashboardSettings.id, SETTINGS_ID)),
  ]);

  const state = {
    teams: teamRows.map((t) => ({
      id: t.id,
      name: t.name,
      students: studentRows
        .filter((s) => s.teamId === t.id)
        .map((s) => ({ id: s.id, name: s.name })),
    })),
    slos: sloRows.map((s) => s.name),
    sloDescriptions: sloRows.map((s) => s.description),
    assignments: assignmentRows.map((a) => ({
      id: a.id,
      name: a.name,
      ...(a.slos ? { slos: a.slos } : {}),
      collapsed: a.collapsed,
      parts: partRows
        .filter((p) => p.assignmentId === a.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          weight: p.weight,
          slos: p.slos,
          isAssessment: p.isAssessment,
          requiredAll: p.requiredAll,
        })),
    })),
    selections: Object.fromEntries(
      selectionRows.map((s) => [`${s.partId}_${s.studentId}`, { weight: s.weight }]),
    ),
    assessmentPairings: Object.fromEntries(pairingRows.map((p) => [p.partId, p.pairings])),
    teamPasswords: Object.fromEntries(passwordRows.map((p) => [p.teamId, p.passwordHash])),
    masterPassword: settingsRows[0]?.masterPasswordHash ?? null,
  };

  return { revision: settingsRows[0]?.revision ?? 0, state };
}

// Replaces everything except selections, mirroring the old whole-document save.
async function saveState(body: DashboardState) {
  return db.transaction(async (tx) => {
    await tx.delete(assignmentParts);
    await tx.delete(assignments);
    await tx.delete(students);
    await tx.delete(teams);
    await tx.delete(slos);
    await tx.delete(assessmentPairings);
    await tx.delete(teamPasswords);

    if (body.slos.length) {
      await tx.insert(slos).values(
        body.slos.map((name, position) => ({
          position,
          name,
          description: body.sloDescriptions?.[position] ?? "",
        })),
      );
    }
    if (body.teams.length) {
      await tx
        .insert(teams)
        .values(body.teams.map((t, position) => ({ id: t.id, name: t.name, position })));
    }
    const studentValues = body.teams.flatMap((t) =>
      (t.students ?? []).map((s, position) => ({ id: s.id, teamId: t.id, name: s.name, position })),
    );
    if (studentValues.length) await tx.insert(students).values(studentValues);

    if (body.assignments.length) {
      await tx.insert(assignments).values(
        body.assignments.map((a, position) => ({
          id: a.id,
          name: a.name,
          slos: a.slos ?? null,
          collapsed: !!a.collapsed,
          position,
        })),
      );
    }
    const partValues = body.assignments.flatMap((a) =>
      (a.parts ?? []).map((p, position) => ({
        id: p.id,
        assignmentId: a.id,
        name: p.name,
        weight: Math.round(Number(p.weight) || 0),
        slos: p.slos ?? [],
        isAssessment: !!p.isAssessment,
        requiredAll: !!p.requiredAll,
        position,
      })),
    );
    if (partValues.length) await tx.insert(assignmentParts).values(partValues);

    const pairingValues = Object.entries(body.assessmentPairings ?? {}).map(
      ([partId, pairings]) => ({ partId, pairings }),
    );
    if (pairingValues.length) await tx.insert(assessmentPairings).values(pairingValues);

    const passwordValues = Object.entries(body.teamPasswords ?? {})
      .filter(([, hash]) => !!hash)
      .map(([teamId, passwordHash]) => ({ teamId, passwordHash }));
    if (passwordValues.length) await tx.insert(teamPasswords).values(passwordValues);

    return bumpRevision(tx, body.masterPassword ?? null);
  });
}

async function replaceSelections(map: SelectionMap) {
  return db.transaction(async (tx) => {
    await tx.delete(selections);
    const values = Object.entries(map).flatMap(([key, value]) => {
      const [partId, studentId] = key.split("_");
      return partId && studentId && value
        ? [{ partId, studentId, weight: Math.round(Number(value.weight) || 0) }]
        : [];
    });
    if (values.length) await tx.insert(selections).values(values);
    return bumpRevision(tx);
  });
}

async function setSelection(partId: string, studentId: string, weight: number | null) {
  return db.transaction(async (tx) => {
    if (weight === null) {
      await tx
        .delete(selections)
        .where(and(eq(selections.partId, partId), eq(selections.studentId, studentId)));
    } else {
      await tx
        .insert(selections)
        .values({ partId, studentId, weight })
        .onConflictDoUpdate({
          target: [selections.partId, selections.studentId],
          set: { weight },
        });
    }
    return bumpRevision(tx);
  });
}

const badRequest = (message: string) => Response.json({ error: message }, { status: 400 });

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  try {
    if (path === "/api/state") {
      if (req.method === "GET") {
        // Lets browsers poll cheaply: nothing is sent back if they're already up to date.
        const since = url.searchParams.get("since");
        if (since !== null && Number(since) === (await getRevision())) {
          return new Response(null, { status: 204 });
        }
        return Response.json(await loadState());
      }
      if (req.method === "PUT") {
        const body = (await req.json()) as DashboardState;
        if (!Array.isArray(body?.teams) || !Array.isArray(body?.assignments) || !Array.isArray(body?.slos)) {
          return badRequest("teams, slos and assignments are required");
        }
        return Response.json({ revision: await saveState(body) });
      }
    }

    if (path === "/api/selections" && req.method === "PUT") {
      const body = (await req.json()) as SelectionMap;
      if (!body || typeof body !== "object") return badRequest("selections map required");
      return Response.json({ revision: await replaceSelections(body) });
    }

    const { partId, studentId } = context.params;
    if (partId && studentId) {
      if (req.method === "PUT") {
        const { weight } = (await req.json()) as { weight?: number };
        const w = Math.round(Number(weight));
        if (!Number.isFinite(w)) return badRequest("weight must be a number");
        return Response.json({ revision: await setSelection(partId, studentId, w) });
      }
      if (req.method === "DELETE") {
        return Response.json({ revision: await setSelection(partId, studentId, null) });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (e) {
    console.error("Dashboard API error:", e);
    return Response.json({ error: "Database request failed" }, { status: 500 });
  }
};

export const config: Config = {
  path: ["/api/state", "/api/selections", "/api/selections/:partId/:studentId"],
};
