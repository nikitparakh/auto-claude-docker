export interface FeedbackAttachment {
  name: string;
  url: string;
}

export type FeedbackCategory =
  | 'bug_report'
  | 'feature_request'
  | 'directive'
  | 'improvement'
  | 'question';

export type FeedbackPriority = 'critical' | 'high' | 'medium' | 'low';

export interface FeedbackItem {
  id: string;
  timestamp: string;
  authorTag: string;
  content: string;
  attachments: FeedbackAttachment[];
  category?: FeedbackCategory;
  priority?: FeedbackPriority;
  summary?: string;
}

export class FeedbackStore {
  private queue: FeedbackItem[] = [];

  enqueue(item: Omit<FeedbackItem, 'id' | 'timestamp'>) {
    const feedback: FeedbackItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      ...item,
    };
    this.queue.push(feedback);
  }

  dequeueAll(): FeedbackItem[] {
    const items = [...this.queue];
    this.queue = [];
    return items;
  }

  getAll(): FeedbackItem[] {
    return [...this.queue];
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  size(): number {
    return this.queue.length;
  }
}

export const feedbackStore = new FeedbackStore();
