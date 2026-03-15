import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { ImageService } from '../../services/image.service';
import { CompanyProfile } from '../../models/erp.models';
import { ResizableDirective } from '../../directives/resizable.directive';

@Component({
  selector: 'app-company-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, ResizableDirective],
  templateUrl: './company-profile.component.html'
})
export class CompanyProfileComponent {
  private dataService = inject(DataService);
  private imageService = inject(ImageService);
  private fb = inject(FormBuilder);

  companies = this.dataService.companies;
  searchTerm = signal('');
  showModal = signal(false);
  isEditMode = signal(false);
  profileForm!: FormGroup;
  isUploading = signal(false);

  constructor() {
    this.initForm();
  }

  initForm() {
    this.profileForm = this.fb.group({
      id: [''], 
      name: [''],
      shortName: [''], // Added: Company Short Name
      taxId: [''],
      owner: [''],
      
      phone: [''],
      fax: [''],
      email: ['', [Validators.email]], // Keep email format check if entered, but not required
      address: [''],
      website: [''],
      
      bankName: [''],
      bankBranch: [''],
      bankAccount: [''],
      bankAccountName: [''],
      
      logoUrl: [''],
      description: ['']
    });
  }

  async onImageUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (!file.type.startsWith('image/')) return;

      this.isUploading.set(true);
      try {
        const compressedBase64 = await this.imageService.compressImage(file);
        this.profileForm.patchValue({ logoUrl: compressedBase64 });
        this.profileForm.markAsDirty();
      } catch (error) {
        console.error('Image upload failed', error);
        alert('圖片處理失敗');
      } finally {
        this.isUploading.set(false);
        input.value = '';
      }
    }
  }

  filteredCompanies = computed(() => {
    const term = this.searchTerm().toLowerCase();
    if (!term) return this.companies();
    
    return this.companies().filter(c => 
      c.name.toLowerCase().includes(term) ||
      (c.shortName && c.shortName.toLowerCase().includes(term)) ||
      c.taxId.includes(term) ||
      c.id.toLowerCase().includes(term)
    );
  });

  onSearchTermChange(event: Event): void {
      const value = (event.target as HTMLInputElement).value;
      this.searchTerm.set(value);
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.initForm();
    // Auto-generate ID for demo
    const randomId = 'COMP-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.profileForm.patchValue({ id: randomId });
    this.showModal.set(true);
  }

  openEditModal(company: CompanyProfile) {
    this.isEditMode.set(true);
    this.initForm();
    this.profileForm.patchValue(company);
    this.profileForm.get('id')?.disable(); // Lock ID
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
  }

  onSubmit() {
    if (this.profileForm.valid) {
      const formValue = this.profileForm.getRawValue();
      const companyData: CompanyProfile = { ...formValue };

      if (this.isEditMode()) {
        this.dataService.updateCompany(companyData);
      } else {
        this.dataService.addCompany(companyData);
      }
      this.closeModal();
    } else {
      this.profileForm.markAllAsTouched();
    }
  }
}
