import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Conversation } from '../models/Conversation';

export class ConversationPanel {
    public static currentPanel: ConversationPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private conversation: Conversation;
    private disposables: vscode.Disposable[] = [];

    public get conversationId(): string {
        return this.conversation.id;
    }

    public updateConversation(conversation: Conversation) {
        this.conversation = conversation;
        this.update();
    }

    private constructor(panel: vscode.WebviewPanel, conversation: Conversation) {
        this.panel = panel;
        this.conversation = conversation;

        this.update();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'copy':
                        await vscode.env.clipboard.writeText(message.text);
                        vscode.window.showInformationMessage('Copied to clipboard!');
                        break;
                    case 'exportMarkdown':
                        await vscode.commands.executeCommand('copilotConversation.exportMarkdown', this.conversation.id);
                        break;
                    case 'exportJson':
                        await vscode.commands.executeCommand('copilotConversation.exportJson', this.conversation.id);
                        break;
                    case 'openFile':
                        await this.openFileReference(message.filePath);
                        break;
                    case 'toggleFavorite':
                        await vscode.commands.executeCommand('copilotConversation.toggleFavorite', this.conversation.id);
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    public static createOrShow(_context: vscode.ExtensionContext, conversation: Conversation) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ConversationPanel.currentPanel && ConversationPanel.currentPanel.conversation.id === conversation.id) {
            ConversationPanel.currentPanel.panel.reveal(column);
            return;
        }

        if (ConversationPanel.currentPanel) {
            ConversationPanel.currentPanel.panel.dispose();
        }

        const panel = vscode.window.createWebviewPanel(
            'conversationView',
            conversation.title,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        ConversationPanel.currentPanel = new ConversationPanel(panel, conversation);
    }

    private async openFileReference(filePath: string) {
        const wsPath = this.conversation.workspacePath;
        if (!wsPath) {
            vscode.window.showWarningMessage('No active workspace associated with this conversation.');
            return;
        }

        // Try to find the file
        let fullPath = path.isAbsolute(filePath) ? filePath : path.join(wsPath, filePath);
        
        // Handle potential drive casing and slash corrections
        fullPath = path.normalize(fullPath);

        if (fs.existsSync(fullPath)) {
            const uri = vscode.Uri.file(fullPath);
            try {
                await vscode.window.showTextDocument(uri);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
            }
        } else {
            // Search workspace for relative matches
            vscode.window.showWarningMessage(`File not found at: ${filePath}. Searching workspace...`);
            const relativePattern = new vscode.RelativePattern(wsPath, `**/${filePath}`);
            const uris = await vscode.workspace.findFiles(relativePattern, null, 1);
            if (uris.length > 0) {
                await vscode.window.showTextDocument(uris[0]);
            } else {
                vscode.window.showErrorMessage(`File "${filePath}" could not be found in this workspace.`);
            }
        }
    }

    private update() {
        this.panel.title = this.conversation.title;
        this.panel.webview.html = this.getHtmlForWebview();
    }

    private getHtmlForWebview(): string {
        const title = this.conversation.title;
        const messagesHtml = this.conversation.messages.map((msg, index) => {
            if (!msg.content || !msg.content.trim()) {
                return '';
            }
            const roleClass = msg.role === 'user' ? 'user' : 'assistant';
            const roleName = msg.role === 'user' ? 'You' : 'GitHub Copilot';
            const formattedContent = this.renderMarkdown(msg.content);
            const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const delay = index * 80;

            const avatarHtml = msg.role === 'user'
                ? `
                    <div class="avatar user-avatar" title="You">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                    </div>
                  `
                : `
                    <div class="avatar assistant-avatar" title="GitHub Copilot">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
                            <circle cx="12" cy="12" r="4"></circle>
                        </svg>
                    </div>
                  `;

            return `
                <div class="message-container ${roleClass}" style="animation-delay: ${delay}ms;">
                    ${avatarHtml}
                    <div class="message-bubble">
                        <div class="message-header">
                            <span class="role-name">${roleName}</span>
                            <span class="message-time">${timeStr}</span>
                        </div>
                        <div class="message-body">
                            ${formattedContent}
                        </div>
                        <div class="message-actions">
                            <button class="action-btn copy-btn" onclick="copyText(this, '${index}')" title="Copy Message">
                                <svg class="icon-copy" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path fill-rule="evenodd" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5z"/><path fill-rule="evenodd" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5z"/></svg>
                                <svg class="icon-check" style="display:none;" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>
                                <span class="btn-label">Copy</span>
                            </button>
                        </div>
                        <textarea id="raw-content-${index}" style="display:none;">${msg.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                    </div>
                </div>
            `;
        }).join('');

        const wsName = this.conversation.workspaceName || 'Unknown Workspace';
        const wsPath = this.conversation.workspacePath || 'N/A';
        const dateStr = new Date(this.conversation.timestamp).toLocaleString();

        const isFav = this.conversation.favorite;
        const favButtonHtml = isFav
            ? `<button class="btn btn-secondary btn-favorite" onclick="toggleFavorite()" title="Remove from Favorites"><svg class="star-icon filled" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/></svg> Favorited</button>`
            : `<button class="btn btn-secondary btn-favorite" onclick="toggleFavorite()" title="Add to Favorites"><svg class="star-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694z"/></svg> Favorite</button>`;

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Conversation Details</title>
                <link rel="preconnect" href="https://fonts.googleapis.com">
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700&display=swap" rel="stylesheet">
                <style>
                    :root {
                        --bg-primary: var(--vscode-editor-background, #1e1e1e);
                        --bg-secondary: var(--vscode-editorWidget-background, #252526);
                        --text-primary: var(--vscode-editor-foreground, #cccccc);
                        --text-secondary: var(--vscode-descriptionForeground, #858585);
                        --accent-blue: var(--vscode-button-background, #007acc);
                        --accent-blue-hover: var(--vscode-button-hoverBackground, #0062a3);
                        --border-color: var(--vscode-panel-border, var(--vscode-widget-border, #3c3c3c));
                        --code-bg: var(--vscode-textCodeBlock-background, var(--vscode-editor-background, #1e1e1e));
                        
                        --user-bubble: rgba(0, 122, 204, 0.1);
                        --assistant-bubble: rgba(0, 0, 0, 0.04);
                    }

                    body {
                        font-family: 'Inter', var(--vscode-font-family, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
                        background-color: var(--bg-primary);
                        color: var(--text-primary);
                        margin: 0;
                        padding: 0;
                        line-height: 1.6;
                    }

                    .container {
                        max-width: 850px;
                        margin: 0 auto;
                        padding: 30px 20px;
                    }

                    .header {
                        background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
                        backdrop-filter: blur(10px);
                        -webkit-backdrop-filter: blur(10px);
                        border: 1px solid var(--border-color);
                        border-radius: 12px;
                        padding: 20px;
                        margin-bottom: 35px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
                        position: sticky;
                        top: 15px;
                        z-index: 100;
                    }

                    .meta-info h1 {
                        font-family: 'Plus Jakarta Sans', sans-serif;
                        font-size: 1.6rem;
                        margin: 0 0 6px 0;
                        font-weight: 700;
                        letter-spacing: -0.3px;
                    }

                    .meta-details {
                        font-size: 0.85rem;
                        color: var(--text-secondary);
                        line-height: 1.4;
                    }

                    .meta-details span {
                        margin-right: 16px;
                    }

                    .toolbar {
                        display: flex;
                        gap: 8px;
                    }

                    .btn {
                        background-color: var(--accent-blue);
                        color: #ffffff;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: 500;
                        font-size: 0.85rem;
                        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                    }

                    .btn:hover {
                        background-color: var(--accent-blue-hover);
                        transform: translateY(-1px);
                        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
                    }

                    .btn:active {
                        transform: translateY(0);
                    }

                    .btn-secondary {
                        background-color: transparent;
                        border: 1px solid var(--border-color);
                        color: var(--text-primary);
                        box-shadow: none;
                    }

                    .btn-secondary:hover {
                        background-color: color-mix(in srgb, var(--border-color) 20%, transparent);
                        border-color: var(--text-secondary);
                        box-shadow: none;
                    }

                    .chat-area {
                        display: flex;
                        flex-direction: column;
                        gap: 24px;
                    }

                    .message-container {
                        display: flex;
                        gap: 16px;
                        max-width: 85%;
                        opacity: 0;
                        transform: translateY(12px);
                        animation: slideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                    }

                    .message-container.user {
                        flex-direction: row-reverse;
                        align-self: flex-end;
                    }

                    .message-container.assistant {
                        align-self: flex-start;
                    }

                    .avatar {
                        width: 36px;
                        height: 36px;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                        color: #ffffff;
                        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12);
                    }

                    .user-avatar {
                        background: linear-gradient(135deg, #3b82f6, #06b6d4);
                    }

                    .assistant-avatar {
                        background: linear-gradient(135deg, #a855f7, #ec4899);
                    }

                    .message-bubble {
                        padding: 16px 20px;
                        border: 1px solid var(--border-color);
                        position: relative;
                        display: flex;
                        flex-direction: column;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
                        transition: border-color 0.2s ease;
                    }

                    .message-container.user .message-bubble {
                        background-color: var(--user-bubble);
                        border-radius: 18px 18px 4px 18px;
                        border-color: transparent;
                    }

                    .message-container.assistant .message-bubble {
                        background-color: var(--assistant-bubble);
                        border-radius: 18px 18px 18px 4px;
                    }

                    .message-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 8px;
                        font-size: 0.8rem;
                        color: var(--text-secondary);
                        border-bottom: 1px solid color-mix(in srgb, var(--border-color) 40%, transparent);
                        padding-bottom: 4px;
                    }

                    .role-name {
                        font-weight: 600;
                    }

                    .message-time {
                        font-size: 0.75rem;
                    }

                    .message-body {
                        font-size: 0.95rem;
                        line-height: 1.6;
                        word-break: break-word;
                    }

                    .message-actions {
                        display: flex;
                        justify-content: flex-end;
                        margin-top: 10px;
                        opacity: 0;
                        transition: opacity 0.2s ease;
                    }

                    .message-bubble:hover .message-actions {
                        opacity: 1;
                    }

                    .action-btn {
                        background: transparent;
                        border: 1px solid var(--border-color);
                        color: var(--text-secondary);
                        border-radius: 4px;
                        padding: 3px 8px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        font-size: 0.7rem;
                    }

                    .action-btn:hover {
                        color: var(--text-primary);
                        border-color: var(--text-secondary);
                        background-color: color-mix(in srgb, var(--border-color) 20%, transparent);
                    }

                    .action-btn.copied {
                        background-color: #10b981;
                        border-color: #10b981;
                        color: #ffffff;
                    }

                    /* Code block formatting */
                    .code-block-container {
                        margin: 16px 0;
                        border-radius: 8px;
                        overflow: hidden;
                        border: 1px solid var(--border-color);
                        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
                    }

                    .code-block-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 8px 14px;
                        background-color: color-mix(in srgb, var(--bg-secondary) 80%, var(--bg-primary));
                        border-bottom: 1px solid var(--border-color);
                        font-family: 'Inter', sans-serif;
                        font-weight: 500;
                        font-size: 0.75rem;
                        color: var(--text-secondary);
                        user-select: none;
                    }

                    .code-block-lang {
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        font-weight: 600;
                    }

                    .code-block-copy-btn {
                        background: transparent;
                        border: 1px solid var(--border-color);
                        color: var(--text-secondary);
                        padding: 3px 8px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 0.7rem;
                        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    }

                    .code-block-copy-btn:hover {
                        color: var(--text-primary);
                        border-color: var(--text-secondary);
                        background-color: color-mix(in srgb, var(--border-color) 20%, transparent);
                    }

                    .code-block-copy-btn.copied {
                        background-color: #10b981;
                        border-color: #10b981;
                        color: #ffffff;
                    }

                    pre {
                        margin: 0;
                        background-color: var(--code-bg);
                        padding: 14px;
                        overflow-x: auto;
                    }

                    code {
                        font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
                        font-size: 0.85rem;
                    }

                    p code {
                        background-color: var(--code-bg);
                        border: 1px solid var(--border-color);
                        border-radius: 4px;
                        padding: 2px 5px;
                        font-size: 0.85em;
                    }

                    .file-link {
                        color: var(--accent-blue-hover);
                        text-decoration: underline;
                        cursor: pointer;
                        font-weight: 500;
                    }

                    .file-link:hover {
                        opacity: 0.85;
                    }

                    .star-icon {
                        display: inline-block;
                        vertical-align: middle;
                    }

                    .star-icon.filled {
                        color: #ffb700;
                    }

                    .btn-favorite {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    }

                    @keyframes slideIn {
                        to { 
                            opacity: 1; 
                            transform: translateY(0); 
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <div class="meta-info">
                            <h1>${title}</h1>
                            <div class="meta-details">
                                <span><strong>Workspace:</strong> ${wsName} (${wsPath})</span><br/>
                                <span><strong>Last Updated:</strong> ${dateStr}</span>
                            </div>
                        </div>
                        <div class="toolbar">
                            ${favButtonHtml}
                            <button class="btn btn-secondary" onclick="exportMarkdown()">Export MD</button>
                            <button class="btn btn-secondary" onclick="exportJson()">Export JSON</button>
                        </div>
                    </div>
                    <div class="chat-area">
                        ${messagesHtml}
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    function toggleFavorite() {
                        vscode.postMessage({ command: 'toggleFavorite' });
                    }

                    function copyText(btn, index) {
                        const raw = document.getElementById('raw-content-' + index).value;
                        vscode.postMessage({
                            command: 'copy',
                            text: raw
                        });
                        
                        const iconCopy = btn.querySelector('.icon-copy');
                        const iconCheck = btn.querySelector('.icon-check');
                        const label = btn.querySelector('.btn-label');
                        
                        iconCopy.style.display = 'none';
                        iconCheck.style.display = 'inline-block';
                        label.textContent = 'Copied!';
                        btn.classList.add('copied');
                        
                        setTimeout(() => {
                            iconCopy.style.display = 'inline-block';
                            iconCheck.style.display = 'none';
                            label.textContent = 'Copy';
                            btn.classList.remove('copied');
                        }, 1500);
                    }

                    function copyCode(btn) {
                        const container = btn.closest('.code-block-container');
                        const code = container.querySelector('code').innerText;
                        
                        navigator.clipboard.writeText(code).then(() => {
                            const iconCopy = btn.querySelector('.icon-copy');
                            const iconCheck = btn.querySelector('.icon-check');
                            const label = btn.querySelector('.btn-label');
                            
                            iconCopy.style.display = 'none';
                            iconCheck.style.display = 'inline-block';
                            label.textContent = 'Copied!';
                            btn.classList.add('copied');
                            
                            setTimeout(() => {
                                iconCopy.style.display = 'inline-block';
                                iconCheck.style.display = 'none';
                                label.textContent = 'Copy';
                                btn.classList.remove('copied');
                            }, 1500);
                        }).catch(err => {
                            console.error('Failed to copy code: ', err);
                        });
                    }

                    function exportMarkdown() {
                        vscode.postMessage({ command: 'exportMarkdown' });
                    }

                    function exportJson() {
                        vscode.postMessage({ command: 'exportJson' });
                    }

                    function openFile(filePath) {
                        vscode.postMessage({
                            command: 'openFile',
                            filePath: filePath
                        });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private renderMarkdown(markdown: string): string {
        if (!markdown) return '';

        // Split by fenced code blocks
        const fencedRegex = /(```\w*\n[\s\S]*?```)/g;
        const parts = markdown.split(fencedRegex);

        const renderedParts = parts.map((part, index) => {
            const isFencedCode = index % 2 === 1;
            if (isFencedCode) {
                // Fenced code block
                const match = part.match(/```(\w*)\n([\s\S]*?)```/);
                const lang = match ? match[1] : '';
                const code = match ? match[2] : '';
                const escapedCode = this.escapeHtml(code.trim());
                const displayLang = lang ? lang : 'code';
                
                return `
                    <div class="code-block-container">
                        <div class="code-block-header">
                            <span class="code-block-lang">${displayLang}</span>
                            <button class="code-block-copy-btn" onclick="copyCode(this)" title="Copy Code">
                                <svg class="icon-copy" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path fill-rule="evenodd" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5z"/><path fill-rule="evenodd" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5z"/></svg>
                                <svg class="icon-check" style="display:none;" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>
                                <span class="btn-label">Copy</span>
                            </button>
                        </div>
                        <pre><code class="language-${lang}">${escapedCode}</code></pre>
                    </div>
                `;
            } else {
                // Plain text block (may contain inline code, bold, italic, links, newlines)
                return this.renderTextBlock(part);
            }
        });

        return renderedParts.join('');
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private renderTextBlock(text: string): string {
        // Split by inline code: `code`
        const inlineRegex = /(`[^`]+`)/g;
        const parts = text.split(inlineRegex);

        const rendered = parts.map((part, index) => {
            const isInlineCode = index % 2 === 1;
            if (isInlineCode) {
                const codeContent = part.substring(1, part.length - 1);
                return `<code>${this.escapeHtml(codeContent)}</code>`;
            } else {
                // True text - escape and apply markdown inline styling
                let escaped = this.escapeHtml(part);

                // Strong: **text**
                escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

                // Italic: *text*
                escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');

                // Get extensions list from settings
                const config = vscode.workspace.getConfiguration('copilotConversation');
                const enabledExtensions = config.get<string[]>('fileLinkExtensions', [
                    'ts', 'js', 'json', 'css', 'html', 'yml', 'yaml', 'md', 'txt', 'py', 'sh', 'go', 'cpp', 'c', 'h', 'rs', 'java', 'cs', 'rb', 'php', 'swift', 'sql'
                ]);
                const extPattern = enabledExtensions.join('|');
                const fileRegex = new RegExp(`\\b(?:[a-zA-Z0-9_\\-\\.\\/]+)\\.(?:${extPattern})\\b`, 'g');

                // File references linkification
                escaped = escaped.replace(fileRegex, (match) => {
                    return `<span class="file-link" onclick="openFile('${match}')">${match}</span>`;
                });

                // Newlines to <br/>
                escaped = escaped.replace(/\n/g, '<br/>');

                return escaped;
            }
        });

        return rendered.join('');
    }

    public dispose() {
        ConversationPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
