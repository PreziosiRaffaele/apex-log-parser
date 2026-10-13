import { ParsedLog } from './types.js'
import { sanitizeString } from './ParserUtils.js'
import { pruneTree, PrunedTreeNode, TreePruneOptions } from './TreePruner.js'

type TreeLine = PrunedTreeNode | string;

export class TreeRenderer {
    constructor() { }

    /**
     * Create a duration bar 
     */
    private createDurationBar(durationMs: number | undefined, maxDuration: number): string {
        if (durationMs == null || maxDuration === 0) return '';
        const barLength = Math.floor((durationMs / maxDuration) * 20);
        return '█'.repeat(barLength);
    }

    /**
     * Format a single node's display line with all details
     */
    private formatNodeLine(node: PrunedTreeNode, totalDuration: number, availableWidth: number): string {
        let line = `${node.type}(${node.id})`;

        let durationInfo = '';
        if (node.durationMs != null && node.durationMs > 0) {
            durationInfo += ` [${node.durationMs}ms`;
            if (typeof totalDuration === 'number' && totalDuration > 0) {
                const percentage = Math.floor((node.durationMs / totalDuration) * 100);
                durationInfo += `|${percentage}%`;
            }
            durationInfo += `] ${this.createDurationBar(node.durationMs, totalDuration)}`;
        }

        const displayName = node.name ?? this.getFallbackDisplayName(node);

        if (displayName) {
            const remainingWidth = availableWidth - line.length - durationInfo.length - 1; // -1 for space
            let name = displayName;
            if (name.length > remainingWidth) {
                if (remainingWidth > 4) {
                    name = name.substring(0, remainingWidth - 4) + '...';
                } else {
                    name = ''; // Not enough space for ellipsis, omit name
                }
            }
            
            if (name) {
                line += ` ${name}`;
            }
        }

        line += durationInfo;

        return line;
    }

    private getFallbackDisplayName(node: PrunedTreeNode): string | undefined {
        if (node.type === 'LIMIT') return node.namespace;
        if (node.type === 'USER_DEBUG' && node.message) return sanitizeString(node.message);
        return undefined;
    }

    private getHiddenLines(node: PrunedTreeNode): string[] {
        const lines: string[] = [];
        if (node.hiddenChildren) {
            const { count, durationMs } = node.hiddenChildren;
            lines.push(`… ${count} ${count === 1 ? 'node' : 'nodes'} hidden [${durationMs}ms total]`);
        }
        if (node.hiddenDescendants) {
            const count = node.hiddenDescendants;
            lines.push(`… ${count} ${count === 1 ? 'descendant' : 'descendants'} hidden`);
        }
        return lines;
    }

    /**
     * Recursively render a node and its children
     */
    private renderNodeRecursive(
        entry: TreeLine,
        indent: string,
        isLast: boolean,
        totalDuration: number,
        terminalWidth: number
    ): string[] {
        const branch = isLast ? '└── ' : '├── ';
        if (typeof entry === 'string') return [indent + branch + entry];

        const childIndent = indent + (isLast ? '    ' : '│   ');
        const availableWidth = terminalWidth - (indent.length + branch.length);
        const lines = [indent + branch + this.formatNodeLine(entry, totalDuration, availableWidth)];
        lines.push(...this.renderChildren(entry, childIndent, totalDuration, terminalWidth));
        return lines;
    }

    /**
     * Render a node's children followed by any hidden-node summary lines
     */
    private renderChildren(
        node: PrunedTreeNode,
        indent: string,
        totalDuration: number,
        terminalWidth: number
    ): string[] {
        const entries: TreeLine[] = [...(node.children ?? []), ...this.getHiddenLines(node)];
        return entries.flatMap((entry, index) =>
            this.renderNodeRecursive(
                entry,
                indent,
                index === entries.length - 1,
                totalDuration,
                terminalWidth
            )
        );
    }

    /**
     * Render the complete tree structure
     */
    public renderTree(parsedLog: ParsedLog, pruneOptions: TreePruneOptions = {}): string {
        if (!parsedLog.tree) return '';
        const rootNode = pruneTree(parsedLog.tree, pruneOptions);
        const totalDuration = parsedLog.summary.durationMs;
        const lines: string[] = [];
        const terminalWidth = process.stdout.columns || 160;

        // Render root node without tree branches
        lines.push(this.formatNodeLine(rootNode, totalDuration, terminalWidth));

        lines.push(...this.renderChildren(rootNode, '', totalDuration, terminalWidth));

        return lines.join('\n');
    }
}
