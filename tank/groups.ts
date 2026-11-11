import type { LiveSession, Priority } from "./live.js";
import type { RexSession } from "./rex.js";
import type { Status } from "./status.js";

export interface Group {
    title: string;
    /** The most urgent priority among the group's sessions. */
    priority?: Priority;
    sessions: LiveSession[];
}

const UNSET = 4;
const rank = (priority: Priority | undefined) => priority ?? UNSET;

function bestPriority(sessions: LiveSession[]): Priority | undefined {
    const best = Math.min(...sessions.map((session) => rank(session.priority)));
    return best === UNSET ? undefined : (best as Priority);
}

function projectsTitle(sessions: LiveSession[]): string {
    return [...new Set(sessions.map((session) => session.project.name))].join(" · ");
}

/**
 * One group per Rex session, titled by its label, with Pi sessions in tab order, since that is how you already group
 * related work. Pi sessions outside Rex (or without a layout) are grouped by project. Groups sort by priority, then
 * sidebar order.
 */
export function groupSessions(sessions: LiveSession[], layout: RexSession[] | undefined): Group[] {
    const position = new Map<string, { group: number; order: number }>();
    (layout ?? []).forEach((rexSession, group) => {
        let order = 0;
        for (const tab of rexSession.tabs) {
            for (const block of tab.blocks) position.set(block, { group, order: order++ });
        }
    });

    const placed = new Map<number, LiveSession[]>();
    const projects = new Map<string, LiveSession[]>();
    for (const session of sessions) {
        const found = session.terminalId ? position.get(session.terminalId) : undefined;
        if (found) placed.set(found.group, [...(placed.get(found.group) ?? []), session]);
        else projects.set(session.project.key, [...(projects.get(session.project.key) ?? []), session]);
    }

    const byTab = (a: LiveSession, b: LiveSession) =>
        position.get(a.terminalId!)!.order - position.get(b.terminalId!)!.order;
    const byStart = (a: LiveSession, b: LiveSession) => a.startedAt.localeCompare(b.startedAt);

    const ordered: { group: Group; order: number }[] = [];
    for (const [group, members] of placed) {
        members.sort(byTab);
        ordered.push({
            group: { title: layout![group]!.label, priority: bestPriority(members), sessions: members },
            order: group,
        });
    }
    let order = (layout?.length ?? 0) + 1;
    for (const members of [...projects.values()].sort((a, b) => a[0]!.project.name.localeCompare(b[0]!.project.name))) {
        members.sort(byStart);
        ordered.push({
            group: { title: projectsTitle(members), priority: bestPriority(members), sessions: members },
            order: order++,
        });
    }
    ordered.sort((a, b) => rank(a.group.priority) - rank(b.group.priority) || a.order - b.order);
    return ordered.map(({ group }) => group);
}

export function countStatuses(sessions: LiveSession[]): Record<Status, number> {
    const counts: Record<Status, number> = { "needs-you": 0, unseen: 0, working: 0, idle: 0 };
    for (const session of sessions) counts[session.status]++;
    return counts;
}
