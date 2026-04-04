export interface DayRecord {
  date:        string; // YYYYMMDD
  count:       number;
  lastUpdate:  string | null;
  categories:  Record<string, number>;
  severities:  Record<string, number>;
}

export interface HistoryData {
  history: DayRecord[];
}
