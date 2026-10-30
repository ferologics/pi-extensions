import type { GhosttyWindow } from "./ghostty.js";
import type { LiveSession, Priority } from "./live.js";
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
 * One group per Ghostty window, with sessions in tab order, since windows are how you already group related work.
 * Sessions outside Ghostty (or without a layout) are grouped by project. Groups sort by priority, then window order.
 */
export function groupSessions(sessions: LiveSession[], layout: GhosttyWindow[] | undefined): Group[] {
    const position = new Map<string, { window: number; order: number }>();
    (layout ?? []).forEach((window, windowIndex) => {
        let order = 0;
        for (const tab of window.tabs) {
            for (const terminalId of tab) position.set(terminalId, { window: windowIndex, order: order++ });
        }
    });

    const windows = new Map<number, LiveSession[]>();
    const projects = new Map<string, LiveSession[]>();
    for (const session of sessions) {
        const found = session.terminalId ? position.get(session.terminalId) : undefined;
        if (found) windows.set(found.window, [...(windows.get(found.window) ?? []), session]);
        else projects.set(session.project.key, [...(projects.get(session.project.key) ?? []), session]);
    }

    const byTab = (a: LiveSession, b: LiveSession) =>
        position.get(a.terminalId!)!.order - position.get(b.terminalId!)!.order;
    const byStart = (a: LiveSession, b: LiveSession) => a.startedAt.localeCompare(b.startedAt);

    const ordered: { group: Group; order: number }[] = [];
    for (const [window, members] of windows) {
        members.sort(byTab);
        ordered.push({
            group: { title: projectsTitle(members), priority: bestPriority(members), sessions: members },
            order: window,
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
