
import { Directive, ElementRef, Input, OnInit, Renderer2, inject } from '@angular/core';

@Directive({
  selector: '[appResizable]',
  standalone: true
})
export class ResizableDirective implements OnInit {
  @Input({ required: true }) tableId!: string;
  @Input({ required: true }) colId!: string;
  @Input() minWidth: number = 40; // Default minimum width

  private el = inject(ElementRef);
  private renderer = inject(Renderer2);
  private startX: number = 0;
  private startWidth: number = 0;
  private resizer: HTMLElement | null = null;

  ngOnInit() {
    // 1. 設定 host 樣式
    this.renderer.setAttribute(this.el.nativeElement, 'title', '可調整寬度');
    this.renderer.setStyle(this.el.nativeElement, 'position', 'relative');
    this.renderer.addClass(this.el.nativeElement, 'resizable-header');

    // 2. 建立拖曳手柄
    this.resizer = this.renderer.createElement('div');
    this.renderer.addClass(this.resizer, 'resizer-handle');
    this.renderer.appendChild(this.el.nativeElement, this.resizer);

    // 3. 還原記憶寬度
    this.restoreWidth();

    // 4. 如果沒有記憶寬度，至少設定最小寬度
    if (!this.el.nativeElement.style.minWidth) {
        this.renderer.setStyle(this.el.nativeElement, 'min-width', `${this.minWidth}px`);
    }

    // 5. 監聽拖曳事件
    this.renderer.listen(this.resizer, 'mousedown', (event: MouseEvent) => {
       this.onMouseDown(event);
    });
    
    // 為了防止拖曳時選取文字
    this.renderer.listen(this.resizer, 'click', (event: Event) => event.stopPropagation());
  }

  private onMouseDown(event: MouseEvent) {
    event.preventDefault();
    this.startX = event.pageX;
    this.startWidth = this.el.nativeElement.offsetWidth;
    this.renderer.addClass(this.resizer, 'resizing');
    this.renderer.addClass(document.body, 'cursor-col-resize');
    this.renderer.setStyle(document.body, 'user-select', 'none');

    const mouseMoveListener = this.renderer.listen('document', 'mousemove', (e: MouseEvent) => {
      const dx = e.pageX - this.startX;
      const newWidth = Math.max(this.minWidth, this.startWidth + dx); 
      this.setWidth(newWidth);
    });

    const mouseUpListener = this.renderer.listen('document', 'mouseup', () => {
      this.renderer.removeClass(this.resizer, 'resizing');
      this.renderer.removeClass(document.body, 'cursor-col-resize');
      this.renderer.removeStyle(document.body, 'user-select');
      this.saveWidth();
      mouseMoveListener(); // 移除監聽
      mouseUpListener();   // 移除監聽
    });
  }

  private setWidth(width: number) {
    this.renderer.setStyle(this.el.nativeElement, 'width', `${width}px`);
    this.renderer.setStyle(this.el.nativeElement, 'min-width', `${width}px`);
    this.renderer.setStyle(this.el.nativeElement, 'max-width', `${width}px`);
    this.renderer.setStyle(this.el.nativeElement, 'overflow', 'hidden');
    this.renderer.setStyle(this.el.nativeElement, 'text-overflow', 'ellipsis');
    this.renderer.setStyle(this.el.nativeElement, 'white-space', 'nowrap');
  }

  private saveWidth() {
    const width = this.el.nativeElement.offsetWidth;
    const key = `erp_col_width_${this.tableId}`;
    try {
        const saved = JSON.parse(localStorage.getItem(key) || '{}');
        saved[this.colId] = width;
        localStorage.setItem(key, JSON.stringify(saved));
    } catch(e) { console.error('Failed to save col width', e); }
  }

  private restoreWidth() {
    const key = `erp_col_width_${this.tableId}`;
    try {
        const saved = JSON.parse(localStorage.getItem(key) || '{}');
        if (saved[this.colId]) {
            this.setWidth(saved[this.colId]);
        }
    } catch(e) { console.error('Failed to load col width', e); }
  }
}
