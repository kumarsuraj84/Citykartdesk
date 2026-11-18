// The Report Builder gets every ticket of the organization in one go (up to 20,000 rows of ~90 columns). Most columns are empty for most tickets (a ticket has answers for only
// its own service's form fields), and an empty value still costs its full column name in the data sent to the browser: about two thirds of the 30 MB a 9,000-ticket report weighed
// was `"form:...":null`. The server therefore leaves the empty (null) cells out when it sends the rows, together with the list of columns, and the browser puts them back before the
// report is built, so every row has exactly the same columns as before. Pure functions, tested in tests/unit/compact-rows.test.ts.

type Row = Record<string, string | number | boolean | null>

/** Removes the null cells from every row, in place (the rows must be the caller's own copy). Empty text, 0 and false are real values and stay. Returns the columns the rows had. */
export function compactRows<T extends Row>(rows: T[]): string[] {
  const keys = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      keys.add(key)
      if (row[key] === null) delete row[key]
    }
  }
  return [...keys]
}

/** Puts the null cells back so that every row has every column, in place. Returns the same array. */
export function expandRows<T extends Row>(rows: T[], keys: readonly string[]): T[] {
  for (const row of rows) {
    for (const key of keys) {
      if (!(key in row)) (row as Row)[key] = null
    }
  }
  return rows
}
