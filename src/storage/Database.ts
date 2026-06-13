import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Conversation } from '../models/Conversation';

export class Database {
    private dbPath: string;
    private conversations: Map<string, Conversation> = new Map();
    private isLoaded: boolean = false;
    private loadPromise: Promise<void> | null = null;

    constructor(context: vscode.ExtensionContext) {
        // Determine DB location
        const config = vscode.workspace.getConfiguration('copilotConversation');
        const customLoc = config.get<string>('storageLocation');
        
        if (customLoc && fs.existsSync(customLoc)) {
            this.dbPath = path.join(customLoc, 'copilot-conversation-db.json');
        } else {
            // Default to extension's global storage
            const storageDir = context.globalStorageUri.fsPath;
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }
            this.dbPath = path.join(storageDir, 'db.json');
        }
    }

    /**
     * Loads the database from disk.
     */
    public async load(): Promise<void> {
        if (this.isLoaded) {
            return;
        }

        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = (async () => {
            try {
                if (fs.existsSync(this.dbPath)) {
                    const data = await fs.promises.readFile(this.dbPath, 'utf8');
                    const list: Conversation[] = JSON.parse(data);
                    this.conversations.clear();
                    for (const item of list) {
                        this.conversations.set(item.id, item);
                    }
                }
                this.isLoaded = true;
            } catch (error) {
                console.error('Failed to load database:', error);
                // Initialize empty if read fails
                this.conversations.clear();
                this.isLoaded = true;
            } finally {
                this.loadPromise = null;
            }
        })();

        return this.loadPromise;
    }

    /**
     * Saves the database to disk.
     */
    public async save(): Promise<void> {
        try {
            const list = Array.from(this.conversations.values());
            const data = JSON.stringify(list, null, 2);
            await fs.promises.writeFile(this.dbPath, data, 'utf8');
        } catch (error) {
            console.error('Failed to save database:', error);
            throw error;
        }
    }

    /**
     * Gets all conversations.
     */
    public getAll(): Conversation[] {
        return Array.from(this.conversations.values());
    }

    /**
     * Gets a single conversation by ID.
     */
    public getById(id: string): Conversation | undefined {
        return this.conversations.get(id);
    }

    /**
     * Inserts or updates a conversation in the database.
     */
    public async upsert(conversation: Conversation): Promise<void> {
        const existing = this.conversations.get(conversation.id);
        if (existing) {
            // Preserve manual flags like tags and favorite if not present in the incoming update
            const mergedTags = conversation.tags && conversation.tags.length > 0
                ? conversation.tags
                : (existing.tags || []);
            const mergedFavorite = conversation.favorite !== undefined
                ? conversation.favorite
                : (existing.favorite || false);
                
            this.conversations.set(conversation.id, {
                ...existing,
                ...conversation,
                tags: mergedTags,
                favorite: mergedFavorite
            });
        } else {
            this.conversations.set(conversation.id, {
                tags: [],
                favorite: false,
                ...conversation
            });
        }
        await this.save();
    }

    /**
     * Updates specific fields of a conversation.
     */
    public async updateFields(id: string, updates: Partial<Conversation>): Promise<void> {
        const existing = this.conversations.get(id);
        if (!existing) {
            throw new Error(`Conversation with ID ${id} not found`);
        }
        this.conversations.set(id, {
            ...existing,
            ...updates
        });
        await this.save();
    }

    /**
     * Deletes a conversation by ID.
     */
    public async delete(id: string): Promise<void> {
        if (this.conversations.delete(id)) {
            await this.save();
        }
    }

    /**
     * Clears all conversations.
     */
    public async clear(): Promise<void> {
        this.conversations.clear();
        await this.save();
    }
}
