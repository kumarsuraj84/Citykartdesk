-- Store Master fields kept per store (previously only in an Excel sheet).
-- Generic to every store: cluster, region, priority_list, open_date, festival (city and state already exist).
-- AC service only (used for AC issues / OEM and AMC follow-up): ac_total, ac_brand, ac_amc_brand, ac_amc_vendor, zenatix. All optional; filled by hand on a store or by uploading
-- the Store Master sheet (Admin > Organization Structure > Stores > Upload Store Master).
-- (city and state already exist on stores.)

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS ac_total      integer CHECK (ac_total IS NULL OR ac_total >= 0),
  ADD COLUMN IF NOT EXISTS ac_brand      text,
  ADD COLUMN IF NOT EXISTS ac_amc_brand     text,
  ADD COLUMN IF NOT EXISTS ac_amc_vendor    text,
  ADD COLUMN IF NOT EXISTS zenatix       boolean,
  ADD COLUMN IF NOT EXISTS open_date     date,
  ADD COLUMN IF NOT EXISTS cluster       text,
  ADD COLUMN IF NOT EXISTS region        text,
  ADD COLUMN IF NOT EXISTS priority_list text,
  ADD COLUMN IF NOT EXISTS festival      text;

COMMENT ON COLUMN stores.ac_total      IS 'AC service only: number of ACs installed in the store';
COMMENT ON COLUMN stores.ac_brand      IS 'AC service only: brand of the installed ACs';
COMMENT ON COLUMN stores.ac_amc_brand  IS 'AC service only: brand that holds the AC AMC (annual maintenance contract)';
COMMENT ON COLUMN stores.ac_amc_vendor IS 'AC service only: vendor company that services the ACs under the AMC';
COMMENT ON COLUMN stores.zenatix       IS 'AC service only: whether the store has Zenatix AC monitoring';
COMMENT ON COLUMN stores.open_date     IS 'Date the store opened (null while pending)';
COMMENT ON COLUMN stores.priority_list IS 'Store priority list as per Ops, e.g. Top 50 / ROS';
