import type { AgentId } from '../agents/types.js';

export const supportedDriveMimeTypes = [
  'application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet',
  'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv', 'text/plain'
] as const;

export interface DriveConnection {
  businessId: string; folderId: string; folderName: string; credentialsCiphertext: string;
  changeToken?: string; channelId?: string; channelResourceId?: string; channelTokenHash?: string; channelExpiresAt?: string;
  status: 'active' | 'error' | 'disconnected'; lastSyncedAt?: string; lastError?: string;
}
export interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string; md5Checksum?: string; parents?: string[]; trashed?: boolean; }
export interface KnowledgeDocument {
  businessId: string; fileId: string; name: string; mimeType: string; modifiedTime: string; checksum: string;
  version: number; status: 'indexed' | 'quarantined' | 'unsupported' | 'deleted'; warning?: string;
  allowedAgents: AgentId[]; sourceUrl: string; content: string;
}
export interface KnowledgeResult { content: string; score: number; citation: { fileId: string; name: string; sourceUrl: string; version: number; modifiedTime: string }; }
