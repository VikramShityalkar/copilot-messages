export interface Message {
    role: "user" | "assistant";
    content: string;
    timestamp?: string;
}

export interface Conversation {
    id: string;
    title: string;
    workspacePath?: string;
    workspaceName?: string;
    timestamp: string; // ISO string or format
    messages: Message[];
    sourceFile: string;
    tags?: string[];
    favorite?: boolean;
}

export interface SearchQuery {
    text?: string;
    workspacePath?: string;
    dateFrom?: string; // ISO format
    dateTo?: string; // ISO format
    tags?: string[];
    favoriteOnly?: boolean;
}
