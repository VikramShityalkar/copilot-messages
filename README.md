# Copilot Conversation

GitHub Copilot Chat is an incredible companion for writing code, but developers frequently face several frustrations:
* **Lost Context**: Conversations are stored deep in system directories, making it difficult to revisit a brilliant solution from last week.
* **No Global Search**: You can't search across all your past conversations or locate code snippets from multiple projects simultaneously.
* **Lack of Organization**: There is no way to bookmark, categorize, or tag conversations for future reference.
* **Hidden Memories**: The facts and preferences that Copilot learns and captures about your projects (User and Repository memories) are hidden away in internal folders, offering no easy way to inspect or edit them.

**Copilot Conversation** solves these problems by providing a 100% local, centralized search, tagging, favorites, and analytics interface for your GitHub Copilot Chat history. Access, organize, search, and export your past conversations—and manage your captured Copilot Memories—directly from your sidebar.

> [!TIP]
> **Have feedback or new feature requirements?** Please report issues and requirements on our [GitHub Issues page](https://github.com/VikramShityalkar/copilot-messages/issues)!

---

## 🔒 100% Local, 100% Private

Privacy is critical for software development. This extension is designed with a **privacy-first** approach:

* **Zero Network Requests**: The extension contains **no telemetry, no tracking, and no external API calls**. It never contacts any server.
* **Direct Local Reading**: Your Copilot Chat conversations are stored locally on your machine by VS Code. This extension reads directly from your VS Code `workspaceStorage` paths, parses the logs, and stores indexes locally in the extension's isolated global storage directory.
* **Your Code Stays Yours**: Your chat history, session titles, workspace associations, and code snippets **never leave your machine**.

---

## 🚀 Key Features

* **Centralized Full-Text Search**: Run fuzzy searches across all chat session logs. Quickly find that regex pattern, database migration syntax, or architectural discussion from weeks ago.
* **Visual Theme-Adaptive Webview**: A modern, responsive chat interface that inherits your active VS Code theme (colors, highlights, and layouts). Features Plus Jakarta Sans headers and smooth staggered slide-in animations.
* **Smart Code Block Copying**: Code blocks in conversations are rendered with dedicated language banners and separate **Copy Code** buttons so you can grab code snippets cleanly without copying container markup.
* **Tagging & Favorites**: Organize your conversations by category (e.g. `architecture`, `database`, `performance`, `security`) and star your favorite sessions to find them instantly.
* **Multi-Format Exports**: Export individual conversations or entire search results to **Markdown (.md)** or **JSON** for documentation and code sharing.
* **Dynamic Workspace Resolution**: Automatically identifies which local workspace a chat session belongs to, displaying project folder tags in your sidebar.

---

## 🛠️ Usage

### Sidebar Panels
After installation, click the **Copilot Conversation** icon on your VS Code Activity Bar to open the explorer sidebar. You'll see:
1. **Recent Conversations**: A chronological list of your chat sessions.
2. **Favorites**: Your starred conversations.
3. **Tags**: Conversations grouped by their tags.
4. **Workspaces**: Conversations grouped by the workspace where they were initiated.
5. **Copilot Memories**: Structured view of local preferences and facts captured by Copilot's memory tool, grouped by scope (Global and Workspace). Clicking any item opens the memory markdown file directly for viewing or editing.

### Commands
Open the VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type:
* `Copilot Conversation: Search Conversations` - Opens a QuickPick search bar to perform real-time, debounced in-memory searches.
* `Copilot Conversation: Reindex` - Triggers an incremental/full scan of VS Code transcript logs on disk.

---

## ⚙️ Configuration

Customize the extension behaviors in your VS Code settings (`settings.json`):

* `copilotConversation.enableAutoIndex` (default: `true`): Automatically scan and index transcript folders on startup.
* `copilotConversation.watchChanges` (default: `true`): Monitor transcripts directory for real-time conversation updates.
* `copilotConversation.maxResults` (default: `100`): Limit the number of search query matches returned.
* `copilotConversation.storageLocation` (default: `""`): Provide a custom path to VS Code's `workspaceStorage` folder if using a portable installation or non-standard directory.
* `copilotConversation.defaultTags` (default: `["architecture", "database", "performance", "security", "frontend"]`): Custom tag suggestions shown when tagging conversations.
* `copilotConversation.fileLinkExtensions` (default: `["ts", "js", "json", "css", "html", "yml", "yaml", "md", ...]`): File extensions that will be recognized and linkified within message texts.

---

## 👨‍💻 Contributing & Testing

The extension includes a sandboxed, zero-dependency unit testing configuration. To run tests:
1. Clone the repository.
2. Run `npm install`.
3. Compile the typescript components: `npm run compile`.
4. Run the test suite: `npm test`. (This runs on sandboxed mock fixtures, isolated from your real chat histories).
