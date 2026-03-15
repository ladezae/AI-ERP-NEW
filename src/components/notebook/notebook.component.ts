
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Note, NoteStatus } from '../../models/erp.models';
import { TaiwanDatePipe } from '../../pipes/taiwan-date.pipe';

@Component({
  selector: 'app-notebook',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, TaiwanDatePipe],
  templateUrl: './notebook.component.html'
})
export class NotebookComponent {
  private dataService = inject(DataService);
  private fb = inject(FormBuilder);

  notes = this.dataService.notes;
  
  // Columns Definition
  readonly columns: { status: NoteStatus, title: string, color: string, icon: string }[] = [
      { status: 'draft', title: '🌱 草稿區 (Drafts)', color: 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
      { status: 'validation', title: '🧪 驗證區 (Validation)', color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z' },
      { status: 'completed', title: '✅ 完成區 (Completed)', color: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' }
  ];

  // Modal State
  showModal = signal(false);
  isEditMode = signal(false);
  noteForm!: FormGroup;

  // Filtered Notes per Column
  getNotesByStatus(status: NoteStatus) {
      return computed(() => this.notes().filter(n => n.status === status).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  }

  constructor() {
      this.initForm();
  }

  initForm() {
      this.noteForm = this.fb.group({
          id: [''],
          title: ['', Validators.required],
          content: ['', Validators.required],
          status: ['draft'],
          createdAt: [''],
          updatedAt: ['']
      });
  }

  openAddModal() {
      this.isEditMode.set(false);
      this.initForm();
      const id = 'N-' + Date.now();
      const now = new Date().toISOString();
      this.noteForm.patchValue({ 
          id, 
          status: 'draft', 
          createdAt: now, 
          updatedAt: now 
      });
      this.showModal.set(true);
  }

  openEditModal(note: Note) {
      this.isEditMode.set(true);
      this.initForm();
      this.noteForm.patchValue(note);
      this.showModal.set(true);
  }

  closeModal() {
      this.showModal.set(false);
  }

  onSubmit() {
      if (this.noteForm.valid) {
          const formVal = this.noteForm.getRawValue();
          const noteData: Note = {
              ...formVal,
              updatedAt: new Date().toISOString()
          };

          if (this.isEditMode()) {
              this.dataService.updateNote(noteData);
          } else {
              this.dataService.addNote(noteData);
          }
          this.closeModal();
      } else {
          this.noteForm.markAllAsTouched();
      }
  }

  deleteNote(id: string) {
      if (confirm('確定要刪除此筆記嗎？')) {
          this.dataService.deleteNote(id);
      }
  }

  moveNote(note: Note, direction: 'forward' | 'backward') {
      const statuses: NoteStatus[] = ['draft', 'validation', 'completed'];
      const currentIndex = statuses.indexOf(note.status);
      let newIndex = currentIndex;

      if (direction === 'forward' && currentIndex < statuses.length - 1) {
          newIndex++;
      } else if (direction === 'backward' && currentIndex > 0) {
          newIndex--;
      }

      if (newIndex !== currentIndex) {
          const updatedNote = { 
              ...note, 
              status: statuses[newIndex],
              updatedAt: new Date().toISOString()
          };
          this.dataService.updateNote(updatedNote);
      }
  }
}
