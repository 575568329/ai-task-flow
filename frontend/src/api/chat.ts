// frontend/src/api/chat.ts
import type { Conversation, ChatMessage } from '@ai-task-flow/shared';

const API_BASE = '/api'; // 使用相对路径，走 vite proxy

export async function getConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/conversations`);
  if (!res.ok) throw new Error(`Failed to fetch conversations: ${res.statusText}`);
  return res.json();
}

export async function createConversation(title?: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Failed to create conversation: ${res.statusText}`);
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete conversation: ${res.statusText}`);
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`);
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.statusText}`);
  return res.json();
}
