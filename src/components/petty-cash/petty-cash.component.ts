import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { PettyCashTransaction, PettyCashSubject } from '../../models/erp.models';
import { TaiwanDatePipe } from '../../pipes/taiwan-date.pipe';

@Component({
  selector: 'app-petty-cash',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, TaiwanDatePipe],
  providers: [DecimalPipe],
  templateUrl: './petty-cash.component.html'
})
export class PettyCashComponent {
  private dataService = inject(DataService);
  private fb = inject(FormBuilder);

  // Data
  transactions = this.dataService.pettyCashTransactions;
  subjects = this.dataService.pettyCashSubjects;
  currentUser = this.dataService.currentUser;
  
  // Note: We'll calculate monthly balance in computed property below instead of using global balance
  // globalBalance = this.dataService.pettyCashBalance; 

  // State
  showModal = signal(false);
  showSubjectsModal = signal(false);
  filterType = signal<'all' | 'Income' | 'Expense'>('all');
  searchTerm = signal('');
  
  // Date Filtering State (Default to current month)
  currentDate = new Date();
  selectedYear = signal(this.currentDate.getFullYear());
  selectedMonth = signal(this.currentDate.getMonth() + 1);
  
  // Forms
  form!: FormGroup;
  subjectForm!: FormGroup; // For adding subjects

  // Filtered List & Monthly Stats
  filteredTransactions = computed(() => {
      const term = this.searchTerm().toLowerCase();
      const type = this.filterType();
      const year = this.selectedYear();
      const month = this.selectedMonth();
      
      const targetPrefix = `${year}-${month.toString().padStart(2, '0')}`;

      return this.transactions()
          .filter(t => {
              // 1. Month Filter
              if (!t.date.startsWith(targetPrefix)) return false;

              // 2. Search Filter
              const matchTerm = !term || t.item.toLowerCase().includes(term) || t.note.toLowerCase().includes(term) || t.handler.toLowerCase().includes(term);
              
              // 3. Type Filter
              const matchType = type === 'all' || t.type === type;
              
              return matchTerm && matchType;
          })
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  monthlyStats = computed(() => {
      const txs = this.filteredTransactions();
      // Note: This computes stats based on *filtered* view. 
      // If we want stats for the whole month regardless of search/type filter, we should re-filter.
      // However, usually stats for the month are based on all transactions in that month.
      // Let's compute based on ALL transactions for the selected month to be accurate.
      
      const year = this.selectedYear();
      const month = this.selectedMonth();
      const targetPrefix = `${year}-${month.toString().padStart(2, '0')}`;
      
      const monthlyTxs = this.transactions().filter(t => t.date.startsWith(targetPrefix));
      
      const income = monthlyTxs.filter(t => t.type === 'Income').reduce((sum, t) => sum + t.amount, 0);
      const expense = monthlyTxs.filter(t => t.type === 'Expense').reduce((sum, t) => sum + t.amount, 0);
      
      return {
          income,
          expense,
          balance: income - expense
      };
  });

  // Filtered Subjects for Dropdown
  // When adding Income, show Income subjects + Both. When Expense, show Expense + Both.
  currentSubjectsList = computed(() => {
      // If modal is not open or form not init, return all.
      // We'll update this list dynamically based on form value change if needed, 
      // but simpler is to just show relevant ones in the template or compute here based on a signal.
      return this.subjects(); 
  });
  
  filteredSubjectsForForm = computed(() => {
     // Access form value reactively if using signals, but here we can just return all or filter in template.
     // To keep it simple, return all sorted by name.
     return this.subjects().sort((a,b) => a.name.localeCompare(b.name));
  });

  constructor() {
      this.initForm();
      this.initSubjectForm();
  }

  initForm() {
      const today = new Date().toISOString().split('T')[0];
      const user = this.currentUser();
      
      this.form = this.fb.group({
          date: [today, Validators.required],
          type: ['Expense', Validators.required],
          amount: [null, [Validators.required, Validators.min(1)]],
          item: ['', Validators.required], // Will be populated by select
          handler: [user?.name || '', Validators.required],
          note: ['']
      });
  }
  
  initSubjectForm() {
      this.subjectForm = this.fb.group({
          name: ['', Validators.required],
          type: ['Expense', Validators.required]
      });
  }

  // --- Transaction Modal ---
  openAddModal() {
      this.initForm();
      this.showModal.set(true);
  }

  closeModal() {
      this.showModal.set(false);
  }

  onSubmit() {
      if (this.form.valid) {
          const val = this.form.value;
          const newTx: PettyCashTransaction = {
              id: `PC-${Date.now()}`,
              date: val.date,
              type: val.type,
              amount: val.amount,
              item: val.item,
              note: val.note || '',
              handler: val.handler,
              createdAt: new Date().toISOString()
          };
          
          this.dataService.addPettyCashTransaction(newTx);
          this.closeModal();
      } else {
          this.form.markAllAsTouched();
      }
  }

  deleteTransaction(id: string) {
      if (confirm('確定要刪除此筆記錄嗎？')) {
          this.dataService.deletePettyCashTransaction(id);
      }
  }

  // --- Subject Management Modal ---
  openSubjectsModal() {
      this.initSubjectForm();
      this.showSubjectsModal.set(true);
  }
  
  closeSubjectsModal() {
      this.showSubjectsModal.set(false);
  }
  
  addSubject() {
      if (this.subjectForm.valid) {
          const val = this.subjectForm.value;
          // Check duplicate
          if (this.subjects().some(s => s.name === val.name && s.type === val.type)) {
              alert('此科目已存在');
              return;
          }
          
          const newSubject: PettyCashSubject = {
              id: `PCS-${Date.now()}`,
              name: val.name,
              type: val.type
          };
          this.dataService.addPettyCashSubject(newSubject);
          this.subjectForm.reset({ type: 'Expense' }); // Reset but keep default type
      }
  }
  
  deleteSubject(id: string) {
      if (confirm('確定要刪除此科目嗎？')) {
          this.dataService.deletePettyCashSubject(id);
      }
  }

  // --- Filters ---
  onSearchChange(event: Event) {
      this.searchTerm.set((event.target as HTMLInputElement).value);
  }
  
  setMonth(delta: number) {
      let m = this.selectedMonth() + delta;
      let y = this.selectedYear();
      
      if (m > 12) {
          m = 1;
          y++;
      } else if (m < 1) {
          m = 12;
          y--;
      }
      
      this.selectedMonth.set(m);
      this.selectedYear.set(y);
  }

  // Helper for template to filter subjects based on current form type
  getSubjectsForType(type: string) {
      return this.subjects().filter(s => s.type === type || s.type === 'Both');
  }

  // --- Inline Editing ---
  
  updateAmount(tx: PettyCashTransaction, event: Event) {
      const val = parseInt((event.target as HTMLInputElement).value, 10);
      if (isNaN(val) || val <= 0) return;
      if (tx.amount !== val) {
          this.dataService.updatePettyCashTransaction({ ...tx, amount: val });
      }
  }

  updateHandler(tx: PettyCashTransaction, event: Event) {
      const val = (event.target as HTMLInputElement).value;
      if (tx.handler !== val) {
          this.dataService.updatePettyCashTransaction({ ...tx, handler: val });
      }
  }

  updateNote(tx: PettyCashTransaction, event: Event) {
      const val = (event.target as HTMLInputElement).value;
      if (tx.note !== val) {
          this.dataService.updatePettyCashTransaction({ ...tx, note: val });
      }
  }

  updateItem(tx: PettyCashTransaction, event: Event) {
      const val = (event.target as HTMLSelectElement).value;
      if (tx.item !== val) {
          this.dataService.updatePettyCashTransaction({ ...tx, item: val });
      }
  }
}
