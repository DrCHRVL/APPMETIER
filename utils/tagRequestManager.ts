// utils/tagRequestManager.ts — Gestion des demandes de création de tags service
import { ElectronBridge } from './electronBridge';

const TAG_REQUESTS_KEY = 'tag_requests';

export interface TagRequest {
  id: string;
  tagValue: string;
  category: 'services' | 'infractions';
  contentieuxId: string;
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
}

export const tagRequestManager = {
  async getRequests(): Promise<TagRequest[]> {
    return await ElectronBridge.getData<TagRequest[]>(TAG_REQUESTS_KEY, []) || [];
  },

  async getPendingRequests(): Promise<TagRequest[]> {
    const all = await this.getRequests();
    return all.filter(r => r.status === 'pending');
  },

  async addRequest(request: Omit<TagRequest, 'id' | 'status' | 'requestedAt'>): Promise<TagRequest> {
    const all = await this.getRequests();
    const newRequest: TagRequest = {
      ...request,
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      requestedAt: new Date().toISOString(),
    };
    all.push(newRequest);
    await ElectronBridge.setData(TAG_REQUESTS_KEY, all);
    return newRequest;
  },

  async reviewRequest(requestId: string, status: 'approved' | 'rejected', reviewedBy: string): Promise<void> {
    const all = await this.getRequests();
    const idx = all.findIndex(r => r.id === requestId);
    if (idx !== -1) {
      all[idx].status = status;
      all[idx].reviewedBy = reviewedBy;
      all[idx].reviewedAt = new Date().toISOString();
      await ElectronBridge.setData(TAG_REQUESTS_KEY, all);
    }
  },

  async clearReviewed(): Promise<void> {
    const all = await this.getRequests();
    const pending = all.filter(r => r.status === 'pending');
    await ElectronBridge.setData(TAG_REQUESTS_KEY, pending);
  }
};
