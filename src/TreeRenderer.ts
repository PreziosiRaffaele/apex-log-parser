import { TreeNode, ParsedLog } from './types.js'

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
    private formatNodeLine(node: TreeNode, totalDuration: number): string {
        let line = node.type + '(' + node.id + ')';

        if (node.name) {
            line += ` ${node.name}`;
        }

        if (node.durationMs != null && node.durationMs > 0) {
            line += ` [${node.durationMs}ms`;
            if (typeof totalDuration === 'number' && totalDuration > 0) {
                const percentage = Math.floor((node.durationMs / totalDuration) * 100);
                line += `|${percentage}%`;
            }
            line += `] ${this.createDurationBar(node.durationMs, totalDuration)}`;
        }

        return line;
    }

    /**
     * Recursively render a node and its children
     */
    private renderNodeRecursive(
        node: TreeNode,
        indent: string,
        isLast: boolean,
        totalDuration: number
    ): string[] {
        const lines: string[] = [];

        const branch = isLast ? '└── ' : '├── ';
        const childIndent = indent + (isLast ? '    ' : '│   ');

        const formattedLine = this.formatNodeLine(node, totalDuration);
        lines.push(indent + branch + formattedLine);

        const children = node.children ?? [];
        lines.push(...this.renderChildren(children, childIndent, totalDuration));

        return lines;
    }

    /**
     * Render a list of child nodes
     */
    private renderChildren(
        children: TreeNode[],
        indent: string,
        totalDuration: number
    ): string[] {
        return children.flatMap((child, index) =>
            this.renderNodeRecursive(
                child,
                indent,
                index === children.length - 1,
                totalDuration
            )
        );
    }

    /**
     * Render the complete tree structure
     */
    public renderTree(parsedLog: ParsedLog): string {
        const rootNode = parsedLog.tree;
        if (!rootNode) return '';
        const totalDuration = parsedLog.meta.durationMs;
        const lines: string[] = [];

        // Render root node without tree branches
        lines.push(this.formatNodeLine(rootNode, totalDuration));

        const children = rootNode.children ?? [];
        lines.push(...this.renderChildren(children, '', totalDuration));

        return lines.join('\n');
    }
}
