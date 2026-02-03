export function parseDate(dateStr: string): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  
  const trimmed = dateStr.trim();
  
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.split('T')[0];
  }

  const isoDate = tryParseISO(trimmed);
  if (isoDate) return isoDate;

  const chineseDate = tryParseChineseDate(trimmed);
  if (chineseDate) return chineseDate;

  const relativeDate = tryParseRelativeDate(trimmed);
  if (relativeDate) return relativeDate;

  const commonDate = tryParseCommonFormats(trimmed);
  if (commonDate) return commonDate;

  return '';
}

function tryParseISO(str: string): string {
  const match = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return '';
}

function tryParseChineseDate(str: string): string {
  const patterns = [
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
    /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
  ];

  for (const pattern of patterns) {
    const match = str.match(pattern);
    if (match) {
      const [, year, month, day] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  const monthDayPattern = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
  const monthDayMatch = str.match(monthDayPattern);
  if (monthDayMatch) {
    const [, month, day] = monthDayMatch;
    const year = new Date().getFullYear();
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return '';
}

function tryParseRelativeDate(str: string): string {
  const now = new Date();
  
  if (/刚刚|刚才|just\s*now/i.test(str)) {
    return formatDate(now);
  }

  if (/今天|today/i.test(str)) {
    return formatDate(now);
  }

  if (/昨天|yesterday/i.test(str)) {
    now.setDate(now.getDate() - 1);
    return formatDate(now);
  }

  if (/前天|day\s*before\s*yesterday/i.test(str)) {
    now.setDate(now.getDate() - 2);
    return formatDate(now);
  }

  const minutesMatch = str.match(/(\d+)\s*分钟前|(\d+)\s*minutes?\s*ago/i);
  if (minutesMatch) {
    const minutes = parseInt(minutesMatch[1] || minutesMatch[2]);
    now.setMinutes(now.getMinutes() - minutes);
    return formatDate(now);
  }

  const hoursMatch = str.match(/(\d+)\s*小时前|(\d+)\s*hours?\s*ago/i);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1] || hoursMatch[2]);
    now.setHours(now.getHours() - hours);
    return formatDate(now);
  }

  const daysMatch = str.match(/(\d+)\s*天前|(\d+)\s*days?\s*ago/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1] || daysMatch[2]);
    now.setDate(now.getDate() - days);
    return formatDate(now);
  }

  const weeksMatch = str.match(/(\d+)\s*周前|(\d+)\s*weeks?\s*ago/i);
  if (weeksMatch) {
    const weeks = parseInt(weeksMatch[1] || weeksMatch[2]);
    now.setDate(now.getDate() - weeks * 7);
    return formatDate(now);
  }

  const monthsMatch = str.match(/(\d+)\s*个?月前|(\d+)\s*months?\s*ago/i);
  if (monthsMatch) {
    const months = parseInt(monthsMatch[1] || monthsMatch[2]);
    now.setMonth(now.getMonth() - months);
    return formatDate(now);
  }

  const yearsMatch = str.match(/(\d+)\s*年前|(\d+)\s*years?\s*ago/i);
  if (yearsMatch) {
    const years = parseInt(yearsMatch[1] || yearsMatch[2]);
    now.setFullYear(now.getFullYear() - years);
    return formatDate(now);
  }

  return '';
}

function tryParseCommonFormats(str: string): string {
  const patterns = [
    { regex: /(\d{1,2})\/(\d{1,2})\/(\d{4})/, order: [3, 1, 2] },
    { regex: /(\d{1,2})-(\d{1,2})-(\d{4})/, order: [3, 1, 2] },
    { regex: /(\d{1,2})\.(\d{1,2})\.(\d{4})/, order: [3, 2, 1] },
    { regex: /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i, handler: parseEnglishMonth },
    { regex: /(\d{1,2})\s+(\w+)\s+(\d{4})/i, handler: parseEnglishMonthAlt },
  ];

  for (const { regex, order, handler } of patterns) {
    const match = str.match(regex);
    if (match) {
      if (handler) {
        return handler(match);
      }
      if (order) {
        const [year, month, day] = order.map(i => match[i]);
        const y = parseInt(year);
        const m = parseInt(month);
        const d = parseInt(day);
        if (y > 1900 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
          return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
      }
    }
  }

  return '';
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseEnglishMonth(match: RegExpMatchArray): string {
  const monthStr = match[1].toLowerCase();
  const day = parseInt(match[2]);
  const year = parseInt(match[3]);
  const month = MONTH_MAP[monthStr];
  
  if (month && day >= 1 && day <= 31 && year > 1900 && year < 2100) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return '';
}

function parseEnglishMonthAlt(match: RegExpMatchArray): string {
  const day = parseInt(match[1]);
  const monthStr = match[2].toLowerCase();
  const year = parseInt(match[3]);
  const month = MONTH_MAP[monthStr];
  
  if (month && day >= 1 && day <= 31 && year > 1900 && year < 2100) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return '';
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
