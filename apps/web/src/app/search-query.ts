import { Observable, debounceTime, distinctUntilChanged, map } from 'rxjs';

export function searchQuery$(input$: Observable<string>): Observable<string | undefined> {
  return input$.pipe(
    debounceTime(300),
    map((value) => value.trim()),
    distinctUntilChanged(),
    map((search) => search || undefined),
  );
}
