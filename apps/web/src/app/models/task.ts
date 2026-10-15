export type Status = 'todo' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high';

export interface Task {
  id: number;
  title: string;
  team: string;
  status: Status;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
}

export interface NewTask {
  title: string;
  team: string;
  priority: Priority;
}
