import type { EventContextFrame, EventNode, Hotspot, HotspotReport, NodeType, ParsedLogSummary } from './types.js';

export const DEFAULT_HOTSPOT_TOP = 20;

const EXCLUDED_HOTSPOT_TYPES = new Set<NodeType>([
    'ROOT',
    'EXECUTION',
    'LIMIT',
    'EXCEPTION_THROWN',
    'FATAL_ERROR',
    'USER_DEBUG',
]);

type HotspotBuilder = {
    type: NodeType;
    name?: string;
    count: number;
    totalSelfMs: number;
    maxSelfMs: number;
    inclusiveMs: number;
    slowest: EventNode;
};

/**
 * Groups events by (type, name), ranked by total self time.
 * Events must be parsed with includeContext: an occurrence nested inside an ancestor frame
 * with the same type and name is excluded from inclusiveMs.
 */
export function buildHotspotReport(summary: ParsedLogSummary, events: EventNode[], top: number): HotspotReport {
    const groups = new Map<string, HotspotBuilder>();

    for (const event of events) {
        if (EXCLUDED_HOTSPOT_TYPES.has(event.type) || event.durationMs === undefined) continue;

        const selfMs = event.selfMs ?? 0;
        const name = getGroupName(event);
        const key = `${event.type}\u0000${name ?? ''}`;
        const isOutermost = !event.context?.stack.some(frame => frame.type === event.type && getGroupName(frame) === name);
        let group = groups.get(key);

        if (!group) {
            group = { type: event.type, name, count: 0, totalSelfMs: 0, maxSelfMs: 0, inclusiveMs: 0, slowest: event };
            groups.set(key, group);
        } else if (isSlower(event, group.slowest)) {
            group.slowest = event;
        }

        group.count++;
        group.totalSelfMs += selfMs;
        group.maxSelfMs = Math.max(group.maxSelfMs, selfMs);
        if (isOutermost) group.inclusiveMs += event.durationMs;
    }

    const hotspots = Array.from(groups.values())
        .map(createHotspot)
        .sort(compareHotspots)
        .slice(0, top);

    return { summary, hotspots };
}

/** DML node names embed the row count, so DML groups by operation and object instead. */
function getGroupName(event: EventContextFrame & { request?: string }): string | undefined {
    if (event.type === 'DML' && event.operation && event.object) return `${event.operation} on ${event.object}`;
    if (event.type === 'CALLOUT' && !event.name) return event.request;
    return event.name;
}

function isSlower(candidate: EventNode, current: EventNode): boolean {
    const candidateSelf = candidate.selfMs ?? 0;
    const currentSelf = current.selfMs ?? 0;
    if (candidateSelf !== currentSelf) return candidateSelf > currentSelf;

    return (candidate.durationMs ?? 0) > (current.durationMs ?? 0);
}

function createHotspot(group: HotspotBuilder): Hotspot {
    const { slowest } = group;

    return {
        type: group.type,
        name: group.name,
        count: group.count,
        totalSelfMs: roundMs(group.totalSelfMs),
        maxSelfMs: roundMs(group.maxSelfMs),
        inclusiveMs: roundMs(group.inclusiveMs),
        slowest: {
            id: slowest.id,
            durationMs: slowest.durationMs,
            selfMs: slowest.selfMs,
            lineNumber: slowest.lineNumber,
            context: slowest.context,
        },
    };
}

function compareHotspots(left: Hotspot, right: Hotspot): number {
    return right.totalSelfMs - left.totalSelfMs
        || right.inclusiveMs - left.inclusiveMs
        || compareStrings(left.type, right.type)
        || compareStrings(left.name ?? '', right.name ?? '');
}

function compareStrings(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function roundMs(value: number): number {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
