import * as vscode from 'vscode';
import { Database } from '../storage/Database';
import { Conversation, SearchQuery } from '../models/Conversation';

export class SearchService {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    /**
     * Searches conversations based on text, workspace, dates, tags, and favorite status.
     */
    public search(query: SearchQuery): Conversation[] {
        let results = this.db.getAll();

        // 1. Text filter (Fuzzy / Full Text Search)
        if (query.text && query.text.trim() !== '') {
            const searchTerms = query.text.toLowerCase().split(/\s+/).filter(Boolean);
            
            results = results.filter(conv => {
                const titleLower = conv.title.toLowerCase();
                
                // Check if all search terms match either title or any message content
                return searchTerms.every(term => {
                    if (titleLower.includes(term)) {
                        return true;
                    }
                    return conv.messages && conv.messages.some(msg => 
                        msg && typeof msg.content === 'string' && msg.content.toLowerCase().includes(term)
                    );
                });
            });
        }

        // 2. Workspace path filter
        if (query.workspacePath) {
            const targetPath = query.workspacePath.toLowerCase();
            results = results.filter(conv => 
                conv.workspacePath?.toLowerCase() === targetPath
            );
        }

        // 3. Date filters
        if (query.dateFrom) {
            const fromTime = new Date(query.dateFrom).getTime();
            results = results.filter(conv => 
                new Date(conv.timestamp).getTime() >= fromTime
            );
        }
        if (query.dateTo) {
            const toTime = new Date(query.dateTo).getTime();
            results = results.filter(conv => 
                new Date(conv.timestamp).getTime() <= toTime
            );
        }

        // 4. Tag filter
        if (query.tags && query.tags.length > 0) {
            results = results.filter(conv => 
                query.tags!.every(tag => conv.tags?.includes(tag))
            );
        }

        // 5. Favorites filter
        if (query.favoriteOnly) {
            results = results.filter(conv => !!conv.favorite);
        }

        // 6. Sort by timestamp descending (most recent first)
        results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        // 7. Pagination / Max Results limit
        const config = vscode.workspace.getConfiguration('copilotConversation');
        const maxResults = config.get<number>('maxResults', 100);
        return results.slice(0, maxResults);
    }

    /**
     * Gets all unique workspaces present in the indexed transcripts.
     */
    public getUniqueWorkspaces(): { path: string; name: string }[] {
        const seen = new Set<string>();
        const workspaces: { path: string; name: string }[] = [];

        for (const conv of this.db.getAll()) {
            if (conv.workspacePath && !seen.has(conv.workspacePath)) {
                seen.add(conv.workspacePath);
                workspaces.push({
                    path: conv.workspacePath,
                    name: conv.workspaceName || 'Unknown Workspace'
                });
            }
        }

        return workspaces;
    }

    /**
     * Gets all unique tags across all indexed conversations.
     */
    public getUniqueTags(): string[] {
        const tags = new Set<string>();
        for (const conv of this.db.getAll()) {
            if (conv.tags) {
                for (const tag of conv.tags) {
                    tags.add(tag);
                }
            }
        }
        return Array.from(tags).sort();
    }
}
