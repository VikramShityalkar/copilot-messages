import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Database } from '../storage/Database';
import { DiscoveryService } from './DiscoveryService';

export class IndexService implements vscode.Disposable {
    private db: Database;
    private watchers: Map<string, fs.FSWatcher> = new Map();
    private isIndexing: boolean = false;
    private onDidIndexEventEmitter = new vscode.EventEmitter<void>();
    public readonly onDidIndex = this.onDidIndexEventEmitter.event;

    constructor(db: Database) {
        this.db = db;
    }

    /**
     * Ensures that the database has been loaded from disk.
     */
    public async ensureLoaded(): Promise<void> {
        await this.db.load();
    }

    /**
     * Runs full or incremental indexing.
     * Checks files' modification times to skip parsing unchanged transcripts.
     */
    public async index(force: boolean = false): Promise<number> {
        if (this.isIndexing) {
            return 0;
        }
        this.isIndexing = true;

        try {
            await this.db.load();
            const discovered = await DiscoveryService.discoverTranscripts();
            let count = 0;

            const existingMap = new Map<string, number>();
            if (!force) {
                // Read what we have in db to get mtime / paths
                for (const conv of this.db.getAll()) {
                    try {
                        if (fs.existsSync(conv.sourceFile)) {
                            const stat = fs.statSync(conv.sourceFile);
                            existingMap.set(conv.sourceFile, stat.mtimeMs);
                        }
                    } catch (e) {
                        // File might have been deleted, clean it up from DB
                        await this.db.delete(conv.id);
                    }
                }
            }

            for (const file of discovered) {
                const existingMtime = existingMap.get(file.filePath);
                if (force || existingMtime === undefined || file.mtime > existingMtime) {
                    const parsed = await DiscoveryService.parseTranscript(file.filePath, file.workspaceStoragePath);
                    if (parsed) {
                        await this.db.upsert(parsed);
                        count++;
                    }
                }
            }

            if (count > 0) {
                await this.db.save();
            }
            this.onDidIndexEventEmitter.fire();

            // Set up watchers if enabled
            this.setupWatchers();

            return count;
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Sets up directory watchers on discovered transcript folders.
     */
    private setupWatchers(): void {
        const config = vscode.workspace.getConfiguration('copilotConversation');
        const watchChanges = config.get<boolean>('watchChanges', true);

        if (!watchChanges) {
            this.disposeWatchers();
            return;
        }

        const paths = DiscoveryService.getStoragePaths();
        for (const storagePath of paths) {
            try {
                const subdirs = fs.readdirSync(storagePath);
                for (const subdir of subdirs) {
                    const transcriptsDir = path.join(storagePath, subdir, 'GitHub.copilot-chat', 'transcripts');
                    if (fs.existsSync(transcriptsDir) && !this.watchers.has(transcriptsDir)) {
                        try {
                            const watcher = fs.watch(transcriptsDir, async (_eventType, filename) => {
                                if (filename && filename.endsWith('.jsonl')) {
                                    const filePath = path.join(transcriptsDir, filename);
                                    const parentStoragePath = path.join(storagePath, subdir);
                                    
                                    // Delay slightly to allow file write to complete
                                    setTimeout(async () => {
                                        try {
                                            if (fs.existsSync(filePath)) {
                                                const parsed = await DiscoveryService.parseTranscript(filePath, parentStoragePath);
                                                if (parsed) {
                                                    await this.db.upsert(parsed);
                                                    await this.db.save();
                                                    this.onDidIndexEventEmitter.fire();
                                                }
                                            } else {
                                                // File deleted
                                                const sessionId = path.basename(filePath, '.jsonl');
                                                await this.db.delete(sessionId);
                                                this.onDidIndexEventEmitter.fire();
                                            }
                                        } catch (err) {
                                            console.error(`Error processing file change on ${filePath}:`, err);
                                        }
                                    }, 200);
                                }
                            });
                            this.watchers.set(transcriptsDir, watcher);
                        } catch (e) {
                            // Watch limit or permission errors, skip
                        }
                    }
                }
            } catch (error) {
                // Ignore storage dir issues
            }
        }
    }

    /**
     * Disposes active watchers.
     */
    public disposeWatchers(): void {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
    }

    /**
     * Disposes watchers and event emitters when extension is deactivated.
     */
    public dispose(): void {
        this.disposeWatchers();
        this.onDidIndexEventEmitter.dispose();
    }
}
