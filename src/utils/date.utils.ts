
export class DateUtils {
  // Mock List of Major Taiwan Holidays (2024-2025)
  // In a real app, this would come from an API (e.g., Google Calendar API)
  static readonly holidays = new Set([
    '2024-01-01', // 元旦
    '2024-02-08', '2024-02-09', '2024-02-10', '2024-02-11', '2024-02-12', '2024-02-13', '2024-02-14', // 春節
    '2024-02-28', // 228
    '2024-04-04', '2024-04-05', // 清明/兒童
    '2024-05-01', // 勞動節
    '2024-06-10', // 端午
    '2024-09-17', // 中秋
    '2024-10-10', // 國慶
    '2025-01-01', // 元旦
    '2025-01-25', '2025-01-26', '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02' // 春節
  ]);

  /**
   * Check if a date string (YYYY-MM-DD) is a weekend or holiday
   */
  static isHolidayOrWeekend(date: Date): boolean {
    const day = date.getDay();
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    // 0 = Sunday, 6 = Saturday
    if (day === 0 || day === 6) return true;
    if (this.holidays.has(dateStr)) return true;
    
    return false;
  }

  /**
   * Add N working days to a start date
   */
  static addWorkingDays(startDateStr: string, days: number): string {
    const date = new Date(startDateStr);
    
    // Validate input
    if (isNaN(date.getTime())) return startDateStr;

    let added = 0;
    let safetyLoop = 0;

    while (added < days && safetyLoop < 365) {
      // Add 1 day
      date.setDate(date.getDate() + 1);
      
      // Check if it's a working day
      if (!this.isHolidayOrWeekend(date)) {
        added++;
      }
      safetyLoop++;
    }

    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
