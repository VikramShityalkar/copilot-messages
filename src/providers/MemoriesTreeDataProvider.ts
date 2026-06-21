import * as vscode from 'vscode';
import { IndexService } from '../services/IndexService';
import { DiscoveryService, DiscoveredMemory } from '../services/DiscoveryService';
import * as path from 'path';

export type MemoriesExplorerItem = MemoryFolderItem | MemoryFileItem;

export class MemoryFolderItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: 'global' | 'workspace',
        public readonly workspacePath?: string,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
    ) {
        super(label, collapsibleState);
        this.contextValue = type === 'global' ? 'globalMemoriesFolder' : 'workspaceMemoriesFolder';
        this.iconPath = type === 'global'
            ? new vscode.ThemeIcon('globe')
            : new vscode.ThemeIcon('folder');
    }
}

export class MemoryFileItem extends vscode.TreeItem {
    constructor(
        public readonly memory: DiscoveredMemory
    ) {
        // Human-friendly label: capitalize & replace hyphens/underscores with spaces
        const baseName = path.basename(memory.fileName, '.md');
        const formattedLabel = baseName
            .split(/[-_]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        super(formattedLabel, vscode.TreeItemCollapsibleState.None);

        this.description = `(${memory.scope})`;
        
        // Premium tooltip
        const dateStr = new Date(memory.mtime).toLocaleString();
        const preview = memory.content.substring(0, 150) || '';
        this.tooltip = new vscode.MarkdownString(
            `**${formattedLabel}**\n\n` +
            `*Scope:* ${memory.scope.toUpperCase()}\n` +
            `*File:* \`${memory.fileName}\`\n` +
            `*Last Updated:* ${dateStr}\n\n` +
            `--- \n\n` +
            `*Preview:*\n${preview}...`
        );

        this.contextValue = 'memoryFileItem';
        this.iconPath = new vscode.ThemeIcon('notebook');

        this.command = {
            command: 'vscode.open',
            title: 'Open Memory File',
            arguments: [vscode.Uri.file(memory.filePath)]
        };
    }
}

export class CopilotMemoriesTreeProvider implements vscode.TreeDataProvider<MemoriesExplorerItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MemoriesExplorerItem | undefined | null | void>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private readonly indexService: IndexService
    ) {
        // Automatically refresh when indexing completes
        this.indexService.onDidIndex(() => this.refresh());
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public getTreeItem(element: MemoriesExplorerItem): vscode.TreeItem {
        return element;
    }

    public async getChildren(element?: MemoriesExplorerItem): Promise<MemoriesExplorerItem[]> {
        // Discovers memories on the fly
        const memories = await DiscoveryService.discoverMemories();

        if (!element) {
            // Root elements: Group the memories by Global and Workspace
            const rootItems: MemoriesExplorerItem[] = [];

            // 1. Group global user memories
            const globalMemories = memories.filter(m => m.scope === 'user');
            if (globalMemories.length > 0) {
                rootItems.push(new MemoryFolderItem('Global Memories', 'global', undefined, vscode.TreeItemCollapsibleState.Expanded));
            }

            // 2. Group workspace memories by workspacePath/Name
            const workspaceGroups = new Map<string, { name: string; items: DiscoveredMemory[] }>();
            for (const m of memories) {
                if (m.scope !== 'user') {
                    const wsPath = m.workspacePath || 'unknown';
                    const wsName = m.workspaceName || 'Unknown Workspace';
                    
                    if (!workspaceGroups.has(wsPath)) {
                        workspaceGroups.set(wsPath, { name: wsName, items: [] });
                    }
                    workspaceGroups.get(wsPath)!.items.push(m);
                }
            }

            for (const [wsPath, wsGroup] of workspaceGroups.entries()) {
                // Expanded by default for better user experience
                rootItems.push(new MemoryFolderItem(wsGroup.name, 'workspace', wsPath, vscode.TreeItemCollapsibleState.Expanded));
            }

            // If there are no memories at all, display a placeholder item
            if (rootItems.length === 0) {
                const placeholder = new vscode.TreeItem('No Copilot memories captured yet');
                placeholder.description = 'Ask Copilot to remember things';
                placeholder.iconPath = new vscode.ThemeIcon('info');
                return [placeholder as any];
            }

            return rootItems;
        } else if (element instanceof MemoryFolderItem) {
            // Child elements for folder
            if (element.type === 'global') {
                const globalMemories = memories.filter(m => m.scope === 'user');
                return globalMemories.map(m => new MemoryFileItem(m));
            } else if (element.type === 'workspace' && element.workspacePath) {
                const wsMemories = memories.filter(m => m.scope !== 'user' && m.workspacePath === element.workspacePath);
                return wsMemories.map(m => new MemoryFileItem(m));
            }
        }

        return [];
    }
}
