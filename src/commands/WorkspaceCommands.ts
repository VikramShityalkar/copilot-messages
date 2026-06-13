import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Database } from '../storage/Database';
import { ConversationItem } from '../providers/TreeDataProvider';
import { SearchService } from '../services/SearchService';
import { ConversationPanel } from '../views/ConversationPanel';

export class WorkspaceCommands {
    public static register(
        context: vscode.ExtensionContext, 
        db: Database, 
        searchService: SearchService,
        refreshCallback: () => void
    ) {
        // 1. Open Original Workspace
        const openWorkspace = vscode.commands.registerCommand('copilotConversation.openWorkspace', async (item: ConversationItem | string) => {
            const id = typeof item === 'string' ? item : item.conversation.id;
            const conv = db.getById(id);
            if (!conv || !conv.workspacePath) {
                vscode.window.showWarningMessage('No original workspace path available for this conversation.');
                return;
            }

            const folderUri = vscode.Uri.file(conv.workspacePath);
            try {
                const stat = await fs.promises.stat(conv.workspacePath);
                if (stat.isDirectory()) {
                    await vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: true });
                } else {
                    vscode.window.showErrorMessage(`Workspace path is not a folder: ${conv.workspacePath}`);
                }
            } catch {
                vscode.window.showErrorMessage(`Workspace folder does not exist at: ${conv.workspacePath}`);
            }
        });

        // 2. Favorite / Unfavorite Toggle
        const toggleFavorite = vscode.commands.registerCommand('copilotConversation.toggleFavorite', async (item: ConversationItem | string) => {
            const id = typeof item === 'string' ? item : item.conversation.id;
            const conv = db.getById(id);
            if (!conv) {
                return;
            }

            const newFav = !conv.favorite;
            if (!newFav) {
                const confirm = await vscode.window.showWarningMessage(
                    `Are you sure you want to remove "${conv.title}" from Favorites?`,
                    { modal: true },
                    'Yes'
                );
                if (confirm !== 'Yes') {
                    return;
                }
            }

            await db.updateFields(id, { favorite: newFav });
            vscode.window.showInformationMessage(newFav ? 'Added to Favorites ★' : 'Removed from Favorites');
            refreshCallback();

            // If the Webview is currently open for this conversation, update it!
            if (ConversationPanel.currentPanel && ConversationPanel.currentPanel.conversationId === id) {
                const updated = db.getById(id);
                if (updated) {
                    ConversationPanel.currentPanel.updateConversation(updated);
                }
            }
        });

        // 3. Add Tag
        const addTag = vscode.commands.registerCommand('copilotConversation.addTag', async (item: ConversationItem | string) => {
            const id = typeof item === 'string' ? item : item.conversation.id;
            const conv = db.getById(id);
            if (!conv) return;

            const config = vscode.workspace.getConfiguration('copilotConversation');
            const defaultTags = config.get<string[]>('defaultTags', ['architecture', 'database', 'performance', 'security', 'frontend']);
            const existingTags = conv.tags || [];

            // Combine defaults and any tags user already created in the DB
            const allDbTags = searchService.getUniqueTags();
            const tagSet = new Set([...defaultTags, ...allDbTags]);
            existingTags.forEach(t => tagSet.delete(t)); // Remove already assigned tags

            const quickPick = vscode.window.createQuickPick();
            quickPick.items = Array.from(tagSet).map(tag => ({ label: tag }));
            quickPick.placeholder = 'Select a tag or type a custom tag name...';
            quickPick.title = `Add Tag to: "${conv.title}"`;

            // Allow custom tags by watching value changes
            quickPick.onDidChangeValue(value => {
                if (value.trim() !== '' && !tagSet.has(value.trim())) {
                    quickPick.items = [
                        { label: `Create tag: "${value.trim()}"` },
                        ...Array.from(tagSet).map(tag => ({ label: tag }))
                    ];
                } else {
                    quickPick.items = Array.from(tagSet).map(tag => ({ label: tag }));
                }
            });

            quickPick.onDidAccept(async () => {
                const selected = quickPick.selectedItems[0];
                if (selected) {
                    let tagName = selected.label;
                    if (tagName.startsWith('Create tag: "')) {
                        tagName = tagName.substring(13, tagName.length - 1);
                    }
                    if (!existingTags.includes(tagName)) {
                        const newTags = [...existingTags, tagName];
                        await db.updateFields(id, { tags: newTags });
                        vscode.window.showInformationMessage(`Added tag "${tagName}"`);
                        refreshCallback();
                    } else {
                        vscode.window.showInformationMessage(`Tag "${tagName}" is already assigned.`);
                    }
                }
                quickPick.hide();
            });

            quickPick.onDidHide(() => quickPick.dispose());
            quickPick.show();
        });

        // 4. Remove Tag
        const removeTag = vscode.commands.registerCommand('copilotConversation.removeTag', async (item: ConversationItem | string) => {
            const id = typeof item === 'string' ? item : item.conversation.id;
            const conv = db.getById(id);
            if (!conv || !conv.tags || conv.tags.length === 0) {
                vscode.window.showInformationMessage('No tags to remove on this conversation.');
                return;
            }

            const selectedTag = await vscode.window.showQuickPick(conv.tags, {
                placeHolder: 'Select a tag to remove...',
                title: `Remove Tag from: "${conv.title}"`
            });

            if (selectedTag) {
                const newTags = conv.tags.filter(t => t !== selectedTag);
                await db.updateFields(id, { tags: newTags });
                vscode.window.showInformationMessage(`Removed tag "${selectedTag}"`);
                refreshCallback();
            }
        });

        // 5. Export Single Conversation to Markdown
        const exportMarkdown = vscode.commands.registerCommand('copilotConversation.exportMarkdown', async (item: ConversationItem | string) => {
            const id = typeof item === 'string' ? item : item.conversation.id;
            const conv = db.getById(id);
            if (!conv) return;

            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(osHome(), `${sanitizeFilename(conv.title)}.md`)),
                filters: { 'Markdown': ['md'] }
            });

            if (uri) {
                    let content = `# ${conv.title}\n\n`;
                content += `* **Workspace:** ${conv.workspaceName || 'None'} (${conv.workspacePath || 'N/A'})\n`;
                content += `* **Date:** ${new Date(conv.timestamp).toLocaleString()}\n\n`;
                content += `--- \n\n`;

                for (const msg of conv.messages) {
                    const speaker = msg.role === 'user' ? '### User' : '### GitHub Copilot';
                    content += `${speaker}\n\n${msg.content}\n\n`;
                }

                await fs.promises.writeFile(uri.fsPath, content, 'utf8');
                    vscode.window.showInformationMessage('Exported conversation successfully!');
            }
        });

        // 6. Export Single Conversation to JSON
        const exportJson = vscode.commands.registerCommand('copilotConversation.exportJson', async (item: ConversationItem | string) => {
            const id = typeof item === 'string' ? item : item.conversation.id;
            const conv = db.getById(id);
            if (!conv) return;

            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(osHome(), `${sanitizeFilename(conv.title)}.json`)),
                filters: { 'JSON': ['json'] }
            });

            if (uri) {
                await fs.promises.writeFile(uri.fsPath, JSON.stringify(conv, null, 2), 'utf8');
                vscode.window.showInformationMessage('Exported conversation successfully!');
            }
        });

        // 7. Export Current Search Results
        const exportSearchResults = vscode.commands.registerCommand('copilotConversation.exportSearchResults', async () => {
            // Prompt the user for search text to export
            const queryText = await vscode.window.showInputBox({
                prompt: 'Enter search text or leave empty to export all conversations...',
                placeHolder: 'Search query...'
            });

            if (queryText === undefined) return; // User cancelled

            const results = searchService.search({ text: queryText });
            if (results.length === 0) {
                vscode.window.showInformationMessage('No search results found to export.');
                return;
            }

            const exportFormat = await vscode.window.showQuickPick(['Markdown', 'JSON'], {
                placeHolder: 'Select export format...'
            });

            if (!exportFormat) return;

            const defaultName = queryText.trim() ? `Search - ${queryText.trim()}` : 'All Conversations';
            const extension = exportFormat === 'Markdown' ? 'md' : 'json';

            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(osHome(), `${sanitizeFilename(defaultName)}.${extension}`)),
                filters: exportFormat === 'Markdown' ? { 'Markdown': ['md'] } : { 'JSON': ['json'] }
            });

            if (uri) {
                if (exportFormat === 'JSON') {
                    await fs.promises.writeFile(uri.fsPath, JSON.stringify(results, null, 2), 'utf8');
                } else {
                    let content = `# Search Results for: "${queryText}"\n`;
                    content += `*Exported on ${new Date().toLocaleString()} - found ${results.length} matches*\n\n`;
                    content += `---\n\n`;

                    for (const conv of results) {
                        content += `## [${conv.workspaceName || 'Global'}] ${conv.title}\n`;
                        content += `* **Date:** ${new Date(conv.timestamp).toLocaleString()}\n`;
                        content += `* **Messages:** ${conv.messages.length}\n\n`;
                        
                        // Show snippet
                        const firstMsg = conv.messages[0]?.content.substring(0, 300) || '';
                        content += `> ${firstMsg.replace(/\n/g, '\n> ')}\n\n`;
                        content += `[Open File](${vscode.Uri.file(conv.sourceFile).toString()})\n\n`;
                        content += `***\n\n`;
                    }
                    await fs.promises.writeFile(uri.fsPath, content, 'utf8');
                }
                vscode.window.showInformationMessage(`Successfully exported ${results.length} search results!`);
            }
        });

        // 8. Bind global export to general button/shortcut
        const exportGeneral = vscode.commands.registerCommand('copilotConversation.export', async () => {
            // Pick a conversation to export
            const convs = db.getAll();
            if (convs.length === 0) {
                vscode.window.showInformationMessage('No conversations available to export.');
                return;
            }

            const selection = await vscode.window.showQuickPick(
                convs.map(c => ({ label: c.title, conversation: c })),
                { placeHolder: 'Select a conversation to export...' }
            );

            if (selection) {
                vscode.commands.executeCommand('copilotConversation.exportMarkdown', selection.conversation.id);
            }
        });

        context.subscriptions.push(
            openWorkspace,
            toggleFavorite,
            addTag,
            removeTag,
            exportMarkdown,
            exportJson,
            exportSearchResults,
            exportGeneral
        );
    }
}

function osHome(): string {
    return process.env.USERPROFILE || process.env.HOME || '.';
}

function sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
}
