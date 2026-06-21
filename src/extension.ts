import * as vscode from 'vscode';
import { Database } from './storage/Database';
import { IndexService } from './services/IndexService';
import { SearchService } from './services/SearchService';
import { CopilotMessagesTreeProvider } from './providers/TreeDataProvider';
import { CopilotMemoriesTreeProvider } from './providers/MemoriesTreeDataProvider';
import { SearchCommand } from './commands/SearchCommand';
import { ConversationPanel } from './views/ConversationPanel';
import { WorkspaceCommands } from './commands/WorkspaceCommands';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Copilot Conversation is activating...');

    const db = new Database(context);
    const indexService = new IndexService(db);
    context.subscriptions.push(indexService);
    const searchService = new SearchService(db);

    // Initial load and index
    const config = vscode.workspace.getConfiguration('copilotConversation');
    if (config.get<boolean>('enableAutoIndex', true)) {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: "Indexing Copilot Conversations..."
        }, async () => {
            try {
                const count = await indexService.index();
                console.log(`Successfully indexed ${count} conversations.`);
            } catch (error) {
                console.error('Initial indexing failed:', error);
            }
        });
    }

    // Register Tree Data Providers
    const recentProvider = new CopilotMessagesTreeProvider(searchService, indexService, 'recent');
    const favoritesProvider = new CopilotMessagesTreeProvider(searchService, indexService, 'favorites');
    const tagsProvider = new CopilotMessagesTreeProvider(searchService, indexService, 'tags');
    const workspacesProvider = new CopilotMessagesTreeProvider(searchService, indexService, 'workspaces');
    const memoriesProvider = new CopilotMemoriesTreeProvider(indexService);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('copilotConversationRecent', recentProvider),
        vscode.window.registerTreeDataProvider('copilotConversationFavorites', favoritesProvider),
        vscode.window.registerTreeDataProvider('copilotConversationTags', tagsProvider),
        vscode.window.registerTreeDataProvider('copilotConversationWorkspaces', workspacesProvider),
        vscode.window.registerTreeDataProvider('copilotConversationMemories', memoriesProvider)
    );

    const refreshViews = () => {
        recentProvider.refresh();
        favoritesProvider.refresh();
        tagsProvider.refresh();
        workspacesProvider.refresh();
        memoriesProvider.refresh();
    };

    // Register Workspace commands (Open Workspace, Favorite, Tagging, Exports)
    WorkspaceCommands.register(context, db, searchService, refreshViews);

    // Register Search Command
    SearchCommand.register(context, searchService);

    // Register Reindex Command
    const reindexDisposable = vscode.commands.registerCommand('copilotConversation.reindex', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Reindexing Copilot Conversations",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: "Scanning transcript directories..." });
            const count = await indexService.index(true);
            vscode.window.showInformationMessage(`Reindexing complete! Discovered and indexed ${count} conversations.`);
        });
    });
    context.subscriptions.push(reindexDisposable);

    // Register viewConversation command
    const viewConvDisposable = vscode.commands.registerCommand('copilotConversation.viewConversation', async (conversationId: string) => {
        const conv = db.getById(conversationId);
        if (conv) {
            ConversationPanel.createOrShow(context, conv);
        } else {
            vscode.window.showErrorMessage(`Conversation with ID ${conversationId} not found.`);
        }
    });
    context.subscriptions.push(viewConvDisposable);

    // Register Open Favorites command
    const openFavsDisposable = vscode.commands.registerCommand('copilotConversation.openFavorites', () => {
        vscode.commands.executeCommand('workbench.view.extension.copilot-conversation-sidebar');
    });
    context.subscriptions.push(openFavsDisposable);
}

export function deactivate() {
    console.log('Copilot Conversation is deactivating...');
}
