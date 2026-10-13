import { TreeNode } from './types.js';

export type TreePruneOptions = {
    maxDepth?: number;
    minDurationMs?: number;
};

export type HiddenChildrenSummary = {
    count: number;
    durationMs: number;
};

export type PrunedTreeNode = Omit<TreeNode, 'children'> & {
    children?: PrunedTreeNode[];
    hiddenDescendants?: number;
    hiddenChildren?: HiddenChildrenSummary;
};

/**
 * Returns a pruned copy of the tree (or the input itself when no option is set); the input is never mutated. ROOT is depth 0.
 * Nodes below `minDurationMs` are dropped unless a descendant is kept, and dropped
 * siblings are summarised in `hiddenChildren` on their parent. Nodes at `maxDepth`
 * lose their children, which are counted (including all nested levels) in `hiddenDescendants`.
 */
export function pruneTree(root: TreeNode, options: TreePruneOptions): PrunedTreeNode {
    const { maxDepth, minDurationMs } = options;
    if (maxDepth === undefined && minDurationMs === undefined) return root;
    const keepFlags = minDurationMs === undefined ? undefined : computeKeepFlags(root, minDurationMs);

    const prune = (node: TreeNode, depth: number): PrunedTreeNode => {
        const { children, ...rest } = node;
        const pruned: PrunedTreeNode = { ...rest };
        if (!children) return pruned;
        if (children.length === 0) {
            pruned.children = [];
            return pruned;
        }

        if (maxDepth !== undefined && depth >= maxDepth) {
            pruned.hiddenDescendants = countDescendants(node);
            return pruned;
        }

        const keptChildren: PrunedTreeNode[] = [];
        const hidden: HiddenChildrenSummary = { count: 0, durationMs: 0 };
        for (const child of children) {
            if (keepFlags && !keepFlags.has(child)) {
                hidden.count++;
                hidden.durationMs += child.durationMs ?? 0;
                continue;
            }
            keptChildren.push(prune(child, depth + 1));
        }

        if (keptChildren.length > 0) pruned.children = keptChildren;
        if (hidden.count > 0) {
            hidden.durationMs = Math.round(hidden.durationMs * 1000) / 1000;
            pruned.hiddenChildren = hidden;
        }
        return pruned;
    };

    return prune(root, 0);
}

function computeKeepFlags(root: TreeNode, minDurationMs: number): Set<TreeNode> {
    const kept = new Set<TreeNode>();
    const visit = (node: TreeNode): boolean => {
        let keep = (node.durationMs ?? 0) >= minDurationMs;
        for (const child of node.children ?? []) {
            if (visit(child)) keep = true;
        }
        if (keep) kept.add(node);
        return keep;
    };
    visit(root);
    return kept;
}

function countDescendants(node: TreeNode): number {
    let count = 0;
    for (const child of node.children ?? []) {
        count += 1 + countDescendants(child);
    }
    return count;
}
