import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { AgentId } from '../agents/types.js';
import type { DriveConnection, KnowledgeDocument, KnowledgeResult } from './types.js';

export interface KnowledgeStore {
  isBusinessAdmin(userId: string, businessId: string): Promise<boolean>;
  saveConnection(value: DriveConnection): Promise<void>; connection(businessId: string): Promise<DriveConnection | null>;
  connectionForChannel(channelId: string): Promise<DriveConnection | null>; activeConnections(): Promise<DriveConnection[]>;
  saveDocument(value: KnowledgeDocument, chunks: string[]): Promise<void>; deleteDocument(businessId: string, fileId: string): Promise<void>;
  documents(businessId: string): Promise<Array<Partial<KnowledgeDocument>>>; retrieve(businessId: string, agent: AgentId, query: string, limit: number): Promise<KnowledgeResult[]>;
}

export class MemoryKnowledgeStore implements KnowledgeStore {
  admins = new Set<string>(); connections = new Map<string, DriveConnection>(); docs = new Map<string, KnowledgeDocument>();
  async isBusinessAdmin(userId: string, businessId: string) { return this.admins.has(`${userId}:${businessId}`); }
  async saveConnection(value: DriveConnection) { this.connections.set(value.businessId, structuredClone(value)); }
  async connection(id: string) { return structuredClone(this.connections.get(id) ?? null); }
  async connectionForChannel(id: string) { return structuredClone([...this.connections.values()].find((v) => v.channelId === id) ?? null); }
  async activeConnections() { return [...this.connections.values()].filter((v) => v.status === 'active').map((v) => structuredClone(v)); }
  async saveDocument(value: KnowledgeDocument) { const key = `${value.businessId}:${value.fileId}`, previous = this.docs.get(key); this.docs.set(key, structuredClone({ ...value, version: previous && previous.checksum !== value.checksum ? previous.version + 1 : previous?.version ?? value.version })); }
  async deleteDocument(businessId: string, fileId: string) { const value = this.docs.get(`${businessId}:${fileId}`); if (value) this.docs.set(`${businessId}:${fileId}`, { ...value, status: 'deleted', content: '' }); }
  async documents(id: string) { return [...this.docs.values()].filter((v) => v.businessId === id).map((value) => { const copy: Partial<KnowledgeDocument> = { ...value }; delete copy.content; return copy; }); }
  async retrieve(businessId: string, agent: AgentId, query: string, limit: number) { const terms = query.toLowerCase().split(/\W+/).filter((v) => v.length > 2); return [...this.docs.values()].filter((v) => v.businessId === businessId && v.status === 'indexed' && v.allowedAgents.includes(agent)).map((v) => ({ v, score: terms.filter((term) => v.content.toLowerCase().includes(term)).length })).filter((x) => x.score).sort((a, b) => b.score - a.score).slice(0, limit).map(({ v, score }) => ({ content: v.content, score, citation: { fileId: v.fileId, name: v.name, sourceUrl: v.sourceUrl, version: v.version, modifiedTime: v.modifiedTime } })); }
}

export class SupabaseKnowledgeStore implements KnowledgeStore {
  constructor(private client: SupabaseClient) {}
  async isBusinessAdmin(userId: string, businessId: string) { const { data, error } = await this.client.from('business_memberships').select('business_id').eq('business_id', businessId).eq('user_id', userId).in('role', ['owner', 'admin']).maybeSingle(); if (error) throw error; return Boolean(data); }
  async saveConnection(v: DriveConnection) { const { error } = await this.client.from('drive_connections').upsert({ business_id: v.businessId, folder_id: v.folderId, folder_name: v.folderName, credentials_ciphertext: v.credentialsCiphertext, change_token: v.changeToken ?? null, channel_id: v.channelId ?? null, channel_resource_id: v.channelResourceId ?? null, channel_token_hash: v.channelTokenHash ?? null, channel_expires_at: v.channelExpiresAt ?? null, status: v.status, last_synced_at: v.lastSyncedAt ?? null, last_error: v.lastError ?? null, updated_at: new Date().toISOString() }, { onConflict: 'business_id' }); if (error) throw error; }
  private map(v: any): DriveConnection { return { businessId: v.business_id, folderId: v.folder_id, folderName: v.folder_name, credentialsCiphertext: v.credentials_ciphertext, changeToken: v.change_token ?? undefined, channelId: v.channel_id ?? undefined, channelResourceId: v.channel_resource_id ?? undefined, channelTokenHash: v.channel_token_hash ?? undefined, channelExpiresAt: v.channel_expires_at ?? undefined, status: v.status, lastSyncedAt: v.last_synced_at ?? undefined, lastError: v.last_error ?? undefined }; }
  async connection(id: string) { const { data, error } = await this.client.from('drive_connections').select('*').eq('business_id', id).maybeSingle(); if (error) throw error; return data ? this.map(data) : null; }
  async connectionForChannel(id: string) { const { data, error } = await this.client.from('drive_connections').select('*').eq('channel_id', id).eq('status', 'active').maybeSingle(); if (error) throw error; return data ? this.map(data) : null; }
  async activeConnections() { const { data, error } = await this.client.from('drive_connections').select('*').eq('status', 'active'); if (error) throw error; return (data ?? []).map((v) => this.map(v)); }
  async saveDocument(v: KnowledgeDocument, chunks: string[]) { const { data, error } = await this.client.rpc('upsert_drive_knowledge', { p_business_id: v.businessId, p_file_id: v.fileId, p_name: v.name, p_mime_type: v.mimeType, p_modified_time: v.modifiedTime, p_checksum: v.checksum, p_status: v.status, p_warning: v.warning ?? null, p_allowed_agents: v.allowedAgents, p_source_url: v.sourceUrl, p_content: v.content, p_chunks: chunks }); if (error) throw error; void data; }
  async deleteDocument(businessId: string, fileId: string) { const { error } = await this.client.from('knowledge_documents').update({ status: 'deleted', content: '', updated_at: new Date().toISOString() }).eq('business_id', businessId).eq('source_file_id', fileId); if (error) throw error; }
  async documents(id: string) { const { data, error } = await this.client.from('knowledge_documents').select('source_file_id,name,mime_type,modified_time,version,status,warning,source_url,updated_at').eq('business_id', id).order('updated_at', { ascending: false }); if (error) throw error; return data ?? []; }
  async retrieve(businessId: string, agent: AgentId, query: string, limit: number) { const { data, error } = await this.client.rpc('search_business_knowledge', { p_business_id: businessId, p_agent_id: agent, p_query: query, p_limit: limit }); if (error) throw error; return (data ?? []).map((v: any) => ({ content: v.content, score: v.score, citation: { fileId: v.source_file_id, name: v.name, sourceUrl: v.source_url, version: v.version, modifiedTime: v.modified_time } })); }
}

export function createKnowledgeStore() { if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) return new SupabaseKnowledgeStore(createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })); if (config.NODE_ENV === 'production') throw new Error('Persistent knowledge store required'); return new MemoryKnowledgeStore(); }
