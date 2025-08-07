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
    private formatNodeLine(node: TreeNode, totalDuration: number, availableWidth: number): string {
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

        if (node.name) {
            const remainingWidth = availableWidth - line.length - durationInfo.length - 1; // -1 for space
            let name = node.name;
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

    /**
     * Recursively render a node and its children
     */
    private renderNodeRecursive(
        node: TreeNode,
        indent: string,
        isLast: boolean,
        totalDuration: number,
        terminalWidth: number
    ): string[] {
        const lines: string[] = [];

        const branch = isLast ? '└── ' : '├── ';
        const childIndent = indent + (isLast ? '    ' : '│   ');

        const availableWidth = terminalWidth - (indent.length + branch.length);
        const formattedLine = this.formatNodeLine(node, totalDuration, availableWidth);
        lines.push(indent + branch + formattedLine);

        const children = node.children ?? [];
        lines.push(...this.renderChildren(children, childIndent, totalDuration, terminalWidth));

        return lines;
    }

    /**
     * Render a list of child nodes
     */
    private renderChildren(
        children: TreeNode[],
        indent: string,
        totalDuration: number,
        terminalWidth: number
    ): string[] {
        return children.flatMap((child, index) =>
            this.renderNodeRecursive(
                child,
                indent,
                index === children.length - 1,
                totalDuration,
                terminalWidth
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
        const terminalWidth = process.stdout.columns || 80;

        // Render root node without tree branches
        lines.push(this.formatNodeLine(rootNode, totalDuration, terminalWidth));

        const children = rootNode.children ?? [];
        lines.push(...this.renderChildren(children, '', totalDuration, terminalWidth));

        return lines.join('\n');
    }
}
