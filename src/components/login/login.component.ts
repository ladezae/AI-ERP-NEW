
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html'
})
export class LoginComponent {
  public dataService = inject(DataService); // Made public for template access
  private fb = inject(FormBuilder);

  loginForm: FormGroup;
  errorMessage = signal('');
  showPassword = signal(false); // Toggle password visibility
  
  constructor() {
    this.loginForm = this.fb.group({
      account: ['', Validators.required],
      password: ['', Validators.required]
    });
  }

  togglePasswordVisibility() {
    this.showPassword.update(v => !v);
  }

  onSubmit() {
    if (this.loginForm.valid) {
      const { account, password } = this.loginForm.value;
      const success = this.dataService.login(account, password);
      
      if (!success) {
        this.errorMessage.set('帳號或密碼錯誤，請重試。');
        this.loginForm.get('password')?.reset();
      } else {
        this.errorMessage.set('');
      }
    } else {
      this.loginForm.markAllAsTouched();
    }
  }
}
