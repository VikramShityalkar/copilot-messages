import * as vscode from 'vscode';
import { SearchService } from '../services/SearchService';
import { Conversation } from '../models/Conversation';

export class SearchCommand {
    public static register(context: vscode.ExtensionContext, searchService: SearchService) {
        const disposable = vscode.commands.registerCommand('copilotConversation.search', async () => {
            const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { conversationId: string }>();
            quickPick.placeholder = 'Search Copilot conversations (e.g. postgres migration, vector search)...';
            quickPick.title = 'Search Copilot Conversations';
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;
            
            // Set initial items (most recent conversations)
            try {
                const initialConvs = searchService.search({});
                quickPick.items = this.mapConversationsToItems(initialConvs);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Search error: ${err.message}`);
            }

            let debounceTimeout: NodeJS.Timeout | undefined;
            quickPick.onDidChangeValue(value => {
                if (debounceTimeout) {
                    clearTimeout(debounceTimeout);
                }
                debounceTimeout = setTimeout(() => {
                    try {
                        const results = searchService.search({ text: value });
                        quickPick.items = this.mapConversationsToItems(results, value);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Search error: ${err.message}`);
                    }
                }, 200);
            });

            quickPick.onDidAccept(() => {
                const selected = quickPick.selectedItems[0];
                if (selected) {
                    vscode.commands.executeCommand('copilotConversation.viewConversation', selected.conversationId);
                }
                quickPick.hide();
            });

            quickPick.onDidHide(() => {
                if (debounceTimeout) {
                    clearTimeout(debounceTimeout);
                }
                quickPick.dispose();
            });
            quickPick.show();
        });

        context.subscriptions.push(disposable);
    }

    private static mapConversationsToItems(
        conversations: Conversation[], 
        searchText?: string
    ): (vscode.QuickPickItem & { conversationId: string })[] {
        const query = searchText ? searchText.toLowerCase().trim() : '';

        return conversations.map(conv => {
            const dateStr = new Date(conv.timestamp).toLocaleDateString();
            const wsName = conv.workspaceName ? ` [${conv.workspaceName}]` : '';
            
            // Find a snippet containing the query
            let preview = '';
            let foundSnippet = false;
            
            if (query && conv.messages) {
                for (const msg of conv.messages) {
                    if (msg.content && msg.content.toLowerCase().includes(query)) {
                        const content = msg.content;
                        const idx = content.toLowerCase().indexOf(query);
                        const start = Math.max(0, idx - 40);
                        const end = Math.min(content.length, idx + 60);
                        let snippet = content.substring(start, end).replace(/[\r\n]+/g, ' ');
                        if (start > 0) snippet = '...' + snippet;
                        if (end < content.length) snippet = snippet + '...';
                        preview = `Matched: "${snippet}"`;
                        foundSnippet = true;
                        break;
                    }
                }
            }

            if (!foundSnippet) {
                const firstMsg = conv.messages && conv.messages[0];
                const content = firstMsg && typeof firstMsg.content === 'string' ? firstMsg.content : '';
                preview = content.substring(0, 100).replace(/[\r\n]+/g, ' ');
            }
            
            return {
                label: conv.title,
                description: `${wsName} - ${dateStr}`,
                detail: preview,
                conversationId: conv.id
            };
        });
    }
}
