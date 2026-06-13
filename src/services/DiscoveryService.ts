import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import * as vscode from 'vscode';
import { Conversation, Message } from '../models/Conversation';
import { WorkspaceResolver } from './WorkspaceResolver';

export interface DiscoveredFile {
    filePath: string;
    workspaceStoragePath: string;
    mtime: number;
}

export class DiscoveryService {
    /**
     * Detects standard workspaceStorage locations based on OS and settings.
     */
    public static getStoragePaths(): string[] {
        const paths: string[] = [];
        
        // 1. User configured path
        try {
            const config = vscode.workspace.getConfiguration('copilotConversation');
            const customPath = config.get<string>('storageLocation');
            if (customPath && customPath.trim() !== '') {
                const resolved = path.normalize(customPath.trim());
                if (fs.existsSync(resolved)) {
                    paths.push(resolved);
                    return paths;
                }
            }
        } catch (e) {
            // Ignore vscode undefined when running in test runner outside VS Code
        }

        // 2. Default paths based on platform
        const home = os.homedir();
        const appData = process.env.APPDATA; // Windows only

        if (os.platform() === 'win32' && appData) {
            paths.push(path.join(appData, 'Code', 'User', 'workspaceStorage'));
            paths.push(path.join(appData, 'Code - Insiders', 'User', 'workspaceStorage'));
            paths.push(path.join(appData, 'VSCodium', 'User', 'workspaceStorage'));
        } else if (os.platform() === 'darwin') {
            paths.push(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'));
            paths.push(path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'workspaceStorage'));
            paths.push(path.join(home, 'Library', 'Application Support', 'VSCodium', 'User', 'workspaceStorage'));
        } else {
            // Linux and other Posix
            paths.push(path.join(home, '.config', 'Code', 'User', 'workspaceStorage'));
            paths.push(path.join(home, '.config', 'Code - Insiders', 'User', 'workspaceStorage'));
            paths.push(path.join(home, '.config', 'VSCodium', 'User', 'workspaceStorage'));
        }

        // Return only paths that exist on disk
        return paths.filter(p => fs.existsSync(p));
    }

    /**
     * Scans storage folders to find all Copilot chat transcripts (.jsonl files).
     */
    public static async discoverTranscripts(): Promise<DiscoveredFile[]> {
        const storagePaths = this.getStoragePaths();
        const discoveredFiles: DiscoveredFile[] = [];

        for (const storagePath of storagePaths) {
            try {
                const subdirs = await fs.promises.readdir(storagePath);
                for (const subdir of subdirs) {
                    const workspaceStoragePath = path.join(storagePath, subdir);
                    const copilotTranscriptsPath = path.join(
                        workspaceStoragePath, 
                        'GitHub.copilot-chat', 
                        'transcripts'
                    );

                    if (fs.existsSync(copilotTranscriptsPath)) {
                        const files = await fs.promises.readdir(copilotTranscriptsPath);
                        for (const file of files) {
                            if (file.endsWith('.jsonl')) {
                                const filePath = path.join(copilotTranscriptsPath, file);
                                try {
                                    const stat = await fs.promises.stat(filePath);
                                    discoveredFiles.push({
                                        filePath,
                                        workspaceStoragePath,
                                        mtime: stat.mtimeMs
                                    });
                                } catch (e) {
                                    // Skip unreadable files
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`Error reading storage path ${storagePath}:`, error);
            }
        }

        return discoveredFiles;
    }

    /**
     * Parses a single transcript .jsonl file into a Conversation model.
     */
    public static async parseTranscript(
        filePath: string, 
        workspaceStoragePath: string
    ): Promise<Conversation | undefined> {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }

        const messages: Message[] = [];
        let sessionId = path.basename(filePath, '.jsonl');
        let startTime = new Date().toISOString();

        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        try {
            for await (const line of rl) {
                if (!line.trim()) {
                    continue;
                }
                try {
                    const event = JSON.parse(line);
                    const timestamp = event.timestamp || new Date().toISOString();

                    if (event.type === 'session.start') {
                        if (event.data?.sessionId) {
                            sessionId = event.data.sessionId;
                        }
                        if (event.data?.startTime) {
                            startTime = event.data.startTime;
                        }
                    } else if (event.type === 'user.message') {
                        const content = (event.data?.content || '').trim();
                        if (content) {
                            messages.push({
                                role: 'user',
                                content: event.data.content,
                                timestamp: timestamp
                            });
                        }
                    } else if (event.type === 'assistant.message') {
                        const content = (event.data?.content || '').trim();
                        if (content) {
                            messages.push({
                                role: 'assistant',
                                content: event.data.content,
                                timestamp: timestamp
                            });
                        }
                    }
                } catch (err) {
                    // Ignore malformed lines
                }
            }
        } catch (error) {
            console.error(`Failed to parse transcript file ${filePath}:`, error);
            return undefined;
        } finally {
            fileStream.destroy();
        }

        if (messages.length === 0) {
            // Skip empty transcripts to keep index clean
            return undefined;
        }

        // Try to resolve workspace metadata
        let workspacePath: string | undefined;
        let workspaceName: string | undefined;

        const resolved = await WorkspaceResolver.resolve(workspaceStoragePath);
        if (resolved) {
            workspacePath = resolved.workspacePath;
            workspaceName = resolved.workspaceName;
        }

        // Extract Copilot-specific title from state.vscdb
        const dbTitles = await WorkspaceResolver.resolveTitles(workspaceStoragePath);
        const copilotTitle = dbTitles.get(sessionId);

        // Determine title: use the copilot title if found, else first user message, else fallback
        let title = copilotTitle || 'Conversation ' + sessionId.substring(0, 8);
        if (!copilotTitle) {
            const firstUserMsg = messages.find(m => m.role === 'user');
            if (firstUserMsg && firstUserMsg.content) {
                const cleanContent = firstUserMsg.content
                    .replace(/[\r\n]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (cleanContent.length > 60) {
                    title = cleanContent.substring(0, 57) + '...';
                } else if (cleanContent.length > 0) {
                    title = cleanContent;
                }
            }
        }

        // Use the last message timestamp or fallback to startTime
        const lastMsg = messages[messages.length - 1];
        const timestamp = lastMsg?.timestamp || startTime;

        return {
            id: sessionId,
            title,
            workspacePath,
            workspaceName,
            timestamp,
            messages,
            sourceFile: filePath
        };
    }
}
