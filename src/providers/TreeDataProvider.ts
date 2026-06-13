import * as vscode from 'vscode';
import { Conversation } from '../models/Conversation';
import { SearchService } from '../services/SearchService';
import { IndexService } from '../services/IndexService';

export type ExplorerItem = ConversationItem | FolderItem;

function getRelativeTimeString(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (isNaN(date.getTime())) {
        return '';
    }

    if (diffSec < 60) {
        return 'Just now';
    } else if (diffMin < 60) {
        return `${diffMin}m ago`;
    } else if (diffHour < 24) {
        return `${diffHour}h ago`;
    } else if (diffDay < 7) {
        return `${diffDay}d ago`;
    } else {
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
}

export class FolderItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: 'tag' | 'workspace',
        public readonly value: string,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
    ) {
        super(label, collapsibleState);
        this.contextValue = type;
        this.iconPath = type === 'tag' 
            ? new vscode.ThemeIcon('tag') 
            : new vscode.ThemeIcon('folder');
    }
}

export class ConversationItem extends vscode.TreeItem {
    constructor(
        public readonly conversation: Conversation
    ) {
        // Label is title, description is workspace name or path + relative time
        super(conversation.title, vscode.TreeItemCollapsibleState.None);
        
        const relativeTime = getRelativeTimeString(conversation.timestamp);
        const wsPart = conversation.workspaceName ? `[${conversation.workspaceName}]` : '';
        this.description = [wsPart, relativeTime].filter(Boolean).join(' - ');
            
        // Human readable date tooltip
        const dateStr = new Date(conversation.timestamp).toLocaleString();
        const snippet = conversation.messages[0]?.content.substring(0, 150) || '';
        
        this.tooltip = new vscode.MarkdownString(
            `**${conversation.title}**\n\n` +
            `*Workspace:* ${conversation.workspaceName || 'None'} (${conversation.workspacePath || 'N/A'})\n` +
            `*Last Updated:* ${dateStr}\n\n` +
            `--- \n\n` +
            `*Preview:* ${snippet}...`
        );
        
        this.contextValue = 'conversation';
        
        // Use custom icons based on state
        if (conversation.favorite) {
            this.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('extensionIcon.starForeground'));
        } else {
            this.iconPath = new vscode.ThemeIcon('comment-discussion');
        }

        // Set click command
        this.command = {
            command: 'copilotConversation.viewConversation',
            title: 'View Conversation',
            arguments: [conversation.id]
        };
    }
}

export class CopilotMessagesTreeProvider implements vscode.TreeDataProvider<ExplorerItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ExplorerItem | undefined | null | void>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private readonly searchService: SearchService,
        private readonly indexService: IndexService,
        private readonly viewType: 'recent' | 'favorites' | 'tags' | 'workspaces'
    ) {
        // Listen to index changes to refresh tree automatically
        this.indexService.onDidIndex(() => this.refresh());
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public getTreeItem(element: ExplorerItem): vscode.TreeItem {
        return element;
    }

    public async getChildren(element?: ExplorerItem): Promise<ExplorerItem[]> {
        // Just make sure database is loaded, do not trigger a full scan
        await this.indexService.ensureLoaded();

        if (!element) {
            // Root elements
            if (this.viewType === 'recent') {
                const results = this.searchService.search({});
                return results.map(conv => new ConversationItem(conv));
            } 
            
            if (this.viewType === 'favorites') {
                const results = this.searchService.search({ favoriteOnly: true });
                return results.map(conv => new ConversationItem(conv));
            } 
            
            if (this.viewType === 'tags') {
                const tags = this.searchService.getUniqueTags();
                return tags.map(tag => new FolderItem(tag, 'tag', tag));
            }

            if (this.viewType === 'workspaces') {
                const workspaces = this.searchService.getUniqueWorkspaces();
                return workspaces.map(ws => new FolderItem(ws.name, 'workspace', ws.path));
            }
        } else {
            // Expanding a folder
            if (element instanceof FolderItem && element.type === 'tag') {
                const results = this.searchService.search({ tags: [element.value] });
                return results.map(conv => new ConversationItem(conv));
            }

            if (element instanceof FolderItem && element.type === 'workspace') {
                const results = this.searchService.search({ workspacePath: element.value });
                return results.map(conv => new ConversationItem(conv));
            }
        }

        return [];
    }
}
