import Module = require('module');
import * as path from 'path';
import * as fs from 'fs';

// Setup dynamic fixtures directory
const fixturesDir = path.join(__dirname, 'fixtures');
const mockStoragePath = path.join(fixturesDir, 'workspaceStorage');

// Mock VS Code
const originalRequire = (Module as any).prototype.require;
(Module as any).prototype.require = function (id: string) {
    if (id === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    get: (key: string, defaultValue: any) => {
                        if (key === 'storageLocation') {
                            return mockStoragePath;
                        }
                        if (key === 'maxResults') {
                            return 100;
                        }
                        return defaultValue;
                    }
                })
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

import { DiscoveryService } from '../services/DiscoveryService';
import { WorkspaceResolver } from '../services/WorkspaceResolver';
import { Database } from '../storage/Database';
import { SearchService } from '../services/SearchService';

function setupFixtures() {
    const mockWsDir = path.join(mockStoragePath, 'mockWorkspace');
    const transcriptsDir = path.join(mockWsDir, 'GitHub.copilot-chat', 'transcripts');

    // Clean up mockStoragePath first if it exists to prevent contamination
    if (fs.existsSync(mockStoragePath)) {
        fs.rmSync(mockStoragePath, { recursive: true, force: true });
    }

    // Create directories
    fs.mkdirSync(transcriptsDir, { recursive: true });

    // Create workspace.json
    fs.writeFileSync(
        path.join(mockWsDir, 'workspace.json'),
        JSON.stringify({ folder: 'file:///d:/mock-workspace-folder' }, null, 2),
        'utf8'
    );

    // Create state.vscdb
    fs.writeFileSync(
        path.join(mockWsDir, 'state.vscdb'),
        `{"sessionId": "a1b2c3d4-1234-1234-1234-1234567890ab", "title": "Postgres Migration Guide"}`,
        'utf8'
    );

    // Create a1b2c3d4-1234-1234-1234-1234567890ab.jsonl
    const transcriptLines = [
        JSON.stringify({ type: 'session.start', timestamp: '2026-06-13T12:00:00.000Z', data: { sessionId: 'a1b2c3d4-1234-1234-1234-1234567890ab', startTime: '2026-06-13T12:00:00.000Z' } }),
        JSON.stringify({ type: 'user.message', timestamp: '2026-06-13T12:01:00.000Z', data: { content: 'How do I run a postgres migration?' } }),
        JSON.stringify({ type: 'assistant.message', timestamp: '2026-06-13T12:02:00.000Z', data: { content: 'Use the yaml migration file structure.' } })
    ].join('\n') + '\n';

    fs.writeFileSync(
        path.join(transcriptsDir, 'a1b2c3d4-1234-1234-1234-1234567890ab.jsonl'),
        transcriptLines,
        'utf8'
    );
}

async function runTest() {
    console.log('Setting up sandboxed test fixtures...');
    setupFixtures();

    console.log('\n--- TEST 1: Detect Storage Paths ---');
    const paths = DiscoveryService.getStoragePaths();
    console.log('Detected storage paths:', paths);

    if (paths.length === 0 || paths[0] !== mockStoragePath) {
        console.error('Test failed: Storage path detection mismatch.');
        process.exit(1);
    }

    console.log('\n--- TEST 2: Discover Transcripts ---');
    const transcripts = await DiscoveryService.discoverTranscripts();
    console.log(`Discovered ${transcripts.length} transcript files.`);

    if (transcripts.length !== 1) {
        console.error('Test failed: Should discover exactly 1 transcript file.');
        process.exit(1);
    }

    const tFile = transcripts[0];
    console.log(`- Path: ${tFile.filePath}`);
    console.log(`- Workspace Storage Path: ${tFile.workspaceStoragePath}`);
    
    console.log(`- Resolving workspace...`);
    const resolved = await WorkspaceResolver.resolve(tFile.workspaceStoragePath);
    if (resolved && resolved.workspaceName === 'mock-workspace-folder' && resolved.workspacePath.includes('mock-workspace-folder')) {
        console.log(`  Resolved Name: ${resolved.workspaceName}`);
        console.log(`  Resolved Path: ${resolved.workspacePath}`);
    } else {
        console.error(`  Test failed to resolve workspace details correctly. Got:`, resolved);
        process.exit(1);
    }

    console.log(`- Parsing transcript...`);
    const conv = await DiscoveryService.parseTranscript(tFile.filePath, tFile.workspaceStoragePath);
    if (conv && conv.id === 'a1b2c3d4-1234-1234-1234-1234567890ab' && conv.title === 'Postgres Migration Guide') {
        console.log(`  Session ID: ${conv.id}`);
        console.log(`  Title: "${conv.title}"`);
        console.log(`  Timestamp: ${conv.timestamp}`);
        console.log(`  Message Count: ${conv.messages.length}`);
    } else {
        console.error(`  Test failed to parse transcript correctly. Got:`, conv);
        process.exit(1);
    }

    console.log('\n--- TEST 3: Database & Search Service ---');
    const mockContext = {
        globalStorageUri: {
            fsPath: path.join(__dirname, '../../test-global-storage')
        }
    };
    
    // Clean up test storage if exists
    if (fs.existsSync(mockContext.globalStorageUri.fsPath)) {
        fs.rmSync(mockContext.globalStorageUri.fsPath, { recursive: true, force: true });
    }
    
    const db = new Database(mockContext as any);
    await db.load();
    const searchService = new SearchService(db);
    
    // Seed DB with discovered transcripts
    for (const file of transcripts) {
        const conv = await DiscoveryService.parseTranscript(file.filePath, file.workspaceStoragePath);
        if (conv) {
            await db.upsert(conv); // This now also tests persistence!
        }
    }
    
    console.log(`Seeded Database with ${db.getAll().length} conversations.`);
    if (db.getAll().length !== 1) {
        console.error('Test failed: Database should contain exactly 1 conversation.');
        process.exit(1);
    }
    
    // Search 1: Search for "YAML"
    console.log('\nExecuting search for term: "yaml"');
    const search1 = searchService.search({ text: 'yaml' });
    console.log(`FTS Search for "yaml": found ${search1.length} matches.`);
    if (search1.length !== 1 || search1[0].title !== 'Postgres Migration Guide') {
        console.error('Test failed: FTS Search for "yaml" returned incorrect results.');
        process.exit(1);
    }

    // Search 2: Search for "postgres"
    console.log('\nExecuting search for term: "postgres"');
    const search2 = searchService.search({ text: 'postgres' });
    console.log(`FTS Search for "postgres": found ${search2.length} matches.`);
    if (search2.length !== 1) {
        console.error('Test failed: FTS Search for "postgres" returned incorrect results.');
        process.exit(1);
    }

    // Search 3: Unique workspaces
    console.log('\nFetching unique workspaces:');
    const workspaces = searchService.getUniqueWorkspaces();
    console.log(workspaces);
    if (workspaces.length !== 1 || workspaces[0].name !== 'mock-workspace-folder') {
        console.error('Test failed: Unique workspaces resolution returned incorrect results.');
        process.exit(1);
    }

    // Cleanup fixtures
    try {
        fs.rmSync(fixturesDir, { recursive: true, force: true });
        fs.rmSync(mockContext.globalStorageUri.fsPath, { recursive: true, force: true });
        console.log('\nCleaned up test fixtures successfully.');
    } catch (e) {
        console.warn('Failed to clean up test fixtures:', e);
    }

    console.log('\nALL TESTS PASSED SUCCESSFULLY!');
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
