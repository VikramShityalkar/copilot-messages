import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ResolvedWorkspace {
    workspacePath: string;
    workspaceName: string;
}

export class WorkspaceResolver {
    /**
     * Resolves workspace details from a workspaceStorage subdirectory path.
     * @param workspaceStoragePath Absolute path to a specific workspaceStorage directory (e.g., .../workspaceStorage/hash)
     */
    public static async resolve(workspaceStoragePath: string): Promise<ResolvedWorkspace | undefined> {
        const workspaceJsonPath = path.join(workspaceStoragePath, 'workspace.json');
        if (!fs.existsSync(workspaceJsonPath)) {
            return undefined;
        }

        try {
            const content = await fs.promises.readFile(workspaceJsonPath, 'utf8');
            const data = JSON.parse(content);

            let uriStr: string | undefined;
            if (data.folder) {
                uriStr = data.folder;
            } else if (data.workspace) {
                uriStr = data.workspace;
            }

            if (!uriStr) {
                return undefined;
            }

            // Decode the URI and get the absolute path
            let workspacePath = '';
            try {
                // Use standard VS Code API for path resolution
                workspacePath = vscode.Uri.parse(uriStr).fsPath;
            } catch (e) {
                // Fallback for tests running outside VS Code
                const decodedUri = decodeURIComponent(uriStr);
                if (decodedUri.startsWith('file:///')) {
                    workspacePath = decodedUri.substring(8);
                } else if (decodedUri.startsWith('file://')) {
                    workspacePath = decodedUri.substring(7);
                } else {
                    workspacePath = decodedUri;
                }

                // Clean up windows drive letters (e.g. d:/ -> D:/)
                if (/^[a-zA-Z]:/.test(workspacePath)) {
                    workspacePath = workspacePath.replace(/\\/g, '/');
                } else {
                    // For Unix systems
                    if (!workspacePath.startsWith('/')) {
                        workspacePath = '/' + workspacePath;
                    }
                }
            }

            // Extract the workspace name (last folder segment)
            const parts = workspacePath.split('/').filter(Boolean);
            let workspaceName = parts[parts.length - 1] || 'Unknown Workspace';

            // Strip suffix if it's a code-workspace file
            const suffix = '.code-workspace';
            if (workspaceName.endsWith(suffix)) {
                workspaceName = workspaceName.substring(0, workspaceName.length - suffix.length);
            }

            // Normalize workspacePath back to platform-specific format for local fs operations
            const normalizedPath = path.normalize(workspacePath);

            return {
                workspacePath: normalizedPath,
                workspaceName: workspaceName
            };
        } catch (error) {
            console.error(`Error resolving workspace for path ${workspaceStoragePath}:`, error);
            return undefined;
        }
    }

    private static titlesCache: Map<string, Map<string, string>> = new Map();

    /**
     * Extracts session titles from the state.vscdb SQLite binary file inside the workspaceStorage directory.
     */
    public static async resolveTitles(workspaceStoragePath: string): Promise<Map<string, string>> {
        const cached = this.titlesCache.get(workspaceStoragePath);
        if (cached) {
            return cached;
        }

        const titles = new Map<string, string>();
        const dbPath = path.join(workspaceStoragePath, 'state.vscdb');
        if (!fs.existsSync(dbPath)) {
            return titles;
        }

        try {
            // Read file in chunks to avoid loading a potentially huge string into memory
            const CHUNK_SIZE = 64 * 1024; // 64KB
            const OVERLAP = 1024;         // 1KB overlap to not miss matches on boundary
            
            const stream = fs.createReadStream(dbPath, { highWaterMark: CHUNK_SIZE });
            let leftover = '';
            const regex = /"sessionId"\s*:\s*"([a-f0-9-]+)"\s*,\s*"title"\s*:\s*"([^"]+)"/g;

            for await (const chunk of stream) {
                const chunkBuf = chunk as Buffer;
                const text = leftover + chunkBuf.toString('utf8');
                let match;
                regex.lastIndex = 0;
                let lastIndex = 0;

                while ((match = regex.exec(text)) !== null) {
                    titles.set(match[1], match[2]);
                    lastIndex = regex.lastIndex;
                }

                // Keep the last part of the string in case a match was cut in half
                leftover = text.substring(lastIndex);
                if (leftover.length > OVERLAP) {
                    leftover = leftover.substring(leftover.length - OVERLAP);
                }
            }
            
            this.titlesCache.set(workspaceStoragePath, titles);
        } catch (error) {
            console.error(`Error extracting titles from ${dbPath}:`, error);
        }

        return titles;
    }
}
