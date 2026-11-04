import { stateName } from './open-meteo'

// The AC Calendar shows the outside temperature BY STATE (decided 2026-11-04), not by city: many store towns are not known to the weather service as cities, a state always is.
// Each state is measured at one fixed point (its capital or main city), so no place has to be looked up and nothing but these numbers is ever sent to the weather service.

export interface StatePoint { name: string; point: string; lat: number; lon: number }

/** Key = the state as a plain lower-case name (what stateName() gives: 'JH' and 'Jharkhand' both become 'jharkhand'). */
export const STATE_POINTS: Record<string, StatePoint> = {
  'andaman and nicobar islands': { name: 'Andaman & Nicobar', point: 'Port Blair', lat: 11.62, lon: 92.73 },
  'andhra pradesh': { name: 'Andhra Pradesh', point: 'Vijayawada', lat: 16.51, lon: 80.65 },
  'arunachal pradesh': { name: 'Arunachal Pradesh', point: 'Itanagar', lat: 27.08, lon: 93.61 },
  assam: { name: 'Assam', point: 'Guwahati', lat: 26.14, lon: 91.74 },
  bihar: { name: 'Bihar', point: 'Patna', lat: 25.59, lon: 85.14 },
  chandigarh: { name: 'Chandigarh', point: 'Chandigarh', lat: 30.73, lon: 76.78 },
  chhattisgarh: { name: 'Chhattisgarh', point: 'Raipur', lat: 21.25, lon: 81.63 },
  'dadra and nagar haveli and daman and diu': { name: 'Dadra & Nagar Haveli and Daman & Diu', point: 'Daman', lat: 20.4, lon: 72.83 },
  delhi: { name: 'Delhi', point: 'New Delhi', lat: 28.61, lon: 77.21 },
  goa: { name: 'Goa', point: 'Panaji', lat: 15.5, lon: 73.83 },
  gujarat: { name: 'Gujarat', point: 'Gandhinagar', lat: 23.22, lon: 72.65 },
  haryana: { name: 'Haryana', point: 'Gurugram', lat: 28.46, lon: 77.03 },
  'himachal pradesh': { name: 'Himachal Pradesh', point: 'Shimla', lat: 31.1, lon: 77.17 },
  'jammu and kashmir': { name: 'Jammu & Kashmir', point: 'Jammu', lat: 32.73, lon: 74.87 },
  jharkhand: { name: 'Jharkhand', point: 'Ranchi', lat: 23.34, lon: 85.31 },
  karnataka: { name: 'Karnataka', point: 'Bengaluru', lat: 12.97, lon: 77.59 },
  kerala: { name: 'Kerala', point: 'Thiruvananthapuram', lat: 8.52, lon: 76.94 },
  ladakh: { name: 'Ladakh', point: 'Leh', lat: 34.16, lon: 77.58 },
  lakshadweep: { name: 'Lakshadweep', point: 'Kavaratti', lat: 10.57, lon: 72.64 },
  'madhya pradesh': { name: 'Madhya Pradesh', point: 'Bhopal', lat: 23.26, lon: 77.41 },
  maharashtra: { name: 'Maharashtra', point: 'Mumbai', lat: 19.08, lon: 72.88 },
  manipur: { name: 'Manipur', point: 'Imphal', lat: 24.82, lon: 93.94 },
  meghalaya: { name: 'Meghalaya', point: 'Shillong', lat: 25.57, lon: 91.88 },
  mizoram: { name: 'Mizoram', point: 'Aizawl', lat: 23.73, lon: 92.72 },
  nagaland: { name: 'Nagaland', point: 'Kohima', lat: 25.67, lon: 94.11 },
  odisha: { name: 'Odisha', point: 'Bhubaneswar', lat: 20.3, lon: 85.82 },
  puducherry: { name: 'Puducherry', point: 'Puducherry', lat: 11.93, lon: 79.83 },
  punjab: { name: 'Punjab', point: 'Ludhiana', lat: 30.9, lon: 75.86 },
  rajasthan: { name: 'Rajasthan', point: 'Jaipur', lat: 26.91, lon: 75.79 },
  sikkim: { name: 'Sikkim', point: 'Gangtok', lat: 27.33, lon: 88.61 },
  'tamil nadu': { name: 'Tamil Nadu', point: 'Chennai', lat: 13.08, lon: 80.27 },
  telangana: { name: 'Telangana', point: 'Hyderabad', lat: 17.39, lon: 78.49 },
  tripura: { name: 'Tripura', point: 'Agartala', lat: 23.83, lon: 91.28 },
  'uttar pradesh': { name: 'Uttar Pradesh', point: 'Lucknow', lat: 26.85, lon: 80.95 },
  uttarakhand: { name: 'Uttarakhand', point: 'Dehradun', lat: 30.32, lon: 78.03 },
  'west bengal': { name: 'West Bengal', point: 'Kolkata', lat: 22.57, lon: 88.36 },
}

/** Other spellings seen (lower case, after stateName()) and the state they mean. */
const ALIASES: Record<string, string> = {
  orissa: 'odisha', uttaranchal: 'uttarakhand', pondicherry: 'puducherry', 'new delhi': 'delhi', 'nct of delhi': 'delhi', 'national capital territory of delhi': 'delhi', 'delhi ncr': 'delhi',
  'andaman and nicobar': 'andaman and nicobar islands', 'andaman nicobar islands': 'andaman and nicobar islands', 'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'daman and diu': 'dadra and nagar haveli and daman and diu', 'jammu kashmir': 'jammu and kashmir', 'jammu and kashmir ut': 'jammu and kashmir', 'j and k': 'jammu and kashmir',
}

/** The row marker in the temperature table: a state's saved temperatures sit under city = the state's name and state = this, so they can never be mixed up with an old city row. */
export const STATE_ROW = 'STATE'

/** The state a Store Master / AC sheet value means ('JH', 'Jharkhand', 'JAMMU & KASHMIR', 'Orissa' ...), or null when it is blank or not a state we know ('ALL' ...). */
export function canonicalState(raw: string | null | undefined): StatePoint | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  const k = stateName(v)
  return STATE_POINTS[k] ?? STATE_POINTS[ALIASES[k] ?? ''] ?? null
}
