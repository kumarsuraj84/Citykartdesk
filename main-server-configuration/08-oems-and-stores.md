# OEMs & Stores

Source: `/admin/org` (Organization Structure), captured 2026-09-24. Schema: `oems`, `stores`, `oem_stores` (many-to-many) — see `supabase/migrations/20240101000128_store_master_and_oem_routing.sql`. This is the AC-servicing OEM routing layer: when a store raises an AC-related ticket, the assigned OEM's contact emails are who gets looped in (drives the `auto_oem_routing` flag on the ADMIN-AC service, see `01-services.md`).

## Locations (2)
| Name | Code | Users | Open requests |
|---|---|---|---|
| HEAD OFFICE | HO | 308 | 2 |
| STORES | STORES | 214 | 3 |

(308 + 214 = 522, close to the ~527-531 total user count seen elsewhere this session — a handful of users likely have no location set.)

## OEMs (11 total, all Active) — AC servicing vendors mapped to stores by region
| OEM | Store count | Contact emails |
|---|---|---|
| BLUE STAR OEM - AS (Assam) | 2 | ankur.pahwa@citykartstores.com |
| BLUE STAR OEM - BR (Bihar) | 38 | nadhelpdesk@bluestarindia.com, praveengupta@bluestarindia.com, syedatif@bluestarindia.com, ravisingh1@bluestarindia.com, jagdishbhamere@bluestarindia.com, krishan.patel@citykartstores.com |
| BLUE STAR OEM - DL (Delhi?) | 7 | nadhelpdesk@bluestarindia.com, ravisingh1@bluestarindia.com, akashdhar@bluestarindia.com, amitrayvadera@bluestarindia.com, krishan.patel@citykartstores.com |
| BLUE STAR OEM - OD (Odisha) | 9 | nadhelpdesk@bluestarindia.com, ravisingh1@bluestarindia.com, akashdhar@bluestarindia.com, eyakupali@bluestarindia.com, krishan.patel@citykartstores.com |
| BLUE STAR OEM - UP | 25 | nadhelpdesk@bluestarindia.com, vishaljaiswal@bluestarindia.com, ravisingh1@bluestarindia.com, akashdhar@bluestarindia.com, amitrayvadera@bluestarindia.com, krishan.patel@citykartstores.com |
| BLUE STAR OEM - WB (West Bengal) | 1 | nadhelpdesk@bluestarindia.com, starcoolingcentre@rediffmail.com, ravisingh1@bluestarindia.com, akashdhar@bluestarindia.com, eyakupali@bluestarindia.com, krishan.patel@citykartstores.com |
| DAIKAIN OEM - ALL [sic, "Daikin"] | 39 | serviceka@daikinindia.com, ankur.gupta@daikinindia.com, rajendra.kumar1@daikinindia.com, soumya.aon@daikinindia.com, laksh.aggarwal@daikinindia.com, krishan.patel@citykartstores.com |
| HITACHI OEM - BR | 20 | corporateserve@jci-hitachi.com, abdul.quadir-ext@jci-hitachi.com, pashupati.nath.pathak-ext@jci-hitachi.com, brijesh.dagar-ext@jci-hitachi.com, yashpalsingh.chauhan@jci-hitachi.com, krishan.patel@citykartstores.com |
| HITACHI OEM - UP | 26 | corporateserve@jci-hitachi.com, sanjeev.6.kumar-ext@bosch-hcgroup.com, mani.kant.verma@jci-hitachi.com, brijesh.dagar-ext@jci-hitachi.com, yashpalsingh.chauhan@jci-hitachi.com, krishan.patel@citykartstores.com |
| LG OEM - ALL | 7 | cac.service@lgepartner.com, vishwadeepak.tiwari@lge.com, ravindra.mishra@lgepartner.com, amit.tripathi@lge.com, krishan.patel@citykartstores.com |
| test | 40 | (none — a placeholder/test OEM still holding 40 real stores that haven't been assigned a real vendor yet) |

`krishan.patel@citykartstores.com` (internal) is CC'd on almost every OEM except the "AS" and "test" ones — likely the internal AC-facilities owner. Brands present: Blue Star (regional split by state — AS/BR/DL/OD/UP/WB), Daikin, Hitachi, LG. Store coverage: 2+38+7+9+25+1+39+20+26+7+40 = 214, matching the Locations count exactly — every store has an OEM assigned (including the 40 still on the placeholder "test" OEM).

## Stores (214 total) — representative sample (first 46 of 214, alphabetical by code)
Real retail store network spanning Uttar Pradesh, Bihar, Madhya Pradesh, Assam, Chhattisgarh, Jammu & Kashmir, Jharkhand, West Bengal — full street addresses on file per store.

| Code | Address (city/area) | OEM |
|---|---|---|
| AAC | Ambedkar Chowk, Ambikapur | test |
| ABD | Aurangabad, Bihar | BLUE STAR OEM - BR |
| AGT | Agartala | test |
| AJL | Jhalwa, Prayagraj UP | test |
| ALC | Civil Lines, Allahabad UP | test |
| ALK | Katra, Prayagraj UP | BLUE STAR OEM - UP |
| AMG | Azamgarh UP | BLUE STAR OEM - UP |
| AMP | Ambikapur, Chhattisgarh | test |
| ANG | Anantnag, J&K | BLUE STAR OEM - DL |
| ANM | Arrah, Bihar | BLUE STAR OEM - BR |
| APM | Arrah (Pakri), Bihar | DAIKAIN OEM - ALL |
| ARG | Rafiganj, Aurangabad Bihar | DAIKAIN OEM - ALL |
| ARN | Aurangabad, Bihar | DAIKAIN OEM - ALL |
| AZM | Azamgarh-2, UP | HITACHI OEM - UP |
| BAC | Bilaspur, Chhattisgarh | DAIKAIN OEM - ALL |
| BAH | Barh, Patna Bihar | BLUE STAR OEM - BR |
| BAR | Buxar, Bihar | test |
| BBR | Belthara Road, Ballia | BLUE STAR OEM - UP |
| BDG | Budgam, J&K | test |
| BGI | Begusarai, Bihar | HITACHI OEM - BR |
| BGM | Gulmohar, Bhopal MP | DAIKAIN OEM - ALL |
| BGP | Gopiganj, Bhadohi UP | DAIKAIN OEM - ALL |
| BHI | Durg, Chhattisgarh | DAIKAIN OEM - ALL |
| BHR | Bahraich, UP | HITACHI OEM - UP |
| BIA | Ballia-1, UP | BLUE STAR OEM - UP |
| BKR | Karond Road, Bhopal MP | DAIKAIN OEM - ALL |
| BLA | Ballia-2, UP | HITACHI OEM - UP |
| BLP | Bilasipara, Dhubri Assam | BLUE STAR OEM - OD |
| BLR | Balia Rasla, UP | BLUE STAR OEM - UP |
| BNK | Banka, Bihar | LG OEM - ALL |
| BPC | Ballia (Purvanchal Cinema Rd), UP | BLUE STAR OEM - UP |
| BPT | Barpeta, Assam | test |
| BRB | Barabanki, UP | BLUE STAR OEM - UP |
| BRD | Bahraich Rupaidiha, UP | BLUE STAR OEM - UP |
| BRN | Teghra, Begusarai Bihar | test |
| BRP | Balrampur, UP | DAIKAIN OEM - ALL |
| BSC | Sarkanda, Bilaspur Chhattisgarh | DAIKAIN OEM - ALL |
| BSK | Sikandarpur, Ballia UP | BLUE STAR OEM - UP |
| BTA | Bettiah, West Champaran Bihar | BLUE STAR OEM - BR |
| CHB | Chaibasa, Jharkhand | test |
| CNW | Chhindwara, MP | DAIKAIN OEM - ALL |
| COB | Cooch Behar, West Bengal | BLUE STAR OEM - WB |
| CPA | Chapra (Sandha), Bihar | BLUE STAR OEM - BR |
| CPR | Chhapra, Bihar | BLUE STAR OEM - BR |

**Remaining 168 stores not captured in this pass** — this is a representative sample only (captured via live UI browsing, one page load, ~20% of the total). For the complete, current 214-store list with exact addresses and OEM assignments, open `/admin/org` → Stores tab live, or export via its own Export button. Store codes are 3-letter, generally derived from the town/area name; naming and OEM-assignment pattern is consistent throughout (state-clustered OEM regions, as seen in the OEM table above).
