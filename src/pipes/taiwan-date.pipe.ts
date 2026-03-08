
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'taiwanDate',
  standalone: true
})
export class TaiwanDatePipe implements PipeTransform {
  private readonly weekDays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  transform(value: string | Date | null | undefined): string {
    if (!value) return '-';
    
    const date = new Date(value);
    if (isNaN(date.getTime())) return '-';

    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const weekDayName = this.weekDays[date.getDay()];

    return `${year}-${month}-${day} ${weekDayName}`;
  }
}
