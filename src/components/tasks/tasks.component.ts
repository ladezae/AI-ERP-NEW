
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { ImageService } from '../../services/image.service';
import { Task, TaskPriority, TaskStatus, TaskType } from '../../models/erp.models';
import { TaiwanDatePipe } from '../../pipes/taiwan-date.pipe';

@Component({
  selector: 'app-tasks',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, TaiwanDatePipe],
  templateUrl: './tasks.component.html',
  styles: [`
    .scrollbar-hide::-webkit-scrollbar {
        display: none;
    }
    .scrollbar-hide {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
  `]
})
export class TasksComponent {
  private dataService = inject(DataService);
  private imageService = inject(ImageService);
  private fb = inject(FormBuilder);

  // Data
  tasks = this.dataService.tasks;
  employees = this.dataService.employees;
  currentUser = this.dataService.currentUser;

  // Filters
  filterStatus = signal<string>('active'); // active, completed, all
  filterType = signal<string>('all');
  searchTerm = signal('');

  // UI State
  selectedTask = signal<Task | null>(null);
  isMaximized = signal(false);
  showCreateModal = signal(false);
  isEditMode = signal(false); // New: Track if we are editing
  editingTaskId = signal<string | null>(null); // New: Track ID being edited
  
  // Create Modal State
  createTaskImage = signal<string | null>(null); // Store pasted image for new/edit task

  // Forms
  taskForm!: FormGroup;
  replyContent = signal('');
  
  // Constants
  readonly priorities: TaskPriority[] = ['High', 'Medium', 'Low'];
  readonly types: TaskType[] = ['Task', 'Reminder', 'Requirement'];

  // UI Options (Chinese)
  readonly priorityOptions = [
    { value: 'High', label: '高' },
    { value: 'Medium', label: '中' },
    { value: 'Low', label: '低' }
  ];

  readonly typeOptions = [
    { value: 'Task', label: '任務' },
    { value: 'Reminder', label: '提醒' },
    { value: 'Requirement', label: '需求' }
  ];

  readonly statusOptions = [
    { value: 'Pending', label: '待處理' },
    { value: 'In Progress', label: '進行中' },
    { value: 'On Hold', label: '暫停' },
    { value: 'Completed', label: '已完成' },
    { value: 'Cancelled', label: '取消' },
    { value: 'Archived', label: '已歸檔' }
  ];

  filteredTasks = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const status = this.filterStatus();
    const type = this.filterType();

    return this.tasks().filter(t => {
      const matchSearch = !term || t.title.toLowerCase().includes(term) || t.description.toLowerCase().includes(term) || t.id.toLowerCase().includes(term);
      
      let matchStatus = true;
      if (status === 'active') matchStatus = t.status !== 'Completed' && t.status !== 'Archived';
      if (status === 'completed') matchStatus = t.status === 'Completed';
      
      const matchType = type === 'all' || t.type === type;

      return matchSearch && matchStatus && matchType;
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  });

  constructor() {
    this.initForm();
  }

  initForm() {
    // UPDATED: Removed Validators.required per request
    this.taskForm = this.fb.group({
      title: [''],
      type: ['Task'],
      priority: ['Medium'],
      status: ['Pending'],
      assigneeId: [''],
      description: [''],
      deadline: [''], 
      reminderDate: ['']
    });
  }

  selectTask(task: Task) {
    this.selectedTask.set(task);
    // Auto-scroll to bottom of chat
    setTimeout(() => {
        const container = document.getElementById('chat-container');
        if (container) container.scrollTop = container.scrollHeight;
    }, 100);
  }

  toggleMaximize() {
    this.isMaximized.update(v => !v);
  }

  openCreateModal() {
    this.isEditMode.set(false);
    this.editingTaskId.set(null);
    this.initForm();
    this.createTaskImage.set(null); // Reset image
    this.showCreateModal.set(true);
  }

  // NEW: Open Edit Modal
  openEditModal(task: Task, event: Event) {
    event.stopPropagation(); // Prevent card selection logic
    this.isEditMode.set(true);
    this.editingTaskId.set(task.id);
    this.initForm();
    
    // Patch Values
    this.taskForm.patchValue({
        title: task.title,
        type: task.type,
        priority: task.priority,
        status: task.status,
        assigneeId: task.assigneeId,
        description: task.description,
        deadline: task.deadline,
        reminderDate: task.reminderDate
    });
    
    // Load existing image if any
    this.createTaskImage.set(task.imageUrl || null);
    
    this.showCreateModal.set(true);
  }

  closeCreateModal() {
    this.showCreateModal.set(false);
    this.editingTaskId.set(null);
  }

  // UPDATED: Save Logic (Create or Update) - Sanitized for Firebase
  saveTask() {
      const val = this.taskForm.value;
      const user = this.currentUser();
      const assignee = this.employees().find(e => e.id === val.assigneeId);
      
      // Sanitize fields to ensure no undefined values are passed to Firestore
      const safeAssigneeId = assignee ? assignee.id : '';
      const safeAssigneeName = assignee ? assignee.name : '';
      const safeDescription = val.description || '';
      const safeDeadline = val.deadline || '';
      const safeReminderDate = val.reminderDate || '';
      const safeImageUrl = this.createTaskImage() || '';

      if (this.isEditMode() && this.editingTaskId()) {
          // UPDATE Existing
          const existingTask = this.tasks().find(t => t.id === this.editingTaskId());
          if (existingTask) {
              const updatedTask: Task = {
                  ...existingTask,
                  title: val.title || '未命名任務',
                  type: val.type,
                  priority: val.priority,
                  status: val.status,
                  description: safeDescription,
                  assigneeId: safeAssigneeId,
                  assigneeName: safeAssigneeName,
                  deadline: safeDeadline,
                  reminderDate: safeReminderDate,
                  updatedAt: new Date().toISOString(),
                  imageUrl: safeImageUrl
              };
              this.dataService.updateTask(updatedTask);
              
              // If currently selected, update view
              if (this.selectedTask()?.id === updatedTask.id) {
                  this.selectedTask.set(updatedTask);
              }
          }
      } else {
          // CREATE New
          const newTask: Task = {
            id: `T-${Date.now()}`,
            title: val.title || '未命名任務',
            type: val.type,
            priority: val.priority,
            status: 'Pending',
            description: safeDescription,
            creatorId: user?.id || 'Unknown',
            creatorName: user?.name || 'Unknown',
            assigneeId: safeAssigneeId,
            assigneeName: safeAssigneeName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deadline: safeDeadline,
            reminderDate: safeReminderDate,
            comments: [],
            imageUrl: safeImageUrl,
            isRead: false
          };
          this.dataService.addTask(newTask);
          this.selectTask(newTask);
      }

      this.closeCreateModal();
  }

  // Check if a task is overdue
  isOverdue(task: Task): boolean {
      if (!task.deadline || task.status === 'Completed' || task.status === 'Archived') return false;
      const today = new Date().toISOString().split('T')[0];
      return task.deadline < today;
  }

  // --- Image Handling for Create Modal ---
  async onCreatePaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            event.preventDefault(); // Prevent default paste behavior
            const blob = items[i].getAsFile();
            if (blob) {
                try {
                    const base64 = await this.imageService.compressImage(blob, 800, 0.7);
                    this.createTaskImage.set(base64);
                } catch (e) {
                    console.error('Create image paste failed', e);
                    alert('圖片處理失敗');
                }
            }
            break;
        }
    }
  }

  removeCreateImage() {
      this.createTaskImage.set(null);
  }

  // --- Reply & Image Handling for Chat ---

  async sendReply() {
    const content = this.replyContent().trim();
    if (!content) return;

    const task = this.selectedTask();
    const user = this.currentUser();
    if (!task || !user) return;

    const comment = {
      id: `C-${Date.now()}`,
      taskId: task.id,
      authorId: user.id,
      authorName: user.name,
      content: content,
      timestamp: new Date().toISOString()
    };

    await this.dataService.addTaskComment(task.id, comment);
    
    // Update local selected task to reflect change immediately (Signal update in service handles global list, but we need to refresh selected ref)
    const updated = this.tasks().find(t => t.id === task.id);
    if (updated) this.selectedTask.set(updated);
    
    this.replyContent.set('');
    
    setTimeout(() => {
        const container = document.getElementById('chat-container');
        if (container) container.scrollTop = container.scrollHeight;
    }, 100);
  }

  async onPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        event.preventDefault();
        const blob = items[i].getAsFile();
        if (blob) {
           await this.processPastedImage(blob);
        }
        break;
      }
    }
  }

  async processPastedImage(file: File) {
      try {
          const base64 = await this.imageService.compressImage(file, 800, 0.7);
          const task = this.selectedTask();
          const user = this.currentUser();
          if (!task || !user) return;

          const comment = {
              id: `C-${Date.now()}`,
              taskId: task.id,
              authorId: user.id,
              authorName: user.name,
              content: '[圖片]',
              imageUrl: base64,
              timestamp: new Date().toISOString()
          };

          await this.dataService.addTaskComment(task.id, comment);
          
          // Refresh
          const updated = this.tasks().find(t => t.id === task.id);
          if (updated) this.selectedTask.set(updated);

          setTimeout(() => {
            const container = document.getElementById('chat-container');
            if (container) container.scrollTop = container.scrollHeight;
          }, 100);

      } catch (e) {
          console.error('Image paste failed', e);
          alert('圖片處理失敗');
      }
  }

  updateStatus(status: TaskStatus) {
      const task = this.selectedTask();
      if (task) {
          const updated = { ...task, status, updatedAt: new Date().toISOString() };
          this.dataService.updateTask(updated);
          this.selectedTask.set(updated);
      }
  }

  deleteTask(task: Task, event?: Event) {
      if (event) {
          event.stopPropagation();
      }
      
      if(confirm(`確定要刪除任務「${task.title}」嗎？\n此動作無法復原。`)) {
          this.dataService.deleteTask(task.id);
          
          // Fix: If we deleted the currently active task, clear selection AND ensure we are back in list view
          if (this.selectedTask()?.id === task.id) {
              this.selectedTask.set(null);
              this.isMaximized.set(false); // Force exit maximized/mobile view to see the list again
          }
      }
  }
}
