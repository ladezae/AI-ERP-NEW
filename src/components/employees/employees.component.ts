
// Force re-compilation
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Employee, Role, Permission } from '../../models/erp.models';
import { ResizableDirective } from '../../directives/resizable.directive';

type TabType = 'employees' | 'roles';

@Component({
  selector: 'app-employees',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './employees.component.html'
})
export class EmployeesComponent {
  private dataService = inject(DataService);
  private fb = inject(FormBuilder);
  
  // Data Signals
  employees = this.dataService.employees;
  roles = this.dataService.roles;
  
  // View State
  activeTab = signal<TabType>('employees');
  searchTerm = signal('');
  
  // Modal State
  showEmployeeModal = signal(false);
  isEditMode = signal(false);
  showRoleModal = signal(false);
  
  // Forms
  employeeForm!: FormGroup;
  roleForm!: FormGroup;

  // Constants
  readonly departments = ['管理部', '業務部', '採購部', '倉管部', '財務部', 'IT部'];

  // COMPLETE MODULE LIST FOR PERMISSIONS (Synced with Sidebar)
  readonly ALL_MODULES = [
    { id: 'MOD-DASHBOARD', name: '儀表板 (Dashboard)' },
    { id: 'MOD-PRODUCT', name: '商品管理 (Products)' },
    { id: 'MOD-ORDER', name: '訂單管理 (Orders)' },
    { id: 'MOD-MANUFACTURING', name: '代工單管理 (Manufacturing)' },
    { id: 'MOD-SHIPPING', name: '出貨管理 (Shipping)' },
    { id: 'MOD-PURCHASE', name: '採購管理 (Purchases)' },
    { id: 'MOD-ALLOCATOR', name: '控貨配量 (Allocator)' },
    { id: 'MOD-CUSTOMER', name: '客戶管理 (Customers)' },
    { id: 'MOD-SUPPLIER', name: '供應商管理 (Suppliers)' },
    { id: 'MOD-DEFINITIONS', name: '數據定義中心 (Definitions)' },
    { id: 'MOD-EMPLOYEE', name: '員工與權限 (Employees)' },
    { id: 'MOD-COMPANY', name: '公司資料 (Company)' },
    { id: 'MOD-BRAND', name: '品牌管理 (Brand)' },
    { id: 'MOD-IMPORT', name: '智慧匯入 (Import)' },
    { id: 'MOD-AI-TRAINING', name: 'AI 訓練 (AI Training)' },
    { id: 'MOD-SYSTEM', name: '系統管理 (System)' }
  ];

  constructor() {
    this.initEmployeeForm();
    this.initRoleForm();
  }

  // --- Employee Management ---

  initEmployeeForm() {
    this.employeeForm = this.fb.group({
      id: [''],
      name: ['', Validators.required],
      email: ['', [Validators.email]], 
      phone: [''],
      department: [''],
      jobTitle: [''],
      roleId: [''],
      roleName: [''], // Will be auto-filled
      status: ['Active'],
      joinDate: [new Date().toISOString().split('T')[0]],
      avatarUrl: ['https://picsum.photos/200/200'],
      // Auth fields
      account: [''],
      password: ['']
    });

    // Auto-fill role name
    this.employeeForm.get('roleId')?.valueChanges.subscribe(roleId => {
       const role = this.roles().find(r => r.id === roleId);
       if (role) {
         this.employeeForm.patchValue({ roleName: role.name });
       }
    });
  }

  filteredEmployees = computed(() => {
    const term = this.searchTerm().toLowerCase();
    if (!term) return this.employees();
    return this.employees().filter(e => 
      e.name.toLowerCase().includes(term) ||
      e.email.toLowerCase().includes(term) ||
      e.roleName.toLowerCase().includes(term) ||
      e.department.toLowerCase().includes(term) ||
      (e.account && e.account.toLowerCase().includes(term))
    );
  });

  onSearchTermChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm.set(value);
  }

  openAddEmployeeModal() {
    this.isEditMode.set(false);
    this.initEmployeeForm();
    // Auto-gen ID
    const id = 'EMP-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.employeeForm.patchValue({ id });
    this.showEmployeeModal.set(true);
  }

  openEditEmployeeModal(employee: Employee) {
    this.isEditMode.set(true);
    this.initEmployeeForm();
    this.employeeForm.patchValue(employee);
    this.employeeForm.get('id')?.disable();
    this.showEmployeeModal.set(true);
  }

  closeEmployeeModal() {
    this.showEmployeeModal.set(false);
  }

  onEmployeeSubmit() {
    if (this.employeeForm.valid) {
      const empData: Employee = this.employeeForm.getRawValue();
      if (this.isEditMode()) {
        this.dataService.updateEmployee(empData);
      } else {
        this.dataService.addEmployee(empData);
      }
      this.closeEmployeeModal();
    } else {
      this.employeeForm.markAllAsTouched();
    }
  }

  // --- Role & Permission Management ---

  initRoleForm() {
    this.roleForm = this.fb.group({
      id: [''],
      name: ['', Validators.required],
      description: [''],
      permissions: this.fb.array([])
    });
  }

  get permissionsArray() {
    return this.roleForm.get('permissions') as FormArray;
  }

  openAddRoleModal() {
    this.isEditMode.set(false);
    this.initRoleForm();
    
    // Auto-generate ID
    const id = 'ROLE-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.roleForm.patchValue({ id });

    // Pre-fill all standard modules with false permissions
    this.ALL_MODULES.forEach(mod => {
        this.permissionsArray.push(this.fb.group({
            moduleId: [mod.id],
            moduleName: [mod.name],
            canRead: [false],
            canWrite: [false],
            canDelete: [false]
        }));
    });

    this.showRoleModal.set(true);
  }

  openEditRoleModal(role: Role) {
    this.isEditMode.set(true);
    this.initRoleForm();
    this.roleForm.patchValue({
        id: role.id,
        name: role.name,
        description: role.description
    });
    
    // Clear array and repopulate with MERGE logic
    // We iterate through ALL_MODULES to ensure new modules appear even for old roles
    this.permissionsArray.clear();
    
    this.ALL_MODULES.forEach(mod => {
        // Try to find existing permission for this module
        const existingPerm = role.permissions.find(p => p.moduleId === mod.id);
        
        if (existingPerm) {
            // Use existing values
            this.permissionsArray.push(this.fb.group({
                moduleId: [existingPerm.moduleId],
                moduleName: [mod.name], // Use latest name definition
                canRead: [existingPerm.canRead],
                canWrite: [existingPerm.canWrite],
                canDelete: [existingPerm.canDelete]
            }));
        } else {
            // Add new module with default false
            this.permissionsArray.push(this.fb.group({
                moduleId: [mod.id],
                moduleName: [mod.name],
                canRead: [false],
                canWrite: [false],
                canDelete: [false]
            }));
        }
    });
    
    this.showRoleModal.set(true);
  }

  closeRoleModal() {
    this.showRoleModal.set(false);
  }

  onRoleSubmit() {
    if (this.roleForm.valid) {
        const roleData: Role = this.roleForm.getRawValue();
        
        if (this.isEditMode()) {
            this.dataService.updateRole(roleData);
        } else {
            this.dataService.addRole(roleData);
        }
        this.closeRoleModal();
    }
  }

  setActiveTab(tab: TabType) {
    this.activeTab.set(tab);
  }
}
