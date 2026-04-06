-- ============================================================
-- WORLD MONITOR — BigQuery view definitions
-- Run these once in your GCP project to create the two views.
-- Replace <YOUR_PROJECT> and <YOUR_DATASET> with your values.
--
-- After creation, set these env vars on Railway:
--   GDELT_EVENTS_VIEW=<YOUR_PROJECT>.<YOUR_DATASET>.recent_events_raw_24h
--
-- Without GDELT_EVENTS_VIEW set, gdelt.js queries the public
-- gdelt-bq.gdeltv2.events table directly (works fine, costs ~$0.01/query).
-- ============================================================


-- ── VIEW 1: recent_events_raw_24h ────────────────────────────────────────
-- Individual conflict/violence events from the last 24 hours.
-- Equivalent to the raw CSV ingestion but pre-filtered in BigQuery.

CREATE OR REPLACE VIEW `<YOUR_PROJECT>.<YOUR_DATASET>.recent_events_raw_24h` AS
SELECT
  CAST(GlobalEventID AS STRING)     AS id,
  CAST(SQLDATE AS STRING)           AS event_timestamp,
  IFNULL(ActionGeo_FullName, '')    AS location,
  IFNULL(ActionGeo_CountryCode, '') AS country_code,
  Actor1Name,
  Actor2Name,
  EventCode,
  EventRootCode,
  QuadClass,
  CASE
    WHEN EventRootCode IN ('18','19','20') THEN 'hard_events'
    WHEN EventRootCode = '14'              THEN 'protests'
    WHEN EventRootCode IN ('03','04','05') THEN 'diplomacy'
    ELSE 'other'
  END                               AS layer_type,
  GoldsteinScale,
  NumMentions,
  NumSources,
  NumArticles,
  AvgTone,
  CAST(ActionGeo_Type AS STRING)    AS geo_type,
  ActionGeo_Lat                     AS latitude,
  ActionGeo_Long                    AS longitude,
  SOURCEURL
FROM `gdelt-bq.gdeltv2.events`
WHERE
  _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 26 HOUR)
  AND ActionGeo_Lat  IS NOT NULL
  AND ActionGeo_Long IS NOT NULL
  AND ActionGeo_Lat  != 0
  AND ActionGeo_Long != 0
  AND SOURCEURL IS NOT NULL
  AND SOURCEURL != ''
  AND QuadClass IN (3, 4)
  AND EventRootCode IN ('03','04','05','13','14','15','16','17','18','19','20')
  AND (
    (QuadClass = 4 AND GoldsteinScale <= -1.0)
    OR
    (QuadClass = 3 AND GoldsteinScale <= -5.0)
  )
;


-- ── VIEW 2: signal_hotspots_24h ──────────────────────────────────────────
-- Events aggregated into geographic hotspots (0.5° grid).
-- Used for dashboards or upstream alerting; gdelt.js replicates this
-- in-memory from recent_events_raw_24h so a second query is not required.

CREATE OR REPLACE VIEW `<YOUR_PROJECT>.<YOUR_DATASET>.signal_hotspots_24h` AS
WITH base AS (
  SELECT
    ROUND(ActionGeo_Lat  * 2) / 2  AS lat_grid,
    ROUND(ActionGeo_Long * 2) / 2  AS lon_grid,
    EventRootCode                   AS root_code,
    CASE
      WHEN EventRootCode IN ('18','19','20') THEN 'hard_events'
      WHEN EventRootCode = '14'              THEN 'protests'
      WHEN EventRootCode IN ('03','04','05') THEN 'diplomacy'
      ELSE 'other'
    END                             AS layer_type,
    -- Base severity score per CAMEO root code
    CASE EventRootCode
      WHEN '19' THEN 100
      WHEN '18' THEN 80
      WHEN '20' THEN 80
      WHEN '14' THEN 50
      ELSE 20
    END                             AS base_severity,
    -- Recency weight: highest within last 2 hours
    CASE
      WHEN _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 HOUR)
        THEN 1.5
      WHEN _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 HOUR)
        THEN 1.2
      ELSE 1.0
    END                             AS recency_weight,
    -- Logarithmic media score prevents major-outlet dominance
    LN(1 + NumMentions + NumSources * 2 + NumArticles) * 5  AS media_score,
    ActionGeo_FullName              AS location_name,
    ActionGeo_CountryCode           AS country_code,
    GoldsteinScale,
    AvgTone,
    NumMentions,
    NumSources,
    NumArticles
  FROM `gdelt-bq.gdeltv2.events`
  WHERE
    _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 26 HOUR)
    AND ActionGeo_Lat  IS NOT NULL
    AND ActionGeo_Long IS NOT NULL
    AND ActionGeo_Lat  != 0
    AND ActionGeo_Long != 0
    AND QuadClass IN (3, 4)
    AND EventRootCode IN ('03','04','05','13','14','15','16','17','18','19','20')
    AND (
      (QuadClass = 4 AND GoldsteinScale <= -1.0)
      OR
      (QuadClass = 3 AND GoldsteinScale <= -5.0)
    )
)
SELECT
  lat_grid                                        AS latitude,
  lon_grid                                        AS longitude,
  -- Most common location name in this cell
  ANY_VALUE(location_name)                        AS location_name,
  ANY_VALUE(country_code)                         AS country_code,
  -- Dominant event type (hard_events > protests > diplomacy)
  MAX(layer_type)                                 AS layer_type,
  COUNT(*)                                        AS event_count,
  SUM(NumMentions)                                AS total_mentions,
  SUM(NumSources)                                 AS total_sources,
  SUM(NumArticles)                                AS total_articles,
  AVG(GoldsteinScale)                             AS avg_goldstein_scale,
  AVG(AvgTone)                                    AS avg_tone,
  MAX(base_severity)                              AS severity_score,
  -- final_signal_score: severity × recency + media boost, capped at 200
  LEAST(200, ROUND(
    MAX(base_severity) * MAX(recency_weight)
    + MAX(media_score)
    + COUNT(*) * 2
  ))                                              AS final_signal_score
FROM base
GROUP BY lat_grid, lon_grid
-- Keep only meaningful clusters: multiple events OR a severe single event
HAVING event_count > 1 OR severity_score >= 80
ORDER BY final_signal_score DESC
;
