
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { ImageService } from '../../services/image.service';
import { Brand } from '../../models/erp.models';

@Component({
  selector: 'app-brand-management',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './brand-management.component.html'
})
export class BrandManagementComponent {
  private dataService = inject(DataService);
  private imageService = inject(ImageService);
  private fb = inject(FormBuilder);

  brands = this.dataService.brands;
  searchTerm = signal('');
  showModal = signal(false);
  isEditMode = signal(false);
  brandForm!: FormGroup;
  isUploading = signal(false);

  constructor() {
    this.initForm();
  }

  initForm() {
    this.brandForm = this.fb.group({
      id: [''],
      nameTw: ['', Validators.required],
      nameEn: [''],
      shortName: [''], // Added: Brand Short Name
      websiteUrl: [''],
      logoUrl: ['']
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
        this.brandForm.patchValue({ logoUrl: compressedBase64 });
        this.brandForm.markAsDirty();
      } catch (error) {
        console.error('Image upload failed', error);
        alert('圖片處理失敗');
      } finally {
        this.isUploading.set(false);
        input.value = '';
      }
    }
  }

  filteredBrands = computed(() => {
    const term = this.searchTerm().toLowerCase();
    if (!term) return this.brands();
    
    return this.brands().filter(b => 
      b.nameTw.toLowerCase().includes(term) ||
      b.nameEn.toLowerCase().includes(term) ||
      (b.shortName && b.shortName.toLowerCase().includes(term)) ||
      b.id.toLowerCase().includes(term)
    );
  });

  onSearchTermChange(event: Event): void {
      const value = (event.target as HTMLInputElement).value;
      this.searchTerm.set(value);
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.initForm();
    // Auto-generate ID
    const randomId = 'BR-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.brandForm.patchValue({ id: randomId });
    this.showModal.set(true);
  }

  openEditModal(brand: Brand) {
    this.isEditMode.set(true);
    this.initForm();
    this.brandForm.patchValue(brand);
    this.brandForm.get('id')?.disable(); // Lock ID
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
  }

  deleteBrand(id: string) {
      if(confirm('確定要刪除此品牌嗎？')) {
          this.dataService.deleteBrand(id);
      }
  }

  onSubmit() {
    if (this.brandForm.valid) {
      const formValue = this.brandForm.getRawValue();
      const brandData: Brand = { ...formValue };

      if (this.isEditMode()) {
        this.dataService.updateBrand(brandData);
      } else {
        this.dataService.addBrand(brandData);
      }
      this.closeModal();
    } else {
      this.brandForm.markAllAsTouched();
    }
  }
}
